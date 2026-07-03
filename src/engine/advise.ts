import { existsSync } from "node:fs";
import { readFile as readFileText } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultBackendRunner,
  invokeBackend,
  type AgentBackend,
  type BackendCommandRunner,
  type BackendCommandRunnerInput,
  type BackendCommandRunnerOutput
} from "./backend";
import type { ReasoningEffort } from "../config/farrier-config";
import { searchSkills, type SkillSearchResult } from "./skills";

export { detectAgentBackend } from "./backend";

export type AdviseBackend = AgentBackend;

export type SkillRecommendation = {
  ref: string;
  name: string;
  installs: number;
  reason: string;
};

export type ResolvedContext = {
  text: string;
  source: string;
};

export type AdviseDeps = {
  which: (bin: string) => string | null;
  exists: (path: string) => boolean;
  readFile: (path: string) => Promise<string>;
};

const defaultAdviseDeps: AdviseDeps = {
  which: (bin) => Bun.which(bin),
  exists: (path) => existsSync(path),
  readFile: (path) => readFileText(path, "utf8")
};

const contextCharLimit = 16_000;
const detectedContextProbes = ["PRP.md", "PRP.txt", join("docs", "PRP.md")];
const defaultMaxRecommendations = 6;
const maxCandidates = 30;

function truncateContext(text: string): string {
  if (text.length <= contextCharLimit) {
    return text;
  }

  return `${text.slice(0, contextCharLimit)}\n\n[context truncated to ${contextCharLimit} characters]`;
}

export async function resolveContext(input: {
  targetDir: string;
  context?: string;
  deps?: Partial<AdviseDeps>;
}): Promise<ResolvedContext | undefined> {
  const deps = { ...defaultAdviseDeps, ...input.deps };

  if (input.context !== undefined) {
    const asGiven = input.context;

    if (deps.exists(asGiven)) {
      const text = await deps.readFile(asGiven);
      return { text: truncateContext(text), source: `file:${asGiven}` };
    }

    const relativeToTarget = join(input.targetDir, asGiven);

    if (deps.exists(relativeToTarget)) {
      const text = await deps.readFile(relativeToTarget);
      return { text: truncateContext(text), source: `file:${relativeToTarget}` };
    }

    return { text: truncateContext(asGiven), source: "text" };
  }

  for (const probe of detectedContextProbes) {
    const path = join(input.targetDir, probe);

    if (deps.exists(path)) {
      const text = await deps.readFile(path);
      return { text: truncateContext(text), source: `detected:${probe}` };
    }
  }

  return undefined;
}

export type AdviseCommandRunnerInput = BackendCommandRunnerInput;

export type AdviseCommandRunnerOutput = BackendCommandRunnerOutput;

export type AdviseCommandRunner = BackendCommandRunner;

export type AdviseSkillsInput = {
  targetDir: string;
  packId: string;
  contextText: string;
  backend: AdviseBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  maxRecommendations?: number;
  runner?: AdviseCommandRunner;
  search?: (query: string) => Promise<SkillSearchResult[]>;
};

export type AdviseResult = {
  backend: AdviseBackend;
  queries: string[];
  recommendations: SkillRecommendation[];
  notes: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildQueriesPrompt(input: { packId: string; contextText: string }): string {
  return `You are farrier's skill-research assistant. Return JSON only, with this exact shape:
{"queries": ["short search query"]}
- 2 to 4 queries, each 1-4 words, suited to a skills registry search (frameworks, tasks, domains).
- No prose, no markdown, no explanations.
Project stack: ${input.packId}
Project description:
${input.contextText}
`;
}

type CandidateSkill = SkillSearchResult & { ref: string };

function buildRecommendationsPrompt(input: {
  packId: string;
  contextText: string;
  maxRecommendations: number;
  candidates: CandidateSkill[];
}): string {
  const candidateSummaries = input.candidates.map(({ ref, name, installs }) => ({ ref, name, installs }));

  return `You are farrier's skill-recommendation assistant. Return JSON only, with this exact shape:
{"recommendations": [{"ref": "<source>@<skillId>", "reason": "one short sentence"}]}
- Choose at most ${input.maxRecommendations} skills from the candidate list below. Copy ref strings exactly.
- Recommend only skills genuinely useful for this project. If none fit, return {"recommendations": []}.
- No prose, no markdown.
Project stack: ${input.packId}
Project description:
${input.contextText}
Candidates:
${JSON.stringify(candidateSummaries, null, 2)}
`;
}

function extractQueries(parsed: unknown, backend: AdviseBackend): string[] {
  if (!isRecord(parsed) || !Array.isArray(parsed.queries)) {
    throw new Error(`${backend} backend JSON must have shape {"queries":[...]}`);
  }

  return parsed.queries.filter((query): query is string => typeof query === "string" && query.trim().length > 0);
}

function extractRawRecommendations(parsed: unknown, backend: AdviseBackend): unknown[] {
  if (!isRecord(parsed) || !Array.isArray(parsed.recommendations)) {
    throw new Error(`${backend} backend JSON must have shape {"recommendations":[...]}`);
  }

  return parsed.recommendations;
}

async function collectCandidates(
  queries: string[],
  search: (query: string) => Promise<SkillSearchResult[]>
): Promise<{ candidates: CandidateSkill[]; notes: string[] }> {
  const settled = await Promise.allSettled(queries.map((query) => search(query)));
  const byRef = new Map<string, CandidateSkill>();
  const notes: string[] = [];

  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      notes.push(`Search for '${queries[index]}' failed: ${message}`);
      continue;
    }

    for (const result of outcome.value) {
      if (byRef.size >= maxCandidates) {
        break;
      }

      const ref = `${result.source}@${result.skillId}`;

      if (!byRef.has(ref)) {
        byRef.set(ref, { ...result, ref });
      }
    }
  }

  return { candidates: Array.from(byRef.values()), notes };
}

function parseRef(ref: string): { source: string; skillId: string } | undefined {
  const separator = ref.lastIndexOf("@");

  if (separator <= 0 || separator === ref.length - 1) {
    return undefined;
  }

  const source = ref.slice(0, separator);
  const skillId = ref.slice(separator + 1);

  return source && skillId ? { source, skillId } : undefined;
}

function validateRecommendation(
  raw: unknown,
  candidatesByRef: Map<string, CandidateSkill>
): { ok: true; recommendation: SkillRecommendation } | { ok: false; reason: string } {
  if (!isRecord(raw)) {
    return { ok: false, reason: "recommendation must be an object" };
  }

  const ref = typeof raw.ref === "string" ? raw.ref : undefined;

  if (!ref) {
    return { ok: false, reason: "recommendation is missing required string field ref" };
  }

  const reason = typeof raw.reason === "string" && raw.reason.trim().length > 0 ? raw.reason : undefined;

  if (!reason) {
    return { ok: false, reason: `recommendation '${ref}' is missing required string field reason` };
  }

  if (!parseRef(ref)) {
    return { ok: false, reason: `recommendation ref '${ref}' is not shaped <source>@<skillId>` };
  }

  const candidate = candidatesByRef.get(ref);

  if (!candidate) {
    return { ok: false, reason: `recommendation ref '${ref}' is not in the candidate set` };
  }

  return {
    ok: true,
    recommendation: {
      ref,
      name: candidate.name,
      installs: candidate.installs,
      reason
    }
  };
}

export async function adviseSkills(input: AdviseSkillsInput): Promise<AdviseResult> {
  const runner = input.runner ?? defaultBackendRunner;
  const search = input.search ?? searchSkills;
  const maxRecommendations = input.maxRecommendations ?? defaultMaxRecommendations;
  const notes: string[] = [];

  const queriesJson = await invokeBackend({
    backend: input.backend,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    prompt: buildQueriesPrompt({ packId: input.packId, contextText: input.contextText }),
    targetDir: input.targetDir,
    runner
  });

  const queries = extractQueries(queriesJson, input.backend);
  const collected = await collectCandidates(queries, search);
  const candidates = collected.candidates;
  notes.push(...collected.notes);

  if (candidates.length === 0) {
    notes.push("No candidate skills found for the generated queries.");
    return { backend: input.backend, queries, recommendations: [], notes };
  }

  const recommendationsJson = await invokeBackend({
    backend: input.backend,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    prompt: buildRecommendationsPrompt({
      packId: input.packId,
      contextText: input.contextText,
      maxRecommendations,
      candidates
    }),
    targetDir: input.targetDir,
    runner
  });

  const rawRecommendations = extractRawRecommendations(recommendationsJson, input.backend);
  const candidatesByRef = new Map(candidates.map((candidate) => [candidate.ref, candidate]));
  const recommendations: SkillRecommendation[] = [];

  for (const raw of rawRecommendations) {
    if (recommendations.length >= maxRecommendations) {
      notes.push(`Dropped extra recommendation beyond the ${maxRecommendations} cap.`);
      continue;
    }

    const validated = validateRecommendation(raw, candidatesByRef);

    if (validated.ok) {
      recommendations.push(validated.recommendation);
    } else {
      notes.push(validated.reason);
    }
  }

  return { backend: input.backend, queries, recommendations, notes };
}
