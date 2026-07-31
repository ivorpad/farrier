import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Verbs are evidence-gated, so a fixture that expects a lint/test/format
 * recipe has to look like a repository that actually adopted those tools.
 * These helpers write the minimum evidence each gate looks for; a test that
 * wants the no-gate path simply does not call them.
 */

/** ruff + pytest declared, plus one test file so the test gate has a suite. */
export async function pythonToolingEvidence(dir: string): Promise<void> {
  await writeFile(
    join(dir, "pyproject.toml"),
    [
      "[project]",
      'name = "fixture"',
      'version = "0.1.0"',
      'dependencies = []',
      "",
      "[dependency-groups]",
      'dev = ["ruff>=0.1", "pytest>=8"]',
      "",
      "[tool.ruff]",
      "line-length = 100",
      "",
    ].join("\n"),
    "utf8"
  );
  await mkdir(join(dir, "tests"), { recursive: true });
  await writeFile(join(dir, "tests", "test_fixture.py"), "def test_ok():\n    assert True\n", "utf8");
}

/** tsconfig for the typecheck gate and prettier for the format verb. */
export async function typescriptToolingEvidence(dir: string): Promise<void> {
  await writeFile(join(dir, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { strict: true } }, null, 2)}\n`, "utf8");
  const packageJsonPath = join(dir, "package.json");
  await writeFile(
    packageJsonPath,
    `${JSON.stringify({ name: "fixture", devDependencies: { prettier: "^3" } }, null, 2)}\n`,
    "utf8"
  );
}

/** rubocop and rails in the Gemfile, which is what the rails verbs are gated on. */
export async function railsToolingEvidence(dir: string): Promise<void> {
  await writeFile(
    join(dir, "Gemfile"),
    ['source "https://rubygems.org"', 'gem "rails"', 'gem "rubocop"', ""].join("\n"),
    "utf8"
  );
}

export type ToolingKind = "python" | "ts" | "rails" | "all" | "none";

/** Seed only the family under test: extra toolchains change stack detection. */
export async function seedToolingEvidence(dir: string, kind: ToolingKind): Promise<void> {
  if (kind === "python" || kind === "all") await pythonToolingEvidence(dir);
  if (kind === "ts" || kind === "all") await typescriptToolingEvidence(dir);
  if (kind === "rails" || kind === "all") await railsToolingEvidence(dir);
}
