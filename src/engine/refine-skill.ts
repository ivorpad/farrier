import {
  defaultBackendRunner,
  invokeBackend,
  type AgentBackend,
  type BackendCommandRunner
} from "./backend";
import type { ReasoningEffort } from "../config/farrier-config";

/**
 * Before delegating to a vendor skill-creator, farrier asks the backend LLM
 * for the implementation decisions the request leaves open (language,
 * libraries, formats, integration points). The user's answers become an
 * explicit "implementation decisions" block in the authoring brief, so the
 * creator stops guessing.
 */
export type RefineQuestion = {
  question: string;
  options: string[];
};

export type RefineAnswer = {
  question: string;
  answer: string;
};

const maxQuestions = 4;
const maxOptions = 5;
const requestCharLimit = 16_000;

function buildRefinePrompt(input: { description: string; packId?: string }): string {
  return `You are farrier's skill-briefing assistant. A coding-agent skill will be authored from the request below by a skill-creator agent. Return JSON only, with this exact shape:
{"questions": [{"question": "short question", "options": ["concrete option"]}]}
- 2 to ${maxQuestions} questions that pin down implementation decisions the request leaves open: language, specific libraries, input/output formats, integration points.
- Skip anything the request already decides. If nothing is open, return {"questions": []}.
- 2 to ${maxOptions} options per question, each concrete (name the actual library/tool/format). Put your recommendation first.
- No prose, no markdown.
${input.packId ? `Project stack: ${input.packId}\n` : ""}Skill request:
${input.description.slice(0, requestCharLimit)}
`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateQuestions(parsed: unknown, backend: AgentBackend): RefineQuestion[] {
  if (!isRecord(parsed) || !Array.isArray(parsed.questions)) {
    throw new Error(`${backend} backend JSON must have shape {"questions":[...]}`);
  }

  const questions: RefineQuestion[] = [];

  for (const raw of parsed.questions) {
    if (questions.length >= maxQuestions) {
      break;
    }

    if (!isRecord(raw) || typeof raw.question !== "string" || raw.question.trim().length === 0) {
      continue;
    }

    const options = Array.isArray(raw.options)
      ? raw.options
          .filter((option): option is string => typeof option === "string" && option.trim().length > 0)
          .map((option) => option.trim())
          .slice(0, maxOptions)
      : [];

    questions.push({ question: raw.question.trim(), options });
  }

  return questions;
}

export async function generateRefineQuestions(input: {
  description: string;
  backend: AgentBackend;
  targetDir: string;
  packId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner?: BackendCommandRunner;
}): Promise<RefineQuestion[]> {
  const parsed = await invokeBackend({
    backend: input.backend,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    prompt: buildRefinePrompt({ description: input.description, packId: input.packId }),
    targetDir: input.targetDir,
    runner: input.runner ?? defaultBackendRunner
  });

  return validateQuestions(parsed, input.backend);
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
