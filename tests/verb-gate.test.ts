import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRenderPlan } from "../src/engine/render";
import { resolvePack } from "../src/packs/index";
import { resolveVerbs } from "../src/engine/verbs";
import { pythonUvVerbs } from "../src/packs/python-uv";

async function dir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-verbs-"));
}

async function pyproject(root: string, body: string): Promise<void> {
  await writeFile(join(root, "pyproject.toml"), body, "utf8");
}

describe("evidence-gated verbs", () => {
  // The bug this gate exists for: `uv init` produces neither ruff nor pytest,
  // so the generated Stop gate ran `uv run ruff check` and died with "Failed
  // to spawn: ruff" on every stop, forever.
  test("a bare uv project gets no gate rather than one that cannot pass", async () => {
    const root = await dir();
    await pyproject(root, '[project]\nname = "bare"\nversion = "0.1.0"\n');

    const resolved = await resolveVerbs(root, pythonUvVerbs);

    expect(resolved.verbs).toEqual({});
    expect(resolved.evaluated.every((verb) => !verb.matched)).toBe(true);

    const plan = await createRenderPlan({ targetDir: root, pack: resolvePack("python-uv") });
    expect(plan.files.some((file) => file.path === "justfile")).toBe(false);
    const manifest = JSON.parse(plan.files.find((file) => file.path === ".farrier.json")!.content);
    expect(manifest.hookIds).not.toContain("verb-runner");
  });

  test("ruff configured without being a dependency still counts", async () => {
    const root = await dir();
    await pyproject(root, '[project]\nname = "x"\nversion = "0.1.0"\n\n[tool.ruff]\nline-length = 100\n');

    const resolved = await resolveVerbs(root, pythonUvVerbs);

    expect(resolved.verbs.checkFast).toBe("uv run ruff check . --extend-exclude .farrier");
    expect(resolved.verbs.check).toBe("uv run ruff check . --extend-exclude .farrier");
    expect(resolved.verbs.test).toBeUndefined();
  });

  // pytest exits 5 on "no tests collected", so the dependency alone is not
  // evidence that there is a suite to run.
  test("pytest declared without any tests does not create a test gate", async () => {
    const root = await dir();
    await pyproject(root, '[project]\nname = "x"\nversion = "0.1.0"\n\n[dependency-groups]\ndev = ["pytest>=8"]\n');

    expect((await resolveVerbs(root, pythonUvVerbs)).verbs.test).toBeUndefined();

    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "tests", "test_x.py"), "def test_x():\n    assert True\n", "utf8");

    expect((await resolveVerbs(root, pythonUvVerbs)).verbs.test).toBe("uv run pytest");
  });

  test("the full check is composed from the parts that survive", async () => {
    const root = await dir();
    await pyproject(
      root,
      '[project]\nname = "x"\nversion = "0.1.0"\n\n[dependency-groups]\ndev = ["ruff>=0.1", "pytest>=8"]\n'
    );
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "tests", "test_x.py"), "def test_x():\n    assert True\n", "utf8");

    const resolved = await resolveVerbs(root, pythonUvVerbs);

    expect(resolved.verbs.check).toBe("uv run ruff check . --extend-exclude .farrier && uv run pytest");
    expect(resolved.verbs.checkFast).toBe("uv run ruff check . --extend-exclude .farrier");
  });
});
