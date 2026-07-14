import { randomUUID } from "node:crypto";
import { access, cp, lstat, mkdir, readlink, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultBackendRunner,
  invokeBackend,
  type AgentBackend,
  type BackendCommandRunner
} from "./backend";
import type { ReasoningEffort } from "../config/farrier-config";
import {
  ensureCreatorInstalled,
  nativeSkillRoots,
  normalizeSkillCreationRequest,
  resolvedHomedir,
  type CreateAgent,
  type SkillCreationOutcome
} from "./create-skill";
import {
  buildLabeledEvalPrompt,
  mergeJudgePasses,
  validateLabeledEvalVerdict,
  type LabelAssignment
} from "./eval-judge";
import { writeEvalReports, type EvalReportPaths } from "./eval-report";
import { placeSkillTrees } from "./skill-placement";
import { nativeSkillRef } from "./skill-paths";
import { maxSkillNameLength, skillNamePattern } from "./skill-validate";
import type { CommandRunner, ResolveSkillsCommandDeps } from "./skills";

export type SkillEvalWinner = CreateAgent | "tie";

/** Per-agent authoring lets each agent name its copy, so the two can diverge. */
export type PerAgentSkillNames = Record<CreateAgent, string>;

export type SkillEvalCopyScore = {
  path: string;
  score: number;
  rationale: string;
  strengths: string[];
  weaknesses: string[];
};

export type SkillEvalVerdict = {
  skillName: string;
  author: AgentBackend;
  /** @deprecated Compatibility alias for author. */
  backend: AgentBackend;
  recommendedWinner: SkillEvalWinner;
  rationale: string;
  copies: Record<CreateAgent, SkillEvalCopyScore>;
  notes: string[];
  reportPaths?: EvalReportPaths;
};

export type SkillWinnerResolution = {
  skillName: string;
  author?: AgentBackend;
  winner: CreateAgent;
  loser: CreateAgent;
  winnerPath: string;
  canonicalPath: string;
  deleted: string[];
  links: Array<{ path: string; target: string; resolvesTo: string }>;
  /** Where the deleted copy was retained, when the recoverable path was used. */
  backupPath?: string;
  notes: string[];
};

const pinnedCreatorRoot = ".claude/skills/skill-creator";
// Resolved per call (not cached at module load) so tests can point HOME at a
// scratch directory.
function globalPinnedCreatorRoot(): string {
  return join(resolvedHomedir(), ".claude", "skills", "skill-creator");
}
const pinnedEvalFiles = [
  "SKILL.md",
  "agents/comparator.md",
  "agents/analyzer.md",
  "references/schemas.md"
];

// Skill names become path segments under the native roots, so anything
// non-kebab-case (separators, dots) could escape them.
function assertSafeSkillName(skillName: string, context: string): void {
  if (!skillNamePattern.test(skillName) || skillName.length > maxSkillNameLength) {
    throw new Error(
      `${context}: skill name '${skillName}' must be kebab-case ([a-z0-9] and single hyphens), at most ${maxSkillNameLength} chars.`
    );
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function skillPath(agent: CreateAgent, skillName: string): string {
  return `${nativeSkillRoots[agent]}/${skillName}`;
}

function resolveNames(input: { skillName: string; names?: PerAgentSkillNames }, context: string): PerAgentSkillNames {
  const names = input.names ?? { claude: input.skillName, codex: input.skillName };
  assertSafeSkillName(names.claude, context);
  assertSafeSkillName(names.codex, context);
  return names;
}

async function assertFile(path: string, message: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

async function hasAllPinnedFiles(root: string): Promise<boolean> {
  for (const file of pinnedEvalFiles) {
    try {
      await access(join(root, file));
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Global-first: a copy already pinned globally (or in this project) is used
 * as-is; only a genuinely missing copy triggers a GitHub pull via the same
 * global-install path authoring uses, so the two never fight over scope.
 * Returns the root to read the eval tooling from — project-relative when the
 * project has its own copy, absolute when falling back to the global one.
 */
async function resolvePinnedCreatorRoot(
  targetDir: string,
  runner?: CommandRunner,
  resolveDeps?: ResolveSkillsCommandDeps
): Promise<string> {
  if (await hasAllPinnedFiles(join(targetDir, pinnedCreatorRoot))) {
    return pinnedCreatorRoot;
  }

  const globalRoot = globalPinnedCreatorRoot();

  if (await hasAllPinnedFiles(globalRoot)) {
    return globalRoot;
  }

  await ensureCreatorInstalled("claude", targetDir, runner, resolveDeps);

  if (await hasAllPinnedFiles(globalRoot)) {
    return globalRoot;
  }

  throw new Error(
    `Pinned Anthropic skill-creator eval tooling is missing from both ${pinnedCreatorRoot} (project) and ${globalRoot} (global), and installing anthropics/skills@skill-creator failed.`
  );
}

export type SkillEvalCandidate = {
  skillName: string;
  /** First declared author; used as the inline evaluation judge. */
  author: CreateAgent;
  /** Directory name per agent — the copies can legitimately diverge. */
  names: PerAgentSkillNames;
  description: string;
};

/**
 * Which outcomes have a comparable per-agent pair: per-agent mode, no failed
 * leg, and exactly one top-level SKILL.md per native root. Each agent named
 * its own copy, so the names are recovered from the outcome files rather than
 * assumed to match.
 */
export function perAgentEvalCandidates(outcomes: SkillCreationOutcome[]): SkillEvalCandidate[] {
  return outcomes.flatMap((outcome) => {
    const request = normalizeSkillCreationRequest(outcome.request);
    if (outcome.error || !outcome.name || request.layout !== "native" || request.authors.length !== 2) {
      return [];
    }

    const names: Partial<PerAgentSkillNames> = {};

    for (const agent of ["claude", "codex"] as const) {
      const prefix = `${nativeSkillRoots[agent]}/`;
      const found = new Set(
        outcome.files
          .filter((file) => file.startsWith(prefix) && file.endsWith("/SKILL.md"))
          .map((file) => file.slice(prefix.length, -"/SKILL.md".length))
          .filter((name) => name.length > 0 && !name.includes("/"))
      );

      if (found.size !== 1) {
        return [];
      }

      names[agent] = [...found][0];
    }

    return [
      {
        skillName: outcome.name,
        author: request.authors[0]!,
        names: names as PerAgentSkillNames,
        description: outcome.request.description
      }
    ];
  });
}

async function assertPerAgentSkillPair(targetDir: string, names: PerAgentSkillNames): Promise<void> {
  for (const agent of ["claude", "codex"] as const) {
    await assertFile(
      join(targetDir, skillPath(agent, names[agent]), "SKILL.md"),
      `Cannot evaluate ${names[agent]}: missing ${skillPath(agent, names[agent])}/SKILL.md`
    );
  }
}

export async function evaluatePerAgentSkill(input: {
  targetDir: string;
  skillName: string;
  /** Per-agent directory names when the copies diverged; defaults to skillName for both. */
  names?: PerAgentSkillNames;
  description?: string;
  author?: AgentBackend;
  /** @deprecated */
  backend?: AgentBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
  /** Used only to self-heal a missing pinned creator via a global install. */
  skillsRunner?: CommandRunner;
  resolveDeps?: ResolveSkillsCommandDeps;
}): Promise<SkillEvalVerdict> {
  const author = input.author ?? input.backend;
  if (!author) throw new Error("Skill evaluation requires one author.");
  if (input.author && input.backend && input.author !== input.backend) throw new Error("Skill evaluation author and backend must match.");
  const names = resolveNames(input, "Cannot evaluate");
  const creatorRoot = await resolvePinnedCreatorRoot(input.targetDir, input.skillsRunner, input.resolveDeps);
  await assertPerAgentSkillPair(input.targetDir, names);

  // The native paths (.claude/skills vs .agents/skills) reveal the vendor, so
  // both copies are staged at neutral paths before the blind judge sees them.
  const stagingRoot = `.farrier-staging/eval-${randomUUID().slice(0, 8)}`;
  const stagedPaths: Record<CreateAgent, string> = {
    claude: `${stagingRoot}/candidate-one`,
    codex: `${stagingRoot}/candidate-two`
  };

  try {
    for (const agent of ["claude", "codex"] as const) {
      await cp(join(input.targetDir, skillPath(agent, names[agent])), join(input.targetDir, stagedPaths[agent]), {
        recursive: true
      });
    }

    const runPass = async (assignment: LabelAssignment) => {
      const aPath = stagedPaths[assignment.A];
      const bPath = stagedPaths[assignment.B];

      const parsed = await invokeBackend({
        backend: author,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        prompt: buildLabeledEvalPrompt({
          skillName: input.skillName,
          description: input.description,
          aPath,
          bPath,
          creatorRoot
        }),
        targetDir: input.targetDir,
        runner: input.runner ?? defaultBackendRunner,
        signal: input.signal
      });

      return {
        verdict: validateLabeledEvalVerdict(parsed, author, { skillName: input.skillName, aPath, bPath }),
        assignment
      };
    };

    // Two blind passes with the labels swapped, in parallel; a winner only
    // stands when both passes agree (position/self-preference bias guard).
    const passes = await Promise.all([
      runPass({ A: "claude", B: "codex" }),
      runPass({ A: "codex", B: "claude" })
    ]);

    const merged = mergeJudgePasses(passes);

    const verdict: SkillEvalVerdict = {
      skillName: input.skillName,
      author,
      backend: author,
      recommendedWinner: merged.recommendedWinner,
      rationale: merged.rationale,
      copies: {
        claude: { path: skillPath("claude", names.claude), ...merged.copies.claude },
        codex: { path: skillPath("codex", names.codex), ...merged.copies.codex }
      },
      notes: merged.notes
    };

    verdict.reportPaths = await writeEvalReports(input.targetDir, verdict);
    return verdict;
  } finally {
    await rm(join(input.targetDir, stagingRoot), { recursive: true, force: true }).catch(() => undefined);
  }
}

async function assertRealSkillDir(targetDir: string, relPath: string): Promise<void> {
  const absPath = join(targetDir, relPath);
  const stat = await lstat(absPath).catch(() => undefined);

  if (!stat) {
    throw new Error(`Cannot resolve winner: missing ${relPath}`);
  }

  if (stat.isSymbolicLink()) {
    const target = await readlink(absPath).catch(() => "unknown target");
    throw new Error(`Cannot resolve winner: ${relPath} is already a symlink to ${target}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Cannot resolve winner: ${relPath} is not a directory`);
  }

  await assertFile(join(absPath, "SKILL.md"), `Cannot resolve winner: missing ${relPath}/SKILL.md`);
}

export async function resolvePerAgentSkillWinner(input: {
  targetDir: string;
  skillName: string;
  /** Per-agent directory names when the copies diverged; defaults to skillName for both. */
  names?: PerAgentSkillNames;
  winner: CreateAgent;
  author?: AgentBackend;
  confirmDeleteAndLink: boolean;
  /**
   * Keep the deleted copy in .farrier-staging/trash/ instead of removing it.
   * Used by the auto-apply paths, where consent was given before the verdict
   * existed — reversibility offsets the blind consent. Interactive picks (the
   * user saw the exact paths and confirmed) delete cleanly.
   */
  retainBackupInTrash?: boolean;
}): Promise<SkillWinnerResolution> {
  const names = resolveNames(input, "Cannot resolve winner");

  if (!input.confirmDeleteAndLink) {
    throw new Error("Refusing to delete and symlink without explicit confirmation.");
  }

  const loser: CreateAgent = input.winner === "claude" ? "codex" : "claude";
  const winnerName = names[input.winner];
  const winnerPath = skillPath(input.winner, winnerName);
  const loserPath = skillPath(loser, names[loser]);
  await assertRealSkillDir(input.targetDir, winnerPath);
  await assertRealSkillDir(input.targetDir, loserPath);

  const canonicalPath = skillPath("codex", winnerName);
  const linkPath = skillPath("claude", winnerName);
  const selectedPaths = new Set([winnerPath, loserPath]);
  for (const destination of [canonicalPath, linkPath]) {
    if (selectedPaths.has(destination)) continue;
    try {
      await lstat(join(input.targetDir, destination));
      throw new Error(`Cannot resolve winner: ${destination} already exists and is not one of the reviewed copies`);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }

  const stagingRoot = `.farrier-staging/authoring/eval-${randomUUID().slice(0, 8)}`;
  const stagedPath = `${stagingRoot}/${winnerName}`;
  await cp(join(input.targetDir, winnerPath), join(input.targetDir, stagedPath), { recursive: true });
  try {
    const stalePaths = new Set<string>();
    if (skillPath("claude", names.claude) !== linkPath) stalePaths.add(skillPath("claude", names.claude));
    if (skillPath("codex", names.codex) !== canonicalPath) stalePaths.add(skillPath("codex", names.codex));
    const removeManifestRefs = [
      nativeSkillRef("claude", names.claude),
      nativeSkillRef("codex", names.codex)
    ];
    const placed = await placeSkillTrees({
      targetDir: input.targetDir,
      copies: [{ author: input.winner, name: winnerName, sourcePath: stagedPath }],
      layout: "shared",
      force: true,
      removePaths: [...stalePaths],
      removeManifestRefs
    });
    let backupPath: string | undefined;
    if (input.retainBackupInTrash && placed.backupDir) {
      const backedUpLoser = join(input.targetDir, placed.backupDir, loserPath);
      try {
        await lstat(backedUpLoser);
        backupPath = `.farrier-staging/trash/${names[loser]}-${randomUUID().slice(0, 8)}`;
        await mkdir(join(input.targetDir, ".farrier-staging", "trash"), { recursive: true });
        await rename(backedUpLoser, join(input.targetDir, backupPath));
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
    return {
      skillName: input.skillName,
      author: input.author,
      winner: input.winner,
      loser,
      winnerPath,
      canonicalPath,
      deleted: [...new Set([loserPath, ...stalePaths])],
      links: placed.links,
      backupPath,
      notes: [
        `Canonicalized the ${input.winner} winner at ${canonicalPath} and linked ${linkPath} to it.`,
        ...(backupPath ? [`The deleted copy was kept at ${backupPath} in case you change your mind.`] : []),
        ...placed.notes,
        ...(placed.backupDir ? [`Reviewed replaced content was retained at ${placed.backupDir}.`] : [])
      ]
    };
  } finally {
    await rm(join(input.targetDir, stagingRoot), { recursive: true, force: true }).catch(() => undefined);
  }
}
