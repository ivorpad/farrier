import type { ReasoningEffort } from "../config/farrier-config";
import {
  AdviceCoordinatorValidationError,
  buildAdviceCoordinatorPrompt,
  buildAdviceCoordinatorRepairPrompt,
  validateAdviceCoordinatorResponse,
} from "./advice-coordinator";
import type { AdviceRegistryEntry } from "./advice-catalog";
import type { AdviceProviderPolicy } from "./advice-policy";
import { buildAdvicePrompt, validateAdviceCoverage, validateAdviceResponse } from "./advice-recommender";
import {
  adviceCategories,
  type AdviceAnalysisSummary,
  type AdviceCategory,
  type AdviceCoverage,
  type AdviceEvidence,
  type AdviceOmittedRecommendation,
  type AdviceRecommendation,
  type AdviceSessionEpisode,
  type AdviceVendor,
  type ProjectProfile,
} from "./advice-types";
import { invokeBackend, type BackendCommandRunner } from "./backend";

export const defaultAdviceWorkerConcurrency = 3;

type CategoryWork = { total: number; queued: number; running: number; completed: number; failed: number };

type AdviceOrchestrationProgress = {
  stage: "backend" | "coordination" | "validation";
  message: string;
  work?: CategoryWork;
};

type WorkerResult = {
  category: AdviceCategory;
  returned: number;
  recommendations: AdviceRecommendation[];
  weakLeads: AdviceRecommendation[];
  omitted: AdviceOmittedRecommendation[];
  notes: string[];
  rejectionReasons: string[];
  localRecoveries: number;
  coverage: AdviceCoverage;
};

type WorkerFailure = { category: AdviceCategory; error: unknown; summary: string };

export type AdviceOrchestrationResult = {
  recommendations: AdviceRecommendation[];
  omitted: AdviceOmittedRecommendation[];
  weakLeads: AdviceRecommendation[];
  coverage: AdviceCoverage[];
  notes: string[];
  rejectionReasons: string[];
  returned: number;
  accepted: number;
  merged: number;
  localRecoveries: number;
  workerCalls: number;
  successfulWorkerCalls: number;
  failedWorkerCalls: number;
  coordinatorCalls: number;
  recoveryCalls: number;
  analysis: AdviceAnalysisSummary;
};

export type AdviceOrchestratorInput = {
  targetDir: string;
  backend: AdviceVendor;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner: BackendCommandRunner;
  signal?: AbortSignal;
  categories: AdviceCategory[];
  profile: ProjectProfile;
  evidence: AdviceEvidence[];
  episodes: AdviceSessionEpisode[];
  policy: AdviceProviderPolicy;
  registry: AdviceRegistryEntry[];
  queries: Array<{ query: string; evidence: string[]; matches: string[] }>;
  concurrency?: number;
  onProgress?: (event: AdviceOrchestrationProgress) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function candidateCategory(value: Record<string, unknown>): AdviceCategory | undefined {
  if (typeof value.category === "string" && adviceCategories.includes(value.category as AdviceCategory)) {
    return value.category as AdviceCategory;
  }
  const prefix = typeof value.id === "string" ? value.id.split(":", 1)[0] : undefined;
  return prefix && adviceCategories.includes(prefix as AdviceCategory) ? prefix as AdviceCategory : undefined;
}

function normalizeWorkerResponse(parsed: unknown, category: AdviceCategory) {
  if (!isRecord(parsed) || !Array.isArray(parsed.recommendations)) {
    throw new Error(`focused ${category} backend response must contain a recommendations array`);
  }
  let localRecoveries = 0;
  const notes: string[] = [];
  const rejectionReasons: string[] = [];
  const recommendations = parsed.recommendations.flatMap((candidate): unknown[] => {
    if (!isRecord(candidate)) return [candidate];
    const declared = candidateCategory(candidate);
    if (declared && declared !== category) {
      rejectionReasons.push(`Dropped cross-category candidate from the focused ${category} call: candidate declared ${declared}.`);
      return [];
    }
    if (declared) return [candidate];
    localRecoveries += 1;
    notes.push(`Filled missing category for a candidate from the focused ${category} call.`);
    return [{ ...candidate, category }];
  });
  const coverage = Array.isArray(parsed.coverage)
    ? parsed.coverage.flatMap((item): unknown[] => isRecord(item) && (item.category === undefined || item.category === category)
      ? [{ ...item, category }]
      : [])
    : [];
  return {
    parsed: { recommendations, coverage },
    returned: parsed.recommendations.length,
    localRecoveries,
    notes,
    rejectionReasons,
  };
}

function failureSummary(error: unknown, backend: AdviceVendor): string {
  const message = error instanceof Error ? error.message : String(error);
  const exitCode = message.match(/backend exited with code (\d+)/)?.[1];
  if (exitCode) return `${backend} backend exited with code ${exitCode}`;
  if (/did not return JSON|returned empty stdout|recommendations array|must have shape/i.test(message)) {
    return `${backend} backend returned an invalid recommendation response`;
  }
  if (/stdout exceeded/i.test(message)) return `${backend} backend output exceeded the allowed size`;
  return `${backend} recommendation worker failed`;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Advice analysis cancelled.");
}

async function runWorker(input: AdviceOrchestratorInput, category: AdviceCategory): Promise<WorkerResult> {
  const evidence = input.evidence;
  const episodes = input.episodes;
  const registry = input.registry.filter((entry) => entry.category === category);
  const parsed = await invokeBackend({
    backend: input.backend,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    targetDir: input.targetDir,
    prompt: buildAdvicePrompt({
      profile: input.profile,
      evidence,
      episodes,
      categories: [category],
      focused: input.categories.length === 1,
      policy: input.policy,
      registry,
      queries: category === "skills" ? input.queries : [],
    }),
    ephemeral: true,
    runner: input.runner,
    signal: input.signal,
  });
  const normalized = normalizeWorkerResponse(parsed, category);
  const validated = validateAdviceResponse({
    parsed: normalized.parsed,
    evidence,
    categories: [category],
    policy: input.policy,
    registry,
  });
  return {
    category,
    returned: normalized.returned,
    recommendations: validated.recommendations,
    weakLeads: validated.weakLeads,
    omitted: validated.omitted,
    notes: [...normalized.notes, ...validated.notes],
    rejectionReasons: [...normalized.rejectionReasons, ...validated.rejectionReasons],
    localRecoveries: normalized.localRecoveries + validated.localRecoveries,
    coverage: validateAdviceCoverage({ parsed: normalized.parsed, categories: [category], ...validated })[0]!,
  };
}

async function runWorkers(input: AdviceOrchestratorInput): Promise<Array<WorkerResult | WorkerFailure>> {
  const concurrency = Math.max(1, Math.min(input.concurrency ?? defaultAdviceWorkerConcurrency, input.categories.length));
  const results: Array<WorkerResult | WorkerFailure> = new Array(input.categories.length);
  let next = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  const progress = (message: string) => input.onProgress?.({
    stage: "backend",
    message,
    work: { total: input.categories.length, queued: input.categories.length - next, running, completed, failed },
  });
  const consume = async () => {
    while (true) {
      if (input.signal?.aborted) return;
      const index = next;
      if (index >= input.categories.length) return;
      next += 1;
      const category = input.categories[index]!;
      running += 1;
      progress(`Running ${category} recommendation worker (${completed + failed}/${input.categories.length} settled)…`);
      try {
        results[index] = await runWorker(input, category);
        completed += 1;
      } catch (error) {
        results[index] = { category, error, summary: failureSummary(error, input.backend) };
        failed += 1;
      } finally {
        running -= 1;
        progress(`Settled ${category} recommendation worker (${completed + failed}/${input.categories.length})…`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, consume));
  throwIfAborted(input.signal);
  return results;
}

function isWorkerFailure(result: WorkerResult | WorkerFailure): result is WorkerFailure {
  return "error" in result;
}

function coordinatorParseFailure(error: unknown, backend: AdviceVendor): string[] | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(`${backend} backend did not return JSON`) || message.includes(`${backend} backend returned empty stdout`)) {
    return ["Response was not a JSON object matching the closed coordinator schema."];
  }
  return undefined;
}

async function coordinate(input: AdviceOrchestratorInput, candidates: AdviceRecommendation[]) {
  const base = { candidates, categories: input.categories, evidence: input.evidence, policy: input.policy };
  let parsed: unknown;
  let repairErrors: string[] | undefined;
  try {
    parsed = await invokeBackend({
      backend: input.backend,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      targetDir: input.targetDir,
      prompt: buildAdviceCoordinatorPrompt(base),
      ephemeral: true,
      runner: input.runner,
      signal: input.signal,
    });
  } catch (error) {
    repairErrors = coordinatorParseFailure(error, input.backend);
    if (!repairErrors) throw error;
  }
  if (!repairErrors) {
    try {
      return { coordinated: validateAdviceCoordinatorResponse({ parsed, candidates, policy: input.policy }), recoveryCalls: 0 };
    } catch (error) {
      if (!(error instanceof AdviceCoordinatorValidationError)) throw error;
      repairErrors = error.errors;
    }
  }
  throwIfAborted(input.signal);
  input.onProgress?.({ stage: "coordination", message: "Repairing one invalid coordinator response…" });
  const repaired = await invokeBackend({
    backend: input.backend,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    targetDir: input.targetDir,
    prompt: buildAdviceCoordinatorRepairPrompt({ ...base, errors: repairErrors }),
    ephemeral: true,
    runner: input.runner,
    signal: input.signal,
  });
  return {
    coordinated: validateAdviceCoordinatorResponse({ parsed: repaired, candidates, policy: input.policy }),
    recoveryCalls: 1,
  };
}

function canonicalRecommendations(items: AdviceRecommendation[]): AdviceRecommendation[] {
  return [...items].sort((left, right) => adviceCategories.indexOf(left.category) - adviceCategories.indexOf(right.category));
}

function deriveCoverage(input: {
  categories: AdviceCategory[];
  successful: Map<AdviceCategory, WorkerResult>;
  failures: Map<AdviceCategory, WorkerFailure>;
  recommendations: AdviceRecommendation[];
  omitted: AdviceOmittedRecommendation[];
  weakLeads: AdviceRecommendation[];
}): AdviceCoverage[] {
  return input.categories.map((category): AdviceCoverage => {
    const failure = input.failures.get(category);
    if (failure) return { category, status: "backend-omission", reason: `Focused ${category} call failed: ${failure.summary}.` };
    const worker = input.successful.get(category)!;
    const selected = input.recommendations.filter((item) => item.category === category).length;
    if (selected) return { category, status: "accepted", reason: worker.coverage.reason };
    if (input.omitted.some((item) => item.recommendation.category === category)) {
      return { category, status: "presentation-omission", reason: "Valid opportunities were omitted by overlap or category presentation bounds." };
    }
    if (input.weakLeads.some((item) => item.category === category)) return { category, status: "weak-evidence", reason: worker.coverage.reason };
    if (worker.returned > 0) return { category, status: "validation-rejection", reason: "The worker returned candidates, but every candidate failed local validation." };
    return { category, status: "no-evidence", reason: worker.coverage.reason };
  });
}

export async function orchestrateAdvice(input: AdviceOrchestratorInput): Promise<AdviceOrchestrationResult> {
  const results = await runWorkers(input);
  const successful = new Map<AdviceCategory, WorkerResult>();
  const failures = new Map<AdviceCategory, WorkerFailure>();
  for (const result of results) {
    if (isWorkerFailure(result)) failures.set(result.category, result);
    else successful.set(result.category, result);
  }
  if (input.categories.length === 1 && failures.size) throw failures.values().next().value!.error;
  if (!successful.size) throw new Error(`Every advice worker failed: ${input.categories.join(", ")}.`);

  const candidates = input.categories.flatMap((category) => successful.get(category)?.recommendations ?? []);
  let recommendations = candidates;
  let coordinatorOmissions: AdviceOmittedRecommendation[] = [];
  let merged = 0;
  let coordinatorCalls = 0;
  let recoveryCalls = 0;
  if (input.categories.length > 1 && candidates.length) {
    coordinatorCalls = 1;
    input.onProgress?.({ stage: "coordination", message: `Coordinating ${candidates.length} validated candidate(s) across categories…` });
    const coordinated = await coordinate(input, candidates);
    recommendations = coordinated.coordinated.recommendations;
    coordinatorOmissions = coordinated.coordinated.omitted;
    merged = coordinated.coordinated.overlapCount;
    recoveryCalls = coordinated.recoveryCalls;
  }
  throwIfAborted(input.signal);
  input.onProgress?.({ stage: "validation", message: "Finalizing deterministic coverage and report accounting…" });

  const workerOmissions = input.categories.flatMap((category) => successful.get(category)?.omitted ?? []);
  const omitted = [...workerOmissions, ...coordinatorOmissions].sort((left, right) =>
    adviceCategories.indexOf(left.recommendation.category) - adviceCategories.indexOf(right.recommendation.category));
  const weakLeads = canonicalRecommendations(input.categories.flatMap((category) => successful.get(category)?.weakLeads ?? []));
  const notes = input.categories.flatMap((category) => successful.get(category)?.notes ?? []);
  for (const failure of failures.values()) notes.push(`Focused ${failure.category} call failed while other categories continued: ${failure.summary}.`);
  const returned = [...successful.values()].reduce((sum, worker) => sum + worker.returned, 0);
  const accepted = [...successful.values()].reduce((sum, worker) =>
    sum + worker.recommendations.length + worker.weakLeads.length + worker.omitted.length, 0);
  const analysis: AdviceAnalysisSummary = {
    mode: input.categories.length === 1 ? "focused" : "category-workers",
    status: failures.size ? "partial" : "complete",
    concurrency: input.categories.length === 1 ? 1 : Math.min(input.concurrency ?? defaultAdviceWorkerConcurrency, input.categories.length),
    workerCalls: input.categories.length,
    coordinatorCalls,
    recoveryCalls,
    categories: input.categories.map((category) => {
      const worker = successful.get(category);
      return worker
        ? { category, status: "completed", returned: worker.returned, validated: worker.recommendations.length + worker.weakLeads.length + worker.omitted.length }
        : { category, status: "failed", returned: 0, validated: 0 };
    }),
  };
  return {
    recommendations: canonicalRecommendations(recommendations),
    omitted,
    weakLeads,
    coverage: deriveCoverage({ categories: input.categories, successful, failures, recommendations, omitted, weakLeads }),
    notes,
    rejectionReasons: input.categories.flatMap((category) => successful.get(category)?.rejectionReasons ?? []),
    returned,
    accepted,
    merged,
    localRecoveries: [...successful.values()].reduce((sum, worker) => sum + worker.localRecoveries, 0),
    workerCalls: input.categories.length,
    successfulWorkerCalls: successful.size,
    failedWorkerCalls: failures.size,
    coordinatorCalls,
    recoveryCalls,
    analysis,
  };
}
