import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

describe("harness audit package countercheck scope", () => {
  test("rejects a target inventory from a different package manifest", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-package-scope-"));
    await mkdir(join(targetDir, "web"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      scripts: { test: "bun test" },
    }, null, 2));
    await writeFile(join(targetDir, "web/AGENTS.md"), "Nested package instructions.\n");
    await writeFile(join(targetDir, "web/package.json"), JSON.stringify({
      scripts: { lint: "eslint ." },
    }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) =>
      item.path === "package.json" || item.path === "web/package.json");
    const nestedCheck = corpus.checks.find((item) =>
      item.id.startsWith("check:package-scripts:") && item.description.includes("web/package.json"))!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "verification:missing-root-test-target",
        layer: "verification",
        severity: "high",
        title: "`test` target is missing",
        defect: "The root package does not define a test target.",
        evidence: evidence.map((item) => item.id),
        counterchecks: [nestedCheck.id],
        artifact: "package.json",
        change: "Add a root test target that runs bun test.",
        risk: "Root changes can be reported complete without tests.",
        uncertainty: "Nested package targets were not compared.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(nestedCheck.result).toBe("lint");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("manifest scope"))).toBeTrue();
  });

  test("accepts a nested package-manager finding with matching scoped evidence", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-nested-manager-"));
    await mkdir(join(targetDir, "web"));
    await writeFile(join(targetDir, "AGENTS.md"), "Use pnpm for every workspace package command.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@10.3.0",
    }, null, 2));
    await writeFile(join(targetDir, "web/AGENTS.md"), "Nested package instructions.\n");
    await writeFile(join(targetDir, "web/package.json"), JSON.stringify({
      packageManager: "npm@11.4.0",
    }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) =>
      item.path === "AGENTS.md" || item.path === "web/package.json");
    const nestedCheck = corpus.checks.find((item) =>
      item.id.startsWith("check:package-manager:") && item.description.includes("web/package.json"))!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "toolchain:nested-manager-conflict",
        layer: "toolchain",
        severity: "high",
        title: "Nested packageManager selects npm",
        defect: "web/package.json packageManager selects npm despite the workspace pnpm policy.",
        evidence: evidence.map((item) => item.id),
        counterchecks: [nestedCheck.id],
        artifact: "web/package.json",
        change: "Replace packageManager with pnpm@10.3.0.",
        risk: "Nested installs can use a different lockfile protocol than workspace commands.",
        uncertainty: "The nested package may be intentionally isolated from the workspace.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(nestedCheck.result).toBe("npm@11.4.0");
    expect(report.recommendations.map((item) => item.id)).toContain("toolchain:nested-manager-conflict");
  });
});
