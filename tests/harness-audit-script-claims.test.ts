import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

describe("harness audit package-script claims", () => {
  test("accepts a runs-without-tests claim when the named gate lacks tests", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-gate-without-tests-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Before completion, run `bun run check`.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ scripts: {
      test: "bun test", check: "tsc --noEmit",
    } }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) => item.path === "AGENTS.md" || item.path === "package.json");
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "verification:check-runs-without-tests",
        layer: "verification",
        severity: "high",
        title: "Completion gate runs without tests",
        defect: "The check script leaves the test suite outside the completion gate.",
        evidence: evidence.map((item) => item.id),
        counterchecks: ["check:package-script-definitions"],
        artifact: "package.json",
        change: "Replace the check body with bun test followed by tsc --noEmit.",
        risk: "Agents can report completion without exercising the test suite.",
        uncertainty: "A separate external workflow was not inspected.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(corpus.checks.find((item) => item.id === "check:package-script-definitions")?.result)
      .toContain("check=tsc --noEmit");
    expect(report.recommendations.map((item) => item.id)).toContain("verification:check-runs-without-tests");
  });

  test("rejects a script omission when the cited manifest line does not show the script", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-gate-unrelated-citation-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ scripts: {
      test: "bun test", check: "tsc --noEmit",
    } }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const unrelated = corpus.lines.find((item) => item.path === "package.json" && item.line === 1)!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "verification:check-runs-without-tests",
        layer: "verification",
        severity: "high",
        title: "Completion gate runs without tests",
        defect: "The check script leaves the test suite outside the completion gate.",
        evidence: [unrelated.id],
        counterchecks: ["check:package-script-definitions"],
        artifact: "package.json",
        change: "Replace the check body with bun test followed by tsc --noEmit.",
        risk: "Agents can report completion without exercising the test suite.",
        uncertainty: "A separate external workflow was not inspected.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(unrelated.text).toBe("{");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("cited line does not show the named script")))
      .toBeTrue();
  });

  test("rejects a missing-target claim when the task inventory lists that target", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-existing-test-target-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ scripts: {
      check: "tsc --noEmit", test: "bun test",
    } }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) => item.path === "package.json");
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "verification:missing-test-target",
        layer: "verification",
        severity: "high",
        title: "Test target is missing",
        defect: "The repository does not define a test target for its completion harness.",
        evidence: evidence.map((item) => item.id),
        counterchecks: ["check:package-scripts"],
        artifact: "package.json",
        change: "Rename the existing test entry to restore the missing test target.",
        risk: "Agents can report completion without a runnable test target.",
        uncertainty: "External verification workflows were not inspected.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(corpus.checks.find((item) => item.id === "check:package-scripts")?.result).toBe("check, test");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("rejects a test omission routed to toolchain with only a manager check", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-gate-wrong-layer-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Before completion, run `pnpm check`.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@10.3.0",
      scripts: { check: "tsc --noEmit", test: "vitest" },
    }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) =>
      item.path === "AGENTS.md" || item.text.includes('"packageManager"'));
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "toolchain:completion-command-misses-tests",
        layer: "toolchain",
        severity: "high",
        title: "Completion command misses test execution",
        defect: "pnpm check does not run tests before completion.",
        evidence: evidence.map((item) => item.id),
        counterchecks: ["check:package-manager"],
        artifact: "AGENTS.md",
        change: "Change the completion command so pnpm check also runs tests.",
        risk: "Agents can report completion without exercising the test suite.",
        uncertainty: "The package scripts were not executed.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(corpus.checks.find((item) => item.id === "check:package-manager")?.result)
      .toBe("pnpm@10.3.0");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("verification gate was routed to toolchain")))
      .toBeTrue();
  });
});
