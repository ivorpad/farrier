import type {
  HarnessAuditModeSummary,
  HarnessAuditRunSummary,
} from "./harness-audit-review-results";
import { harnessAuditModes, type HarnessAuditMode } from "./harness-audit-types";

export type HarnessAuditDeepValueMetric = "precision" | "correct-layer" | "recall";

export function harnessAuditSeededRecallByMode(
  runs: HarnessAuditRunSummary[],
): Record<HarnessAuditMode, number> {
  return Object.fromEntries(harnessAuditModes.map((mode) => {
    const selected = runs.filter((run) => run.mode === mode && run.repositoryKind === "seeded");
    const issues = selected.reduce((sum, run) => sum + run.groundTruthIssues, 0);
    const matched = selected.reduce((sum, run) => sum + run.matchedIssues, 0);
    return [mode, issues ? matched / issues : 0];
  })) as Record<HarnessAuditMode, number>;
}

export function improvedHarnessAuditDeepMetric(
  summaries: Record<HarnessAuditMode, HarnessAuditModeSummary>,
  seededRecall: Record<HarnessAuditMode, number>,
): HarnessAuditDeepValueMetric | undefined {
  const improved = (field: "precision" | "correctLayerRate") =>
    summaries.deep[field] > summaries.quick[field] && summaries.deep[field] > summaries.baseline[field];
  if (improved("precision")) return "precision";
  if (improved("correctLayerRate")) return "correct-layer";
  if (seededRecall.deep > seededRecall.quick && seededRecall.deep > seededRecall.baseline) return "recall";
  return undefined;
}
