import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";
import type { BackendCommandRunner } from "../src/engine/backend";

test("a package script inventory cannot prove strict_xfail semantics", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-pytest-claim-"));
  await writeFile(join(targetDir, "pyproject.toml"), "[tool.pytest]\nstrict_xfail = true\n");
  await writeFile(join(targetDir, "package.json"), JSON.stringify({ scripts: { test: "pytest" } }));
  const corpus = await collectHarnessAuditCorpus(targetDir);
  const line = corpus.lines.find((item) => item.text.includes("strict_xfail"))!;
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stdout: JSON.stringify({ recommendations: [{
      id: "verification:strict-xfail-semantics",
      layer: "verification",
      severity: "high",
      title: "Pytest strict_xfail makes expected failures fail the test gate",
      defect: "strict_xfail = true causes ordinary expected failures to fail the test run.",
      evidence: [line.id],
      counterchecks: ["check:package-script-definitions"],
      artifact: "pyproject.toml",
      change: "Change strict_xfail to false.",
      risk: "The test gate can reject an expected failure.",
      uncertainty: "The audit did not execute pytest with this setting.",
    }] }),
    stderr: "",
  });

  const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

  expect(report.recommendations).toEqual([]);
  expect(report.notes.some((note) => note.includes("configuration claim"))).toBeTrue();
});
