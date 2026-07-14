import { Effect } from "effect";
import { existsSync } from "node:fs";
import { lstat, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillRef } from "../packs/types";
import { applyMutationPlan, inspectMutationPlan, type MutationOperation } from "./mutation-transaction";
import { withIsolatedExecution, type IsolationFact, type IsolatedInput } from "./execution-isolation";

export type SkillSearchResult = {
  skillId: string;
  name: string;
  installs: number;
  source: string;
};

export type CommandRunnerInput = {
  cmd: string[];
  cwd: string;
  signal?: AbortSignal;
  env?: Record<string, string>;
};

export type CommandRunnerOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (input: CommandRunnerInput) => Promise<CommandRunnerOutput>;

export type InstallSkillResult = {
  ref: SkillRef;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
  isolation?: IsolationFact;
};

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeSkill(value: unknown): SkillSearchResult | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const skillId = stringField(record.skillId) ?? stringField(record.id);
  const source = stringField(record.source);

  if (!skillId || !source) {
    return undefined;
  }

  const installs = typeof record.installs === "number" && Number.isFinite(record.installs) ? record.installs : 0;

  return {
    skillId,
    name: stringField(record.name) ?? skillId,
    installs,
    source
  };
}

function isSkillSearchResult(value: SkillSearchResult | undefined): value is SkillSearchResult {
  return value !== undefined;
}

export async function searchSkills(q: string, options?: { signal?: AbortSignal }): Promise<SkillSearchResult[]> {
  const query = q.trim();

  if (query.length === 0) {
    return [];
  }

  const baseUrl = (process.env.SKILLS_API_URL || "https://skills.sh").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=10`, {
    signal: options?.signal
  });

  if (!response.ok) {
    throw new Error(`skills search failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as { skills?: unknown[] };
  const skills = Array.isArray(body.skills) ? body.skills : [];

  return skills
    .map(normalizeSkill)
    .filter(isSkillSearchResult)
    .sort((a, b) => b.installs - a.installs);
}

function parseSkillRef(ref: SkillRef): { source: string; skillId: string } | undefined {
  const separator = ref.lastIndexOf("@");

  if (separator <= 0 || separator === ref.length - 1) {
    return undefined;
  }

  const source = ref.slice(0, separator);
  const skillId = ref.slice(separator + 1);

  if (!source || !skillId) {
    return undefined;
  }

  return { source, skillId };
}

// The external CLI owns a shared lock/manifest surface. Run sources one at a
// time so reviewed staged transactions cannot race each other.
const INSTALL_CONCURRENCY = 1;
const skillsEnvironmentPassthrough = [
  "GITHUB_TOKEN", "GH_TOKEN", "GITLAB_TOKEN", "GITLAB_PRIVATE_TOKEN",
  "BITBUCKET_TOKEN", "BITBUCKET_USERNAME", "BITBUCKET_APP_PASSWORD",
  "SSH_AUTH_SOCK", "GIT_ASKPASS", "SSH_ASKPASS", "GIT_SSH_COMMAND", "GIT_SSH_VARIANT",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "no_proxy"
] as const;

async function readLockedSkillIds(targetDir: string): Promise<Set<string> | undefined> {
  try {
    const content = await readFile(join(targetDir, "skills-lock.json"), "utf-8");
    const parsed = JSON.parse(content) as { skills?: Record<string, unknown> };

    if (!parsed.skills || typeof parsed.skills !== "object") {
      return undefined;
    }

    return new Set(Object.keys(parsed.skills));
  } catch {
    return undefined;
  }
}

export type ResolveSkillsCommandDeps = {
  which: (bin: string) => string | null;
  exists: (path: string) => boolean;
};

const defaultResolveDeps: ResolveSkillsCommandDeps = {
  which: (bin) => Bun.which(bin),
  exists: (path) => existsSync(path)
};

function bundledSkillsBinPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "..", "..", "node_modules", ".bin", "skills");
}

export function resolveSkillsCommand(deps: ResolveSkillsCommandDeps = defaultResolveDeps): string[] {
  const envBin = process.env.FARRIER_SKILLS_BIN;

  if (envBin && envBin.trim().length > 0) {
    return envBin.trim().split(/\s+/);
  }

  const bundledBin = bundledSkillsBinPath();

  if (deps.exists(bundledBin)) {
    return [bundledBin];
  }

  if (deps.which("skills")) {
    return ["skills"];
  }

  if (deps.which("bunx")) {
    return ["bunx", "skills"];
  }

  if (deps.which("pnpm")) {
    return ["pnpm", "dlx", "skills"];
  }

  throw new Error(
    "Could not find the skills CLI. Install it as a dependency (bundled at node_modules/.bin/skills), " +
      "add it to PATH, set FARRIER_SKILLS_BIN, or ensure bunx or pnpm is available."
  );
}

async function defaultRunner(input: CommandRunnerInput): Promise<CommandRunnerOutput> {
  const proc = Bun.spawn({
    cmd: input.cmd,
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: input.env,
    detached: true
  });

  const abort = () => {
    try { process.kill(-proc.pid, "SIGTERM"); } catch { proc.kill(); }
  };
  input.signal?.addEventListener("abort", abort, { once: true });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("")
  ]);

  input.signal?.removeEventListener("abort", abort);
  return {
    exitCode,
    stdout,
    stderr
  };
}

export const defaultInstallAgents = ["claude-code", "codex"];

export async function installSkills(
  refs: SkillRef[],
  targetDir: string,
  runner: CommandRunner = defaultRunner,
  resolveDeps: ResolveSkillsCommandDeps = defaultResolveDeps,
  agents: string[] = defaultInstallAgents,
  global = false
): Promise<InstallSkillResult[]> {
  const uniqueRefs = Array.from(new Set(refs));
  const resultByRef = new Map<SkillRef, InstallSkillResult>();

  let commandHead: string[];

  try {
    commandHead = resolveSkillsCommand(resolveDeps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return uniqueRefs.map((ref) => ({
      ref,
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: 1,
      error: message
    }));
  }

  const commandLabel = commandHead.join(" ");
  const refsBySource = new Map<string, { ref: SkillRef; skillId: string }[]>();

  for (const ref of uniqueRefs) {
    const parsed = parseSkillRef(ref);

    if (!parsed) {
      resultByRef.set(ref, {
        ref,
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: 1,
        error: `Invalid skill ref '${ref}'. Expected <source>@<skillId>.`
      });
      continue;
    }

    const group = refsBySource.get(parsed.source) ?? [];
    group.push({ ref, skillId: parsed.skillId });
    refsBySource.set(parsed.source, group);
  }

  const installSource = async (source: string, skillIds: string[]): Promise<InstallSkillResult[]> => {
    const cmd = [...commandHead, "add", source, "-s", ...skillIds, "-a", ...agents, ...(global ? ["-g"] : []), "-y"];
    const refs = skillIds.map((skillId): SkillRef => `${source}@${skillId}`);

    let output: CommandRunnerOutput;
    let runError: string | undefined;

    let isolation: IsolationFact | undefined;
    let workspace: string | undefined;
    try {
      const inputs: IsolatedInput[] = [];
      const localSource = source.startsWith("./") ? join(targetDir, source.slice(2)) : undefined;
      if (localSource && (await lstat(localSource).catch(() => undefined))) inputs.push({ source: localSource, path: source.slice(2) });
      const lockPath = join(targetDir, "skills-lock.json");
      if (!global && (await lstat(lockPath).catch(() => undefined))) inputs.push({ source: lockPath, path: "skills-lock.json" });
      const isolated = await withIsolatedExecution({
        targetDir,
        inputs,
        nativeConfinement: false,
        environmentPassthrough: skillsEnvironmentPassthrough,
        environmentOverrides: {
          GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL ?? join(homedir(), ".gitconfig")
        },
        retainWorkspace: true,
        run: async (context) => ({
          output: await runner({ cmd, cwd: context.workspace, signal: context.signal, env: context.environment }),
          workspace: context.workspace
        })
      });
      output = isolated.value.output;
      workspace = isolated.value.workspace;
      isolation = isolated.isolation;
      if (output.exitCode === 0) {
        const allowed = new Set([".claude", ".agents", ".codex", "skills-lock.json", "skills", "home", "tmp"]);
        const unexpected = (await readdir(workspace)).filter((entry) => !allowed.has(entry));
        if (unexpected.length > 0) throw new Error(`skills CLI produced unexpected output: ${unexpected.sort().join(", ")}`);

        const outputRoot = global ? join(workspace, "home") : workspace;
        const destinationRoot = global ? (process.env.HOME || homedir()) : targetDir;
        const roots = agents.map((agent) => global
          ? (agent === "claude-code" ? ".claude/skills" : ".codex/skills")
          : (agent === "claude-code" ? ".claude/skills" : ".agents/skills"));
        const operations: MutationOperation[] = [];
        for (const root of roots) {
          for (const skillId of skillIds) {
            const staged = join(outputRoot, root, skillId);
            if ((await lstat(staged).catch(() => undefined))?.isDirectory()) {
              operations.push({ kind: "replace-tree", path: `${root}/${skillId}`, sourcePath: staged });
            }
          }
        }
        const stagedLock = join(workspace, "skills-lock.json");
        if (!global && (await lstat(stagedLock).catch(() => undefined))?.isFile()) {
          const stagedDocument = JSON.parse(await readFile(stagedLock, "utf8")) as { version?: unknown; skills?: Record<string, unknown> };
          const currentDocument = await readFile(join(targetDir, "skills-lock.json"), "utf8")
            .then((value) => JSON.parse(value) as { version?: unknown; skills?: Record<string, unknown> })
            .catch(() => ({ version: stagedDocument.version, skills: {} }));
          const merged = {
            ...currentDocument,
            ...stagedDocument,
            skills: { ...(currentDocument.skills ?? {}), ...(stagedDocument.skills ?? {}) }
          };
          operations.push({ kind: "write-file", path: "skills-lock.json", content: `${JSON.stringify(merged, null, 2)}\n` });
        }
        if (operations.length > 0) await applyMutationPlan(await inspectMutationPlan(destinationRoot, operations));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output = { exitCode: 1, stdout: "", stderr: "" };
      runError = `${message} (ran '${commandLabel}'). Try installing the skills CLI or set FARRIER_SKILLS_BIN.`;
    } finally {
      if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }

    return refs.map((ref) => ({
      ref,
      ok: !runError && output.exitCode === 0,
      stdout: output.stdout,
      stderr: output.stderr,
      exitCode: output.exitCode,
      isolation,
      error:
        runError ??
        (output.exitCode === 0
          ? undefined
          : `${commandLabel} add exited with code ${output.exitCode}. Try installing the skills CLI or set FARRIER_SKILLS_BIN.`)
    }));
  };

  // One `skills add` per source (the -s flag takes multiple skill ids), so each
  // source repo is cloned once. Sources run concurrently, capped so a long
  // source list doesn't spawn unbounded clones.
  const sourceResults = await Effect.runPromise(
    Effect.forEach(
      Array.from(refsBySource.entries()),
      ([source, group]) =>
        Effect.promise(() => installSource(source, group.map((entry) => entry.skillId))),
      { concurrency: INSTALL_CONCURRENCY }
    )
  );

  for (const result of sourceResults.flat()) {
    resultByRef.set(result.ref, result);
  }

  // The skills CLI updates skills-lock.json via read-modify-write with no file
  // locking, so concurrent invocations can drop each other's lock entries even
  // when every install succeeded. Verify the lock and re-run the raced skills
  // sequentially (sequential = no race, so one repair pass converges).
  if (refsBySource.size > 1) {
    const lockedSkillIds = await readLockedSkillIds(targetDir);

    if (lockedSkillIds) {
      for (const [source, group] of refsBySource) {
        const missing = group.filter(
          (entry) => resultByRef.get(entry.ref)?.ok && !lockedSkillIds.has(entry.skillId)
        );

        if (missing.length === 0) {
          continue;
        }

        const repaired = await installSource(source, missing.map((entry) => entry.skillId));

        for (const result of repaired) {
          resultByRef.set(result.ref, result);
        }
      }
    }
  }

  return uniqueRefs
    .map((ref) => resultByRef.get(ref))
    .filter((result): result is InstallSkillResult => result !== undefined);
}
