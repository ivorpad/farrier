import { describe, expect, test } from "bun:test";
import {
  adjudicatedHarnessAuditIssue,
  harnessAuditAdjudicationProblems,
  indexHarnessAuditAdjudications,
  recommendationCitesIssue,
  type HarnessAuditRecommendationAdjudication,
} from "../src/engine/harness-audit-adjudication";
import type { HarnessAuditGroundTruth } from "../src/engine/harness-audit-evaluation";
import type { HarnessAuditRecommendation } from "../src/engine/harness-audit-types";

const truth: HarnessAuditGroundTruth = {
  repository: "known",
  issues: [{
    id: "guidance-missing",
    layer: "guidance",
    severity: "high",
    locations: [{ path: "AGENTS.md", line: 3 }],
  }],
};

function recommendation(): HarnessAuditRecommendation {
  return {
    id: "guidance:missing",
    layer: "guidance",
    severity: "high",
    title: "Missing guidance",
    defect: "The repository guidance omits a required policy.",
    citations: [{ path: "AGENTS.md", line: 3, excerpt: "Run checks." }],
    counterchecks: [{ description: "Inspected the policy section.", result: "Policy absent." }],
    proposal: { artifact: "AGENTS.md", change: "Add the required policy." },
    risk: "Agents can miss the policy.",
    uncertainty: "Only the selected guidance was inspected.",
    source: "model",
  };
}

function adjudication(issueId: string | null): HarnessAuditRecommendationAdjudication {
  return {
    alias: "linen",
    mode: "deep",
    recommendationId: "guidance:missing",
    issueId,
    rationale: "The claim describes the seeded missing-guidance issue.",
  };
}

describe("harness audit claim adjudication", () => {
  test("requires an adjudication for every reported recommendation", () => {
    const problems = harnessAuditAdjudicationProblems({
      reviewerId: "reviewer-1",
      aliases: { linen: { truth } },
      runs: [{ alias: "linen", mode: "deep", report: { recommendations: [recommendation()] } }],
      adjudications: [],
    });

    expect(problems).toEqual([
      "Reviewer reviewer-1: missing claim adjudication for linen:deep:guidance:missing.",
    ]);
  });

  test("rejects duplicate, unknown, and unexplained adjudications", () => {
    const first = adjudication("not-an-issue");
    first.rationale = "";
    const problems = harnessAuditAdjudicationProblems({
      reviewerId: "reviewer-1",
      aliases: { linen: { truth } },
      runs: [{ alias: "linen", mode: "deep", report: { recommendations: [recommendation()] } }],
      adjudications: [first, adjudication("guidance-missing"), {
        ...adjudication(null), recommendationId: "unknown",
      }],
    });

    expect(problems.some((item) => item.includes("duplicate claim adjudication"))).toBeTrue();
    expect(problems.some((item) => item.includes("unknown ground-truth issue"))).toBeTrue();
    expect(problems.some((item) => item.includes("has no rationale"))).toBeTrue();
    expect(problems.some((item) => item.includes("unknown recommendation"))).toBeTrue();
  });

  test("keeps claim identity separate from exact citation evidence", () => {
    const item = adjudication("guidance-missing");
    const indexed = indexHarnessAuditAdjudications([item]);
    const issue = adjudicatedHarnessAuditIssue(indexed.values().next().value, truth)!;
    const wrongCitation = recommendation();
    wrongCitation.citations[0]!.line = 4;

    expect(issue.id).toBe("guidance-missing");
    expect(recommendationCitesIssue(recommendation(), issue)).toBeTrue();
    expect(recommendationCitesIssue(wrongCitation, issue)).toBeFalse();
  });
});
