import { describe, expect, test } from "bun:test";
import {
  AdviceCoordinatorValidationError,
  buildAdviceCoordinatorPrompt,
  validateAdviceCoordinatorResponse,
} from "../src/engine/advice-coordinator";
import { advicePolicyFor } from "../src/engine/advice-policy";
import type { AdviceRecommendation } from "../src/engine/advice-types";

function candidate(id: string, category: AdviceRecommendation["category"]): AdviceRecommendation {
  const policy = advicePolicyFor("codex");
  const route = policy.routes.find((item) => item.category === category)!;
  return {
    id,
    category,
    targetVendors: ["codex"],
    reason: "The same review procedure is repeatedly requested.",
    benefit: "Keeps the review procedure reusable.",
    evidence: ["project:root"],
    confidence: "high",
    implementationRoute: { id: route.id, description: route.description },
  };
}

describe("advice coordinator", () => {
  test("selects known IDs and materializes unchanged local candidates", () => {
    const guidance = candidate("guidance:review-rule", "guidance");
    const skill = candidate("skills:review-procedure", "skills");
    const coordinated = validateAdviceCoordinatorResponse({
      parsed: {
        selectedIds: [skill.id],
        omissions: [{
          id: guidance.id,
          kind: "overlap",
          selectedId: skill.id,
          reason: "The skill contains the reusable procedure, so the guidance would duplicate it.",
        }],
      },
      candidates: [guidance, skill],
      policy: advicePolicyFor("codex"),
    });

    expect(coordinated.recommendations).toEqual([skill]);
    expect(coordinated.omitted[0]?.recommendation).toEqual(guidance);
    expect(coordinated.overlapCount).toBe(1);
  });

  test("rejects unknown fields, incomplete partitions, and invalid overlap targets", () => {
    const guidance = candidate("guidance:review-rule", "guidance");
    expect(() => validateAdviceCoordinatorResponse({
      parsed: {
        selectedIds: [],
        omissions: [{ id: guidance.id, kind: "overlap", selectedId: guidance.id, reason: "Duplicate." }],
        recommendations: [{ ...guidance, reason: "Changed by the model." }],
      },
      candidates: [guidance],
      policy: advicePolicyFor("codex"),
    })).toThrow(AdviceCoordinatorValidationError);
  });

  test("prompt contains only bounded candidates and their cited evidence", () => {
    const skill = candidate("skills:review-procedure", "skills");
    const prompt = buildAdviceCoordinatorPrompt({
      candidates: [skill],
      categories: ["skills"],
      evidence: [
        { id: "project:root", source: "project", kind: "structure", summary: "Repository root." },
        { id: "project:unused", source: "project", kind: "structure", summary: "Must not be forwarded." },
      ],
      policy: advicePolicyFor("codex"),
    });
    expect(prompt).toContain("skills:review-procedure");
    expect(prompt).toContain("Repository root.");
    expect(prompt).not.toContain("Must not be forwarded.");
  });
});
