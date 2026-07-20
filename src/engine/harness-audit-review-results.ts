import type { HarnessAuditScore } from "./harness-audit-evaluation";
import type { HarnessAuditMode, HarnessAuditReport } from "./harness-audit-types";

export type HarnessAuditRepositoryKind = "known-defects" | "clean" | "seeded";

export type HarnessAuditRunSummary = {
  reviewerId: string;
  alias: string;
  repositoryKind: HarnessAuditRepositoryKind;
  mode: HarnessAuditMode;
  recommendations: number;
  passedRecommendations: number;
  realRecommendations: number;
  correctLayerRecommendations: number;
  falsePositives: string[];
  wrongLayerRecommendations: string[];
  contractFailures: string[];
  groundTruthIssues: number;
  matchedIssues: number;
  missedIssues: string[];
  precision: number;
  correctLayerRate: number;
  recall: number;
  topCorrectLayerAndActionable: boolean;
  automatedScore: HarnessAuditScore;
  metrics: HarnessAuditReport["metrics"];
};

export type HarnessAuditModeSummary = {
  runs: number;
  recommendations: number;
  passedRecommendations: number;
  realRecommendations: number;
  correctLayerRecommendations: number;
  falsePositives: string[];
  missedIssues: string[];
  precision: number;
  correctLayerRate: number;
  recall: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  meanLatencyMs: number;
};

export type HarnessAuditBlindedEvaluation = {
  passed: boolean;
  failedCriteria: string[];
  recordProblems: string[];
  reviewerDecisions: Array<{
    reviewerId: string;
    role: "staff" | "principal";
    farrierBuildId: string;
    decision: "would-adopt" | "would-not-adopt";
    blockingTrustOrSafetyObjection?: string;
    highestSeverityReason?: string;
  }>;
  runSummaries: HarnessAuditRunSummary[];
  modeSummaries: Record<HarnessAuditMode, HarnessAuditModeSummary>;
  seededRecall: Record<HarnessAuditMode, number>;
  deepValueMetric?: "precision" | "correct-layer" | "recall";
};
