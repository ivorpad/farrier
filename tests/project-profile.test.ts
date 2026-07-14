import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
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
    expect(queries.map((item) => item.query)).toEqual(expect.arrayContaining(["typescript drizzle postgres", "drizzle migrations", "postgres schema review", "release deployment github actions"]));
    expect(queries.every((item) => item.evidence.every((id) => id.startsWith("project:capability:")))).toBe(true);
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
