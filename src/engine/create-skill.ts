import { existsSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { ResolvedModelSettings } from "../config/farrier-config";
import {
  backendCommand,
  defaultBackendRunner,
  formatBackendStreamActivity,
  type AgentBackend,
  type BackendCommandRunner
} from "./backend";
import { placeSkillTrees } from "./skill-placement";
import { nativeSkillPath, nativeSkillRoots } from "./skill-paths";
import {
  snapshotSkillRoot,
  validateCreatedSkill,
  type ValidatedSkill
} from "./skill-validate";
import {
  installSkills,
  type CommandRunner,
  type InstallSkillResult,
  type ResolveSkillsCommandDeps
} from "./skills";

export { scaffoldSkillDraft, slugifySkillName, validateCreatedSkill, type SkillDraft } from "./skill-validate";
export { nativeSkillRoots } from "./skill-paths";

export type CreateAgent = AgentBackend;
export type AuthoringMode = "author-claude" | "author-codex" | "per-agent";
export type SkillLayout = "native" | "shared";

/** Canonical fields are authors/layout. agents/mode remain readable in 0.4.x. */
export type SkillCreationRequest = {
  description: string;
  authors?: CreateAgent[];
  layout?: SkillLayout;
  /** @deprecated */
  agents?: CreateAgent[];
  /** @deprecated */
  mode?: AuthoringMode;
  nameOverride?: string;
  model?: string;
};

export type NormalizedSkillCreationRequest = SkillCreationRequest & {
  authors: CreateAgent[];
  layout: SkillLayout;
};

export type SkillCreationOutcome = {
  request: SkillCreationRequest;
  authors?: CreateAgent[];
  layout?: SkillLayout;
  name?: string;
  names?: Partial<Record<CreateAgent, string>>;
  files: string[];
  installed: boolean;
  notes: string[];
  backupDir?: string | null;
  error?: string;
};

const defaultCreatorRefs: Record<CreateAgent, string | undefined> = {
  claude: "anthropics/skills@skill-creator",
  codex: undefined
};

const creatorRefEnvVars: Record<CreateAgent, string> = {
  claude: "FARRIER_CREATOR_CLAUDE",
  codex: "FARRIER_CREATOR_CODEX"
};

const skillsCliAgentIds: Record<CreateAgent, string> = { claude: "claude-code", codex: "codex" };

/** @deprecated New authoring never writes this root. */
export const canonicalSkillRoot = "skills";

export function normalizeSkillCreationRequest(request: SkillCreationRequest): NormalizedSkillCreationRequest {
  let canonical: { authors: CreateAgent[]; layout: SkillLayout } | undefined;
  if (request.authors || request.layout) {
    if (!request.authors || !request.layout) throw new Error("canonical skill requests require both authors and layout");
    if (request.authors.length < 1 || request.authors.length > 2) throw new Error("authors must contain one or two providers");
    if (new Set(request.authors).size !== request.authors.length) throw new Error("duplicate --author values are not allowed");
    if (request.authors.some((author) => author !== "claude" && author !== "codex")) throw new Error("authors must contain only claude and codex");
    if (request.layout === "shared" && request.authors.length !== 1) throw new Error("shared layout requires exactly one author");
    if (request.model && request.authors.length > 1) throw new Error("one --model cannot be used with two authors; configure each provider model instead");
    canonical = { authors: [...request.authors], layout: request.layout };
  }

  let legacy: { authors: CreateAgent[]; layout: SkillLayout } | undefined;
  if (request.agents || request.mode) {
    const agents = [...new Set(request.agents ?? [])];
    if (agents.length === 0) throw new Error("legacy skill request requires at least one agent");
    if (request.mode === "per-agent") {
      if (agents.length !== 2 || !agents.includes("claude") || !agents.includes("codex")) {
        throw new Error("legacy per-agent mode requires --agents claude,codex");
      }
      legacy = { authors: agents, layout: "native" };
    } else if (request.mode === "author-claude" || request.mode === "author-codex") {
      const author = request.mode === "author-claude" ? "claude" : "codex";
      if (!agents.includes(author)) throw new Error(`legacy ${request.mode} requires ${author} in --agents`);
      legacy = { authors: [author], layout: agents.length === 2 ? "shared" : "native" };
    } else if (agents.length === 1) {
      legacy = { authors: agents, layout: "native" };
    } else {
      throw new Error("legacy multiple --agents values require --mode");
    }
  }

  if (canonical && legacy && (canonical.layout !== legacy.layout || canonical.authors.join(",") !== legacy.authors.join(","))) {
    throw new Error("canonical --author/--shared selection conflicts with legacy --agents/--mode");
  }
  const resolved = canonical ?? legacy;
  if (!resolved) throw new Error("skill creation requires at least one author");
  return { ...request, ...resolved };
}

export function creatorRef(agent: CreateAgent): string | undefined {
  const override = process.env[creatorRefEnvVars[agent]];
  return override !== undefined && override.trim() !== "" ? override : defaultCreatorRefs[agent];
}

export function resolvedHomedir(): string {
  return process.env.HOME || homedir();
}

export function globalSkillRoot(agent: CreateAgent): string {
  return join(resolvedHomedir(), agent === "claude" ? ".claude" : ".codex", "skills");
}

async function lockedSkillIds(targetDir: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await readFile(join(targetDir, "skills-lock.json"), "utf8")) as { skills?: Record<string, unknown> };
    return new Set(parsed.skills && typeof parsed.skills === "object" ? Object.keys(parsed.skills) : []);
  } catch {
    return new Set();
  }
}

export async function ensureCreatorInstalled(
  agent: CreateAgent,
  targetDir: string,
  runner?: CommandRunner,
  resolveDeps?: ResolveSkillsCommandDeps
): Promise<InstallSkillResult | undefined> {
  const ref = creatorRef(agent);
  if (!ref) return undefined;
  const skillId = ref.slice(ref.lastIndexOf("@") + 1);
  if ((await lockedSkillIds(targetDir)).has(skillId)) return { ref, ok: true, stdout: "", stderr: "", exitCode: 0 };
  const exists = resolveDeps?.exists ?? existsSync;
  if (exists(join(globalSkillRoot(agent), skillId, "SKILL.md"))) return { ref, ok: true, stdout: "", stderr: "", exitCode: 0 };
  return (await installSkills([ref], targetDir, runner, resolveDeps, [skillsCliAgentIds[agent]], true))[0];
}

const descriptionCharLimit = 16_000;

export function buildAuthoringPrompt(input: {
  agent: CreateAgent;
  description: string;
  outputRoot: string;
  nameOverride?: string;
}): string {
  const creator = input.agent === "claude" ? "Use the skill-creator skill installed in this project" : "Use the built-in $skill-creator skill";
  const description = input.description.length <= descriptionCharLimit
    ? input.description
    : `${input.description.slice(0, descriptionCharLimit)}\n\n[request truncated to ${descriptionCharLimit} characters]`;
  const nameLine = input.nameOverride ? `\n- Name the skill exactly '${input.nameOverride}'.` : "";
  return `${creator} to create exactly one agent skill for the request below.
Requirements:
- Create the skill directory under ${input.outputRoot}/ only, as ${input.outputRoot}/<skill-name>/SKILL.md plus any supporting files inside that same directory. Do not create or modify any other files.
- SKILL.md must start with YAML frontmatter containing name (kebab-case, at most 64 characters, matching the directory name) and description (one sentence saying what the skill does and when to use it).${nameLine}
- Do not ask questions; make reasonable decisions and finish.
Skill request:
${description}
`;
}

export type SkillCreationPhase = "creator" | "authoring" | "validating" | "placement" | "installing";
export type CollisionDecision = "replace" | "keep";
export type CollisionInfo = { path: string; stagingPath: string };

export type CreateSkillDeps = {
  backendRunner?: BackendCommandRunner;
  skillsRunner?: CommandRunner;
  resolveDeps?: ResolveSkillsCommandDeps;
  /** @deprecated Local placement is the installation. */
  install?: boolean;
  force?: boolean;
  progress?: (phase: SkillCreationPhase, agent?: CreateAgent, activity?: string) => void;
  serializeInstall?: <T>(fn: () => Promise<T>) => Promise<T>;
  signal?: AbortSignal;
  onCollision?: (info: CollisionInfo) => Promise<CollisionDecision>;
  modelSettings?: Partial<Record<CreateAgent, ResolvedModelSettings>>;
};

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("cancelled");
}

export type StageSkillInput = {
  agent: CreateAgent;
  description: string;
  targetDir: string;
  model?: string;
  nameOverride?: string;
  deps: CreateSkillDeps;
  creatorReady?: boolean;
  cleanupOnFailure?: boolean;
};

export async function stageSkill(input: StageSkillInput): Promise<{ stagingRoot: string; validated: ValidatedSkill }> {
  if (!input.creatorReady) {
    input.deps.progress?.("creator", input.agent);
    const result = await ensureCreatorInstalled(input.agent, input.targetDir, input.deps.skillsRunner, input.deps.resolveDeps);
    if (result && !result.ok) throw new Error(`Could not install the ${input.agent} creator skill (${result.ref}): ${result.error ?? result.stderr}`);
  }
  const stagingRoot = `.farrier-staging/authoring/${crypto.randomUUID().slice(0, 8)}`;
  try {
    await mkdir(join(input.targetDir, stagingRoot), { recursive: true });
    const before = await snapshotSkillRoot(join(input.targetDir, stagingRoot));
    const prompt = buildAuthoringPrompt({ agent: input.agent, description: input.description, outputRoot: stagingRoot, nameOverride: input.nameOverride });
    throwIfCancelled(input.deps.signal);
    input.deps.progress?.("authoring", input.agent);
    const settings = input.deps.modelSettings?.[input.agent];
    const model = input.model ?? settings?.model ?? (input.agent === "claude" ? "opus" : undefined);
    const reasoningEffort = settings?.reasoningEffort ?? (input.agent === "codex" ? "high" : undefined);
    const command = backendCommand(input.agent, model, prompt, { write: true, stream: true, reasoningEffort });
    const output = await (input.deps.backendRunner ?? defaultBackendRunner)({
      cmd: command.cmd,
      cwd: input.targetDir,
      stdin: command.stdin,
      signal: input.deps.signal,
      onStdoutLine: (line) => {
        const activity = formatBackendStreamActivity(input.agent, line);
        if (activity) input.deps.progress?.("authoring", input.agent, activity);
      }
    });
    if (input.deps.signal?.aborted) throw new Error(`cancelled; killed the ${input.agent} run`);
    if (output.exitCode !== 0) throw new Error(`${input.agent} backend exited with code ${output.exitCode}${output.stderr.trim() ? `: ${output.stderr.trim()}` : ""}`);
    input.deps.progress?.("validating", input.agent);
    const validated = await validateCreatedSkill({
      targetDir: input.targetDir,
      root: stagingRoot,
      before,
      backend: input.agent,
      nameOverride: input.nameOverride
    });
    return { stagingRoot, validated };
  } catch (error) {
    if (input.cleanupOnFailure) {
      await rm(join(input.targetDir, stagingRoot), { recursive: true, force: true });
      await rmdir(join(input.targetDir, ".farrier-staging", "authoring")).catch(() => undefined);
    }
    throw error;
  }
}

/** @deprecated Kept for compatibility with third-party/legacy canonical installs. */
export async function installLocalSkill(
  name: string,
  targetDir: string,
  agents: CreateAgent[],
  runner?: CommandRunner,
  resolveDeps?: ResolveSkillsCommandDeps
): Promise<InstallSkillResult> {
  return (await installSkills([`./${canonicalSkillRoot}@${name}`], targetDir, runner, resolveDeps, agents.map((agent) => skillsCliAgentIds[agent])))[0]!;
}

/** @deprecated New placement updates all native refs transactionally. */
export async function recordSkillInManifest(targetDir: string, ref: string): Promise<boolean> {
  const path = join(targetDir, ".farrier.json");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (!Array.isArray(manifest.skills)) return false;
  if (!manifest.skills.includes(ref)) {
    manifest.skills.push(ref);
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return true;
}

function outcomeFiles(
  legs: Array<{ author: CreateAgent; stagingRoot: string; validated: ValidatedSkill }>,
  layout: SkillLayout
): string[] {
  if (layout === "shared") {
    const leg = legs[0]!;
    const real = nativeSkillPath("codex", leg.validated.name);
    return [
      ...leg.validated.files.map((file) => `${real}/${file.slice(`${leg.stagingRoot}/${leg.validated.name}/`.length)}`),
      nativeSkillPath("claude", leg.validated.name)
    ];
  }
  return legs.flatMap((leg) => {
    const root = nativeSkillPath(leg.author, leg.validated.name);
    return leg.validated.files.map((file) => `${root}/${file.slice(`${leg.stagingRoot}/${leg.validated.name}/`.length)}`);
  });
}

export async function createSkill(request: SkillCreationRequest, targetDir: string, deps: CreateSkillDeps = {}): Promise<SkillCreationOutcome> {
  let normalized: NormalizedSkillCreationRequest;
  try {
    normalized = normalizeSkillCreationRequest(request);
  } catch (error) {
    return { request, files: [], installed: false, notes: [], error: error instanceof Error ? error.message : String(error) };
  }
  const base = { request, authors: normalized.authors, layout: normalized.layout };
  const settled = await Promise.allSettled(normalized.authors.map(async (author) => ({
    author,
    ...(await stageSkill({
      agent: author,
      description: normalized.description,
      targetDir,
      model: normalized.model,
      nameOverride: normalized.nameOverride,
      deps
    }))
  })));
  const legs = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failures = settled.flatMap((result, index) => result.status === "rejected"
    ? [`${normalized.authors[index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (failures.length) {
    const notes = legs.map((leg) => `Validated staged copy kept at ${leg.stagingRoot}/${leg.validated.name}.`);
    return { ...base, name: legs[0]?.validated.name, names: Object.fromEntries(legs.map((leg) => [leg.author, leg.validated.name])), files: [], installed: false, notes, error: failures.join(" | ") };
  }

  try {
    throwIfCancelled(deps.signal);
    deps.progress?.("placement", normalized.authors[0]);
    const place = () => placeSkillTrees({
      targetDir,
      copies: legs.map((leg) => ({ author: leg.author, name: leg.validated.name, sourcePath: `${leg.stagingRoot}/${leg.validated.name}` })),
      layout: normalized.layout,
      force: deps.force
    });
    const serialize = deps.serializeInstall ?? (<T,>(fn: () => Promise<T>) => fn());
    let placement;
    try {
      placement = await serialize(place);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const collisionPath = message.match(/^(.+?) already exists; use --force/)?.[1];
      if (!deps.onCollision || !collisionPath) throw error;
      const collisionLeg = legs.find((leg) => collisionPath.endsWith(`/${leg.validated.name}`)) ?? legs[0]!;
      const decision = await deps.onCollision({
        path: collisionPath,
        stagingPath: `${collisionLeg.stagingRoot}/${collisionLeg.validated.name}`
      });
      if (decision !== "replace") throw error;
      placement = await serialize(() => placeSkillTrees({
        targetDir,
        copies: legs.map((leg) => ({ author: leg.author, name: leg.validated.name, sourcePath: `${leg.stagingRoot}/${leg.validated.name}` })),
        layout: normalized.layout,
        force: true
      }));
    }
    await Promise.all(legs.map((leg) => rm(join(targetDir, leg.stagingRoot), { recursive: true, force: true })));
    await rmdir(join(targetDir, ".farrier-staging", "authoring")).catch(() => undefined);
    const notes = [...legs.flatMap((leg) => leg.validated.notes), ...placement.notes];
    if (deps.install === false) notes.push("--no-install is deprecated and has no effect; provider-native placement is the installation.");
    if (normalized.authors.length > 1) notes.push("Provider copies were authored independently and are not tracked in skills-lock.json.");
    return {
      ...base,
      name: legs[0]!.validated.name,
      names: Object.fromEntries(legs.map((leg) => [leg.author, leg.validated.name])),
      files: outcomeFiles(legs, normalized.layout),
      installed: true,
      notes,
      backupDir: placement.backupDir
    };
  } catch (error) {
    return {
      ...base,
      name: legs[0]?.validated.name,
      names: Object.fromEntries(legs.map((leg) => [leg.author, leg.validated.name])),
      files: [],
      installed: false,
      notes: legs.map((leg) => `Validated staged copy kept at ${leg.stagingRoot}/${leg.validated.name}.`),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export type SkillCreationProgressEvent =
  | { index: number; phase: SkillCreationPhase; agent?: CreateAgent; activity?: string }
  | { index: number; phase: "done"; outcome: SkillCreationOutcome };

const AUTHOR_CONCURRENCY = 3;

export async function createSkills(
  requests: SkillCreationRequest[],
  targetDir: string,
  deps: CreateSkillDeps = {},
  onProgress?: (event: SkillCreationProgressEvent) => void
): Promise<SkillCreationOutcome[]> {
  const normalized = requests.map(normalizeSkillCreationRequest);
  for (const author of new Set(normalized.flatMap((request) => request.authors))) {
    const result = await ensureCreatorInstalled(author, targetDir, deps.skillsRunner, deps.resolveDeps);
    if (result && !result.ok) throw new Error(`Could not install the ${author} creator skill (${result.ref})`);
  }
  let commitChain: Promise<unknown> = Promise.resolve();
  const serializeInstall = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = commitChain.then(fn, fn);
    commitChain = next.catch(() => undefined);
    return next;
  };
  return Effect.runPromise(Effect.forEach(
    requests.map((request, index) => ({ request, index })),
    ({ request, index }) => Effect.promise(async () => {
      if (deps.signal?.aborted) {
        const outcome: SkillCreationOutcome = { request, files: [], installed: false, notes: [], error: "cancelled before start" };
        onProgress?.({ index, phase: "done", outcome });
        return outcome;
      }
      const outcome = await createSkill(request, targetDir, {
        ...deps,
        serializeInstall,
        progress: (phase, agent, activity) => onProgress?.({ index, phase, agent, activity })
      });
      onProgress?.({ index, phase: "done", outcome });
      return outcome;
    }),
    { concurrency: AUTHOR_CONCURRENCY }
  ));
}
