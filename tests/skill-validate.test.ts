import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  collapseDescription,
  maxSkillCaseCount,
  maxSkillCasesBytes,
  readSkillBehaviorEvidence,
  scaffoldSkillDraft,
  slugifySkillName
} from "../src/engine/skill-validate";

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
    expect(draft.files.map((file) => file.path)).toEqual(["skills/review-api-responses/SKILL.md", "skills/review-api-responses/evals/cases.json"]);
  });

  test("rejects duplicate ids and bounds cases.json bytes and count before parsing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farrier-cases-"));
    await mkdir(join(dir, "evals"));
    const positive = { id: "same", kind: "positive", prompt: "use", expectedBehavior: "use it" };
    const negative = { id: "same", kind: "negative", prompt: "skip", expectedBehavior: "skip it" };
    await writeFile(join(dir, "evals/cases.json"), JSON.stringify({ version: 1, cases: [positive, negative] }));
    expect(await readSkillBehaviorEvidence(dir)).toMatchObject({ availability: "unavailable", cases: [] });

    const many = Array.from({ length: maxSkillCaseCount + 1 }, (_, index) => ({
      id: `case-${index}`,
      kind: index === 0 ? "positive" : "negative",
      prompt: "prompt",
      expectedBehavior: "behavior"
    }));
    await writeFile(join(dir, "evals/cases.json"), JSON.stringify({ version: 1, cases: many }));
    expect(await readSkillBehaviorEvidence(dir)).toMatchObject({ availability: "unavailable" });

    await writeFile(join(dir, "evals/cases.json"), " ".repeat(maxSkillCasesBytes + 1));
    expect(await readSkillBehaviorEvidence(dir)).toMatchObject({ availability: "unavailable" });
  });
});
