import { describe, expect, test } from "bun:test";
import { advicePolicyFor } from "../src/engine/advice-policy";
import { validateAdviceResponse } from "../src/engine/advice-recommender";
import type { AdviceEvidence } from "../src/engine/advice-types";

function rawRecommendation(id: string, evidence: string) {
  return {
    id,
    category: "skills",
    evidence: [evidence],
    routeId: "skills:agents-shared",
    reason: "A reusable repository procedure is needed.",
    confidence: "high",
  };
}

describe("advice worker validation", () => {
  test("rejects opposite-provider evidence but accepts any category the model judges supported", () => {
    const evidence: AdviceEvidence[] = [
      { id: "session:none", source: "codex", kind: "session", summary: "No category.", targetVendors: ["codex"] },
      { id: "session:claude", source: "codex", kind: "session", summary: "Wrong provider.", selectedProvider: "claude" },
    ];
    const result = validateAdviceResponse({
      parsed: { recommendations: [rawRecommendation("skills:none", "session:none"), rawRecommendation("skills:wrong-provider", "session:claude")] },
      evidence,
      categories: ["skills"],
      policy: advicePolicyFor("codex"),
      registry: [],
    });

    expect(result.recommendations.map((item) => item.id)).toEqual(["skills:none"]);
    expect(result.rejectionReasons).toEqual([
      "Dropped recommendation 'skills:wrong-provider': cited evidence excludes the selected provider.",
    ]);
  });

  test("legacy evidence without category metadata remains eligible", () => {
    const result = validateAdviceResponse({
      parsed: { recommendations: [rawRecommendation("skills:legacy", "session:legacy")] },
      evidence: [{ id: "session:legacy", source: "codex", kind: "session", summary: "Reusable review request." }],
      categories: ["skills"],
      policy: advicePolicyFor("codex"),
      registry: [],
    });

    expect(result.recommendations.map((item) => item.id)).toEqual(["skills:legacy"]);
  });

  test("caps high-confidence candidates and weak leads independently", () => {
    const evidence = [{ id: "project:root", source: "project" as const, kind: "structure", summary: "Root." }];
    const recommendations = [
      ...Array.from({ length: 6 }, (_, index) => ({ ...rawRecommendation(`skills:high-${index}`, "project:root"), reason: `High-confidence procedure ${index}.` })),
      ...Array.from({ length: 6 }, (_, index) => ({ ...rawRecommendation(`skills:low-${index}`, "project:root"), reason: `Low-confidence procedure ${index}.`, confidence: "low" })),
    ];
    const result = validateAdviceResponse({
      parsed: { recommendations },
      evidence,
      categories: ["skills"],
      policy: advicePolicyFor("codex"),
      registry: [],
    });

    expect(result.recommendations).toHaveLength(5);
    expect(result.weakLeads).toHaveLength(5);
    expect(result.omitted).toHaveLength(2);
  });
});
