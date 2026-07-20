import { expect, test } from "bun:test";
import type {
  HarnessAuditModeSummary,
  HarnessAuditRunSummary,
} from "../src/engine/harness-audit-review-results";
import {
  harnessAuditSeededRecallByMode,
  improvedHarnessAuditDeepMetric,
} from "../src/engine/harness-audit-review-value";
import type { HarnessAuditMode } from "../src/engine/harness-audit-types";

function summary(recall: number): HarnessAuditModeSummary {
  return { precision: 1, correctLayerRate: 1, recall } as HarnessAuditModeSummary;
}

function seededRun(mode: HarnessAuditMode, matchedIssues: number): HarnessAuditRunSummary {
  return {
    mode, repositoryKind: "seeded", groundTruthIssues: 3, matchedIssues,
  } as HarnessAuditRunSummary;
}

test("known-repository recall cannot stand in for seeded deep value", () => {
  const summaries = {
    quick: summary(0.25), baseline: summary(0.25), deep: summary(0.5),
  };
  const seededRecall = harnessAuditSeededRecallByMode([
    seededRun("quick", 1), seededRun("baseline", 1), seededRun("deep", 1),
  ]);

  expect(summaries.deep.recall).toBeGreaterThan(summaries.baseline.recall);
  expect(seededRecall).toEqual({ quick: 1 / 3, baseline: 1 / 3, deep: 1 / 3 });
  expect(improvedHarnessAuditDeepMetric(summaries, seededRecall)).toBeUndefined();
});

test("a seeded recall gain over both comparison modes counts as deep value", () => {
  const summaries = { quick: summary(0.5), baseline: summary(0.5), deep: summary(0.75) };
  const seededRecall = harnessAuditSeededRecallByMode([
    seededRun("quick", 1), seededRun("baseline", 1), seededRun("deep", 2),
  ]);

  expect(improvedHarnessAuditDeepMetric(summaries, seededRecall)).toBe("recall");
});
