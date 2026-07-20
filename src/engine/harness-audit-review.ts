import {
  recommendationContractPass,
  scoreHarnessAudit,
  type HarnessAuditGroundTruth,
} from "./harness-audit-evaluation";
import {
  adjudicatedHarnessAuditIssue,
  harnessAuditAdjudicationKey,
  harnessAuditAdjudicationProblems,
  indexHarnessAuditAdjudications,
  recommendationCitesIssue,
  type HarnessAuditRecommendationAdjudication,
} from "./harness-audit-adjudication";
import {
  harnessAuditPanelBudgetProblems,
  harnessAuditPreflightProblems,
  harnessAuditRunProviderCostProblems,
  type HarnessAuditPanelBudgetApproval,
  type HarnessAuditReviewPreflight,
} from "./harness-audit-review-preflight";
import { harnessAuditAliasCopyProblems } from "./harness-audit-review-aliases";
import { harnessAuditSeededRecallByMode, improvedHarnessAuditDeepMetric } from "./harness-audit-review-value";
import type {
  HarnessAuditBlindedEvaluation,
  HarnessAuditModeSummary,
  HarnessAuditRepositoryKind,
  HarnessAuditRunSummary,
} from "./harness-audit-review-results";
import {
  harnessAuditLayers,
  harnessAuditModes,
  type HarnessAuditMode,
  type HarnessAuditRecommendation,
  type HarnessAuditReport,
} from "./harness-audit-types";
export const harnessAuditSafetyGuarantees = [
  "consent",
  "redaction",
  "provider-purity",
  "cancellation",
  "review",
  "mutation-safety",
] as const;
export type HarnessAuditSafetyGuarantee = (typeof harnessAuditSafetyGuarantees)[number];
export type { HarnessAuditRecommendationAdjudication } from "./harness-audit-adjudication";
export type {
  HarnessAuditBlindedEvaluation,
  HarnessAuditModeSummary,
  HarnessAuditRepositoryKind,
  HarnessAuditRunSummary,
} from "./harness-audit-review-results";
export type HarnessAuditRecommendationJudgment = {
  recommendationId: string;
  realDefect: boolean;
  correctLayer: boolean;
  exactCitations: boolean;
  counterchecksSupportClaim: boolean;
  affectedArtifactOrDiff: boolean;
  riskSupported: boolean;
  uncertaintyHonest: boolean;
  prohibitedModelAuthorityClaim: boolean;
  speculativeCreation: boolean;
  actionableWithoutCoaching: boolean;
};
export type HarnessAuditRunReview = {
  alias: string;
  mode: HarnessAuditMode;
  report: HarnessAuditReport;
  judgments: HarnessAuditRecommendationJudgment[];
};
export type HarnessAuditReviewerRecord = {
  reviewerId: string;
  role: "staff" | "principal";
  farrierBuildId: string;
  decision: "would-adopt" | "would-not-adopt";
  blockingTrustOrSafetyObjection?: string;
  highestSeverityReason?: string;
  attestations: {
    startedFromHelp: boolean;
    usedWithoutCoaching: boolean;
    inspectedRepositoryFiles: boolean;
    reportsUnedited: boolean;
    knownRepositoryUnfamiliar: boolean;
    groundTruthHiddenUntilSubmission: boolean;
    otherReviewsHiddenUntilSubmission: boolean;
    sameBackendModelAccount: boolean;
  };
  preflight: HarnessAuditReviewPreflight;
  runs: HarnessAuditRunReview[];
};
export type HarnessAuditAliasTruth = {
  kind: HarnessAuditRepositoryKind;
  targetDir: string;
  corpusDigest: string;
  truth: HarnessAuditGroundTruth;
};
export type HarnessAuditBlindedEvaluationInput = {
  reviewers: HarnessAuditReviewerRecord[];
  panelBudgetApproval: HarnessAuditPanelBudgetApproval;
  aliasesByReviewer: Record<string, Record<string, HarnessAuditAliasTruth>>;
  adjudicationsByReviewer: Record<string, HarnessAuditRecommendationAdjudication[]>;
  safety: Record<HarnessAuditSafetyGuarantee, { farrierBuildId: string; passed: boolean; evidence: string[] }>;
};
function recommendationPasses(
  recommendation: HarnessAuditRecommendation,
  judgment: HarnessAuditRecommendationJudgment | undefined,
): boolean {
  return Boolean(judgment
    && recommendationContractPass(recommendation)
    && judgment.realDefect
    && judgment.correctLayer
    && judgment.exactCitations
    && judgment.counterchecksSupportClaim
    && judgment.affectedArtifactOrDiff
    && judgment.riskSupported
    && judgment.uncertaintyHonest
    && !judgment.prohibitedModelAuthorityClaim
    && !judgment.speculativeCreation
    && judgment.actionableWithoutCoaching);
}

const judgmentBooleanFields = [
  "realDefect",
  "correctLayer",
  "exactCitations",
  "counterchecksSupportClaim",
  "affectedArtifactOrDiff",
  "riskSupported",
  "uncertaintyHonest",
  "prohibitedModelAuthorityClaim",
  "speculativeCreation",
  "actionableWithoutCoaching",
] as const satisfies ReadonlyArray<keyof HarnessAuditRecommendationJudgment>;

const requiredAttestations = [
  "startedFromHelp", "usedWithoutCoaching", "inspectedRepositoryFiles", "reportsUnedited",
  "knownRepositoryUnfamiliar", "groundTruthHiddenUntilSubmission",
  "otherReviewsHiddenUntilSubmission", "sameBackendModelAccount",
] as const satisfies ReadonlyArray<keyof HarnessAuditReviewerRecord["attestations"]>;

const metricFields = [
  "modelCalls",
  "successfulModelCalls",
  "failedModelCalls",
  "inputTokens",
  "outputTokens",
  "latencyMs",
  "cumulativeModelTimeMs",
] as const satisfies ReadonlyArray<keyof HarnessAuditReport["metrics"]>;

function reportRecordProblems(
  run: HarnessAuditRunReview,
  prefix: string,
  key: string,
  aliasTruth: HarnessAuditAliasTruth | undefined,
): string[] {
  const problems: string[] = [];
  const metrics = run.report.metrics;
  if (run.report.schemaVersion !== 1 || run.report.reportOnly !== true) {
    problems.push(`${prefix}: run ${key} is not a schema-version-1 report-only audit.`);
  }
  if (aliasTruth && run.report.targetDir !== aliasTruth.targetDir) {
    problems.push(`${prefix}: run ${key} target directory does not match its blinded alias.`);
  }
  if (!/^[a-f0-9]{64}$/.test(run.report.corpus.digest ?? "")) {
    problems.push(`${prefix}: run ${key} has no valid corpus digest.`);
  } else if (aliasTruth && run.report.corpus.digest !== aliasTruth.corpusDigest) {
    problems.push(`${prefix}: run ${key} corpus digest does not match its frozen alias snapshot.`);
  }
  const invalidMetrics = metricFields.filter((field) =>
    !Number.isSafeInteger(metrics[field]) || metrics[field] < 0);
  if (invalidMetrics.length) {
    problems.push(`${prefix}: run ${key} has invalid metrics: ${invalidMetrics.join(", ")} must be non-negative safe integers.`);
  }
  if (Number.isSafeInteger(metrics.modelCalls)
    && Number.isSafeInteger(metrics.successfulModelCalls)
    && Number.isSafeInteger(metrics.failedModelCalls)
    && metrics.successfulModelCalls + metrics.failedModelCalls !== metrics.modelCalls) {
    problems.push(`${prefix}: run ${key} has invalid metrics: successful plus failed calls does not equal model calls.`);
  }
  if (metrics.failedModelCalls > 0) {
    problems.push(`${prefix}: run ${key} contains ${metrics.failedModelCalls} failed model call(s).`);
  }
  if (metrics.modelCalls === 0
    && (metrics.inputTokens !== 0 || metrics.outputTokens !== 0 || metrics.tokenAccounting !== "none")) {
    problems.push(`${prefix}: run ${key} has model token accounting despite zero model calls.`);
  }
  if (metrics.successfulModelCalls > 0 && metrics.tokenAccounting !== "provider") {
    problems.push(`${prefix}: run ${key} requires provider-reported token usage for successful model calls.`);
  }
  if (metrics.successfulModelCalls > 0 && (metrics.inputTokens === 0 || metrics.outputTokens === 0)) {
    problems.push(`${prefix}: run ${key} requires positive provider-reported input and output token counts.`);
  }
  if (!["none", "provider", "estimated-from-utf8", "mixed"].includes(metrics.tokenAccounting)) {
    problems.push(`${prefix}: run ${key} has an invalid token-accounting source.`);
  }
  const coverageLayers = run.report.coverage.map((item) => item.layer);
  if (run.report.coverage.length !== harnessAuditLayers.length
    || new Set(coverageLayers).size !== harnessAuditLayers.length
    || !harnessAuditLayers.every((layer) => coverageLayers.includes(layer))) {
    problems.push(`${prefix}: run ${key} coverage must contain every harness layer exactly once.`);
  }
  if (run.report.coverage.some((item) => item.status === "worker-failed")) {
    problems.push(`${prefix}: run ${key} contains worker-failed coverage and is not a complete comparison run.`);
  }
  if (run.mode === "quick" && run.report.recommendations.some((item) => item.source === "model")) {
    problems.push(`${prefix}: run ${key} contains a model-sourced recommendation in deterministic quick mode.`);
  }
  if (run.mode !== "quick" && !run.report.backend) {
    problems.push(`${prefix}: run ${key} has no recorded model backend.`);
  }
  if (run.mode !== "quick" && !run.report.model?.trim()) {
    problems.push(`${prefix}: run ${key} has no explicit comparison model.`);
  }
  const providerCostCeiling = run.report.executionBudget?.maxProviderCostUsdPerCall;
  problems.push(...harnessAuditRunProviderCostProblems({
    backend: run.report.backend,
    modelCalls: metrics.modelCalls,
    maxProviderCostUsdPerCall: providerCostCeiling,
    prefix,
    key,
  }));
  return problems;
}

function runRecordProblems(
  reviewer: HarnessAuditReviewerRecord,
  aliases: Record<string, HarnessAuditAliasTruth> | undefined,
  adjudications: HarnessAuditRecommendationAdjudication[] | undefined,
): string[] {
  const problems: string[] = [];
  const prefix = `Reviewer ${reviewer.reviewerId || "(missing id)"}`;
  if (!reviewer.reviewerId.trim()) problems.push(`${prefix}: reviewerId is missing.`);
  if (reviewer.role !== "staff" && reviewer.role !== "principal") problems.push(`${prefix}: role must be staff or principal.`);
  if (!reviewer.farrierBuildId?.trim()) problems.push(`${prefix}: Farrier build ID is missing.`);
  if (reviewer.decision === "would-not-adopt" && !reviewer.highestSeverityReason?.trim()) {
    problems.push(`${prefix}: would-not-adopt requires the highest-severity reason.`);
  }
  if (!requiredAttestations.every((name) => reviewer.attestations?.[name] === true)) {
    problems.push(`${prefix}: one or more blinded-use attestations are missing or false.`);
  }
  const aliasEntries = Object.entries(aliases ?? {});
  const kinds = aliasEntries.map(([, item]) => item.kind);
  if (aliasEntries.length !== 3 || new Set(kinds).size !== 3
    || !["known-defects", "clean", "seeded"].every((kind) => kinds.includes(kind as HarnessAuditRepositoryKind))) {
    problems.push(`${prefix}: alias mapping must contain exactly one known-defects, clean, and seeded repository.`);
  }
  if (new Set(aliasEntries.map(([, item]) => item.targetDir)).size !== aliasEntries.length) {
    problems.push(`${prefix}: every blinded alias must map to a distinct target directory.`);
  }
  for (const [alias, item] of aliasEntries) {
    if (!item.targetDir?.trim()) problems.push(`${prefix}: alias ${alias} has no target directory.`);
    if (!/^[a-f0-9]{64}$/.test(item.corpusDigest ?? "")) {
      problems.push(`${prefix}: alias ${alias} has no valid frozen corpus digest.`);
    }
  }
  const runKeys = new Set<string>();
  for (const run of reviewer.runs) {
    const key = `${run.alias}:${run.mode}`;
    if (runKeys.has(key)) problems.push(`${prefix}: duplicate run ${key}.`);
    runKeys.add(key);
    if (!aliases?.[run.alias]) problems.push(`${prefix}: run ${key} has no blinded alias mapping.`);
    if (run.report.mode !== run.mode) problems.push(`${prefix}: run ${key} report mode is ${run.report.mode}.`);
    problems.push(...reportRecordProblems(run, prefix, key, aliases?.[run.alias]));
    const reportIds = run.report.recommendations.map((item) => item.id);
    const judgmentIds = run.judgments.map((item) => item.recommendationId);
    if (new Set(reportIds).size !== reportIds.length) problems.push(`${prefix}: run ${key} contains duplicate recommendation IDs.`);
    if (new Set(judgmentIds).size !== judgmentIds.length) problems.push(`${prefix}: run ${key} contains duplicate judgments.`);
    for (const judgment of run.judgments) {
      const malformed = judgmentBooleanFields.filter((field) => typeof judgment[field] !== "boolean");
      if (malformed.length) {
        problems.push(`${prefix}: run ${key} judgment ${judgment.recommendationId || "(missing id)"} lacks boolean fields ${malformed.join(", ")}.`);
      }
    }
    const missing = reportIds.filter((id) => !judgmentIds.includes(id));
    const extra = judgmentIds.filter((id) => !reportIds.includes(id));
    if (missing.length) problems.push(`${prefix}: run ${key} lacks judgments for ${missing.join(", ")}.`);
    if (extra.length) problems.push(`${prefix}: run ${key} has judgments for unknown recommendations ${extra.join(", ")}.`);
  }
  const modelRuns = reviewer.runs.filter((run) => run.mode !== "quick");
  if (new Set(modelRuns.map((run) => run.report.backend)).size !== 1) {
    problems.push(`${prefix}: baseline and deep runs must use the same backend.`);
  }
  if (new Set(modelRuns.map((run) => run.report.model ?? "(provider default)")).size !== 1) {
    problems.push(`${prefix}: baseline and deep runs must use the same model.`);
  }
  problems.push(...harnessAuditAdjudicationProblems({
    reviewerId: reviewer.reviewerId,
    aliases,
    runs: reviewer.runs,
    adjudications,
  }));
  problems.push(...harnessAuditPreflightProblems({ reviewerId: reviewer.reviewerId, aliases, preflight: reviewer.preflight, runs: reviewer.runs }));
  for (const [alias] of aliasEntries) {
    for (const mode of harnessAuditModes) {
      if (!runKeys.has(`${alias}:${mode}`)) problems.push(`${prefix}: missing run ${alias}:${mode}.`);
    }
  }
  if (reviewer.runs.length !== 9) problems.push(`${prefix}: expected 9 runs, received ${reviewer.runs.length}.`);
  return problems;
}

function summarizeRun(input: {
  reviewerId: string;
  run: HarnessAuditRunReview;
  aliasTruth: HarnessAuditAliasTruth;
  adjudications: Map<string, HarnessAuditRecommendationAdjudication>;
}): HarnessAuditRunSummary {
  const judgments = new Map(input.run.judgments.map((item) => [item.recommendationId, item]));
  const matchedIssues = new Set<string>();
  let passedRecommendations = 0;
  let realRecommendations = 0;
  let correctLayerRecommendations = 0;
  const falsePositives: string[] = [];
  const wrongLayerRecommendations: string[] = [];
  const contractFailures: string[] = [];
  for (const recommendation of input.run.report.recommendations) {
    const judgment = judgments.get(recommendation.id);
    const adjudication = input.adjudications.get(harnessAuditAdjudicationKey(
      input.run.alias, input.run.mode, recommendation.id));
    const issue = adjudicatedHarnessAuditIssue(adjudication, input.aliasTruth.truth);
    const groundTruthReal = Boolean(issue);
    const groundTruthCorrectLayer = issue?.layer === recommendation.layer;
    const groundTruthExactCitation = Boolean(issue && recommendationCitesIssue(recommendation, issue));
    const reviewerAndGroundTruthReal = Boolean(judgment?.realDefect && groundTruthReal);
    const contractPass = recommendationPasses(recommendation, judgment);
    if (contractPass && groundTruthReal && groundTruthCorrectLayer && groundTruthExactCitation) {
      passedRecommendations += 1;
    }
    if (!contractPass || (groundTruthReal && !groundTruthExactCitation)) contractFailures.push(recommendation.id);
    if (!reviewerAndGroundTruthReal) {
      falsePositives.push(recommendation.id);
      continue;
    }
    realRecommendations += 1;
    if (judgment!.correctLayer && groundTruthCorrectLayer) correctLayerRecommendations += 1;
    else wrongLayerRecommendations.push(recommendation.id);
    if (issue && !matchedIssues.has(issue.id)) matchedIssues.add(issue.id);
  }
  const missedIssues = input.aliasTruth.truth.issues.filter((item) => !matchedIssues.has(item.id)).map((item) => item.id);
  const count = input.run.report.recommendations.length;
  const truthCount = input.aliasTruth.truth.issues.length;
  const top = input.run.report.recommendations[0];
  const topJudgment = top ? judgments.get(top.id) : undefined;
  const topAdjudication = top ? input.adjudications.get(harnessAuditAdjudicationKey(
    input.run.alias, input.run.mode, top.id)) : undefined;
  const topIssue = adjudicatedHarnessAuditIssue(topAdjudication, input.aliasTruth.truth);
  const topCorrectLayerAndActionable = Boolean(top
    && recommendationPasses(top, topJudgment)
    && topIssue?.layer === top.layer
    && recommendationCitesIssue(top, topIssue));
  const issueIds = new Map(input.run.report.recommendations.map((item) => [
    item.id,
    input.adjudications.get(harnessAuditAdjudicationKey(input.run.alias, input.run.mode, item.id))?.issueId ?? null,
  ]));
  return {
    reviewerId: input.reviewerId,
    alias: input.run.alias,
    repositoryKind: input.aliasTruth.kind,
    mode: input.run.mode,
    recommendations: count,
    passedRecommendations,
    realRecommendations,
    correctLayerRecommendations,
    falsePositives,
    wrongLayerRecommendations,
    contractFailures,
    groundTruthIssues: truthCount,
    matchedIssues: matchedIssues.size,
    missedIssues,
    precision: count ? realRecommendations / count : truthCount ? 0 : 1,
    correctLayerRate: realRecommendations ? correctLayerRecommendations / realRecommendations : truthCount ? 0 : 1,
    recall: truthCount ? matchedIssues.size / truthCount : 1,
    topCorrectLayerAndActionable,
    automatedScore: scoreHarnessAudit(input.run.report, input.aliasTruth.truth, issueIds),
    metrics: input.run.report.metrics,
  };
}

function summarizeMode(mode: HarnessAuditMode, runs: HarnessAuditRunSummary[]): HarnessAuditModeSummary {
  const selected = runs.filter((run) => run.mode === mode);
  const recommendations = selected.reduce((sum, run) => sum + run.recommendations, 0);
  const real = selected.reduce((sum, run) => sum + run.realRecommendations, 0);
  const correctLayer = selected.reduce((sum, run) => sum + run.correctLayerRecommendations, 0);
  const truthIssues = selected.reduce((sum, run) => sum + run.groundTruthIssues, 0);
  const matchedIssues = selected.reduce((sum, run) => sum + run.matchedIssues, 0);
  const latencyMs = selected.reduce((sum, run) => sum + run.metrics.latencyMs, 0);
  return {
    runs: selected.length,
    recommendations,
    passedRecommendations: selected.reduce((sum, run) => sum + run.passedRecommendations, 0),
    realRecommendations: real,
    correctLayerRecommendations: correctLayer,
    falsePositives: selected.flatMap((run) => run.falsePositives.map((id) => `${run.reviewerId}/${run.alias}/${id}`)),
    missedIssues: selected.flatMap((run) => run.missedIssues.map((id) => `${run.reviewerId}/${run.alias}/${id}`)),
    precision: recommendations ? real / recommendations : truthIssues ? 0 : 1,
    correctLayerRate: real ? correctLayer / real : truthIssues ? 0 : 1,
    recall: truthIssues ? matchedIssues / truthIssues : 1,
    modelCalls: selected.reduce((sum, run) => sum + run.metrics.modelCalls, 0),
    inputTokens: selected.reduce((sum, run) => sum + run.metrics.inputTokens, 0),
    outputTokens: selected.reduce((sum, run) => sum + run.metrics.outputTokens, 0),
    latencyMs,
    meanLatencyMs: selected.length ? latencyMs / selected.length : 0,
  };
}

export function evaluateBlindedHarnessAudit(input: HarnessAuditBlindedEvaluationInput): HarnessAuditBlindedEvaluation {
  const recordProblems: string[] = [];
  const reviewerIds = input.reviewers.map((reviewer) => reviewer.reviewerId);
  const adjudicationReviewerIds = Object.keys(input.adjudicationsByReviewer ?? {});
  if (new Set(reviewerIds).size !== reviewerIds.length) recordProblems.push("Reviewer IDs must be unique.");
  if (adjudicationReviewerIds.length !== reviewerIds.length
    || adjudicationReviewerIds.some((reviewerId) => !reviewerIds.includes(reviewerId))) {
    recordProblems.push("Claim adjudication reviewer IDs must match the reviewer records.");
  }
  if (new Set(input.reviewers.map((reviewer) => reviewer.farrierBuildId)).size !== 1) {
    recordProblems.push("Every reviewer must evaluate the same Farrier build ID.");
  }
  recordProblems.push(...harnessAuditAliasCopyProblems(input.aliasesByReviewer));
  recordProblems.push(...harnessAuditPanelBudgetProblems({
    approval: input.panelBudgetApproval,
    preflights: input.reviewers.map((reviewer) => reviewer.preflight),
  }));
  for (const reviewer of input.reviewers) {
    recordProblems.push(...runRecordProblems(
      reviewer,
      input.aliasesByReviewer[reviewer.reviewerId],
      input.adjudicationsByReviewer?.[reviewer.reviewerId],
    ));
  }
  const runSummaries = input.reviewers.flatMap((reviewer) => {
    const adjudications = indexHarnessAuditAdjudications(input.adjudicationsByReviewer?.[reviewer.reviewerId]);
    return reviewer.runs.flatMap((run) => {
      const aliasTruth = input.aliasesByReviewer[reviewer.reviewerId]?.[run.alias];
      return aliasTruth ? [summarizeRun({ reviewerId: reviewer.reviewerId, run, aliasTruth, adjudications })] : [];
    });
  });
  const modeSummaries = Object.fromEntries(harnessAuditModes.map((mode) => [mode, summarizeMode(mode, runSummaries)])) as Record<HarnessAuditMode, HarnessAuditModeSummary>;
  const seededRecall = harnessAuditSeededRecallByMode(runSummaries);
  const deepValueMetric = improvedHarnessAuditDeepMetric(modeSummaries, seededRecall);
  const allAttested = input.reviewers.every((reviewer) =>
    requiredAttestations.every((name) => reviewer.attestations?.[name] === true));
  const allRecommendationsPass = runSummaries.every((run) => run.passedRecommendations === run.recommendations);
  const seededTopPass = runSummaries.filter((run) => run.repositoryKind === "seeded")
    .every((run) => run.topCorrectLayerAndActionable);
  const cleanRuns = input.reviewers.flatMap((reviewer) => reviewer.runs.filter((run) =>
    input.aliasesByReviewer[reviewer.reviewerId]?.[run.alias]?.kind === "clean"));
  const cleanHasSpeculativeCreation = cleanRuns.some((run) => run.judgments.some((item) => item.speculativeCreation));
  const quickZeroCalls = runSummaries.filter((run) => run.mode === "quick").every((run) => run.metrics.modelCalls === 0);
  const baselineOneCall = runSummaries.filter((run) => run.mode === "baseline").every((run) => run.metrics.modelCalls === 1);
  const eachReviewerRanMultiWorkerDeep = input.reviewers.every((reviewer) =>
    reviewer.runs.some((run) => run.mode === "deep" && run.report.metrics.modelCalls >= 2));
  const safetyItems = harnessAuditSafetyGuarantees.map((name) => input.safety[name]);
  const safetyBuildId = input.reviewers[0]?.farrierBuildId;
  const safetyBuildBound = safetyItems.every((item) => item?.farrierBuildId === safetyBuildId);
  const safetyEvidencePresent = safetyItems.every((item) => item?.evidence?.length > 0
    && item.evidence.every((entry) => typeof entry === "string" && entry.trim()));
  if (!safetyBuildBound) recordProblems.push("Every safety evidence record must match the evaluated Farrier build ID.");
  if (!safetyEvidencePresent) recordProblems.push("Every safety guarantee requires non-blank evidence.");
  const safetyPass = safetyBuildBound && safetyEvidencePresent
    && safetyItems.every((item) => item?.passed === true);
  const failedCriteria: string[] = [];
  const require = (condition: boolean, failure: string) => { if (!condition) failedCriteria.push(failure); };
  require(recordProblems.length === 0, "Blinded records are complete, internally consistent, and preserve every recommendation judgment.");
  require(input.reviewers.length === 5 && new Set(reviewerIds).size === 5 && allAttested,
    "Five independent staff/principal reviewers completed hands-on use without coaching.");
  require(input.reviewers.length === 5 && input.reviewers.every((reviewer) => reviewer.decision === "would-adopt"),
    "All five reviewers independently chose would-adopt.");
  require(input.reviewers.every((reviewer) => !reviewer.blockingTrustOrSafetyObjection?.trim()),
    "No reviewer reported a blocking trust or safety objection.");
  require(allRecommendationsPass, "Every recommendation passed the factual, routing, citation, countercheck, artifact, risk, and uncertainty contract.");
  require(seededTopPass && runSummaries.some((run) => run.repositoryKind === "seeded"),
    "The top recommendation was correct-layer and actionable in every seeded run.");
  require(!cleanHasSpeculativeCreation, "Clean repositories received no speculative creation recommendation.");
  require(quickZeroCalls && runSummaries.some((run) => run.mode === "quick"), "Every quick run made zero model calls.");
  require(baselineOneCall && runSummaries.some((run) => run.mode === "baseline"), "Every baseline run made exactly one model call.");
  require(eachReviewerRanMultiWorkerDeep, "Every reviewer exercised a planned multi-worker deep run.");
  require(Boolean(deepValueMetric), "Deep improved precision, correct-layer rate, or recall over both quick and baseline.");
  require(safetyPass, "Consent, redaction, provider-purity, cancellation, review, and mutation-safety evidence all passed.");
  return {
    passed: failedCriteria.length === 0,
    failedCriteria,
    recordProblems,
    reviewerDecisions: input.reviewers.map((reviewer) => ({
      reviewerId: reviewer.reviewerId,
      role: reviewer.role,
      farrierBuildId: reviewer.farrierBuildId,
      decision: reviewer.decision,
      ...(reviewer.blockingTrustOrSafetyObjection
        ? { blockingTrustOrSafetyObjection: reviewer.blockingTrustOrSafetyObjection }
        : {}),
      ...(reviewer.highestSeverityReason ? { highestSeverityReason: reviewer.highestSeverityReason } : {}),
    })),
    runSummaries,
    modeSummaries,
    seededRecall,
    ...(deepValueMetric ? { deepValueMetric } : {}),
  };
}
