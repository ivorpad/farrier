import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planSkillRegistryQueries } from "../src/engine/advice-registry";
import { profileProject } from "../src/engine/project-profile";

describe("project profile", () => {
  test("captures TypeScript, PostgreSQL, Drizzle, migrations, workflows, CI, and installed automation", async () => {
    const parent = await mkdtemp(join(tmpdir(), "farrier-profile-drizzle-"));
    const root = join(parent, "project");
    await cp(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "advice", "typescript-drizzle"), root, { recursive: true });

    const profile = await profileProject(root);
    const queries = planSkillRegistryQueries(profile);

    expect(profile.packageManagers).toEqual(["pnpm"]);
    expect(profile.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(profile.dependencies?.map((item) => item.name)).toEqual(expect.arrayContaining(["typescript", "drizzle-orm", "drizzle-kit", "postgres", "vitest"]));
    expect(profile.workflows?.map((item) => `${item.kind}:${item.name}`)).toEqual(expect.arrayContaining(["test:test", "lint:lint", "typecheck:typecheck", "database:db:migrate", "deployment:deploy", "ci:CI"]));
    expect(profile.capabilities?.map((item) => item.name)).toEqual(expect.arrayContaining(["TypeScript", "PostgreSQL", "Drizzle", "Database migrations", "Automated tests", "CI workflows", "Release workflow", "Deployment workflow"]));
    expect(profile.automations).toContainEqual(expect.objectContaining({ category: "skills", path: ".agents/skills/db-review/SKILL.md" }));
    expect(profile.repositoryCoverage?.complete).toBe(false);
    expect(profile.repositoryCoverage?.skippedPaths).toEqual(expect.arrayContaining([
      { path: "drizzle.config.ts", reason: "no-extractor" },
      { path: "drizzle/0001.sql", reason: "no-extractor" },
    ]));
    expect(profile.repositoryFacts?.find((item) => item.id === "project:capability:orm:drizzle")).toEqual(expect.objectContaining({
      path: "package.json",
      extractor: "package-json-v1",
      confidence: "inferred",
      contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(profile.skillInventory?.entries).toContainEqual(expect.objectContaining({
      name: "db-review",
      topologies: ["codex-native"],
      provenance: "project",
    }));
    expect(profile.evidence.find((item) => item.id === "project:capability:orm:drizzle")).toEqual(expect.objectContaining({
      extractor: "package-json-v1",
      factConfidence: "inferred",
      contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(queries.map((item) => item.query)).toEqual(expect.arrayContaining(["typescript drizzle postgres", "drizzle migrations", "postgres schema review", "release deployment github actions"]));
    expect(queries.every((item) => item.evidence.every((id) => id.startsWith("project:capability:")))).toBe(true);
  });

  test("does not profile symlinked manifests, workflows, or agent configuration", async () => {
    const parent = await mkdtemp(join(tmpdir(), "farrier-profile-links-"));
    const root = join(parent, "project");
    const outside = join(parent, "outside");
    const selectedRoot = join(parent, "selected-project");
    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "package.json"), JSON.stringify({
      dependencies: { "outside-dependency": "1.0.0", next: "15.0.0" },
    }));
    await writeFile(join(outside, "ci.yml"), "name: Outside workflow\non:\n  push:\n");
    await writeFile(join(outside, "AGENTS.md"), "# Outside instructions\n");
    await symlink(join(outside, "package.json"), join(root, "package.json"));
    await symlink(join(outside, "ci.yml"), join(root, ".github", "workflows", "ci.yml"));
    await symlink(join(outside, "AGENTS.md"), join(root, "AGENTS.md"));
    await symlink(root, selectedRoot);

    const profile = await profileProject(selectedRoot);

    expect(profile.targetDir).toBe(await realpath(root));
    expect(profile.stacks).toEqual([]);
    expect(profile.dependencies).toEqual([]);
    expect(profile.ci).toEqual([]);
    expect(profile.configuration.agents).toEqual([]);
    expect(profile.evidence.some((item) => item.summary.includes("outside-dependency"))).toBe(false);
  });

  test("parses pyproject and Gemfile dependency names without executing project code", async () => {
    const root = await mkdtemp(join(tmpdir(), "farrier-profile-manifests-"));
    await writeFile(join(root, "pyproject.toml"), "[project]\ndependencies = [\"fastapi>=0.100\", \"psycopg[binary]>=3\"]\n[tool.uv]\n", "utf8");
    await writeFile(join(root, "Gemfile"), "gem \"rails\"\ngem 'pg'\n", "utf8");
    const profile = await profileProject(root);
    expect(profile.dependencies?.map((item) => item.name)).toEqual(expect.arrayContaining(["fastapi", "psycopg", "rails", "pg"]));
    expect(profile.packageManagers).toEqual(expect.arrayContaining(["uv", "bundler"]));
  });
});
