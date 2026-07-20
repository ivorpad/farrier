import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { scoreHarnessAudit, type HarnessAuditGroundTruth } from "../src/engine/harness-audit-evaluation";
import type { HarnessAuditReport } from "../src/engine/harness-audit-types";

const truth: HarnessAuditGroundTruth = {
  repository: "fixture",
  issues: [{ id: "missing-check", layer: "verification", severity: "high", locations: [{ path: "AGENTS.md", line: 4 }] }],
};

function recommendation(id: string, layer: "verification" | "guidance", line: number) {
  return {
    id, layer, severity: "high" as const, title: "Broken check", defect: "The documented check target does not exist.",
    citations: [{ path: "AGENTS.md", line, excerpt: "Run the missing check." }],
    counterchecks: [{ description: "Listed task targets.", result: "test" }],
    proposal: { artifact: "AGENTS.md", change: "Use the test target." },
    risk: "Completion can skip tests.", uncertainty: "The intended alias is unknown.", source: "deterministic" as const,
  };
}

function report(recommendations: HarnessAuditReport["recommendations"]): HarnessAuditReport {
  return {
    schemaVersion: 1, reportOnly: true, targetDir: "/repo", mode: "quick", recommendations,
    coverage: [], metrics: {
      modelCalls: 0, successfulModelCalls: 0, failedModelCalls: 0, inputTokens: 0, outputTokens: 0,
      latencyMs: 1, cumulativeModelTimeMs: 0, tokenAccounting: "none",
    },
    corpus: { digest: "a".repeat(64), filesRead: 1, linesSupplied: 1, checksPerformed: 1, skipped: [] }, notes: [],
  };
}

describe("harness audit evaluation", () => {
  test("scores real, wrong-layer, duplicate, false-positive, and missed recommendations", () => {
    const scored = scoreHarnessAudit(report([
      recommendation("verification:real", "verification", 4),
      recommendation("guidance:duplicate", "guidance", 4),
      recommendation("guidance:false", "guidance", 9),
    ]), truth);

    expect(scored.precision).toBe(2 / 3);
    expect(scored.correctLayerRate).toBe(1 / 2);
    expect(scored.duplicateRecommendations).toEqual(["guidance:duplicate"]);
    expect(scored.falsePositives).toEqual(["guidance:false"]);
    expect(scored.missedIssues).toEqual([]);
    expect(scored.topCorrectLayerAndActionable).toBeTrue();
  });

  test("clean reports pass only with no recommendations", () => {
    const clean = { repository: "clean", issues: [] };
    expect(scoreHarnessAudit(report([]), clean).precision).toBe(1);
    expect(scoreHarnessAudit(report([recommendation("guidance:false", "guidance", 9)]), clean).falsePositives)
      .toEqual(["guidance:false"]);
  });

  test("rejects alternate model-confidence assertions from the recommendation contract", () => {
    const authorityClaim = recommendation("verification:model-authority", "verification", 4);
    authorityClaim.risk = "Confidence: high. Completion can skip tests.";
    authorityClaim.uncertainty = "I am 95% confident even though the task was not executed.";

    const scored = scoreHarnessAudit(report([authorityClaim]), truth);

    expect(scored.contractFailures).toEqual([authorityClaim.id]);
    expect(scored.topCorrectLayerAndActionable).toBeFalse();
  });

  test("does not confuse cited or negated confidence wording with model authority", () => {
    const supported = recommendation("verification:confidence-risk", "verification", 4);
    supported.citations[0]!.excerpt = "The old report says Confidence: high.";
    supported.risk = "This creates false confidence that tests ran.";
    supported.uncertainty = "We are not confident which task alias was intended.";

    const scored = scoreHarnessAudit(report([supported]), truth);

    expect(scored.contractFailures).toEqual([]);
    expect(scored.topCorrectLayerAndActionable).toBeTrue();
  });

  test("quick mode scores the full fixture corpus without a model call", async () => {
    const fixtureRoot = resolve(import.meta.dir, "fixtures/harness-audit");
    const document = JSON.parse(await readFile(resolve(fixtureRoot, "ground-truth.json"), "utf8")) as {
      repositories: Record<string, Omit<HarnessAuditGroundTruth, "repository">>;
    };
    const expected = {
      "known-defects": { recommendations: 3, missedIssues: [] },
      clean: { recommendations: 0, missedIssues: [] },
      seeded: {
        recommendations: 6,
        missedIssues: ["seed-verification-bypassed-tests", "seed-toolchain-floating-manager"],
      },
    };

    for (const [repository, result] of Object.entries(expected)) {
      const audit = await auditHarness({ targetDir: resolve(fixtureRoot, repository), mode: "quick" });
      const scored = scoreHarnessAudit(audit, { repository, issues: document.repositories[repository]!.issues });

      expect(audit.metrics.modelCalls).toBe(0);
      expect(scored.recommendations).toBe(result.recommendations);
      expect(scored.precision).toBe(1);
      expect(scored.correctLayerRate).toBe(1);
      expect(scored.falsePositives).toEqual([]);
      expect(scored.contractFailures).toEqual([]);
      expect(scored.missedIssues).toEqual(result.missedIssues);
      expect(scored.topCorrectLayerAndActionable).toBeTrue();
    }
  });
});
