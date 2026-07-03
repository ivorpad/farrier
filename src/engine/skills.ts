import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillRef } from "../packs/types";

export type SkillSearchResult = {
  skillId: string;
  name: string;
  installs: number;
  source: string;
};

export type CommandRunnerInput = {
  cmd: string[];
  cwd: string;
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

export async function searchSkills(q: string): Promise<SkillSearchResult[]> {
  const query = q.trim();

  if (query.length === 0) {
    return [];
  }

  const baseUrl = (process.env.SKILLS_API_URL || "https://skills.sh").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=10`);

  if (!response.ok) {
    throw new Error(`skills search failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as { skills?: unknown[] };
  const skills = Array.isArray(body.skills) ? body.skills : [];

  return skills.map(normalizeSkill).filter(isSkillSearchResult);
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
    stderr: "pipe"
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("")
  ]);

  return {
    exitCode,
    stdout,
    stderr
  };
}

export async function installSkills(
  refs: SkillRef[],
  targetDir: string,
  runner: CommandRunner = defaultRunner,
  resolveDeps: ResolveSkillsCommandDeps = defaultResolveDeps
): Promise<InstallSkillResult[]> {
  const uniqueRefs = Array.from(new Set(refs));
  const results: InstallSkillResult[] = [];

  let commandHead: string[];

  try {
    commandHead = resolveSkillsCommand(resolveDeps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    for (const ref of uniqueRefs) {
      results.push({
        ref,
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: 1,
        error: message
      });
    }

    return results;
  }

  const commandLabel = commandHead.join(" ");

  for (const ref of uniqueRefs) {
    const parsed = parseSkillRef(ref);

    if (!parsed) {
      results.push({
        ref,
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: 1,
        error: `Invalid skill ref '${ref}'. Expected <source>@<skillId>.`
      });
      continue;
    }

    const cmd = [...commandHead, "add", parsed.source, "-s", parsed.skillId, "-a", "claude-code", "codex", "-y"];

    try {
      const output = await runner({
        cmd,
        cwd: targetDir
      });

      results.push({
        ref,
        ok: output.exitCode === 0,
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.exitCode,
        error:
          output.exitCode === 0
            ? undefined
            : `${commandLabel} add exited with code ${output.exitCode}. Try installing the skills CLI or set FARRIER_SKILLS_BIN.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      results.push({
        ref,
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: 1,
        error: `${message} (ran '${commandLabel}'). Try installing the skills CLI or set FARRIER_SKILLS_BIN.`
      });
    }
  }

  return results;
}
