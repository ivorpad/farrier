import type { AgentBackend } from "./backend";
import type { CreateAgent } from "./create-skill";

/**
 * Blind judging: the judge only ever sees "Candidate A" / "Candidate B" at
 * neutral staged paths, never which agent authored which copy. The verdict is
 * label-keyed; mapping back to claude/codex happens in code, outside the model.
 * Two passes run with the labels swapped — an LLM judge is position-biased and
 * (when it can tell) vendor-biased, so a winner only counts when both passes
 * agree; otherwise the recommendation degrades to a tie.
 */

export type EvalCandidateLabel = "A" | "B";

export type LabeledCopyScore = {
  path: string;
  score: number;
  rationale: string;
  strengths: string[];
  weaknesses: string[];
};

export type LabeledEvalVerdict = {
  skillName: string;
  recommendedWinner: EvalCandidateLabel | "tie";
  rationale: string;
  copies: Record<EvalCandidateLabel, LabeledCopyScore>;
  notes: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown, field: string, backend: AgentBackend): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${backend} backend JSON field ${field} must be an array of strings`);
  }

  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);

  if (strings.length !== value.length) {
    throw new Error(`${backend} backend JSON field ${field} must be an array of strings`);
  }

  return strings.map((item) => item.trim());
}

function scoreCopy(raw: unknown, field: string, backend: AgentBackend, expectedPath: string): LabeledCopyScore {
  if (!isRecord(raw)) {
    throw new Error(`${backend} backend JSON field ${field} must be an object`);
  }

  if (typeof raw.path !== "string" || raw.path.trim() !== expectedPath) {
    throw new Error(`${backend} backend JSON field ${field}.path must be ${expectedPath}, got ${String(raw.path)}`);
  }

  if (typeof raw.score !== "number" || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > 10) {
    throw new Error(`${backend} backend JSON field ${field}.score must be a number from 0 to 10`);
  }

  if (typeof raw.rationale !== "string" || raw.rationale.trim().length === 0) {
    throw new Error(`${backend} backend JSON field ${field}.rationale must be a non-empty string`);
  }

  return {
    path: raw.path.trim(),
    score: raw.score,
    rationale: raw.rationale.trim(),
    strengths: stringArray(raw.strengths, `${field}.strengths`, backend),
    weaknesses: stringArray(raw.weaknesses, `${field}.weaknesses`, backend)
  };
}

export function validateLabeledEvalVerdict(
  parsed: unknown,
  backend: AgentBackend,
  expected: { skillName: string; aPath: string; bPath: string }
): LabeledEvalVerdict {
  if (!isRecord(parsed) || !isRecord(parsed.copies)) {
    throw new Error(`${backend} backend JSON must have shape {"skill_name":"...","recommended_winner":"A|B|tie","copies":{"A":...,"B":...}}`);
  }

  if (typeof parsed.skill_name !== "string" || parsed.skill_name.trim() !== expected.skillName) {
    throw new Error(`${backend} backend JSON field skill_name must be ${expected.skillName}, got ${String(parsed.skill_name)}`);
  }

  const winner = parsed.recommended_winner;
  if (winner !== "A" && winner !== "B" && winner !== "tie") {
    throw new Error(`${backend} backend JSON field recommended_winner must be A, B, or tie`);
  }

  if (typeof parsed.rationale !== "string" || parsed.rationale.trim().length === 0) {
    throw new Error(`${backend} backend JSON field rationale must be a non-empty string`);
  }

  return {
    skillName: parsed.skill_name.trim(),
    recommendedWinner: winner,
    rationale: parsed.rationale.trim(),
    copies: {
      A: scoreCopy(parsed.copies.A, "copies.A", backend, expected.aPath),
      B: scoreCopy(parsed.copies.B, "copies.B", backend, expected.bPath)
    },
    notes: stringArray(parsed.notes ?? [], "notes", backend)
  };
}

export function buildLabeledEvalPrompt(input: {
  skillName: string;
  description?: string;
  aPath: string;
  bPath: string;
  /** Project-relative or absolute root of the pinned Anthropic skill-creator eval tooling. */
  creatorRoot: string;
  behaviorEvidence?: { digest: string; cases: unknown[] };
}): string {
  const description = input.description?.trim()
    ? `Original request:\n${input.description.trim()}\n\n`
    : "Original request: not provided; infer intended behavior from both SKILL.md files.\n\n";

  const behaviorEvidence = input.behaviorEvidence
    ? `Bounded redacted behavior cases (digest ${input.behaviorEvidence.digest}):\n${JSON.stringify(input.behaviorEvidence.cases)}\n\nAssess both candidates against every positive and negative case. Any deterministic regression must veto a winner.\n\n`
    : "Behavior cases unavailable; state this limitation in notes.\n\n";

  return `You are Farrier\'s skill evaluator. Return JSON only.

Use the pinned Anthropic skill-creator eval workflow:
- Read ${input.creatorRoot}/agents/comparator.md and apply its blind-comparison rubric.
- Read ${input.creatorRoot}/agents/analyzer.md and use its post-hoc analysis guidance to explain why the better skill wins.
- Read ${input.creatorRoot}/references/schemas.md for comparison/analysis field expectations.

This is a blind comparison of two anonymous candidate skills. Do NOT try to infer which tool or vendor produced which candidate; judge only the content. This is a read-only static eval; do not edit files, create workspaces, run agents, or delete anything.

Skill name: ${input.skillName}
${description}${behaviorEvidence}Candidate A: ${input.aPath}
Candidate B: ${input.bPath}

Return exactly this JSON shape, with no markdown:
{
  "skill_name": "${input.skillName}",
  "recommended_winner": "A" | "B" | "tie",
  "rationale": "one concise paragraph explaining the recommendation",
  "copies": {
    "A": {
      "path": "${input.aPath}",
      "score": 0,
      "rationale": "why this candidate scored this way",
      "strengths": ["specific strength"],
      "weaknesses": ["specific weakness"]
    },
    "B": {
      "path": "${input.bPath}",
      "score": 0,
      "rationale": "why this candidate scored this way",
      "strengths": ["specific strength"],
      "weaknesses": ["specific weakness"]
    }
  },
  "notes": ["anything the user should know before choosing"]
}

Score each candidate from 0 to 10 for instruction clarity, triggering description, progressive disclosure, bundled resource usefulness, safety, and likely reliability for the original request. The recommendation is advisory; the user will choose what to keep.`;
}

/** Which agent each label refers to in one judge pass. */
export type LabelAssignment = Record<EvalCandidateLabel, CreateAgent>;

export type MergedJudgeVerdict = {
  recommendedWinner: CreateAgent | "tie";
  rationale: string;
  copies: Record<CreateAgent, Omit<LabeledCopyScore, "path">>;
  notes: string[];
};

function winnerAgent(verdict: LabeledEvalVerdict, assignment: LabelAssignment): CreateAgent | "tie" {
  return verdict.recommendedWinner === "tie" ? "tie" : assignment[verdict.recommendedWinner];
}

function copyFor(verdict: LabeledEvalVerdict, assignment: LabelAssignment, agent: CreateAgent): LabeledCopyScore {
  return assignment.A === agent ? verdict.copies.A : verdict.copies.B;
}

/**
 * Merge the two swapped passes: scores average across positions, and a winner
 * stands only when both passes name the same agent — anything else is a tie.
 */
export function mergeJudgePasses(
  passes: Array<{ verdict: LabeledEvalVerdict; assignment: LabelAssignment }>
): MergedJudgeVerdict {
  const [first, second] = passes;

  if (!first || !second) {
    throw new Error("mergeJudgePasses requires exactly two passes");
  }

  const firstWinner = winnerAgent(first.verdict, first.assignment);
  const secondWinner = winnerAgent(second.verdict, second.assignment);
  const agreed = firstWinner === secondWinner;
  const notes = [...first.verdict.notes];

  if (!agreed) {
    notes.push(
      `The judge disagreed with itself when the candidates were swapped (${firstWinner} vs ${secondWinner}) — treating as a tie.`
    );
  }

  const copies = Object.fromEntries(
    (["claude", "codex"] as const).map((agent) => {
      const one = copyFor(first.verdict, first.assignment, agent);
      const two = copyFor(second.verdict, second.assignment, agent);
      return [
        agent,
        {
          score: Math.round(((one.score + two.score) / 2) * 10) / 10,
          rationale: one.rationale,
          strengths: one.strengths,
          weaknesses: one.weaknesses
        }
      ];
    })
  ) as MergedJudgeVerdict["copies"];

  return {
    recommendedWinner: agreed ? firstWinner : "tie",
    rationale: first.verdict.rationale,
    copies,
    notes
  };
}
