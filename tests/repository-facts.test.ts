import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectRepositoryFacts } from "../src/engine/repository-facts";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "advice",
  "typescript-drizzle",
);

describe("repository facts", () => {
  test("returns stable evidence-compatible facts with bounded coverage and provenance", async () => {
    const parent = await mkdtemp(join(tmpdir(), "farrier-facts-"));
    const root = join(parent, "project");
    await cp(fixtureRoot, root, { recursive: true });

    const first = await inspectRepositoryFacts(root);
    const second = await inspectRepositoryFacts(root);

    expect(second).toEqual(first);
    expect(first.facts).toContainEqual(expect.objectContaining({
      id: "project:dependency:drizzle-orm",
      kind: "dependency",
      path: "package.json",
      extractor: "package-json-v1",
      confidence: "exact",
      line: 14,
    }));
    expect(first.facts).toContainEqual(expect.objectContaining({
      id: "project:capability:orm:drizzle",
      kind: "capability",
      confidence: "inferred",
    }));
    expect(first.facts).toContainEqual(expect.objectContaining({
      id: "project:workflow:package-json:db-migrate",
      kind: "workflow",
      path: "package.json",
    }));
    expect(first.facts).toContainEqual(expect.objectContaining({
      id: "project:config:agents:agents-md",
      kind: "instruction",
      path: "AGENTS.md",
    }));
    expect(first.facts).toContainEqual(expect.objectContaining({
      id: "project:config:skills:agents-skills-db-review-skill-md",
      kind: "installed-skill",
      path: ".agents/skills/db-review/SKILL.md",
    }));
    expect(first.facts).toContainEqual(expect.objectContaining({
      id: "project:ci:github-workflows-ci-yml",
      kind: "workflow",
      path: ".github/workflows/ci.yml",
    }));
    expect(first.facts.every((fact) => /^[a-f0-9]{64}$/.test(fact.contentDigest))).toBe(true);
    expect(first.coverage.visitedPaths).toContain("package.json");
    expect(first.coverage.readErrors).toEqual([]);
    expect(first.coverage.truncatedPaths).toEqual([]);
    expect(first.coverage.skippedPaths).toContainEqual({
      path: "drizzle.config.ts",
      reason: "no-extractor",
    });
    expect(first.coverage.visitedPaths).not.toContain("drizzle.config.ts");
    expect(first.coverage.complete).toBe(false);
  });

  test("reports symlinks and oversized candidates instead of treating them as absent", async () => {
    const parent = await mkdtemp(join(tmpdir(), "farrier-facts-bounds-"));
    const root = join(parent, "project");
    const outside = join(parent, "outside");
    await mkdir(root);
    await writeFile(outside, JSON.stringify({ dependencies: { escaped: "1" } }), "utf8");
    await symlink(outside, join(root, "package.json"));
    await writeFile(join(root, "AGENTS.md"), "# Rules\n" + "x".repeat(320_001), "utf8");

    const result = await inspectRepositoryFacts(root);

    expect(result.facts.some((fact) => fact.summary.includes("escaped"))).toBe(false);
    expect(result.coverage.skippedPaths).toContainEqual({ path: "package.json", reason: "symlink" });
    expect(result.coverage.skippedPaths).toContainEqual({ path: "AGENTS.md", reason: "oversized" });
    expect(result.coverage.truncatedPaths).toEqual([{ path: "AGENTS.md", maxBytes: 320_000 }]);
    expect(result.coverage.complete).toBe(false);
  });

  test("records malformed extractor input within coverage without exposing content", async () => {
    const root = await mkdtemp(join(tmpdir(), "farrier-facts-malformed-"));
    await writeFile(join(root, "package.json"), "{secret-token", "utf8");

    const result = await inspectRepositoryFacts(root);

    expect(result.facts).toEqual([]);
    expect(result.coverage.skippedPaths).toEqual([{ path: "package.json", reason: "parse-error" }]);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
});
