import { randomUUID } from "node:crypto";
import { access, cp, lstat, mkdir, readlink, realpath, rename, rm, symlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  defaultBackendRunner,
  invokeBackend,
  type AgentBackend,
  type BackendCommandRunner
} from "./backend";
import {
  ensureCreatorInstalled,
  nativeSkillRoots,
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
  backend: AgentBackend;
  recommendedWinner: SkillEvalWinner;
  rationale: string;
  copies: Record<CreateAgent, SkillEvalCopyScore>;
  notes: string[];
  reportPaths?: EvalReportPaths;
};

export type SkillWinnerResolution = {
  skillName: string;
  winner: CreateAgent;
  loser: CreateAgent;
  winnerPath: string;
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
    if (outcome.error || !outcome.name || outcome.request.mode !== "per-agent") {
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
  backend: AgentBackend;
  model?: string;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
  /** Used only to self-heal a missing pinned creator via a global install. */
  skillsRunner?: CommandRunner;
  resolveDeps?: ResolveSkillsCommandDeps;
}): Promise<SkillEvalVerdict> {
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
        backend: input.backend,
        model: input.model,
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
        verdict: validateLabeledEvalVerdict(parsed, input.backend, { skillName: input.skillName, aPath, bPath }),
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
      backend: input.backend,
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
  const winnerPath = skillPath(input.winner, names[input.winner]);
  const loserPath = skillPath(loser, names[loser]);
  // The link carries the winner's name so both roots expose the same skill;
  // it only differs from loserPath when the copies chose different names.
  const linkPath = skillPath(loser, names[input.winner]);

  await assertRealSkillDir(input.targetDir, winnerPath);
  await assertRealSkillDir(input.targetDir, loserPath);

  const winnerAbs = join(input.targetDir, winnerPath);
  const loserAbs = join(input.targetDir, loserPath);
  const linkAbs = join(input.targetDir, linkPath);

  if (linkPath !== loserPath && (await lstat(linkAbs).catch(() => undefined))) {
    throw new Error(`Cannot resolve winner: ${linkPath} already exists and would be overwritten by the symlink.`);
  }

  const winnerSkillReal = await realpath(join(winnerAbs, "SKILL.md"));
  const backupAbs = `${loserAbs}.farrier-delete-${randomUUID().slice(0, 8)}`;
  const linkTarget = relative(dirname(linkAbs), winnerAbs) || ".";

  await rename(loserAbs, backupAbs);

  try {
    await symlink(linkTarget, linkAbs, "dir");
    const linkedSkillReal = await realpath(join(linkAbs, "SKILL.md"));

    if (linkedSkillReal !== winnerSkillReal) {
      throw new Error(`symlink ${linkPath} resolves to ${linkedSkillReal}, not ${winnerSkillReal}`);
    }

    let backupPath: string | undefined;

    if (input.retainBackupInTrash) {
      backupPath = `.farrier-staging/trash/${names[loser]}-${randomUUID().slice(0, 8)}`;
      await mkdir(dirname(join(input.targetDir, backupPath)), { recursive: true });
      await rename(backupAbs, join(input.targetDir, backupPath));
    } else {
      await rm(backupAbs, { recursive: true, force: false });
    }

    return {
      skillName: input.skillName,
      winner: input.winner,
      loser,
      winnerPath,
      deleted: [loserPath],
      links: [{ path: linkPath, target: linkTarget, resolvesTo: winnerPath }],
      backupPath,
      notes: [
        `Deleted ${loserPath} and linked ${linkPath} to ${winnerPath}.`,
        ...(backupPath ? [`The deleted copy was kept at ${backupPath} in case you change your mind.`] : [])
      ]
    };
  } catch (error) {
    await rm(linkAbs, { recursive: true, force: true }).catch(() => undefined);
    await rename(backupAbs, loserAbs).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to link ${linkPath} to ${winnerPath}: ${message}`);
  }
}
