import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adviceCategories } from "../src/engine/advice-types";
import { advicePolicyFor, claudeAdvicePolicy, codexAdvicePolicy } from "../src/engine/advice-policy";

describe("provider advice policies", () => {
  test("cover the same recommendation jobs with provider-native routes", () => {
    expect(claudeAdvicePolicy.categories.map((item) => item.category)).toEqual([...adviceCategories]);
    expect(codexAdvicePolicy.categories.map((item) => item.category)).toEqual([...adviceCategories]);
    expect(claudeAdvicePolicy.routes.every((route) => route.vendors.includes("claude"))).toBe(true);
    expect(codexAdvicePolicy.routes.every((route) => route.vendors.includes("codex"))).toBe(true);
    expect(claudeAdvicePolicy.routes.map((route) => route.id)).toContain("skills:claude-local");
    expect(claudeAdvicePolicy.routes.map((route) => route.id)).not.toContain("skills:agents-shared");
    expect(codexAdvicePolicy.routes.map((route) => route.id)).toContain("skills:agents-shared");
    expect(codexAdvicePolicy.routes.map((route) => route.id)).not.toContain("skills:claude-local");
  });

  test("records exact provider artifact locations and presentation bounds", () => {
    expect(claudeAdvicePolicy.artifactLocations.map((item) => item.location)).toEqual(expect.arrayContaining([".claude/skills/<name>/SKILL.md", ".claude/agents/<name>.md", ".mcp.json"]));
    expect(codexAdvicePolicy.artifactLocations.map((item) => item.location)).toEqual(expect.arrayContaining([".agents/skills/<name>/SKILL.md", ".codex/agents/<name>.toml", ".codex/config.toml"]));
    expect(codexAdvicePolicy.categories.every((item) => item.defaultLimit === 2 && item.focusedLimit === 5)).toBe(true);
    expect(advicePolicyFor("claude")).toBe(claudeAdvicePolicy);
    expect(advicePolicyFor("codex")).toBe(codexAdvicePolicy);
  });

  test("matches the provider-parity fixture without cross-provider paths", async () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "advice", "provider-parity.json");
    const fixture = JSON.parse(await readFile(path, "utf8")) as { jobs: Array<{ category: string; claude: string; codex: string }> };
    for (const job of fixture.jobs) {
      expect(claudeAdvicePolicy.artifactLocations.find((item) => item.category === job.category)?.location).toBe(job.claude);
      expect(codexAdvicePolicy.artifactLocations.find((item) => item.category === job.category)?.location).toBe(job.codex);
    }
  });
});
