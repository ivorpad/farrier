import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

describe("harness audit mypy citations", () => {
  test("rejects a stale selector claim when the cited config line omits the selector", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-mypy-unrelated-citation-"));
    await mkdir(join(targetDir, "scripts"), { recursive: true });
    await mkdir(join(targetDir, "fastapi"));
    await writeFile(join(targetDir, "pyproject.toml"), [
      "[tool.mypy]", "strict = true", "", "[[tool.mypy.overrides]]",
      'module = "fastapi.tests.*"', "ignore_missing_imports = true", "",
    ].join("\n"));
    await writeFile(join(targetDir, "scripts/lint.sh"), "#!/bin/sh\nmypy fastapi\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const unrelated = corpus.lines.find((item) => item.path === "pyproject.toml" && item.line === 1)!;
    const check = corpus.checks.find((item) => item.id.startsWith("check:mypy-override:"))!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ recommendations: [{
        id: "verification:stale-mypy-selector",
        layer: "verification",
        severity: "high",
        title: "Stale override selector",
        defect: "The fastapi.tests override targets a missing module path.",
        evidence: [unrelated.id],
        counterchecks: [check.id],
        artifact: "pyproject.toml",
        change: "Remove the stale fastapi.tests override.",
        risk: "The intended exception is not applied.",
        uncertainty: "Generated modules outside the repository were not inspected.",
      }] }),
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(unrelated.text).toBe("[tool.mypy]");
    expect(check.result).toContain("module target fastapi/tests: missing");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("mypy claim lacks exact selector evidence")))
      .toBeTrue();
  });

  test("rejects a claim about a different selector than the one counterchecked", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-mypy-wrong-selector-"));
    await mkdir(join(targetDir, "scripts"), { recursive: true });
    await mkdir(join(targetDir, "fastapi"));
    await mkdir(join(targetDir, "docs_src"));
    await writeFile(join(targetDir, "pyproject.toml"), [
      "[tool.mypy]", "strict = true", "", "[[tool.mypy.overrides]]",
      'module = "fastapi.tests.*"', "ignore_missing_imports = true", "",
      "[[tool.mypy.overrides]]", 'module = "docs_src.*"', "disallow_untyped_defs = false", "",
    ].join("\n"));
    await writeFile(join(targetDir, "scripts/lint.sh"), "#!/bin/sh\nmypy fastapi\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const selectors = corpus.lines.filter((item) => item.path === "pyproject.toml"
      && item.text.startsWith("module ="));
    const wrongCheck = corpus.checks.find((item) => item.description.includes("fastapi.tests.*"))!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ recommendations: [{
        id: "verification:stale-docs-selector",
        layer: "verification",
        severity: "high",
        title: "Stale mypy docs_src override selector",
        defect: "The docs_src override targets a missing module path.",
        evidence: selectors.map((line) => line.id),
        counterchecks: [wrongCheck.id],
        artifact: "pyproject.toml",
        change: "Remove the stale docs_src override.",
        risk: "The intended exception is not applied.",
        uncertainty: "Generated modules outside the repository were not inspected.",
      }] }),
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(wrongCheck.result).toContain("module target fastapi/tests: missing");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("mypy claim does not name the checked selector")))
      .toBeTrue();
  });
});
