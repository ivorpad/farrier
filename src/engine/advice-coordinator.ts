import { redactText } from "./behavior-evidence";
import type { AdviceProviderPolicy } from "./advice-policy";
import {
  adviceCategories,
  type AdviceCategory,
  type AdviceEvidence,
  type AdviceOmittedRecommendation,
  type AdviceRecommendation,
} from "./advice-types";

type CoordinatorOmission = {
  id: string;
  kind: "overlap" | "limit";
  selectedId?: string;
  reason: string;
};

type CoordinatorResponse = {
  selectedIds: string[];
  omissions: CoordinatorOmission[];
};

export type CoordinatedAdvice = {
  recommendations: AdviceRecommendation[];
  omitted: AdviceOmittedRecommendation[];
  overlapCount: number;
};

export class AdviceCoordinatorValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Advice coordinator response is invalid: ${errors.join(" ")}`);
    this.name = "AdviceCoordinatorValidationError";
    this.errors = errors;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function candidatePayload(candidates: AdviceRecommendation[]) {
  return candidates.map((candidate) => ({
    id: candidate.id,
    category: candidate.category,
    reason: candidate.reason,
    benefit: candidate.benefit,
    confidence: candidate.confidence,
    evidence: candidate.evidence,
    route: candidate.implementationRoute,
    registryRef: candidate.registryRef,
  }));
}

function citedEvidencePayload(candidates: AdviceRecommendation[], evidence: AdviceEvidence[]) {
  const cited = new Set(candidates.flatMap((candidate) => candidate.evidence));
  return evidence
    .filter((item) => cited.has(item.id))
    .map((item) => ({ id: item.id, summary: item.summary, source: item.source, kind: item.kind }));
}

export function buildAdviceCoordinatorPrompt(input: {
  candidates: AdviceRecommendation[];
  categories: AdviceCategory[];
  evidence: AdviceEvidence[];
  policy: AdviceProviderPolicy;
}): string {
  const limits = input.policy.categories
    .filter((item) => input.categories.includes(item.category))
    .map((item) => ({ category: item.category, limit: item.defaultLimit }));
  return `You are Farrier's constrained ${input.policy.provider} advice coordinator. Return JSON only:
{"selectedIds":["known-candidate-id"],"omissions":[{"id":"known-candidate-id","kind":"overlap|limit","selectedId":"required only for overlap","reason":"non-empty reason, at most 320 characters"}]}

Select the strongest non-overlapping recommendations. You may only select or omit the supplied IDs.

Rules:
- Partition every candidate exactly once across selectedIds and omissions.
- Select at least one candidate.
- Keep each category within its stated limit.
- Use overlap only when another different selected candidate covers the same need. Point selectedId to that candidate.
- Use limit only when that candidate's category is already at its limit.
- Do not rewrite candidate facts, invent IDs, or add prose outside JSON.

Provider decision rules:
${JSON.stringify(input.policy.decisionRules)}

Requested categories and limits:
${JSON.stringify(limits)}

Candidate set:
${JSON.stringify(candidatePayload(input.candidates))}

Cited evidence summaries:
${JSON.stringify(citedEvidencePayload(input.candidates, input.evidence))}
`;
}

export function buildAdviceCoordinatorRepairPrompt(input: {
  candidates: AdviceRecommendation[];
  categories: AdviceCategory[];
  evidence: AdviceEvidence[];
  policy: AdviceProviderPolicy;
  errors: string[];
}): string {
  return `${buildAdviceCoordinatorPrompt(input)}
Your previous response failed the closed schema:
${JSON.stringify(input.errors.map((error) => redactText(error).slice(0, 320)))}

Return one corrected JSON object now.`;
}

function parseCoordinatorResponse(parsed: unknown): { response?: CoordinatorResponse; errors: string[] } {
  if (!isRecord(parsed)) return { errors: ["Response must be an object."] };
  const errors: string[] = [];
  const rootKeys = Object.keys(parsed).filter((key) => key !== "selectedIds" && key !== "omissions");
  if (rootKeys.length) errors.push(`Unknown response fields: ${rootKeys.join(", ")}.`);
  const selectedIds = Array.isArray(parsed.selectedIds) && parsed.selectedIds.every((id) => typeof id === "string")
    ? parsed.selectedIds as string[]
    : [];
  if (!Array.isArray(parsed.selectedIds) || parsed.selectedIds.some((id) => typeof id !== "string")) {
    errors.push("selectedIds must be an array of strings.");
  }
  const omissions: CoordinatorOmission[] = [];
  if (!Array.isArray(parsed.omissions)) errors.push("omissions must be an array.");
  else for (const [index, value] of parsed.omissions.entries()) {
    if (!isRecord(value)) {
      errors.push(`omissions[${index}] must be an object.`);
      continue;
    }
    const unknownKeys = Object.keys(value).filter((key) => !["id", "kind", "selectedId", "reason"].includes(key));
    if (unknownKeys.length) errors.push(`omissions[${index}] has unknown fields: ${unknownKeys.join(", ")}.`);
    const id = typeof value.id === "string" ? value.id : "";
    const kind = value.kind === "overlap" || value.kind === "limit" ? value.kind : undefined;
    const selectedId = typeof value.selectedId === "string" ? value.selectedId : undefined;
    const reason = typeof value.reason === "string" ? value.reason.trim() : "";
    if (!id || !kind || !reason) {
      errors.push(`omissions[${index}] requires id, kind, and a non-empty reason.`);
      continue;
    }
    if (Array.from(reason).length > 320) errors.push(`Omission reason for '${id}' exceeds 320 characters.`);
    omissions.push({ id, kind, ...(selectedId ? { selectedId } : {}), reason });
  }
  return errors.length ? { errors } : { response: { selectedIds, omissions }, errors: [] };
}

export function validateAdviceCoordinatorResponse(input: {
  parsed: unknown;
  candidates: AdviceRecommendation[];
  policy: AdviceProviderPolicy;
}): CoordinatedAdvice {
  const parsed = parseCoordinatorResponse(input.parsed);
  if (!parsed.response) throw new AdviceCoordinatorValidationError(parsed.errors);
  const errors: string[] = [];
  const response = parsed.response;
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  if (candidateById.size !== input.candidates.length) errors.push("Candidate IDs are not unique.");
  const selected = new Set<string>();
  for (const id of response.selectedIds) {
    if (!candidateById.has(id)) errors.push(`Unknown selected ID '${id}'.`);
    if (selected.has(id)) errors.push(`Duplicate selected ID '${id}'.`);
    selected.add(id);
  }
  if (input.candidates.length && selected.size === 0) errors.push("At least one candidate must be selected.");
  const omitted = new Set<string>();
  for (const omission of response.omissions) {
    if (!candidateById.has(omission.id)) errors.push(`Unknown omitted ID '${omission.id}'.`);
    if (selected.has(omission.id) || omitted.has(omission.id)) errors.push(`Candidate '${omission.id}' appears more than once.`);
    omitted.add(omission.id);
    if (omission.kind === "overlap") {
      if (!omission.selectedId) errors.push(`Overlap omission '${omission.id}' requires selectedId.`);
      else if (omission.selectedId === omission.id) errors.push(`Overlap omission '${omission.id}' cannot point to itself.`);
      else if (!candidateById.has(omission.selectedId)) errors.push(`Overlap omission '${omission.id}' points to an unknown candidate.`);
      else if (!selected.has(omission.selectedId)) errors.push(`Overlap omission '${omission.id}' must point to a selected candidate.`);
    } else if (omission.selectedId) errors.push(`Limit omission '${omission.id}' cannot include selectedId.`);
  }
  for (const id of candidateById.keys()) {
    if (!selected.has(id) && !omitted.has(id)) errors.push(`Candidate '${id}' is missing from the partition.`);
  }
  for (const category of adviceCategories) {
    const limit = input.policy.categories.find((item) => item.category === category)?.defaultLimit;
    if (limit === undefined) continue;
    const selectedCount = response.selectedIds.filter((id) => candidateById.get(id)?.category === category).length;
    if (selectedCount > limit) errors.push(`Category '${category}' exceeds its limit of ${limit}.`);
    for (const omission of response.omissions.filter((item) => item.kind === "limit" && candidateById.get(item.id)?.category === category)) {
      if (selectedCount < limit) errors.push(`Limit omission '${omission.id}' is invalid because '${category}' has room.`);
    }
  }
  if (errors.length) throw new AdviceCoordinatorValidationError(errors);

  const rank = new Map(response.selectedIds.map((id, index) => [id, index]));
  const recommendations = response.selectedIds
    .map((id) => candidateById.get(id)!)
    .sort((left, right) => adviceCategories.indexOf(left.category) - adviceCategories.indexOf(right.category)
      || rank.get(left.id)! - rank.get(right.id)!);
  const omissions = response.omissions.map((omission): AdviceOmittedRecommendation => ({
    recommendation: candidateById.get(omission.id)!,
    reason: redactText(omission.reason).replace(/\s+/g, " ").trim(),
  }));
  return {
    recommendations,
    omitted: omissions,
    overlapCount: response.omissions.filter((item) => item.kind === "overlap").length,
  };
}
