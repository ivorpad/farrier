import { randomUUID } from "node:crypto";
import { access, lstat, readlink, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  backendEnvironmentOverrides,
  backendEnvironmentPassthrough,
  defaultBackendRunner,
  invokeBackend,
  type AgentBackend,
  type BackendCommandRunner
} from "./backend";
import type { ReasoningEffort } from "../config/farrier-config";
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
import { maxSkillNameLength, readSkillBehaviorEvidence, skillNamePattern } from "./skill-validate";
import type { CommandRunner, ResolveSkillsCommandDeps } from "./skills";
import { applyMutationPlan, inspectMutationPlan, type MutationOperation } from "./mutation-transaction";
import { withIsolatedExecution } from "./execution-isolation";
import { canonicalEvidence, compareEvidence, createEvidenceSet, type EvidenceComparison } from "./behavior-evidence";

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
  evidence?: EvidenceComparison & { availability: "available" | "unavailable"; caseCount: number };
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
  reasoningEffort?: ReasoningEffort;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
  /** Used only to self-heal a missing pinned creator via a global install. */
  skillsRunner?: CommandRunner;
  resolveDeps?: ResolveSkillsCommandDeps;
}): Promise<SkillEvalVerdict> {
  if (input.signal?.aborted) throw new Error("Skill evaluation cancelled before start.");
  const names = resolveNames(input, "Cannot evaluate");
  const creatorRoot = await resolvePinnedCreatorRoot(input.targetDir, input.skillsRunner, input.resolveDeps);
  await assertPerAgentSkillPair(input.targetDir, names);
  const [claudeCases, codexCases] = await Promise.all([
    readSkillBehaviorEvidence(join(input.targetDir, skillPath("claude", names.claude))),
    readSkillBehaviorEvidence(join(input.targetDir, skillPath("codex", names.codex)))
  ]);
  const declarationKeys = new Set<string>();
  const caseItems = [...claudeCases.cases, ...codexCases.cases]
    .filter((item) => {
      const key = canonicalEvidence(item);
      if (declarationKeys.has(key)) return false;
      declarationKeys.add(key);
      return true;
    })
    .sort((left, right) => canonicalEvidence(left).localeCompare(canonicalEvidence(right)));
  const normalizedClaudeCases = claudeCases.cases.map(canonicalEvidence).sort();
  const normalizedCodexCases = codexCases.cases.map(canonicalEvidence).sort();
  const declarationsMatch = canonicalEvidence(normalizedClaudeCases) === canonicalEvidence(normalizedCodexCases);
  const caseSet = createEvidenceSet({
    workflow: "skill",
    items: caseItems.length > 0 ? caseItems : [{ id: "behavior-cases-unavailable", kind: "negative" as const, prompt: "[unavailable]", expectedBehavior: "[unavailable]" }],
    maxItems: 200,
    maxItemBytes: 5_000,
    maxTotalBytes: 1_000_000
  });
  const inconclusiveCases = [{ id: "declaration-comparison", outcome: "inconclusive" as const }];
  const caseComparison = compareEvidence({ beforeSet: caseSet, afterSet: caseSet, before: inconclusiveCases, after: inconclusiveCases });

  const stagedPaths: Record<CreateAgent, string> = { claude: "candidate-one", codex: "candidate-two" };
  const isolated = await withIsolatedExecution({
    targetDir: input.targetDir,
    nativeConfinement: input.backend === "codex",
    environmentPassthrough: backendEnvironmentPassthrough(input.backend),
    environmentOverrides: backendEnvironmentOverrides(input.backend),
    readOnlyWorkspace: true,
    signal: input.signal,
    inputs: [
      { source: join(input.targetDir, skillPath("claude", names.claude)), path: stagedPaths.claude },
      { source: join(input.targetDir, skillPath("codex", names.codex)), path: stagedPaths.codex },
      { source: resolve(input.targetDir, creatorRoot), path: "creator" }
    ],
    run: async ({ workspace, environment, signal }) => {
    const runPass = async (assignment: LabelAssignment) => {
      const aPath = stagedPaths[assignment.A];
      const bPath = stagedPaths[assignment.B];

      const parsed = await invokeBackend({
        backend: input.backend,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        prompt: buildLabeledEvalPrompt({
          skillName: input.skillName,
          description: input.description,
          aPath,
          bPath,
          creatorRoot: "creator",
          behaviorEvidence: { digest: caseSet.digest, cases: caseSet.items }
        }),
        targetDir: workspace,
        runner: input.runner ?? defaultBackendRunner,
        signal,
        env: environment
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
    const behaviorAvailable = claudeCases.availability === "available" && codexCases.availability === "available";
    const recommendedWinner = merged.recommendedWinner;

    return {
      skillName: input.skillName,
      backend: input.backend,
      recommendedWinner,
      rationale: merged.rationale,
      copies: {
        claude: { path: skillPath("claude", names.claude), ...merged.copies.claude },
        codex: { path: skillPath("codex", names.codex), ...merged.copies.codex }
      },
      notes: [
        ...merged.notes,
        ...(behaviorAvailable
          ? [`Behavior declarations: ${caseItems.length} distinct positive/negative case(s), comparison ${caseComparison.result}, digest ${caseSet.digest}. Declarations were supplied to the blind judge but were not executed.`]
          : ["Behavior cases unavailable for one or both legacy/third-party copies; static blind evaluation was preserved and behavioral evidence is inconclusive."]),
        ...(!declarationsMatch ? ["Trust limitation: candidate behavior-case declarations differ; this non-directional mismatch does not establish a regression or veto either candidate."] : []),
        ...(caseSet.truncated ? [`Behavior declarations were bounded: retained ${caseSet.itemCount}/${caseSet.inputItemCount}; ${caseSet.truncatedItemCount} truncated and ${caseSet.omittedItemCount} omitted.`] : []),
        input.backend === "codex"
          ? "Isolation mode: native-confinement (Codex read-only sandbox)."
          : "Isolation mode: staged-best-effort; target fingerprints were verified and residual OS-user write risk remains."
      ],
      evidence: { ...caseComparison, availability: behaviorAvailable ? "available" : "unavailable", caseCount: caseItems.length }
    } satisfies SkillEvalVerdict;
    }
  });
  const verdict: SkillEvalVerdict = isolated.value;
  verdict.reportPaths = await writeEvalReports(input.targetDir, verdict);
  return verdict;
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
  const linkAbs = join(input.targetDir, linkPath);

  if (linkPath !== loserPath && (await lstat(linkAbs).catch(() => undefined))) {
    throw new Error(`Cannot resolve winner: ${linkPath} already exists and would be overwritten by the symlink.`);
  }

  const linkTarget = relative(dirname(linkAbs), winnerAbs) || ".";
  const operations: MutationOperation[] = [
    ...(linkPath === loserPath ? [] : [{ kind: "remove-tree", path: loserPath } as const]),
    { kind: "link", path: linkPath, target: linkTarget }
  ];
  try {
    const backupBase = input.retainBackupInTrash
      ? `.farrier-staging/trash/${names[loser]}-${randomUUID().slice(0, 8)}`
      : undefined;
    const transaction = await applyMutationPlan(await inspectMutationPlan(input.targetDir, operations), {
      backupBase,
      retainBackupsOnSuccess: input.retainBackupInTrash === true
    });
    const backupPath = transaction.backupDir ? `${transaction.backupDir}/${loserPath}` : undefined;
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
        ...(backupPath ? [`The replaced copy was kept at ${backupPath} for recovery in case you change your mind.`] : [])
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to link ${linkPath} to ${winnerPath}: ${message}`);
  }
}
