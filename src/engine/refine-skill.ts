import {
  backendEnvironmentOverrides,
  backendEnvironmentPassthrough,
  defaultBackendRunner,
  invokeBackend,
  type AgentBackend,
  type BackendCommandRunner
} from "./backend";
import type { ReasoningEffort } from "../config/farrier-config";
import { withIsolatedExecution } from "./execution-isolation";
import { createEvidenceSet } from "./behavior-evidence";

/**
 * Before delegating to a vendor skill-creator, farrier grills the requester
 * about the implementation decisions the request leaves open — one question at
 * a time, each adapting to the prior answers. Walking the design tree branch by
 * branch (rather than dumping a fixed batch) keeps the interview short and lets
 * every answer steer the next question. The answers become an explicit
 * "implementation decisions" block in the authoring brief, so the creator stops
 * guessing.
 */
export type RefineQuestion = {
  question: string;
  options: string[];
};

export type RefineAnswer = {
  question: string;
  answer: string;
};

export const maxGrillQuestions = 6;
const maxOptions = 5;
const requestCharLimit = 16_000;

function buildGrillPrompt(input: {
  evidenceDigest: string;
  evidenceItems: unknown[];
  questionNumber: number;
  packId?: string;
}): string {
  return `You are farrier's grill-master: a relentless but concise design interviewer. A coding-agent skill will be authored from the request below by a skill-creator agent. Interview the requester ONE question at a time until the brief leaves no consequential decision open. Walk the design tree branch by branch: pick the biggest unresolved fork, and let each prior answer decide which branch to probe next — never ask about a branch whose parent decision is still open, and never ask about anything the request or a prior answer already settles.

Probe whatever most changes what gets built: scope and non-goals, inputs/outputs and formats, language and libraries, integration points, edge cases, failure modes, quality bars — not just library picks.

Return JSON only, exactly one of:
{"question": "one short, specific question", "options": ["concrete option"]}
{"done": true}

Rules:
- Exactly ONE question. Bundling questions is bewildering.
- 2 to ${maxOptions} options, each concrete (name the actual library/tool/format/behavior). Put your recommendation first.
- This is question ${input.questionNumber} of at most ${maxGrillQuestions} — spend it on the most consequential open fork.
- Return {"done": true} when the remaining open decisions would not change what a competent skill-creator builds.
- No prose, no markdown.
${input.packId ? `Project stack: ${input.packId}\n` : ""}Bounded redacted skill-request evidence (digest ${input.evidenceDigest}):
${JSON.stringify(input.evidenceItems)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateGrillStep(parsed: unknown, backend: AgentBackend): RefineQuestion | null {
  if (isRecord(parsed) && parsed.done === true) {
    return null;
  }

  if (isRecord(parsed) && typeof parsed.question === "string" && parsed.question.trim().length > 0) {
    const options = Array.isArray(parsed.options)
      ? parsed.options
          .filter((option): option is string => typeof option === "string" && option.trim().length > 0)
          .map((option) => option.trim())
          .slice(0, maxOptions)
      : [];

    return { question: parsed.question.trim(), options };
  }

  throw new Error(`${backend} backend JSON must be {"question":"...","options":[...]} or {"done":true}`);
}

/**
 * Asks the backend for the next grill question, adapting to the answers so far.
 * Returns null when grilling is done — either the backend calls it (`{"done":
 * true}`) or the question budget is spent. A thrown error means the malformed
 * step should stop the interview; callers proceed with the answers already in
 * hand, never blocking creation.
 */
export async function generateNextGrillQuestion(input: {
  description: string;
  backend: AgentBackend;
  targetDir: string;
  priorAnswers: RefineAnswer[];
  questionNumber: number;
  packId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
}): Promise<RefineQuestion | null> {
  if (input.questionNumber > maxGrillQuestions) {
    return null;
  }

  const evidence = createEvidenceSet({
    workflow: "skill",
    items: [{
      description: input.description,
      ...(input.priorAnswers.length > 0
        ? {
            "Decisions so far": input.priorAnswers.map((entry) => ({
              question: entry.question,
              answer: entry.answer.trim().length > 0 ? entry.answer.trim() : "(skipped — you decide; do not re-ask)"
            }))
          }
        : {})
    }],
    maxItemBytes: requestCharLimit,
    maxTotalBytes: requestCharLimit
  });
  const isolated = await withIsolatedExecution({
    targetDir: input.targetDir,
    nativeConfinement: input.backend === "codex",
    environmentPassthrough: backendEnvironmentPassthrough(input.backend),
    environmentOverrides: backendEnvironmentOverrides(input.backend),
    readOnlyWorkspace: true,
    signal: input.signal,
    run: ({ workspace, environment, signal }) => invokeBackend({
      backend: input.backend,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      prompt: buildGrillPrompt({
        evidenceDigest: evidence.digest,
        evidenceItems: evidence.items,
        questionNumber: input.questionNumber,
        packId: input.packId
      }),
      targetDir: workspace,
      runner: input.runner ?? defaultBackendRunner,
      signal,
      env: environment
    })
  });

  return validateGrillStep(isolated.value, input.backend);
}

/** Folds answered questions into the brief the skill-creator will receive. */
export function applyRefinements(description: string, answers: RefineAnswer[]): string {
  const meaningful = answers.filter((answer) => answer.answer.trim().length > 0);

  if (meaningful.length === 0) {
    return description;
  }

  const decisions = meaningful.map((answer) => `- ${answer.question} ${answer.answer.trim()}`).join("\n");

  return `${description}

Implementation decisions (follow these exactly):
${decisions}`;
}
