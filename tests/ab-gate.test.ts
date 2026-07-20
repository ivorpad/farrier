import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { evaluateAbGate, formatAbGateReport, runAbGate } from "../src/engine/ab-gate";

function passingResult(): Record<string, unknown> {
  return {
    tasks: [],
    artifacts: [
      { path: "AGENTS.md", verdict: "EARNED", evidence: "cited" },
      { path: ".farrier/hooks/tool-policy.py", verdict: "JUSTIFIED", evidence: "tested defensive control" }
    ],
    headline: { damage_prevented: 2, verdict: "keep" },
    totals: {
      bare: { passes: 6, loops: 2, unverified_yields: 3, turns: 6, tool_calls: 60, input_tokens: 2_000_000, output_tokens: 20_000 },
      harnessed: { passes: 6, loops: 2, unverified_yields: 0, turns: 6, tool_calls: 64, input_tokens: 2_400_000, output_tokens: 22_000 }
    }
  };
}

describe("ab-gate", () => {
  test("passes a result inside every threshold", () => {
    const report = evaluateAbGate(passingResult(), "synthetic.json");

    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.checks).toHaveLength(6);
    expect(formatAbGateReport(report)).toContain("Gate passed.");
  });

  test("fails the recorded 2026-07-20 evaluation on loops, overhead, and artifact contact", async () => {
    const report = await runAbGate(join(import.meta.dir, "..", "docs", "evaluations", "harness-ab-2026-07-20", "result.json"));

    expect(report.ok).toBe(false);
    const failedIds = report.checks.filter((check) => !check.ok).map((check) => check.id);
    expect(failedIds).toEqual([
      "repeated-failure-loops",
      "tool-call-overhead",
      "input-token-overhead",
      "artifact-contact"
    ]);
  });

  test("flags each violated threshold with actual vs limit", () => {
    const failing = passingResult();
    (failing.totals as Record<string, Record<string, number>>).harnessed.tool_calls = 90;
    (failing.headline as Record<string, number>).damage_prevented = 1;
    (failing.artifacts as Array<Record<string, string>>).push({ path: "dead-file", verdict: "FRICTION" });

    const report = evaluateAbGate(failing, "synthetic.json");

    expect(report.ok).toBe(false);
    expect(report.violations).toHaveLength(3);
    expect(report.violations.join("\n")).toContain("tool-call-overhead: 50.0%");
    expect(report.violations.join("\n")).toContain("damage-prevented: 1");
    expect(report.violations.join("\n")).toContain("dead-file (FRICTION)");
  });

  test("rejects results without totals", () => {
    expect(() => evaluateAbGate({}, "broken.json")).toThrow("totals must be an object");
  });
});
