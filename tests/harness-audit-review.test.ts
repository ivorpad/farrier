import { describe, expect, test } from "bun:test";
import type { HarnessAuditPlan } from "../src/engine/harness-audit";
import type { HarnessAuditGroundTruth } from "../src/engine/harness-audit-evaluation";
import { buildHarnessAuditPanelBudgetApproval, buildHarnessAuditReviewPreflight } from "../src/engine/harness-audit-review-preflight";
import {
  evaluateBlindedHarnessAudit,
  harnessAuditSafetyGuarantees,
  type HarnessAuditAliasTruth,
  type HarnessAuditBlindedEvaluationInput,
  type HarnessAuditRecommendationAdjudication,
  type HarnessAuditRecommendationJudgment,
  type HarnessAuditReviewerRecord,
} from "../src/engine/harness-audit-review";
import { harnessAuditLayers, type HarnessAuditMode, type HarnessAuditRecommendation, type HarnessAuditReport } from "../src/engine/harness-audit-types";
const knownTruth: HarnessAuditGroundTruth = { repository: "known-defects", issues: [{ id: "known-guidance", layer: "guidance", severity: "high", locations: [{ path: "AGENTS.md", line: 3 }] }] };
const cleanTruth: HarnessAuditGroundTruth = { repository: "clean", issues: [] };
const seededTruth: HarnessAuditGroundTruth = {
  repository: "seeded",
  issues: [
    { id: "seed-guidance", layer: "guidance", severity: "high", locations: [{ path: "AGENTS.md", line: 5 }] },
    { id: "seed-verification", layer: "verification", severity: "high", locations: [{ path: "package.json", line: 7 }] },
    { id: "seed-toolchain", layer: "toolchain", severity: "high", locations: [{ path: "package.json", line: 4 }] },
  ],
};
const panelApprovalReference = "panel-budget-approval";
function recommendation(input: {
  id: string;
  layer: "guidance" | "verification" | "toolchain";
  path: string;
  line: number;
  source: "deterministic" | "model";
}): HarnessAuditRecommendation {
  return {
    id: input.id,
    layer: input.layer,
    severity: "high",
    title: "Proven harness defect",
    defect: "The cited harness instruction contradicts a performed repository check.",
    citations: [{ path: input.path, line: input.line, excerpt: "Contradictory harness instruction." }],
    counterchecks: [{ description: "Compared the instruction with the declared task.", result: "contradiction found" }],
    proposal: { artifact: input.path, change: "Replace the contradictory instruction with the declared task." },
    risk: "Agents can report completion without the required check.",
    uncertainty: "The task was inspected statically and was not executed.",
    source: input.source,
  };
}
function report(
  mode: HarnessAuditMode,
  recommendations: HarnessAuditRecommendation[],
  calls: number,
  targetDir: string,
  corpusDigest: string,
): HarnessAuditReport {
  return {
    schemaVersion: 1,
    reportOnly: true,
    targetDir,
    mode,
    ...(mode === "quick" ? {} : {
      backend: "codex" as const,
      model: "comparison-model",
      executionBudget: { maxModelCalls: calls, maxEstimatedInputTokens: calls * 1_000 },
    }),
    recommendations,
    coverage: harnessAuditLayers.map((layer) => ({ layer, status: "no-finding", reason: "Fixture report." })),
    metrics: {
      modelCalls: calls,
      successfulModelCalls: calls,
      failedModelCalls: 0,
      inputTokens: calls * 1_000,
      outputTokens: calls * 100,
      latencyMs: calls ? calls * 20 : 2,
      cumulativeModelTimeMs: calls * 18,
      tokenAccounting: calls ? "provider" : "none",
    },
    corpus: { digest: corpusDigest, filesRead: 2, linesSupplied: 20, checksPerformed: 3, skipped: [] },
    notes: [],
  };
}
function passingJudgment(recommendationId: string): HarnessAuditRecommendationJudgment {
  return {
    recommendationId,
    realDefect: true,
    correctLayer: true,
    exactCitations: true,
    counterchecksSupportClaim: true,
    affectedArtifactOrDiff: true,
    riskSupported: true,
    uncertaintyHonest: true,
    prohibitedModelAuthorityClaim: false,
    speculativeCreation: false,
    actionableWithoutCoaching: true,
  };
}
function reviewedRun(
  alias: string,
  mode: HarnessAuditMode,
  recommendations: HarnessAuditRecommendation[],
  calls: number,
  provenance: Pick<HarnessAuditAliasTruth, "targetDir" | "corpusDigest">,
) {
  return {
    alias,
    mode,
    report: report(mode, recommendations, calls, provenance.targetDir, provenance.corpusDigest),
    judgments: recommendations.map((item) => passingJudgment(item.id)),
  };
}
function preflightPlan(
  alias: string,
  mode: "baseline" | "deep",
  provenance: Pick<HarnessAuditAliasTruth, "targetDir" | "corpusDigest">,
  calls: number,
): { alias: string; plan: HarnessAuditPlan } {
  const scopeNames = mode === "baseline"
    ? ["baseline" as const]
    : ["verification", "toolchain", "generalist"].slice(0, calls) as Array<"verification" | "toolchain" | "generalist">;
  const scopes = scopeNames.map((scope) => ({ scope,
    promptBytes: 4_000, estimatedInputTokens: 1_000,
    linesSupplied: 20, checksSupplied: 3 }));
  return {
    alias,
    plan: {
      schemaVersion: 1,
      planOnly: true,
      targetDir: provenance.targetDir,
      mode,
      plannedModelCalls: calls,
      promptBytes: scopes.reduce((sum, scope) => sum + scope.promptBytes, 0),
      estimatedInputTokens: scopes.reduce((sum, scope) => sum + scope.estimatedInputTokens, 0),
      maxConcurrency: mode === "baseline" ? 1 : Math.min(3, calls),
      deterministicFindings: 0,
      scopes,
      skippedScopes: [],
      corpus: { digest: provenance.corpusDigest, filesRead: 2, linesSupplied: 20, checksPerformed: 3, skipped: [] },
      estimateNote: "Fixture local estimate.",
    },
  };
}
function reviewer(index: number): { record: HarnessAuditReviewerRecord; aliases: Record<string, HarnessAuditAliasTruth> } {
  const knownAlias = `r${index}-linen`;
  const cleanAlias = `r${index}-quartz`;
  const seededAlias = `r${index}-umber`;
  const aliases: Record<string, HarnessAuditAliasTruth> = {
    [knownAlias]: {
      kind: "known-defects", targetDir: `/opaque/${knownAlias}`, corpusDigest: "1".repeat(64), truth: knownTruth,
    },
    [cleanAlias]: {
      kind: "clean", targetDir: `/opaque/${cleanAlias}`, corpusDigest: "2".repeat(64), truth: cleanTruth,
    },
    [seededAlias]: {
      kind: "seeded", targetDir: `/opaque/${seededAlias}`, corpusDigest: "3".repeat(64), truth: seededTruth,
    },
  };
  const known = (source: "deterministic" | "model") => recommendation({
    id: `guidance:known-${source}`,
    layer: "guidance",
    path: "AGENTS.md",
    line: 3,
    source,
  });
  const seedGuidance = (source: "deterministic" | "model") => recommendation({
    id: `guidance:seed-${source}`,
    layer: "guidance",
    path: "AGENTS.md",
    line: 5,
    source,
  });
  const seedVerification = recommendation({
    id: "verification:seed-deep",
    layer: "verification",
    path: "package.json",
    line: 7,
    source: "model",
  });
  const seedToolchain = recommendation({
    id: "toolchain:seed-deep", layer: "toolchain", path: "package.json", line: 4, source: "model",
  });
  const runs = [
    reviewedRun(knownAlias, "quick", [known("deterministic")], 0, aliases[knownAlias]!),
    reviewedRun(knownAlias, "baseline", [known("model")], 1, aliases[knownAlias]!),
    reviewedRun(knownAlias, "deep", [known("deterministic")], 0, aliases[knownAlias]!),
    reviewedRun(cleanAlias, "quick", [], 0, aliases[cleanAlias]!),
    reviewedRun(cleanAlias, "baseline", [], 1, aliases[cleanAlias]!),
    reviewedRun(cleanAlias, "deep", [], 0, aliases[cleanAlias]!),
    reviewedRun(seededAlias, "quick", [seedGuidance("deterministic")], 0, aliases[seededAlias]!),
    reviewedRun(seededAlias, "baseline", [seedGuidance("model")], 1, aliases[seededAlias]!),
    reviewedRun(seededAlias, "deep", [seedGuidance("deterministic"), seedVerification, seedToolchain], 2, aliases[seededAlias]!),
  ];
  const plans = [
    preflightPlan(knownAlias, "baseline", aliases[knownAlias]!, 1),
    preflightPlan(knownAlias, "deep", aliases[knownAlias]!, 0),
    preflightPlan(cleanAlias, "baseline", aliases[cleanAlias]!, 1),
    preflightPlan(cleanAlias, "deep", aliases[cleanAlias]!, 0),
    preflightPlan(seededAlias, "baseline", aliases[seededAlias]!, 1),
    preflightPlan(seededAlias, "deep", aliases[seededAlias]!, 2),
  ];
  const preflight = buildHarnessAuditReviewPreflight(panelApprovalReference, plans);
  return {
    aliases,
    record: {
      reviewerId: `reviewer-${index}`,
      role: index % 2 ? "staff" : "principal",
      farrierBuildId: "farrier-evaluation-build",
      decision: "would-adopt",
      attestations: {
        startedFromHelp: true,
        usedWithoutCoaching: true,
        inspectedRepositoryFiles: true,
        reportsUnedited: true,
        knownRepositoryUnfamiliar: true,
        groundTruthHiddenUntilSubmission: true,
        otherReviewsHiddenUntilSubmission: true,
        sameBackendModelAccount: true,
      },
      preflight,
      runs,
    },
  };
}
function adjudicationsFor(
  record: HarnessAuditReviewerRecord,
  aliases: Record<string, HarnessAuditAliasTruth>,
): HarnessAuditRecommendationAdjudication[] {
  return record.runs.flatMap((run) => run.report.recommendations.map((item) => {
    const issue = aliases[run.alias]!.truth.issues.find((candidate) => candidate.layer === item.layer
      && candidate.locations.some((location) => item.citations.some((citation) =>
        citation.path === location.path && citation.line === location.line)));
    return {
      alias: run.alias,
      mode: run.mode,
      recommendationId: item.id,
      issueId: issue?.id ?? null,
      rationale: issue ? `The claim identifies ${issue.id}.` : "The claim does not identify a seeded issue.",
    };
  }));
}
function passingInput(): HarnessAuditBlindedEvaluationInput {
  const reviewers = Array.from({ length: 5 }, (_, index) => reviewer(index + 1));
  return {
    reviewers: reviewers.map((item) => item.record),
    panelBudgetApproval: buildHarnessAuditPanelBudgetApproval(panelApprovalReference, reviewers.map((item) => item.record.preflight)),
    aliasesByReviewer: Object.fromEntries(reviewers.map((item) => [item.record.reviewerId, item.aliases])),
    adjudicationsByReviewer: Object.fromEntries(reviewers.map((item) => [
      item.record.reviewerId,
      adjudicationsFor(item.record, item.aliases),
    ])),
    safety: Object.fromEntries(harnessAuditSafetyGuarantees.map((name) => [name, {
      farrierBuildId: "farrier-evaluation-build", passed: true, evidence: [`tests/${name}.test.ts`],
    }])) as HarnessAuditBlindedEvaluationInput["safety"],
  };
}
describe("blinded harness audit evaluation", () => {
  test("passes when every reviewer uses multi-worker deep only on supported seeded opportunities", () => {
    const result = evaluateBlindedHarnessAudit(passingInput());
    expect(result.passed).toBeTrue();
    expect(result.failedCriteria).toEqual([]);
    expect(result.recordProblems).toEqual([]);
    expect(result.deepValueMetric).toBe("recall");
    expect(result.seededRecall.quick).toBe(1 / 3);
    expect(result.modeSummaries.baseline.modelCalls).toBe(15);
    expect(result.seededRecall.deep).toBe(1);
    expect(result.modeSummaries.deep.modelCalls).toBe(10);
    expect(result.reviewerDecisions.every((item) => item.decision === "would-adopt")).toBeTrue();
  });
  test("rejects blank or stale safety evidence", () => {
    const input = passingInput();
    input.safety.redaction.evidence = [" "];
    input.safety.consent.farrierBuildId = "older-build";
    const result = evaluateBlindedHarnessAudit(input);
    expect(result.passed).toBeFalse();
    expect(result.recordProblems.some((item) => item.includes("safety evidence"))).toBeTrue();
    expect(result.failedCriteria.some((item) => item.includes("safety evidence"))).toBeTrue();
  });
  test("rejects a panel that never exercises more than one deep worker", () => {
    const input = passingInput();
    for (const reviewer of input.reviewers) {
      reviewer.runs.filter((run) => run.mode === "deep").forEach((run) => { run.report.metrics.modelCalls = Math.min(1, run.report.metrics.modelCalls); });
    }
    const result = evaluateBlindedHarnessAudit(input);
    expect(result.failedCriteria.some((item) => item.includes("multi-worker deep"))).toBeTrue();
  });
  test("rejects per-reviewer preflights without an exact five-review ceiling", () => {
    const input = passingInput();
    input.panelBudgetApproval.approvedMaxProviderCalls = input.reviewers[0]!.preflight.approvedMaxProviderCalls;
    const result = evaluateBlindedHarnessAudit(input);
    expect(result.recordProblems.some((item) => item.includes("all reviewer preflights"))).toBeTrue();
  });
  test("requires provider-reported tokens for every successful paid run", () => {
    const input = passingInput();
    for (const reviewer of input.reviewers) reviewer.runs.filter((run) => run.report.metrics.modelCalls > 0)
      .forEach((run) => { run.report.metrics.tokenAccounting = "estimated-from-utf8"; });
    const result = evaluateBlindedHarnessAudit(input);
    expect(result.passed).toBeFalse();
    expect(result.recordProblems.some((item) => item.includes("provider-reported token usage"))).toBeTrue();
    const zeroUsage = passingInput();
    zeroUsage.reviewers[0]!.runs.find((run) => run.report.metrics.modelCalls > 0)!.report.metrics.outputTokens = 0;
    expect(evaluateBlindedHarnessAudit(zeroUsage).recordProblems.some((item) => item.includes("positive provider-reported"))).toBeTrue();
  });
  test("preserves negative findings and fails adoption, restraint, cost, value, and safety gates", () => {
    const input = structuredClone(passingInput());
    input.reviewers[0]!.decision = "would-not-adopt";
    input.reviewers[0]!.blockingTrustOrSafetyObjection = "Counterchecks do not prove the top claim.";
    input.reviewers[0]!.highestSeverityReason = "A false recommendation ranked first.";
    input.reviewers[0]!.runs.find((run) => run.mode === "quick")!.report.metrics.modelCalls = 1;
    input.safety.redaction = { ...input.safety.redaction, passed: false, evidence: ["tests/redaction.test.ts failed"] };
    for (const reviewer of input.reviewers) {
      const seededDeep = reviewer.runs.find((run) => run.mode === "deep"
        && input.aliasesByReviewer[reviewer.reviewerId]![run.alias]!.kind === "seeded")!;
      seededDeep.report.recommendations = seededDeep.report.recommendations.slice(0, 1);
      seededDeep.judgments = seededDeep.judgments.slice(0, 1);
    }
    const cleanDeep = input.reviewers[0]!.runs.find((run) => run.mode === "deep"
      && input.aliasesByReviewer[input.reviewers[0]!.reviewerId]![run.alias]!.kind === "clean")!;
    const speculative = recommendation({
      id: "guidance:create-missing-policy",
      layer: "guidance",
      path: "AGENTS.md",
      line: 1,
      source: "model",
    });
    cleanDeep.report.recommendations = [speculative];
    cleanDeep.judgments = [{
      ...passingJudgment(speculative.id),
      realDefect: false,
      speculativeCreation: true,
    }];
    input.adjudicationsByReviewer[input.reviewers[0]!.reviewerId]!.push({
      alias: cleanDeep.alias,
      mode: cleanDeep.mode,
      recommendationId: speculative.id,
      issueId: null,
      rationale: "The clean repository contains no seeded issue.",
    });
    const result = evaluateBlindedHarnessAudit(input);
    expect(result.passed).toBeFalse();
    expect(result.deepValueMetric).toBeUndefined();
    expect(result.failedCriteria.some((item) => item.includes("would-adopt"))).toBeTrue();
    expect(result.failedCriteria.some((item) => item.includes("blocking trust"))).toBeTrue();
    expect(result.failedCriteria.some((item) => item.includes("speculative creation"))).toBeTrue();
    expect(result.failedCriteria.some((item) => item.includes("zero model calls"))).toBeTrue();
    expect(result.failedCriteria.some((item) => item.includes("Deep improved"))).toBeTrue();
    expect(result.failedCriteria.some((item) => item.includes("safety evidence"))).toBeTrue();
    expect(result.modeSummaries.deep.falsePositives).toContain("reviewer-1/r1-quartz/guidance:create-missing-policy");
    expect(result.reviewerDecisions[0]?.blockingTrustOrSafetyObjection).toContain("Counterchecks");
    expect(result.reviewerDecisions[0]?.highestSeverityReason).toContain("false recommendation");
  });
  test("rejects incomplete panels and missing per-recommendation judgments", () => {
    const input = passingInput();
    input.reviewers.pop();
    const firstRun = input.reviewers[0]!.runs.find((run) => run.report.recommendations.length)!;
    firstRun.judgments = [];
    const result = evaluateBlindedHarnessAudit(input);
    expect(result.passed).toBeFalse();
    expect(result.recordProblems.some((item) => item.includes("lacks judgments"))).toBeTrue();
    expect(result.failedCriteria.some((item) => item.includes("Five independent"))).toBeTrue();
    expect(result.failedCriteria.some((item) => item.includes("Every recommendation"))).toBeTrue();
  });
  test("does not let reviewer checkboxes override hidden ground truth", () => {
    const input = passingInput();
    const reviewer = input.reviewers[0]!;
    const knownDeep = reviewer.runs.find((run) => run.mode === "deep"
      && input.aliasesByReviewer[reviewer.reviewerId]![run.alias]!.kind === "known-defects")!;
    const unmatched = recommendation({
      id: "guidance:unmatched-claim",
      layer: "guidance",
      path: "README.md",
      line: 99,
      source: "model",
    });
    const wrongLayer = recommendation({
      id: "verification:wrong-layer-claim",
      layer: "verification",
      path: "AGENTS.md",
      line: 3,
      source: "model",
    });
    knownDeep.report.recommendations.push(unmatched, wrongLayer);
    knownDeep.judgments.push(passingJudgment(unmatched.id), passingJudgment(wrongLayer.id));
    input.adjudicationsByReviewer[reviewer.reviewerId]!.push(
      {
        alias: knownDeep.alias,
        mode: knownDeep.mode,
        recommendationId: unmatched.id,
        issueId: null,
        rationale: "The claim has no matching known issue.",
      },
      {
        alias: knownDeep.alias,
        mode: knownDeep.mode,
        recommendationId: wrongLayer.id,
        issueId: "known-guidance",
        rationale: "The claim points to the guidance issue but routes it to verification.",
      },
    );
    const result = evaluateBlindedHarnessAudit(input);
    const summary = result.runSummaries.find((run) => run.reviewerId === reviewer.reviewerId
      && run.alias === knownDeep.alias && run.mode === "deep")!;
    expect(result.passed).toBeFalse();
    expect(result.failedCriteria.some((item) => item.includes("Every recommendation"))).toBeTrue();
    expect(summary.falsePositives).toContain(unmatched.id);
    expect(summary.wrongLayerRecommendations).toContain(wrongLayer.id);
    expect(summary.automatedScore.falsePositives).toContain(unmatched.id);
  });
  test("requires a claim-level ground-truth match instead of crediting a coincidental citation", () => {
    const input = passingInput();
    const reviewer = input.reviewers[0]!;
    const knownDeep = reviewer.runs.find((run) => run.mode === "deep"
      && input.aliasesByReviewer[reviewer.reviewerId]![run.alias]!.kind === "known-defects")!;
    const citedButUnrelated = knownDeep.report.recommendations[0]!;
    citedButUnrelated.title = "Public telemetry leak";
    citedButUnrelated.defect = "The cited instruction sends repository secrets to a public telemetry endpoint.";
    citedButUnrelated.proposal.change = "Remove the telemetry upload.";
    const adjudication = input.adjudicationsByReviewer[reviewer.reviewerId]!.find((item) =>
      item.alias === knownDeep.alias && item.mode === knownDeep.mode
      && item.recommendationId === citedButUnrelated.id)!;
    adjudication.issueId = null;
    adjudication.rationale = "The seeded issue is missing guidance, not telemetry disclosure.";
    const result = evaluateBlindedHarnessAudit(input);
    const summary = result.runSummaries.find((run) => run.reviewerId === reviewer.reviewerId
      && run.alias === knownDeep.alias && run.mode === "deep")!;
    expect(result.passed).toBeFalse();
    expect(summary.falsePositives).toContain(citedButUnrelated.id);
    expect(summary.automatedScore.falsePositives).toContain(citedButUnrelated.id);
  });
  test("requires the seeded top recommendation to be actionable without coaching", () => {
    const input = passingInput();
    const reviewer = input.reviewers[0]!;
    const seededDeep = reviewer.runs.find((run) => run.mode === "deep"
      && input.aliasesByReviewer[reviewer.reviewerId]![run.alias]!.kind === "seeded")!;
    Object.assign(seededDeep.judgments[0]!, { actionableWithoutCoaching: false });
    const result = evaluateBlindedHarnessAudit(input);
    expect(result.passed).toBeFalse();
    expect(result.failedCriteria.some((item) => item.includes("top recommendation"))).toBeTrue();
  });
  test("rejects impossible metrics, model-sourced quick findings, and failed coverage", () => {
    const input = passingInput();
    const reviewer = input.reviewers[0]!;
    const knownQuick = reviewer.runs.find((run) => run.mode === "quick"
      && input.aliasesByReviewer[reviewer.reviewerId]![run.alias]!.kind === "known-defects")!;
    knownQuick.report.recommendations[0]!.source = "model";
    const knownBaseline = reviewer.runs.find((run) => run.mode === "baseline"
      && input.aliasesByReviewer[reviewer.reviewerId]![run.alias]!.kind === "known-defects")!;
    knownBaseline.report.metrics.successfulModelCalls = 0;
    knownBaseline.report.metrics.inputTokens = -1;
    knownBaseline.report.metrics.latencyMs = -5;
    const cleanDeep = reviewer.runs.find((run) => run.mode === "deep"
      && input.aliasesByReviewer[reviewer.reviewerId]![run.alias]!.kind === "clean")!;
    cleanDeep.report.coverage[0] = {
      layer: "guidance",
      status: "worker-failed",
      reason: "worker returned no usable report",
    };
    const result = evaluateBlindedHarnessAudit(input);
    expect(result.passed).toBeFalse();
    expect(result.recordProblems.some((item) => item.includes("model-sourced recommendation"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("invalid metrics"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("worker-failed"))).toBeTrue();
  });
  test("rejects a report from the wrong alias and mixed comparison backends", () => {
    const input = passingInput();
    const reviewer = input.reviewers[0]!;
    const aliases = input.aliasesByReviewer[reviewer.reviewerId]!;
    const knownAlias = Object.entries(aliases).find(([, item]) => item.kind === "known-defects")!;
    const knownQuick = reviewer.runs.find((run) => run.alias === knownAlias[0] && run.mode === "quick")!;
    knownQuick.report.targetDir = "/opaque/wrong-alias";
    knownQuick.report.corpus.digest = "b".repeat(64);
    const knownBaseline = reviewer.runs.find((run) => run.alias === knownAlias[0] && run.mode === "baseline")!;
    knownBaseline.report.backend = "claude";
    const knownDeep = reviewer.runs.find((run) => run.alias === knownAlias[0] && run.mode === "deep")!;
    knownDeep.report.model = undefined;
    input.reviewers[1]!.farrierBuildId = "different-build";
    Object.assign(input.reviewers[2]!.attestations, { knownRepositoryUnfamiliar: false, otherReviewsHiddenUntilSubmission: false, sameBackendModelAccount: undefined });
    const result = evaluateBlindedHarnessAudit(input);
    expect(result.passed).toBeFalse();
    expect(result.recordProblems.some((item) => item.includes("target directory"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("corpus digest"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("same backend"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("provider-cost ceiling"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("explicit comparison model"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("same Farrier build"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("attestations are missing"))).toBeTrue();
  });
  test("rejects missing, over-budget, and wrong-snapshot preflight evidence", () => {
    const input = passingInput();
    delete (input.reviewers[0] as Partial<HarnessAuditReviewerRecord>).preflight;
    input.reviewers[1]!.preflight.approvedMaxProviderCalls = 0;
    input.reviewers[2]!.preflight.plans[0]!.plan.corpus.digest = "f".repeat(64);
    input.reviewers[3]!.preflight.plans.pop();
    const baseline = input.reviewers[4]!.runs.find((run) => run.mode === "baseline")!;
    baseline.report.executionBudget!.maxModelCalls = 2;
    const result = evaluateBlindedHarnessAudit(input);
    expect(result.passed).toBeFalse();
    expect(result.recordProblems.some((item) => item.includes("preflight evidence"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("approved provider-call maximum"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("frozen alias snapshot"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("one baseline and one deep plan"))).toBeTrue();
    expect(result.recordProblems.some((item) => item.includes("exact saved preflight"))).toBeTrue();
  });
});
