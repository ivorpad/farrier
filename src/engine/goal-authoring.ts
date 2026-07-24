import type { ReasoningEffort } from "../config/farrier-config";
import {
  backendEnvironmentOverrides,
  backendEnvironmentPassthrough,
  backendFailureMessage,
  parseBackendJson,
  type AgentBackend,
  type BackendCommandRunner
} from "./backend";
import { gateSubagents, type ExportLesson } from "./export-playbook";
import { isolatedAuthoringTimeoutMs, withIsolatedExecution } from "./execution-isolation";
import type { AnnotatedSessionEvidence } from "./gate-catalog";
import type { SkillUsage } from "./session-evidence";

/**
 * GOAL.md authoring: the export's meta prompt, written by the consented LLM
 * pass from the SAME classified lessons that build the playbook — one review,
 * two artifacts. The model writes the rich, stack-specific contract (that is
 * the point of a goal; see the fieldbrief sample); the deterministic layer
 * only validates mechanics that keep the /goal loop closable:
 *
 * 1. PRD-scaled checks: anything non-universal must carry a printed
 *    not_applicable escape, or an evaluator can loop forever on an audit the
 *    app never needed (the maximalism failure of the first sample).
 * 2. Repo as ledger: conversation context compacts, so completion state
 *    (requirement ledger, design approval) lives in repository files that get
 *    re-printed fresh, never in transcript memory.
 * 3. Evidence citations: constraints derived from sessions cite their steers
 *    and clusters, the same provenance rule the lessons already follow.
 */

export const goalLedgerPath = "docs/exec-plans/LEDGER.md";
export const goalApprovalPath = "docs/design-review.md";
/** Claude Code caps a /goal condition at 4,000 chars; author to 3,400, validate at 3,500. */
const conditionAuthoringBudget = 3_400;
export const maxGoalConditionChars = 3_500;
const minGoalMdChars = 800;
const maxGoalMdChars = 40_000;
const maxPromptSteers = 120;
const maxPromptClusters = 40;

export type GoalArtifacts = {
  /** Full GOAL.md content, LLM-authored, validated mechanics. */
  goalMd: string;
  /** Paste-ready /goal condition referencing GOAL.md. */
  condition: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reviewer subagents the selected lessons will install (mirrors buildPlaybookProposal). */
export function reviewerNamesForLessons(lessons: readonly ExportLesson[]): string[] {
  return lessons
    .filter((lesson) => lesson.classification === "portable" && gateSubagents[lesson.gateId])
    .map((lesson) => gateSubagents[lesson.gateId]!.name);
}

export function buildGoalPrompt(input: {
  playbookName: string;
  annotated: AnnotatedSessionEvidence;
  lessons: readonly ExportLesson[];
  skillUsage: readonly SkillUsage[];
}): string {
  const reviewers = reviewerNamesForLessons(input.lessons);
  const steers = input.annotated.steers.slice(0, maxPromptSteers).map((steer, index) => ({
    index,
    ...(steer.date ? { date: steer.date } : {}),
    text: steer.text
  }));
  const clusters = input.annotated.failureClusters.slice(0, maxPromptClusters).map((cluster, index) => ({
    index,
    key: cluster.key,
    class: cluster.class,
    count: cluster.count,
    sessionCount: cluster.sessionCount,
    samples: cluster.samples
  }));
  const lessons = input.lessons.map((lesson) => ({
    gateId: lesson.gateId,
    classification: lesson.classification,
    rationale: lesson.rationale,
    steerIndexes: lesson.steerIndexes,
    clusterIndexes: lesson.clusterIndexes
  }));
  const skills = input.skillUsage
    .filter((skill) => skill.installed)
    .map((skill) => ({ name: skill.name, invocations: skill.invocations, sessions: skill.sessions }));

  return `You are Farrier's goal author. From the evidence of a finished project's agent sessions, write the goal contract that will drive an agent building the NEXT project from its PRD, using the exported harness (the ${input.playbookName} skill, its gates checker, and the review subagents).

Return JSON only with this exact shape:

{
  "goal": {
    "goalMd": "full GOAL.md markdown content",
    "condition": "paste-ready /goal condition, at most ${conditionAuthoringBudget} characters"
  }
}

GOAL.md rules:
- It is the full operating contract: rich and stack-specific wherever the evidence supports it (if the clusters name build commands, simulators, or artifacts, write those exact commands and teardown steps). Generalize away app-specific names, labels, screens, and copy: PRD.md is the only per-project input, and a material PRD gap is a blocker, never an invitation to invent behavior.
- Exactly six sections, numbered: "## 1. Outcome", "## 2. Verification surface", "## 3. Constraints", "## 4. Boundaries", "## 5. Iteration policy", "## 6. Blocked stop".
- The goal evaluator cannot run tools; it judges only what the working agent prints. Every check must be printable evidence: an exit code, a count, a decisive output line, printed fresh in the turn that claims completion.
- Durable state lives in repository files because conversation context compacts: a requirement ledger at ${goalLedgerPath} (requirement -> implementation path -> check pointer), one plan file per work slice under docs/exec-plans/, and the design approval quoted verbatim at ${goalApprovalPath}. Completion claims re-print current file state; never trust transcript memory.
- Point the verification surface at the exported checker (.agents/skills/${input.playbookName}/gates/check.py, with a .claude/skills twin): its exit code plus per-gate PASS/FAIL lines. Also require the project's own check command from AGENTS.md, exit 0, final line printed. Do not restate individual gate rules the checker already enforces.
- Every check or constraint that is not universal must be scaled to the PRD with a printed escape: state what in the PRD activates it, and that otherwise the agent prints <name>=not_applicable with the PRD reason. Never include an audit the PRD cannot justify without that escape.
- Constraints derived from the evidence carry citations in the form [evidence: steer 3, cluster 1] using the indexes below. A constraint with no evidence and no universal justification does not belong in the contract.
${reviewers.length > 0 ? `- Review subagents will be installed (${reviewers.join(", ")}). Include a human checkpoint: feature work is forbidden until the user has approved the design review in this thread; the approving message is quoted verbatim into ${goalApprovalPath}; approval is never inferred from silence, a build, screenshots, or the agent's own judgment.` : "- No review subagents ship with this export; include a human checkpoint only if the evidence demands one."}
- No invocation mechanics, CLI version requirements, or install steps in GOAL.md; the README covers those.
- Write in plain concrete English. No marketing adjectives, no em dashes, no invented metrics.

condition rules:
- At most ${conditionAuthoringBudget} characters, references GOAL.md, and summarizes the completion checks (checker exit + all gates PASS, project check command exit 0, ledger printed with zero open rows${reviewers.length > 0 ? ", the approval file quoting the user's message" : ""}), each "freshly printed this turn". End with: if blocked, follow GOAL.md section 6 and do not claim completion.

Classified lessons (reviewed; your constraints must align with them):
${JSON.stringify(lessons, null, 2)}

Steers (user messages, redacted and bounded; cite by index):
${JSON.stringify(steers, null, 2)}

Failure clusters (deterministic counts; cite by index):
${JSON.stringify(clusters, null, 2)}

Installed skills with per-skill invocation counts from the source sessions (use them in Boundaries: subagents name their skills; never paste the catalog into the main thread):
${JSON.stringify(skills, null, 2)}
`;
}

export type GoalValidationContext = {
  hasLessons: boolean;
  requiresApproval: boolean;
};

export function validateGoalArtifacts(
  value: unknown,
  context: GoalValidationContext
): { ok: true; goal: GoalArtifacts } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: "goal must be an object" };
  const goalMd = value.goalMd;
  const condition = value.condition;
  if (typeof goalMd !== "string" || goalMd.trim().length < minGoalMdChars) {
    return { ok: false, reason: `goalMd must be a string of at least ${minGoalMdChars} chars` };
  }
  if (goalMd.length > maxGoalMdChars) {
    return { ok: false, reason: `goalMd exceeds ${maxGoalMdChars} chars` };
  }
  if (typeof condition !== "string" || condition.trim().length === 0) {
    return { ok: false, reason: "condition must be a non-empty string" };
  }
  if (condition.length > maxGoalConditionChars) {
    return { ok: false, reason: `condition exceeds ${maxGoalConditionChars} chars (Claude Code caps /goal at 4,000)` };
  }
  if (!condition.includes("GOAL.md")) {
    return { ok: false, reason: "condition must reference GOAL.md" };
  }
  for (let section = 1; section <= 6; section += 1) {
    if (!goalMd.includes(`## ${section}.`)) {
      return { ok: false, reason: `goalMd is missing section "## ${section}."` };
    }
  }
  if (!goalMd.includes(goalLedgerPath)) {
    return { ok: false, reason: `goalMd must keep durable state in ${goalLedgerPath}` };
  }
  if (!goalMd.includes("not_applicable")) {
    return { ok: false, reason: "goalMd must carry printed not_applicable escapes for PRD-scaled checks" };
  }
  if (context.requiresApproval && !goalMd.includes(goalApprovalPath)) {
    return { ok: false, reason: `goalMd must record the design approval at ${goalApprovalPath}` };
  }
  if (context.hasLessons && !goalMd.includes("[evidence:")) {
    return { ok: false, reason: "goalMd constraints must cite their evidence ([evidence: ...])" };
  }
  return { ok: true, goal: { goalMd, condition } };
}

function goalFromBackendOutput(stdout: string): unknown {
  const parsed = parseBackendJson(stdout);
  if (!isRecord(parsed) || !isRecord(parsed.goal)) {
    throw new Error('backend JSON must have shape {"goal":{"goalMd":"...","condition":"..."}}');
  }
  return parsed.goal;
}

export async function authorGoalArtifacts(input: {
  targetDir: string;
  playbookName: string;
  annotated: AnnotatedSessionEvidence;
  lessons: readonly ExportLesson[];
  skillUsage: readonly SkillUsage[];
  backend: AgentBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner: BackendCommandRunner;
}): Promise<GoalArtifacts> {
  const model = input.model ?? (input.backend === "claude" ? "sonnet" : "gpt-5.5");
  const prompt = buildGoalPrompt({
    playbookName: input.playbookName,
    annotated: input.annotated,
    lessons: input.lessons,
    skillUsage: input.skillUsage
  });

  const command =
    input.backend === "claude"
      ? {
          cmd: [
            "claude", "-p", "--model", model,
            ...(input.reasoningEffort ? ["--effort", input.reasoningEffort] : []),
            "--permission-mode", "plan"
          ],
          stdin: prompt
        }
      : {
          cmd: [
            "codex", "exec", "--skip-git-repo-check", "-s", "read-only", "--model", model,
            ...(input.reasoningEffort ? ["-c", `model_reasoning_effort=${input.reasoningEffort}`] : []),
            prompt
          ],
          stdin: undefined
        };

  const isolated = await withIsolatedExecution({
    targetDir: input.targetDir,
    nativeConfinement: input.backend === "codex",
    environmentPassthrough: backendEnvironmentPassthrough(input.backend),
    environmentOverrides: backendEnvironmentOverrides(input.backend),
    timeoutMs: isolatedAuthoringTimeoutMs,
    readOnlyWorkspace: true,
    // Same fence posture as lesson classification: the source project's agent
    // sessions may still be open; nothing is read from or staged into it.
    concurrentTargetWrites: "tolerate",
    run: async ({ workspace, environment, redactValues, signal }) => ({
      output: await input.runner({
        cmd: command.cmd,
        cwd: workspace,
        stdin: command.stdin,
        signal,
        env: environment,
        redactValues
      }),
      redactValues
    })
  });
  const { output, redactValues } = isolated.value;

  if (output.exitCode !== 0) {
    throw new Error(backendFailureMessage({ backend: input.backend, exitCode: output.exitCode, output, redactValues }));
  }
  if (output.capture?.stdout.truncated) {
    throw new Error(
      `${input.backend} backend stdout exceeded the capture limit (received ${output.capture.stdout.byteCount} bytes; sha256 ${output.capture.stdout.sha256})`
    );
  }

  const validated = validateGoalArtifacts(goalFromBackendOutput(output.stdout), {
    hasLessons: input.lessons.length > 0,
    requiresApproval: reviewerNamesForLessons(input.lessons).length > 0
  });
  if (!validated.ok) {
    throw new Error(`goal validation failed: ${validated.reason}`);
  }
  return validated.goal;
}
