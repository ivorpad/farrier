import type { HarnessAuditPlan } from "./harness-audit";
import type { HarnessAuditMode, HarnessAuditReport } from "./harness-audit-types";

export type HarnessAuditReviewPreflightPlan = {
  alias: string;
  plan: HarnessAuditPlan;
  maxProviderCostUsdPerCall?: number;
};

export type HarnessAuditReviewPreflight = {
  approvalReference: string;
  approvedMaxProviderCalls: number;
  approvedMaxEstimatedInputTokens: number;
  approvedMaxProviderCostUsd: number;
  plans: HarnessAuditReviewPreflightPlan[];
};

export type HarnessAuditPanelBudgetApproval = {
  approvalReference: string;
  approvedMaxProviderCalls: number;
  approvedMaxEstimatedInputTokens: number;
  approvedMaxProviderCostUsd: number;
};

export function buildHarnessAuditReviewPreflight(
  approvalReference: string,
  plans: HarnessAuditReviewPreflightPlan[],
): HarnessAuditReviewPreflight {
  return {
    approvalReference,
    approvedMaxProviderCalls: plans.reduce((sum, item) => sum + item.plan.plannedModelCalls, 0),
    approvedMaxEstimatedInputTokens: plans.reduce((sum, item) => sum + item.plan.estimatedInputTokens, 0),
    approvedMaxProviderCostUsd: plans.reduce((sum, item) =>
      sum + item.plan.plannedModelCalls * (item.maxProviderCostUsdPerCall ?? 0), 0),
    plans,
  };
}

export function buildHarnessAuditPanelBudgetApproval(
  approvalReference: string,
  preflights: HarnessAuditReviewPreflight[],
): HarnessAuditPanelBudgetApproval {
  return {
    approvalReference,
    approvedMaxProviderCalls: preflights.reduce(
      (sum, item) => sum + item.approvedMaxProviderCalls,
      0,
    ),
    approvedMaxEstimatedInputTokens: preflights.reduce(
      (sum, item) => sum + item.approvedMaxEstimatedInputTokens,
      0,
    ),
    approvedMaxProviderCostUsd: preflights.reduce(
      (sum, item) => sum + item.approvedMaxProviderCostUsd,
      0,
    ),
  };
}

type AliasProvenance = { targetDir: string; corpusDigest: string };
type ReviewedRun = { alias: string; mode: HarnessAuditMode; report: HarnessAuditReport };

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function harnessAuditRunProviderCostProblems(input: {
  backend: HarnessAuditReport["backend"];
  modelCalls: number;
  maxProviderCostUsdPerCall: number | undefined;
  prefix: string;
  key: string;
}): string[] {
  if (input.backend === "claude"
    && input.modelCalls > 0
    && !positiveFinite(input.maxProviderCostUsdPerCall)) {
    return [`${input.prefix}: run ${input.key} has no positive Claude per-call provider-cost ceiling.`];
  }
  if (input.backend && input.backend !== "claude"
    && input.maxProviderCostUsdPerCall !== undefined) {
    return [`${input.prefix}: run ${input.key} records a Claude-only provider-cost ceiling for another backend.`];
  }
  return [];
}

export function harnessAuditPanelBudgetProblems(input: {
  approval: HarnessAuditPanelBudgetApproval | undefined;
  preflights: Array<HarnessAuditReviewPreflight | undefined>;
}): string[] {
  const approval = input.approval;
  if (!approval) return ["Required five-review panel budget approval is missing."];
  const problems: string[] = [];
  if (!approval.approvalReference?.trim()) problems.push("Panel budget approval reference is missing.");
  if (!nonNegativeInteger(approval.approvedMaxProviderCalls)) {
    problems.push("Panel approved provider-call maximum must be a non-negative safe integer.");
  }
  if (!nonNegativeInteger(approval.approvedMaxEstimatedInputTokens)) {
    problems.push("Panel approved local input-token maximum must be a non-negative safe integer.");
  }
  if (!nonNegativeFinite(approval.approvedMaxProviderCostUsd)) {
    problems.push("Panel approved provider-cost maximum must be a non-negative finite number.");
  }
  const preflights = input.preflights.filter((item): item is HarnessAuditReviewPreflight => Boolean(item));
  if (preflights.length !== input.preflights.length) {
    problems.push("Panel budget approval cannot be verified while a reviewer preflight is missing.");
  }
  if (preflights.some((item) => item.approvalReference !== approval.approvalReference)) {
    problems.push("Every reviewer preflight must use the panel budget approval reference.");
  }
  const callValues = preflights.map((item) => item.approvedMaxProviderCalls);
  const tokenValues = preflights.map((item) => item.approvedMaxEstimatedInputTokens);
  const costValues = preflights.map((item) => item.approvedMaxProviderCostUsd);
  const totalCalls = callValues.reduce((sum, value) => sum + value, 0);
  const totalTokens = tokenValues.reduce((sum, value) => sum + value, 0);
  const totalCost = costValues.reduce((sum, value) => sum + value, 0);
  if (callValues.every(nonNegativeInteger) && !Number.isSafeInteger(totalCalls)) {
    problems.push("Five-review provider-call total exceeds the safe integer range.");
  } else if (nonNegativeInteger(approval.approvedMaxProviderCalls)
    && approval.approvedMaxProviderCalls !== totalCalls) {
    problems.push("Panel approved provider-call maximum does not equal all reviewer preflights.");
  }
  if (tokenValues.every(nonNegativeInteger) && !Number.isSafeInteger(totalTokens)) {
    problems.push("Five-review local input-token total exceeds the safe integer range.");
  } else if (nonNegativeInteger(approval.approvedMaxEstimatedInputTokens)
    && approval.approvedMaxEstimatedInputTokens !== totalTokens) {
    problems.push("Panel approved local input-token maximum does not equal all reviewer preflights.");
  }
  if (costValues.every(nonNegativeFinite) && !Number.isFinite(totalCost)) {
    problems.push("Five-review provider-cost total is not finite.");
  } else if (nonNegativeFinite(approval.approvedMaxProviderCostUsd)
    && approval.approvedMaxProviderCostUsd !== totalCost) {
    problems.push("Panel approved provider-cost maximum does not equal all reviewer preflights.");
  }
  return problems;
}

function planShapeProblems(
  plan: HarnessAuditPlan,
  prefix: string,
  key: string,
): string[] {
  const problems: string[] = [];
  const numericFields = [
    "plannedModelCalls", "promptBytes", "estimatedInputTokens", "maxConcurrency", "deterministicFindings",
  ] as const satisfies ReadonlyArray<keyof HarnessAuditPlan>;
  const invalid = numericFields.filter((field) => !nonNegativeInteger(plan[field]));
  if (invalid.length) problems.push(`${prefix}: preflight ${key} has invalid non-negative integers: ${invalid.join(", ")}.`);
  if (plan.schemaVersion !== 1 || plan.planOnly !== true) {
    problems.push(`${prefix}: preflight ${key} is not a schema-version-1 plan-only record.`);
  }
  if (!Array.isArray(plan.scopes)) {
    problems.push(`${prefix}: preflight ${key} has no scope records.`);
    return problems;
  }
  const invalidScopes = plan.scopes.filter((scope) =>
    !nonNegativeInteger(scope.promptBytes)
    || !nonNegativeInteger(scope.estimatedInputTokens)
    || !nonNegativeInteger(scope.linesSupplied)
    || !nonNegativeInteger(scope.checksSupplied));
  if (invalidScopes.length) problems.push(`${prefix}: preflight ${key} contains invalid scope metrics.`);
  if (nonNegativeInteger(plan.plannedModelCalls) && plan.plannedModelCalls !== plan.scopes.length) {
    problems.push(`${prefix}: preflight ${key} planned calls do not equal its selected scopes.`);
  }
  const promptBytes = plan.scopes.reduce((sum, scope) => sum + scope.promptBytes, 0);
  const estimatedTokens = plan.scopes.reduce((sum, scope) => sum + scope.estimatedInputTokens, 0);
  if (nonNegativeInteger(plan.promptBytes) && plan.promptBytes !== promptBytes) {
    problems.push(`${prefix}: preflight ${key} prompt bytes do not equal its scope total.`);
  }
  if (nonNegativeInteger(plan.estimatedInputTokens) && plan.estimatedInputTokens !== estimatedTokens) {
    problems.push(`${prefix}: preflight ${key} estimated input tokens do not equal its scope total.`);
  }
  if (plan.mode === "baseline" && (plan.plannedModelCalls !== 1 || plan.scopes[0]?.scope !== "baseline")) {
    problems.push(`${prefix}: preflight ${key} is not a one-call baseline.`);
  }
  if (plan.mode === "deep" && plan.scopes.some((scope) => scope.scope === "baseline")) {
    problems.push(`${prefix}: preflight ${key} includes a baseline scope in deep mode.`);
  }
  return problems;
}

export function harnessAuditPreflightProblems(input: {
  reviewerId: string;
  aliases: Record<string, AliasProvenance> | undefined;
  preflight: HarnessAuditReviewPreflight | undefined;
  runs: ReviewedRun[];
}): string[] {
  const prefix = `Reviewer ${input.reviewerId || "(missing id)"}`;
  const preflight = input.preflight;
  if (!preflight) return [`${prefix}: required budget preflight evidence is missing.`];
  const problems: string[] = [];
  if (!preflight.approvalReference?.trim()) problems.push(`${prefix}: budget approval reference is missing.`);
  if (!nonNegativeInteger(preflight.approvedMaxProviderCalls)) {
    problems.push(`${prefix}: approved provider-call maximum must be a non-negative safe integer.`);
  }
  if (!nonNegativeInteger(preflight.approvedMaxEstimatedInputTokens)) {
    problems.push(`${prefix}: approved local input-token maximum must be a non-negative safe integer.`);
  }
  if (!nonNegativeFinite(preflight.approvedMaxProviderCostUsd)) {
    problems.push(`${prefix}: approved provider-cost maximum must be a non-negative finite number.`);
  }
  if (!Array.isArray(preflight.plans)) {
    problems.push(`${prefix}: required budget preflight evidence has no saved plans.`);
    return problems;
  }
  const expectedKeys = Object.keys(input.aliases ?? {}).flatMap((alias) => [
    `${alias}:baseline`, `${alias}:deep`,
  ]);
  const keys = preflight.plans.map((item) => `${item.alias}:${item.plan?.mode}`);
  if (preflight.plans.length !== expectedKeys.length || new Set(keys).size !== keys.length) {
    problems.push(`${prefix}: budget preflight must contain one baseline and one deep plan for every alias.`);
  }
  for (const key of expectedKeys) {
    if (!keys.includes(key)) problems.push(`${prefix}: budget preflight is missing ${key}.`);
  }
  for (const item of preflight.plans) {
    const plan = item.plan;
    const key = `${item.alias}:${plan?.mode}`;
    const alias = input.aliases?.[item.alias];
    if (!plan || (plan.mode !== "baseline" && plan.mode !== "deep")) {
      problems.push(`${prefix}: preflight ${key} is not a baseline or deep plan.`);
      continue;
    }
    if (!alias) problems.push(`${prefix}: preflight ${key} has no blinded alias mapping.`);
    if (alias && plan.targetDir !== alias.targetDir) {
      problems.push(`${prefix}: preflight ${key} target directory does not match its blinded alias.`);
    }
    if (alias && plan.corpus.digest !== alias.corpusDigest) {
      problems.push(`${prefix}: preflight ${key} corpus digest does not match its frozen alias snapshot.`);
    }
    problems.push(...planShapeProblems(plan, prefix, key));
    const run = input.runs.find((candidate) => candidate.alias === item.alias && candidate.mode === plan.mode);
    if (item.maxProviderCostUsdPerCall !== undefined
      && !positiveFinite(item.maxProviderCostUsdPerCall)) {
      problems.push(`${prefix}: preflight ${key} has an invalid per-call provider-cost ceiling.`);
    }
    if (plan.plannedModelCalls === 0 && item.maxProviderCostUsdPerCall !== undefined) {
      problems.push(`${prefix}: preflight ${key} assigns provider cost to a zero-call plan.`);
    }
    if (run?.report.backend === "claude"
      && plan.plannedModelCalls > 0
      && !positiveFinite(item.maxProviderCostUsdPerCall)) {
      problems.push(`${prefix}: preflight ${key} lacks the required Claude per-call provider-cost ceiling.`);
    }
    if (run?.report.backend !== "claude" && item.maxProviderCostUsdPerCall !== undefined) {
      problems.push(`${prefix}: preflight ${key} assigns a Claude-only provider-cost ceiling to another backend.`);
    }
    if (run && run.report.metrics.modelCalls !== plan.plannedModelCalls) {
      problems.push(`${prefix}: run ${key} model calls do not match its saved preflight.`);
    }
    if (run?.report.executionBudget?.maxModelCalls !== plan.plannedModelCalls
      || run.report.executionBudget.maxEstimatedInputTokens !== plan.estimatedInputTokens
      || run.report.executionBudget.maxProviderCostUsdPerCall !== item.maxProviderCostUsdPerCall) {
      problems.push(`${prefix}: run ${key} did not record the exact saved preflight as its execution budget.`);
    }
  }
  const totalCalls = preflight.plans.reduce((sum, item) => sum + (item.plan?.plannedModelCalls ?? 0), 0);
  const totalTokens = preflight.plans.reduce((sum, item) => sum + (item.plan?.estimatedInputTokens ?? 0), 0);
  const totalCost = preflight.plans.reduce((sum, item) =>
    sum + (item.plan?.plannedModelCalls ?? 0) * (item.maxProviderCostUsdPerCall ?? 0), 0);
  if (nonNegativeInteger(preflight.approvedMaxProviderCalls)
    && preflight.approvedMaxProviderCalls !== totalCalls) {
    problems.push(`${prefix}: approved provider-call maximum does not equal the six saved plans.`);
  }
  if (nonNegativeInteger(preflight.approvedMaxEstimatedInputTokens)
    && preflight.approvedMaxEstimatedInputTokens !== totalTokens) {
    problems.push(`${prefix}: approved local input-token maximum does not equal the six saved plans.`);
  }
  if (nonNegativeFinite(preflight.approvedMaxProviderCostUsd)
    && preflight.approvedMaxProviderCostUsd !== totalCost) {
    problems.push(`${prefix}: approved provider-cost maximum does not equal the six saved plans.`);
  }
  return problems;
}
