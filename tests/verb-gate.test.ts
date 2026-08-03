import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { resolvePack } from "../src/packs/index";
import { resolveVerbs } from "../src/engine/verbs";
import { pythonUvVerbs } from "../src/packs/python-uv";
import { validateRegistryItem } from "../src/registry/schema";
import { createRuntimeReport } from "../src/engine/doctor-runtime";

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

  // A pack published before verbs were gated declared a flat `check` that was
  // the authoritative gate, and it could hold stages beyond lint and test.
  // Recomposing the gate from the converted parts silently dropped them, which
  // would weaken a published pack's verification on upgrade.
  test("a legacy remote pack keeps every stage of its declared check", async () => {
    const item = validateRegistryItem(
      {
        schemaVersion: 1,
        type: "pack",
        name: "demo",
        version: "1.0.0",
        pack: {
          detect: { files: ["demo.toml"] },
          skills: [],
          hooks: [],
          verbs: {
            check: "tsc --noEmit && bun test && bun run build",
            checkFast: "tsc --noEmit",
            test: "bun test",
            fmt: "prettier -w ."
          }
        }
      } as never,
      { name: "demo", type: "pack", version: "1.0.0" } as never
    );

    expect(item.type).toBe("pack");
    if (item.type !== "pack") return;

    const resolved = await resolveVerbs(await dir(), item.pack.verbs!);

    expect(resolved.verbs.check).toBe("tsc --noEmit && bun test && bun run build");
    expect(resolved.verbs.checkFast).toBe("tsc --noEmit");
    expect(resolved.verbs.test).toBe("bun test");
  });
});

describe("gateless harness runtime expectations", () => {
  // The render path deliberately omits the justfile and the verb-runner
  // binding when nothing has evidence, so demanding `just` there reports an
  // unhealthy harness over a tool nothing generated uses.
  test("doctor does not require just when no gate was rendered", async () => {
    const root = await dir();
    await pyproject(root, '[project]\nname = "bare"\nversion = "0.1.0"\n');
    const plan = await createRenderPlan({ targetDir: root, pack: resolvePack("python-uv") });
    await writeRenderPlan(plan);

    const report = await createRuntimeReport({ targetDir: root, includeHookTests: false });

    expect(report.problems.some((problem) => problem.id === "executable:just")).toBe(false);
  }, 20_000);

});
