import { describe, expect, test } from "bun:test";
import { collapseDescription, scaffoldSkillDraft, slugifySkillName } from "../src/engine/skill-validate";

describe("skill validation primitives", () => {
  test("normalizes names and bounds frontmatter descriptions", () => {
    expect(slugifySkillName(" Review API Responses! ")).toBe("review-api-responses");
    const collapsed = collapseDescription(`  ${"x".repeat(510)}  `);
    expect(collapsed.description).toHaveLength(500);
    expect(collapsed.truncated).toBe(true);
  });

  test("creates one deterministic offline skill draft", () => {
    const draft = scaffoldSkillDraft({ description: "Review API responses" });
    expect(draft.name).toBe("review-api-responses");
    expect(draft.files.map((file) => file.path)).toEqual(["skills/review-api-responses/SKILL.md"]);
  });
});
