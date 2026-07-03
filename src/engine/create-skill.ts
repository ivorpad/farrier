import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { backendCommand, type AgentBackend, type BackendCommandRunner, defaultBackendRunner } from "./backend";
import type { RenderedFile } from "./render";
import {
  collapseDescription,
  maxDescriptionLength,
  maxSkillNameLength,
  skillNamePattern,
  slugifySkillName,
  snapshotSkillRoot,
  validateCreatedSkill,
  yamlScalar,
  type ValidatedSkill
} from "./skill-validate";
import {
  installSkills,
  type CommandRunner,
  type InstallSkillResult,
  type ResolveSkillsCommandDeps
} from "./skills";

export { scaffoldSkillDraft, slugifySkillName, validateCreatedSkill, type SkillDraft } from "./skill-validate";

export type CreateAgent = AgentBackend;

export type AuthoringMode = "author-claude" | "author-codex" | "per-agent";

export type SkillCreationRequest = {
  description: string;
  agents: CreateAgent[];
  mode: AuthoringMode;
  nameOverride?: string;
  model?: string;
};

export type SkillCreationOutcome = {
  request: SkillCreationRequest;
  name?: string;
  files: string[];
  installed: boolean;
  notes: string[];
  error?: string;
};

// Codex ships $skill-creator built in (~/.codex/skills/.system), so it has no
// ref to pin by default; pinning one anyway (FARRIER_CREATOR_CODEX) is possible
// but both vendors use the skill id `skill-creator`, so pinning both into one
// project would collide in .agents/skills and skills-lock.json.
const defaultCreatorRefs: Record<CreateAgent, string | undefined> = {
  claude: "anthropics/skills@skill-creator",
  codex: undefined
};

const creatorRefEnvVars: Record<CreateAgent, string> = {
  claude: "FARRIER_CREATOR_CLAUDE",
  codex: "FARRIER_CREATOR_CODEX"
};

export function creatorRef(agent: CreateAgent): string | undefined {
  const override = process.env[creatorRefEnvVars[agent]];
  return override !== undefined && override.trim() !== "" ? override : defaultCreatorRefs[agent];
}

// Agent ids as the skills CLI's -a flag spells them.
const skillsCliAgentIds: Record<CreateAgent, string> = {
  claude: "claude-code",
  codex: "codex"
};

// Where each agent natively discovers repo-level skills; per-agent authoring
// writes here. Codex reads the universal .agents/skills directory.
export const nativeSkillRoots: Record<CreateAgent, string> = {
  claude: ".claude/skills",
  codex: ".agents/skills"
};

export const canonicalSkillRoot = "skills";

const descriptionCharLimit = 16_000;

async function lockedSkillIds(targetDir: string): Promise<Set<string>> {
  try {
    const content = await readFile(join(targetDir, "skills-lock.json"), "utf8");
    const parsed = JSON.parse(content) as { skills?: Record<string, unknown> };
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

  if (!ref) {
    return undefined;
  }

  const skillId = ref.slice(ref.lastIndexOf("@") + 1);
  const locked = await lockedSkillIds(targetDir);

  if (locked.has(skillId)) {
    return { ref, ok: true, stdout: "", stderr: "", exitCode: 0 };
  }

  const results = await installSkills([ref], targetDir, runner, resolveDeps, [skillsCliAgentIds[agent]]);
  return results[0];
}

function truncateRequest(text: string): string {
  if (text.length <= descriptionCharLimit) {
    return text;
  }

  return `${text.slice(0, descriptionCharLimit)}\n\n[request truncated to ${descriptionCharLimit} characters]`;
}

export function buildAuthoringPrompt(input: {
  agent: CreateAgent;
  description: string;
  outputRoot: string;
  nameOverride?: string;
}): string {
  const creator =
    input.agent === "claude"
      ? "Use the skill-creator skill installed in this project"
      : "Use the built-in $skill-creator skill";

  const nameLine = input.nameOverride ? `\n- Name the skill exactly '${input.nameOverride}'.` : "";

  return `${creator} to create exactly one agent skill for the request below.
Requirements:
- Create the skill directory under ${input.outputRoot}/ only, as ${input.outputRoot}/<skill-name>/SKILL.md plus any supporting files inside that same directory. Do not create or modify any other files.
- SKILL.md must start with YAML frontmatter containing name (kebab-case, at most 64 characters, matching the directory name) and description (one sentence saying what the skill does and when to use it).${nameLine}
- Do not ask questions; make reasonable decisions and finish.
Skill request:
${truncateRequest(input.description)}
`;
}

export type SkillCreationPhase = "creator" | "authoring" | "validating" | "installing";

export type CollisionDecision = "replace" | "keep";

export type CollisionInfo = {
  /** targetDir-relative path of the existing skill directory. */
  path: string;
  /** targetDir-relative staging path holding the freshly authored copy. */
  stagingPath: string;
};

export type CreateSkillDeps = {
  backendRunner?: BackendCommandRunner;
  skillsRunner?: CommandRunner;
  resolveDeps?: ResolveSkillsCommandDeps;
  install?: boolean;
  progress?: (phase: SkillCreationPhase, agent?: CreateAgent) => void;
  /** Serializes skills-lock/manifest writers when authoring runs concurrently. */
  serializeInstall?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Aborting kills in-flight agent runs and skips work not yet started. */
  signal?: AbortSignal;
  /** Asked when the authored skill's destination already exists; absent = keep (error). */
  onCollision?: (info: CollisionInfo) => Promise<CollisionDecision>;
};

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("cancelled");
  }
}

const stagingRootBase = ".farrier-staging";

/**
 * Each authoring run gets its own empty staging root, so concurrent runs can't
 * pollute each other's dir-diff validation, then the single validated skill
 * directory is moved into its final root. Failures leave the staged files in
 * place for inspection; success removes the run's staging dir.
 */
async function placeSkill(
  targetDir: string,
  stagingRoot: string,
  finalRoot: string,
  validated: ValidatedSkill,
  onCollision?: (info: CollisionInfo) => Promise<CollisionDecision>
): Promise<ValidatedSkill> {
  const destination = join(targetDir, finalRoot, validated.name);
  const notes = [...validated.notes];

  if (existsSync(destination)) {
    const decision = onCollision
      ? await onCollision({ path: `${finalRoot}/${validated.name}`, stagingPath: `${stagingRoot}/${validated.name}` })
      : "keep";

    if (decision !== "replace") {
      throw new Error(
        `${finalRoot}/${validated.name} already exists. Authored files kept at ${stagingRoot}/${validated.name} for inspection.`
      );
    }

    await rm(destination, { recursive: true, force: true });
    notes.push(`Replaced the existing ${finalRoot}/${validated.name}.`);
  }

  await mkdir(dirname(destination), { recursive: true });
  await rename(join(targetDir, stagingRoot, validated.name), destination);
  await rm(join(targetDir, stagingRoot), { recursive: true, force: true });

  return {
    ...validated,
    notes,
    files: validated.files.map((file) => `${finalRoot}/${file.slice(stagingRoot.length + 1)}`)
  };
}

async function authorSkill(input: {
  agent: CreateAgent;
  description: string;
  targetDir: string;
  finalRoot: string;
  model?: string;
  nameOverride?: string;
  deps: CreateSkillDeps;
}): Promise<ValidatedSkill> {
  input.deps.progress?.("creator", input.agent);
  const creatorInstall = await ensureCreatorInstalled(
    input.agent,
    input.targetDir,
    input.deps.skillsRunner,
    input.deps.resolveDeps
  );

  if (creatorInstall && !creatorInstall.ok) {
    throw new Error(`Could not install the ${input.agent} creator skill (${creatorInstall.ref}): ${creatorInstall.error ?? creatorInstall.stderr}`);
  }

  const stagingRoot = `${stagingRootBase}/${crypto.randomUUID().slice(0, 8)}`;
  await mkdir(join(input.targetDir, stagingRoot), { recursive: true });
  const before = await snapshotSkillRoot(join(input.targetDir, stagingRoot));

  const prompt = buildAuthoringPrompt({
    agent: input.agent,
    description: input.description,
    outputRoot: stagingRoot,
    nameOverride: input.nameOverride
  });

  throwIfCancelled(input.deps.signal);
  input.deps.progress?.("authoring", input.agent);
  const command = backendCommand(input.agent, input.model, prompt, { write: true });
  const runner = input.deps.backendRunner ?? defaultBackendRunner;
  const output = await runner({ cmd: command.cmd, cwd: input.targetDir, stdin: command.stdin, signal: input.deps.signal });

  if (input.deps.signal?.aborted) {
    throw new Error(`cancelled — killed the ${input.agent} run`);
  }

  if (output.exitCode !== 0) {
    const stderr = output.stderr.trim();
    throw new Error(`${input.agent} backend exited with code ${output.exitCode}${stderr ? `: ${stderr}` : ""}`);
  }

  input.deps.progress?.("validating", input.agent);
  const validated = await validateCreatedSkill({
    targetDir: input.targetDir,
    root: stagingRoot,
    before,
    backend: input.agent,
    nameOverride: input.nameOverride
  });

  return placeSkill(input.targetDir, stagingRoot, input.finalRoot, validated, input.deps.onCollision);
}

export async function installLocalSkill(
  name: string,
  targetDir: string,
  agents: CreateAgent[],
  runner?: CommandRunner,
  resolveDeps?: ResolveSkillsCommandDeps
): Promise<InstallSkillResult> {
  const results = await installSkills(
    [`./${canonicalSkillRoot}@${name}`],
    targetDir,
    runner,
    resolveDeps,
    agents.map((agent) => skillsCliAgentIds[agent])
  );

  return results[0]!;
}

export async function recordSkillInManifest(targetDir: string, ref: string): Promise<boolean> {
  const manifestPath = join(targetDir, ".farrier.json");
  let manifest: Record<string, unknown>;

  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }

  if (!Array.isArray(manifest.skills)) {
    return false;
  }

  if (!manifest.skills.includes(ref)) {
    manifest.skills.push(ref);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  return true;
}

export async function createSkill(
  request: SkillCreationRequest,
  targetDir: string,
  deps: CreateSkillDeps = {}
): Promise<SkillCreationOutcome> {
  const notes: string[] = [];
  const files: string[] = [];

  const serialize = deps.serializeInstall ?? (<T,>(fn: () => Promise<T>) => fn());

  try {
    if (request.mode === "per-agent") {
      // Parallel legs: staging roots isolate them, and one agent's failure
      // (e.g. its copy already exists) must not stop the other's run.
      const legs = await Promise.all(
        request.agents.map(async (agent) => {
          try {
            const validated = await authorSkill({
              agent,
              description: request.description,
              targetDir,
              finalRoot: nativeSkillRoots[agent],
              model: request.model,
              nameOverride: request.nameOverride,
              deps
            });
            return { agent, validated };
          } catch (error) {
            return { agent, error: error instanceof Error ? error.message : String(error) };
          }
        })
      );

      const succeeded = legs.filter((leg) => leg.validated);
      const failed = legs.filter((leg) => leg.error);

      for (const leg of succeeded) {
        files.push(...leg.validated!.files);
        notes.push(...leg.validated!.notes);
      }

      const names = new Set(succeeded.map((leg) => leg.validated!.name));

      if (names.size > 1) {
        notes.push(`The copies chose different names: ${Array.from(names).join(", ")}.`);
      }

      if (request.agents.length > 1) {
        notes.push("Per-agent copies were authored independently and may diverge; they are not tracked in skills-lock.json.");
      }

      return {
        request,
        name: succeeded[0]?.validated!.name,
        files,
        installed: false,
        notes,
        error:
          failed.length > 0
            ? failed.map((leg) => `${leg.agent}: ${leg.error}`).join(" | ") +
              (succeeded.length > 0 ? ` (${succeeded.map((leg) => leg.agent).join(", ")} copy succeeded)` : "")
            : undefined
      };
    }

    const authoringAgent: CreateAgent = request.mode === "author-claude" ? "claude" : "codex";
    const validated = await authorSkill({
      agent: authoringAgent,
      description: request.description,
      targetDir,
      finalRoot: canonicalSkillRoot,
      model: request.model,
      nameOverride: request.nameOverride,
      deps
    });

    files.push(...validated.files);
    notes.push(...validated.notes);

    if (deps.install === false) {
      notes.push(`Skipped install; run: skills add ./${canonicalSkillRoot} -s ${validated.name} -a ${request.agents.map((agent) => skillsCliAgentIds[agent]).join(" ")} -y`);
      return { request, name: validated.name, files, installed: false, notes };
    }

    throwIfCancelled(deps.signal);
    deps.progress?.("installing", authoringAgent);
    const install = await serialize(() =>
      installLocalSkill(validated.name, targetDir, request.agents, deps.skillsRunner, deps.resolveDeps)
    );

    if (!install.ok) {
      return {
        request,
        name: validated.name,
        files,
        installed: false,
        notes,
        error: `Skill authored at ${canonicalSkillRoot}/${validated.name}/ but install failed: ${install.error ?? install.stderr}. Retry: skills add ./${canonicalSkillRoot} -s ${validated.name} -a ${request.agents.map((agent) => skillsCliAgentIds[agent]).join(" ")} -y`
      };
    }

    if (await serialize(() => recordSkillInManifest(targetDir, `./${canonicalSkillRoot}@${validated.name}`))) {
      notes.push("Recorded in .farrier.json skills.");
    }

    return { request, name: validated.name, files, installed: true, notes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { request, name: undefined, files, installed: false, notes, error: message };
  }
}

export type SkillCreationProgressEvent =
  | { index: number; phase: SkillCreationPhase; agent?: CreateAgent }
  | { index: number; phase: "done"; outcome: SkillCreationOutcome };

const AUTHOR_CONCURRENCY = 3;

/**
 * Runs a batch of creation requests concurrently (each authoring run has its
 * own staging root, so runs can't cross-contaminate), while lock-touching
 * steps — creator pinning up front, `skills add` + manifest writes via a
 * shared mutex — stay sequential, because the skills CLI's lockfile writes
 * are unlocked read-modify-write.
 */
export async function createSkills(
  requests: SkillCreationRequest[],
  targetDir: string,
  deps: CreateSkillDeps = {},
  onProgress?: (event: SkillCreationProgressEvent) => void
): Promise<SkillCreationOutcome[]> {
  const creatorAgents = new Set<CreateAgent>(
    requests.flatMap((request) =>
      request.mode === "per-agent" ? request.agents : [request.mode === "author-claude" ? "claude" : "codex"]
    )
  );

  for (const agent of creatorAgents) {
    await ensureCreatorInstalled(agent, targetDir, deps.skillsRunner, deps.resolveDeps);
  }

  let installChain: Promise<unknown> = Promise.resolve();
  const serializeInstall = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = installChain.then(fn, fn);
    installChain = next.catch(() => undefined);
    return next;
  };

  return Effect.runPromise(
    Effect.forEach(
      requests.map((request, index) => ({ request, index })),
      ({ request, index }) =>
        Effect.promise(async () => {
          if (deps.signal?.aborted) {
            const outcome: SkillCreationOutcome = { request, files: [], installed: false, notes: [], error: "cancelled before start" };
            onProgress?.({ index, phase: "done", outcome });
            return outcome;
          }

          const outcome = await createSkill(request, targetDir, {
            ...deps,
            serializeInstall,
            progress: (phase, agent) => onProgress?.({ index, phase, agent })
          });

          onProgress?.({ index, phase: "done", outcome });
          return outcome;
        }),
      { concurrency: AUTHOR_CONCURRENCY }
    )
  );
}
