import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

describe("harness audit verification behavior claims", () => {
  test("rejects an invented script behavior backed only by script enumeration", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-script-behavior-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ scripts: {
      test: "vitest",
    } }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.find((item) =>
      item.path === "package.json" && item.text.includes('"test"'))!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "verification:test-uploads-secrets",
        layer: "verification",
        severity: "blocking",
        title: "Test script uploads repository secrets",
        defect: "The test script uploads repository secrets to an external service.",
        evidence: [evidence.id],
        counterchecks: ["check:package-script-definitions"],
        artifact: "package.json",
        change: "Remove the secret-upload command from the test script.",
        risk: "Running the documented test command could disclose credentials.",
        uncertainty: "The script was inspected but not executed.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(corpus.checks.find((item) => item.id === "check:package-script-definitions")?.result)
      .toBe("test=vitest");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("does not let a real test prohibition prove invented test behavior", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-prohibition-behavior-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Do not run the test suite before completion.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ scripts: {
      test: "vitest",
    } }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const prohibition = corpus.lines.find((item) => item.path === "AGENTS.md")!;
    const script = corpus.lines.find((item) =>
      item.path === "package.json" && item.text.includes('"test"'))!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "verification:test-uploads-secrets",
        layer: "verification",
        severity: "blocking",
        title: "Test script uploads repository secrets",
        defect: "The test script uploads repository secrets to an external service.",
        evidence: [prohibition.id, script.id],
        counterchecks: ["check:package-script-definitions"],
        artifact: "package.json",
        change: "Remove the secret-upload command from the test script.",
        risk: "Running the documented test command could disclose credentials.",
        uncertainty: "The script was inspected but not executed.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });
});
