import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";
import { validateHarnessAuditResponse } from "../src/engine/harness-audit-model";
import { quickHarnessAudit } from "../src/engine/harness-audit-quick";

const fixtures = resolve(import.meta.dir, "fixtures/harness-audit");

describe("harness audit speculative creation", () => {
  test("rejects lockfile creation when absence is the only policy evidence", async () => {
    const corpus = await collectHarnessAuditCorpus(resolve(fixtures, "clean"));
    const deterministic = quickHarnessAudit(corpus);
    const packageManager = corpus.lines.find((line) => line.text.includes("packageManager"))!;

    const result = validateHarnessAuditResponse({
      corpus,
      layer: "toolchain",
      deterministic,
      parsed: { recommendations: [{
        id: "toolchain:add-lockfile",
        layer: "toolchain",
        severity: "high",
        title: "Package installs are not reproducible",
        defect: "The repository has no lockfile despite declaring Bun.",
        evidence: [packageManager.id],
        counterchecks: ["check:lockfiles", "check:package-manager"],
        artifact: "package.json",
        change: "Generate and commit bun.lock.",
        risk: "Install resolution can change between runs.",
        uncertainty: "The repository may intentionally omit generated lockfiles.",
      }] },
    });

    expect(result.recommendations).toEqual([]);
    expect(result.rejections).toEqual([
      expect.stringContaining("speculative absence cannot justify creating or declaring an artifact"),
    ]);
  });

  test("does not infer version-control state from physical lockfile presence", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-lockfile-tracking-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      name: "tracking-check",
      scripts: { test: "vitest run" },
    }, null, 2));
    await writeFile(join(targetDir, "package-lock.json"), "{}\n");
    await writeFile(join(targetDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.find((line) => line.path === "package.json")!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ recommendations: [{
        id: "toolchain:competing-lockfiles",
        layer: "toolchain",
        severity: "high",
        title: "Competing lockfiles are committed",
        defect: "Both discovered lockfiles are committed, so install commands can resolve different versions.",
        evidence: [evidence.id],
        counterchecks: ["check:lockfiles"],
        artifact: "package.json",
        change: "Remove the unintended second lockfile.",
        risk: "Install results can differ between environments.",
        uncertainty: "The intended lockfile is not identified by supplied evidence.",
      }] }),
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(corpus.checks.find((check) => check.id === "check:lockfiles")?.result)
      .toBe("package-lock.json, pnpm-lock.yaml");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("version-control state"))).toBeTrue();
  });

  test("does not aim a lockfile removal at an unrelated cited artifact", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-lockfile-artifact-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ name: "artifact-check" }, null, 2));
    await writeFile(join(targetDir, "package-lock.json"), "{}\n");
    await writeFile(join(targetDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.find((line) => line.path === "package.json")!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ recommendations: [{
        id: "toolchain:competing-lockfiles",
        layer: "toolchain",
        severity: "high",
        title: "Competing lockfiles are present",
        defect: "The working tree contains two lockfiles, so install commands can resolve different versions.",
        evidence: [evidence.id],
        counterchecks: ["check:lockfiles"],
        artifact: "package.json",
        change: "Remove the unintended second lockfile.",
        risk: "Install results can differ between environments.",
        uncertainty: "The intended lockfile is not identified by supplied evidence.",
      }] }),
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("does not cite the affected lockfile artifact"))).toBeTrue();
  });
});
