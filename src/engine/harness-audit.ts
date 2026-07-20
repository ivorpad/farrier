import type { ReasoningEffort } from "../config/farrier-config";
import type { AdviceVendor } from "./advice-types";
import {
  defaultBackendRunner,
  invokeBackend,
  type BackendCommandRunner,
} from "./backend";
import type { BackendTokenUsage } from "./backend-json-events";
import { collectHarnessAuditCorpus, type HarnessAuditCorpus } from "./harness-audit-evidence";
import {
  buildHarnessAuditPrompt,
  harnessAuditScopeHasModelEvidence,
  harnessAuditScopeSkipReason,
  projectHarnessAuditCorpus,
  type HarnessAuditPromptScope,
  validateHarnessAuditResponse,
} from "./harness-audit-model";
import { harnessAuditCorpusDigest } from "./harness-audit-provenance";
import { quickHarnessAudit, sortHarnessRecommendations } from "./harness-audit-quick";
import {
  harnessAuditLayers,
  type HarnessAuditLayer,
  type HarnessAuditLayerCoverage,
  type HarnessAuditMetrics,
  type HarnessAuditMode,
  type HarnessAuditRecommendation,
  type HarnessAuditReport,
} from "./harness-audit-types";

export type HarnessAuditProgress = {
  stage: "collect" | "deterministic" | "model" | "complete";
  message: string;
};

export type HarnessAuditBudget = {
  maxModelCalls?: number;
  maxEstimatedInputTokens?: number;
  maxProviderCostUsdPerCall?: number;
};

export type HarnessAuditInput = HarnessAuditBudget & {
  targetDir: string;
  mode: HarnessAuditMode;
  backend?: AdviceVendor;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
  concurrency?: number;
  onProgress?: (event: HarnessAuditProgress) => void;
};

export type HarnessAuditPlan = {
  schemaVersion: 1;
  planOnly: true;
  targetDir: string;
  mode: HarnessAuditMode;
  plannedModelCalls: number;
  promptBytes: number;
  estimatedInputTokens: number;
  maxConcurrency: number;
  deterministicFindings: number;
  scopes: Array<{
    scope: "baseline" | "generalist" | HarnessAuditLayer;
    promptBytes: number;
    estimatedInputTokens: number;
    linesSupplied: number;
    checksSupplied: number;
  }>;
  skippedScopes: Array<{
    scope: "baseline" | "generalist" | HarnessAuditLayer;
    reason: string;
  }>;
  corpus: HarnessAuditReport["corpus"];
  estimateNote: string;
};

type ModelOutcome = {
  layer?: HarnessAuditLayer;
  recommendations: HarnessAuditRecommendation[];
  rejections: string[];
  error?: string;
  skipped?: string;
};

type TokenAccountingState = {
  providerCalls: number;
  estimatedCalls: number;
};

function estimatedTokens(value: string): number {
  return value ? Math.ceil(Buffer.byteLength(value, "utf8") / 4) : 0;
}

const emptyBaselineReason = "Baseline model call skipped: no supplied artifact line can satisfy the required exact file-and-line citation contract.";

function deepAuditScopes(): HarnessAuditPromptScope[] {
  return [
    ...harnessAuditLayers.map((layer): HarnessAuditPromptScope => ({ kind: "specialist", layer })),
    { kind: "generalist" },
  ];
}

function scopeName(scope: HarnessAuditPromptScope): "baseline" | "generalist" | HarnessAuditLayer {
  return scope.kind === "specialist" ? scope.layer : scope.kind;
}

function reportCorpus(corpus: HarnessAuditCorpus): HarnessAuditReport["corpus"] {
  return {
    digest: harnessAuditCorpusDigest(corpus),
    filesRead: corpus.documents.length,
    linesSupplied: corpus.lines.length,
    checksPerformed: corpus.checks.length,
    skipped: corpus.skipped,
  };
}

function buildHarnessAuditPlan(input: {
  corpus: HarnessAuditCorpus;
  deterministic: HarnessAuditRecommendation[];
  mode: HarnessAuditMode;
  concurrency?: number;
}): HarnessAuditPlan {
  const { corpus, deterministic } = input;
  const candidates: HarnessAuditPromptScope[] = input.mode === "quick"
    ? []
    : input.mode === "baseline"
      ? [{ kind: "baseline" }]
      : deepAuditScopes();
  const selected = input.mode === "deep"
    ? candidates.filter((scope) => harnessAuditScopeHasModelEvidence(corpus, scope))
    : input.mode === "baseline" && corpus.lines.length === 0
      ? []
      : candidates;
  const scopes = selected.map((scope) => {
    const projected = projectHarnessAuditCorpus(corpus, scope);
    const prompt = buildHarnessAuditPrompt({ corpus: projected, scope, deterministic });
    const promptBytes = Buffer.byteLength(prompt, "utf8");
    return {
      scope: scopeName(scope),
      promptBytes,
      estimatedInputTokens: estimatedTokens(prompt),
      linesSupplied: projected.lines.length,
      checksSupplied: projected.checks.length,
    };
  });
  const skippedScopes = input.mode === "quick" ? [] : candidates
    .filter((scope) => !selected.includes(scope))
    .map((scope) => ({
      scope: scopeName(scope),
      reason: input.mode === "baseline"
        ? emptyBaselineReason
        : harnessAuditScopeSkipReason(corpus, scope)!,
    }));
  const promptBytes = scopes.reduce((sum, scope) => sum + scope.promptBytes, 0);
  const plannedModelCalls = scopes.length;
  return {
    schemaVersion: 1,
    planOnly: true,
    targetDir: corpus.root,
    mode: input.mode,
    plannedModelCalls,
    promptBytes,
    estimatedInputTokens: scopes.reduce((sum, scope) => sum + scope.estimatedInputTokens, 0),
    maxConcurrency: input.mode === "deep"
      ? Math.min(Math.max(1, input.concurrency ?? 3), plannedModelCalls)
      : plannedModelCalls,
    deterministicFindings: deterministic.length,
    scopes,
    skippedScopes,
    corpus: reportCorpus(corpus),
    estimateNote: "Input-token estimates use UTF-8 bytes divided by four. Provider system prompts, cache accounting, tokenization, retries, and output tokens are not included.",
  };
}

export async function planHarnessAudit(input: {
  targetDir: string;
  mode: HarnessAuditMode;
  concurrency?: number;
}): Promise<HarnessAuditPlan> {
  const corpus = await collectHarnessAuditCorpus(input.targetDir);
  const deterministic = quickHarnessAudit(corpus);
  return buildHarnessAuditPlan({ corpus, deterministic, mode: input.mode, concurrency: input.concurrency });
}

export function assertHarnessAuditBudget(plan: HarnessAuditPlan, budget: HarnessAuditBudget): void {
  for (const [name, value] of [
    ["maxModelCalls", budget.maxModelCalls],
    ["maxEstimatedInputTokens", budget.maxEstimatedInputTokens],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${name} must be a non-negative safe integer.`);
    }
  }
  if (budget.maxModelCalls !== undefined && plan.plannedModelCalls > budget.maxModelCalls) {
    throw new Error(`Audit stopped before model use: ${plan.plannedModelCalls} planned calls exceed the approved maximum of ${budget.maxModelCalls}.`);
  }
  if (budget.maxEstimatedInputTokens !== undefined
    && plan.estimatedInputTokens > budget.maxEstimatedInputTokens) {
    throw new Error(`Audit stopped before model use: the local estimate of ${plan.estimatedInputTokens} input tokens exceeds the approved maximum of ${budget.maxEstimatedInputTokens}. Provider overhead and output tokens are not included.`);
  }
  if (budget.maxProviderCostUsdPerCall !== undefined
    && (!Number.isFinite(budget.maxProviderCostUsdPerCall)
      || budget.maxProviderCostUsdPerCall <= 0)) {
    throw new Error("maxProviderCostUsdPerCall must be a positive finite number.");
  }
}

function emptyMetrics(): HarnessAuditMetrics {
  return {
    modelCalls: 0,
    successfulModelCalls: 0,
    failedModelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    cumulativeModelTimeMs: 0,
    tokenAccounting: "none",
  };
}

function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 320);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Harness audit cancelled.");
}

async function invokeAuditModel(input: {
  audit: HarnessAuditInput;
  corpus: HarnessAuditCorpus;
  deterministic: HarnessAuditRecommendation[];
  metrics: HarnessAuditMetrics;
  tokenState: TokenAccountingState;
  runner: BackendCommandRunner;
  scope: HarnessAuditPromptScope;
}): Promise<ModelOutcome> {
  if (!input.audit.backend) throw new Error(`${input.audit.mode} audit requires a reasoning backend.`);
  const layer = input.scope.kind === "specialist" ? input.scope.layer : undefined;
  const projectedCorpus = projectHarnessAuditCorpus(input.corpus, input.scope);
  const prompt = buildHarnessAuditPrompt({
    corpus: projectedCorpus,
    scope: input.scope,
    deterministic: input.deterministic,
  });
  input.metrics.modelCalls += 1;
  const started = performance.now();
  let outputEstimate = 0;
  let providerUsage: BackendTokenUsage | undefined;
  let backendCompleted = false;
  const measuredRunner: BackendCommandRunner = async (runnerInput) => {
    const output = await input.runner(runnerInput);
    outputEstimate = estimatedTokens(output.stdout);
    return output;
  };
  try {
    const parsed = await invokeBackend({
      backend: input.audit.backend,
      model: input.audit.model,
      reasoningEffort: input.audit.reasoningEffort,
      prompt,
      targetDir: input.corpus.root,
      runner: measuredRunner,
      signal: input.audit.signal,
      ephemeral: true,
      captureUsage: true,
      onUsage: (usage) => { providerUsage = usage; },
      maxBudgetUsd: input.audit.maxProviderCostUsdPerCall,
    });
    backendCompleted = true;
    const result = validateHarnessAuditResponse({
      parsed,
      corpus: projectedCorpus,
      layer,
      deterministic: input.deterministic,
    });
    input.metrics.successfulModelCalls += 1;
    return { layer, ...result };
  } catch (error) {
    if (input.audit.signal?.aborted) throw error;
    input.metrics.failedModelCalls += 1;
    return { layer, recommendations: [], rejections: [], error: errorSummary(error) };
  } finally {
    if (providerUsage) {
      input.metrics.inputTokens += providerUsage.inputTokens;
      input.metrics.outputTokens += providerUsage.outputTokens;
      input.tokenState.providerCalls += 1;
    } else if (backendCompleted) {
      input.metrics.inputTokens += estimatedTokens(prompt);
      input.metrics.outputTokens += outputEstimate;
      input.tokenState.estimatedCalls += 1;
    }
    input.metrics.cumulativeModelTimeMs += Math.round(performance.now() - started);
  }
}

async function deepOutcomes(input: {
  audit: HarnessAuditInput;
  corpus: HarnessAuditCorpus;
  deterministic: HarnessAuditRecommendation[];
  metrics: HarnessAuditMetrics;
  tokenState: TokenAccountingState;
  runner: BackendCommandRunner;
}): Promise<ModelOutcome[]> {
  const tasks = deepAuditScopes();
  const concurrency = Math.max(1, Math.min(input.audit.concurrency ?? 3, tasks.length));
  const outcomes: ModelOutcome[] = new Array(tasks.length);
  let next = 0;
  const consume = async () => {
    while (true) {
      throwIfAborted(input.audit.signal);
      const index = next;
      if (index >= tasks.length) return;
      next += 1;
      const scope = tasks[index]!;
      const layer = scope.kind === "specialist" ? scope.layer : undefined;
      const skipReason = harnessAuditScopeSkipReason(input.corpus, scope);
      if (skipReason) {
        outcomes[index] = {
          layer,
          recommendations: [],
          rejections: [],
          skipped: `${layer ?? "generalist"} model call skipped: ${skipReason}`,
        };
        continue;
      }
      input.audit.onProgress?.({
        stage: "model",
        message: `Auditing ${layer ?? "generalist"} (${index + 1}/${tasks.length})…`,
      });
      outcomes[index] = await invokeAuditModel({ ...input, scope });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, consume));
  throwIfAborted(input.audit.signal);
  return outcomes;
}

function coverageFor(input: {
  mode: HarnessAuditMode;
  recommendations: HarnessAuditRecommendation[];
  outcomes: ModelOutcome[];
}): HarnessAuditLayerCoverage[] {
  return harnessAuditLayers.map((layer) => {
    const findings = input.recommendations.filter((item) => item.layer === layer);
    const failed = input.outcomes.find((outcome) => outcome.layer === layer && outcome.error);
    const skipped = input.outcomes.find((outcome) => outcome.layer === layer && outcome.skipped);
    const baselineFailure = input.mode === "baseline" && input.outcomes[0]?.error;
    const baselineSkipped = input.mode === "baseline" ? input.outcomes[0]?.skipped : undefined;
    if (failed || baselineFailure) {
      const error = failed?.error ?? input.outcomes[0]!.error!;
      return { layer, status: "worker-failed", reason: error };
    }
    if (findings.length) {
      return { layer, status: "finding", reason: `${findings.length} evidence-bound defect${findings.length === 1 ? "" : "s"}.` };
    }
    if (skipped || baselineSkipped) {
      return { layer, status: "not-run", reason: skipped?.skipped ?? baselineSkipped! };
    }
    return {
      layer,
      status: "no-finding",
      reason: input.mode === "quick"
        ? "No deterministic rule matched the selected harness corpus."
        : "No additional defect met the evidence, countercheck, and artifact requirements.",
    };
  });
}

function mergeRecommendations(
  deterministic: HarnessAuditRecommendation[],
  outcomes: ModelOutcome[],
): HarnessAuditRecommendation[] {
  const merged = new Map(deterministic.map((item) => [item.id, item]));
  for (const outcome of outcomes) {
    for (const item of outcome.recommendations) {
      const locations = new Set(item.citations.map((citation) => `${citation.path}:${citation.line}`));
      const duplicate = [...merged.values()].some((existing) =>
        existing.layer === item.layer
        && existing.citations.some((citation) => locations.has(`${citation.path}:${citation.line}`)));
      if (!merged.has(item.id) && !duplicate) merged.set(item.id, item);
    }
  }
  return sortHarnessRecommendations([...merged.values()]);
}

export async function auditHarness(input: HarnessAuditInput): Promise<HarnessAuditReport> {
  const auditStarted = performance.now();
  if (input.mode !== "quick" && !input.backend) throw new Error(`${input.mode} audit requires --backend claude or --backend codex.`);
  throwIfAborted(input.signal);
  input.onProgress?.({ stage: "collect", message: "Collecting bounded harness files and counterchecks…" });
  const corpus = await collectHarnessAuditCorpus(input.targetDir);
  input.onProgress?.({ stage: "deterministic", message: "Running deterministic harness checks…" });
  const deterministic = quickHarnessAudit(corpus);
  if (input.maxProviderCostUsdPerCall !== undefined && input.backend !== "claude") {
    throw new Error("--max-provider-cost-usd-per-call is supported only by the Claude backend.");
  }
  const needsPlan = input.maxModelCalls !== undefined
    || input.maxEstimatedInputTokens !== undefined
    || input.maxProviderCostUsdPerCall !== undefined
    || input.backend === "claude";
  if (needsPlan) {
    const plan = buildHarnessAuditPlan({
      corpus,
      deterministic,
      mode: input.mode,
      concurrency: input.concurrency,
    });
    assertHarnessAuditBudget(plan, input);
    if (input.backend === "claude"
      && plan.plannedModelCalls > 0
      && input.maxProviderCostUsdPerCall === undefined) {
      throw new Error("Audit stopped before model use: Claude audits require --max-provider-cost-usd-per-call.");
    }
  }
  const metrics = emptyMetrics();
  const runner = input.runner ?? defaultBackendRunner;
  const tokenState: TokenAccountingState = { providerCalls: 0, estimatedCalls: 0 };
  let outcomes: ModelOutcome[] = [];
  if (input.mode === "baseline") {
    if (corpus.lines.length === 0) {
      input.onProgress?.({ stage: "model", message: emptyBaselineReason });
      outcomes = [{ recommendations: [], rejections: [], skipped: emptyBaselineReason }];
    } else {
      input.onProgress?.({ stage: "model", message: "Running the one-call audit baseline…" });
      outcomes = [await invokeAuditModel({
        audit: input,
        corpus,
        deterministic,
        metrics,
        tokenState,
        runner,
        scope: { kind: "baseline" },
      })];
    }
  } else if (input.mode === "deep") {
    outcomes = await deepOutcomes({ audit: input, corpus, deterministic, metrics, tokenState, runner });
  }
  const recommendations = mergeRecommendations(deterministic, outcomes);
  const rejections = outcomes.flatMap((outcome) => outcome.rejections);
  const failures = outcomes.filter((outcome) => outcome.error);
  metrics.tokenAccounting = tokenState.providerCalls && tokenState.estimatedCalls
    ? "mixed"
    : tokenState.providerCalls
      ? "provider"
      : tokenState.estimatedCalls
        ? "estimated-from-utf8"
        : "none";
  const tokenNote = metrics.tokenAccounting === "provider"
    ? "Token counts come from backend CLI usage events."
    : metrics.tokenAccounting === "estimated-from-utf8"
      ? "Token counts are UTF-8 estimates because this runner returned no provider usage event."
      : metrics.tokenAccounting === "mixed"
        ? "Token totals combine provider usage events with UTF-8 estimates for calls that returned no usage event."
        : undefined;
  const notes = [
    ...(tokenNote ? [tokenNote] : []),
    ...rejections,
    ...failures.map((outcome) => `${outcome.layer ?? "generalist"} model call failed: ${outcome.error}`),
    ...outcomes.filter((outcome) => outcome.layer === undefined && outcome.skipped).map((outcome) => outcome.skipped!),
  ];
  metrics.latencyMs = Math.round(performance.now() - auditStarted);
  input.onProgress?.({ stage: "complete", message: `Audit complete with ${recommendations.length} recommendation(s).` });
  return {
    schemaVersion: 1,
    reportOnly: true,
    targetDir: corpus.root,
    mode: input.mode,
    ...(input.backend ? { backend: input.backend } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.maxModelCalls !== undefined
      || input.maxEstimatedInputTokens !== undefined
      || input.maxProviderCostUsdPerCall !== undefined
      ? { executionBudget: {
        ...(input.maxModelCalls !== undefined ? { maxModelCalls: input.maxModelCalls } : {}),
        ...(input.maxEstimatedInputTokens !== undefined
          ? { maxEstimatedInputTokens: input.maxEstimatedInputTokens }
          : {}),
        ...(input.maxProviderCostUsdPerCall !== undefined
          ? { maxProviderCostUsdPerCall: input.maxProviderCostUsdPerCall }
          : {}),
      } }
      : {}),
    recommendations,
    coverage: coverageFor({ mode: input.mode, recommendations, outcomes }),
    metrics,
    corpus: reportCorpus(corpus),
    notes,
  };
}

export function harnessAuditFailed(report: HarnessAuditReport): boolean {
  return report.metrics.failedModelCalls > 0
    || report.coverage.some((item) => item.status === "worker-failed");
}
