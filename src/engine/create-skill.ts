import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import {
  backendCommand, backendEnvironmentOverrides, backendEnvironmentPassthrough, defaultBackendRunner,
  formatBackendStreamActivity, type AgentBackend, type BackendCommandRunner
} from "./backend";
import type { ResolvedModelSettings } from "../config/farrier-config";
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
import { applyMutationPlan, fingerprintPath, inspectMutationPlan } from "./mutation-transaction";
import { withIsolatedExecution, type IsolationFact } from "./execution-isolation";
import {
  canonicalSkillRoot,
  creatorRef,
  globalSkillRoot,
  nativeSkillRoots,
  resolvedHomedir,
  skillsCliAgentIds,
} from "./skill-paths";
import { buildAuthoringPrompt } from "./skill-authoring-prompt";
import { redactEvidence } from "./behavior-evidence";

export { canonicalSkillRoot, creatorRef, globalSkillRoot, nativeSkillRoots, resolvedHomedir } from "./skill-paths";
export { buildAuthoringPrompt } from "./skill-authoring-prompt";
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
  isolation?: IsolationFact;
};

async function lockedSkillIds(targetDir: string): Promise<Set<string>> {
  try {
    const content = await readFile(join(targetDir, "skills-lock.json"), "utf8");
    const parsed = JSON.parse(content) as { skills?: Record<string, unknown> };
    return new Set(parsed.skills && typeof parsed.skills === "object" ? Object.keys(parsed.skills) : []);
  } catch {
    return new Set();
  }
}

/**
 * Global-first: an already-installed global copy (from this project or any
 * other) is used as-is; only a genuinely missing skill triggers a GitHub
 * pull, and that pull installs globally (-g) so future projects skip it too.
 */
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

  const exists = resolveDeps?.exists ?? existsSync;

  if (exists(join(globalSkillRoot(agent), skillId, "SKILL.md"))) {
    return { ref, ok: true, stdout: "", stderr: "", exitCode: 0 };
  }

  const results = await installSkills([ref], targetDir, runner, resolveDeps, [skillsCliAgentIds[agent]], true);
  return results[0];
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
  progress?: (phase: SkillCreationPhase, agent?: CreateAgent, activity?: string) => void;
  /** Serializes skills-lock/manifest writers when authoring runs concurrently. */
  serializeInstall?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Aborting kills in-flight agent runs and skips work not yet started. */
  signal?: AbortSignal;
  /** Asked when the authored skill's destination already exists; absent = keep (error). */
  onCollision?: (info: CollisionInfo) => Promise<CollisionDecision>;
  /**
   * Per-backend model/effort from config resolution. Used when the request
   * carries no explicit model; each per-agent leg reads its own backend's
   * settings. Built-in defaults (claude opus, codex high effort) apply when a
   * backend has no entry.
   */
  modelSettings?: Partial<Record<CreateAgent, ResolvedModelSettings>>;
};

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("cancelled");
  }
}

const stagingRootBase = ".farrier-output";

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
      ? await onCollision({ path: `${finalRoot}/${validated.name}`, stagingPath: join(stagingRoot, validated.name) })
      : "keep";

    if (decision !== "replace") {
      throw new Error(
        `${finalRoot}/${validated.name} already exists. Authored files kept at ${join(stagingRoot, validated.name)} for inspection.`
      );
    }

    notes.push(`Replaced the existing ${finalRoot}/${validated.name}.`);
  }

  await applyMutationPlan(await inspectMutationPlan(targetDir, [{
    kind: "replace-tree",
    path: `${finalRoot}/${validated.name}`,
    sourcePath: join(stagingRoot, validated.name)
  }]));
  await rm(dirname(stagingRoot), { recursive: true, force: true });

  return {
    ...validated,
    notes,
    files: validated.files.map((file) => `${finalRoot}/${file.slice(stagingRootBase.length + 1)}`)
  };
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

export async function stageSkill(input: StageSkillInput): Promise<{ stagingRoot: string; validated: ValidatedSkill; isolation: IsolationFact }> {
  if (!input.creatorReady) {
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
  }

  throwIfCancelled(input.deps.signal);
  const isolated = await withIsolatedExecution({
    targetDir: input.targetDir,
    nativeConfinement: input.agent === "codex",
    environmentPassthrough: backendEnvironmentPassthrough(input.agent),
    environmentOverrides: backendEnvironmentOverrides(input.agent),
    signal: input.deps.signal,
    retainWorkspace: true,
    retainWorkspaceOnError: !input.cleanupOnFailure,
    run: async ({ workspace, environment, signal }) => {
      const stagingRoot = stagingRootBase;
      const before = await snapshotSkillRoot(join(workspace, stagingRoot));
      const prompt = buildAuthoringPrompt({
        agent: input.agent,
        description: input.description,
        outputRoot: stagingRoot,
        nameOverride: input.nameOverride
      });
      input.deps.progress?.("authoring", input.agent);
      const settings = input.deps.modelSettings?.[input.agent];
      const model = input.model ?? settings?.model ?? (input.agent === "claude" ? "opus" : undefined);
      const reasoningEffort = settings?.reasoningEffort ?? (input.agent === "codex" ? "high" : undefined);
      const command = backendCommand(input.agent, model, prompt, { write: true, stream: true, reasoningEffort });
      const runner = input.deps.backendRunner ?? defaultBackendRunner;
      const output = await runner({
        cmd: command.cmd,
        cwd: workspace,
        stdin: command.stdin,
        signal,
        env: environment,
        onStdoutLine: (line) => {
          const activity = formatBackendStreamActivity(input.agent, line);
          if (activity) input.deps.progress?.("authoring", input.agent, activity);
        }
      });
      if (signal.aborted) throw new Error(`cancelled — killed the ${input.agent} run`);
      if (output.exitCode !== 0) {
        const stderr = output.stderr.trim();
        throw new Error(`${input.agent} backend exited with code ${output.exitCode}${stderr ? `: ${stderr}` : ""}`);
      }
      input.deps.progress?.("validating", input.agent);
      const validated = await validateCreatedSkill({ targetDir: workspace, root: stagingRoot, before, backend: input.agent, nameOverride: input.nameOverride });
      return { stagingRoot: join(workspace, stagingRoot), validated };
    }
  });
  return { ...isolated.value, isolation: isolated.isolation };
}

async function authorSkill(input: StageSkillInput & { finalRoot: string }): Promise<ValidatedSkill> {
  const { stagingRoot, validated, isolation } = await stageSkill(input);
  const placed = await placeSkill(input.targetDir, stagingRoot, input.finalRoot, validated, input.deps.onCollision);
  return {
    ...placed,
    notes: [
      ...placed.notes,
      isolation.mode === "native-confinement"
        ? "Isolation mode: native-confinement (Codex workspace-write sandbox in a temporary workspace)."
        : `Isolation mode: staged-best-effort. ${isolation.residualRisk}`
    ]
  };
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
  const expected = await fingerprintPath(manifestPath);
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
    const plan = await inspectMutationPlan(targetDir, [{
      kind: "write-file",
      path: ".farrier.json",
      content: `${JSON.stringify(manifest, null, 2)}\n`
    }]);
    plan.operations[0]!.expected = expected;
    await applyMutationPlan(plan);
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
  const safeRequest = { ...request, description: redactEvidence(request.description) };

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
              description: safeRequest.description,
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
        request: safeRequest,
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
      description: safeRequest.description,
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
      return { request: safeRequest, name: validated.name, files, installed: false, notes };
    }

    throwIfCancelled(deps.signal);
    deps.progress?.("installing", authoringAgent);
    const install = await serialize(() =>
      installLocalSkill(validated.name, targetDir, request.agents, deps.skillsRunner, deps.resolveDeps)
    );

    if (!install.ok) {
      return {
        request: safeRequest,
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

    return { request: safeRequest, name: validated.name, files, installed: true, notes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { request: safeRequest, name: undefined, files, installed: false, notes, error: message };
  }
}

export type SkillCreationProgressEvent =
  | { index: number; phase: SkillCreationPhase; agent?: CreateAgent; activity?: string }
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
            progress: (phase, agent, activity) => onProgress?.({ index, phase, agent, activity })
          });

          onProgress?.({ index, phase: "done", outcome });
          return outcome;
        }),
      { concurrency: AUTHOR_CONCURRENCY }
    )
  );
}
