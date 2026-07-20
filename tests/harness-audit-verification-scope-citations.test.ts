import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

function outputRecommendation(input: {
  evidence: string[];
  check: string;
  artifact: string;
}): BackendCommandRunner {
  return async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [{
      id: "verification:ci-scope-contradiction",
      layer: "verification",
      severity: "high",
      title: "CI workflow verification scope contradicts its exemption",
      defect: "CI workflow changes require verification but .github changes are exempted.",
      evidence: input.evidence,
      counterchecks: [input.check],
      artifact: input.artifact,
      change: "Remove CI workflow files from the .github exemption.",
      risk: "CI changes can bypass the verification procedure that explicitly covers them.",
      uncertainty: "The intended treatment of other .github files remains unspecified.",
    }] }),
  });
}

describe("harness audit verification-scope citations", () => {
  test("rejects a scope contradiction borrowed from another guidance document", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-scope-wrong-document-"));
    await mkdir(join(targetDir, "docs"));
    await writeFile(join(targetDir, "AGENTS.md"), [
      "Run it when you change:",
      "- CI workflows.",
      "",
      "You can skip it for repo-meta changes such as `.github/`.",
      "",
    ].join("\n"));
    await writeFile(join(targetDir, "docs/AGENTS.md"), "The platform team owns CI workflow changes.\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const unrelated = corpus.lines.find((line) => line.path === "docs/AGENTS.md")!;
    const check = corpus.checks.find((item) => item.id.startsWith("check:verification-scope:"))!;

    const report = await auditHarness({
      targetDir,
      mode: "baseline",
      backend: "codex",
      runner: outputRecommendation({ evidence: [unrelated.id], check: check.id, artifact: unrelated.path }),
    });

    expect(check.description).toContain("in AGENTS.md");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("verification-scope claim lacks exact policy evidence")))
      .toBeTrue();
  });

  test("rejects a scope contradiction supported by unrelated lines in the checked document", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-scope-wrong-lines-"));
    await writeFile(join(targetDir, "AGENTS.md"), [
      "The platform team owns CI workflow changes.",
      "",
      "Run it when you change:",
      "- CI workflows.",
      "",
      "You can skip it for repo-meta changes such as `.github/`.",
      "",
    ].join("\n"));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const unrelated = corpus.lines.find((line) => line.path === "AGENTS.md" && line.line === 1)!;
    const check = corpus.checks.find((item) => item.id.startsWith("check:verification-scope:"))!;

    const report = await auditHarness({
      targetDir,
      mode: "baseline",
      backend: "codex",
      runner: outputRecommendation({ evidence: [unrelated.id], check: check.id, artifact: unrelated.path }),
    });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("verification-scope claim lacks exact policy evidence")))
      .toBeTrue();
  });

  test("does not use a scope comparison as proof that a test task is skipped", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-scope-test-task-"));
    await writeFile(join(targetDir, "AGENTS.md"), [
      "Run it when you change:",
      "- CI workflows.",
      "",
      "You can skip it for repo-meta changes such as `.github/`.",
      "",
    ].join("\n"));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((line) =>
      line.path === "AGENTS.md" && /CI workflows|skip it/.test(line.text));
    const check = corpus.checks.find((item) => item.id.startsWith("check:verification-scope:"))!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ recommendations: [{
        id: "verification:ci-scope-skips-tests",
        layer: "verification",
        severity: "high",
        title: "CI workflow exemption skips tests",
        defect: "CI workflow changes under .github are exempted from the test suite.",
        evidence: evidence.map((line) => line.id),
        counterchecks: [check.id],
        artifact: "AGENTS.md",
        change: "Remove the .github exemption so the existing test suite runs for CI workflow changes.",
        risk: "CI changes could be reported complete without tests.",
        uncertainty: "No test task or script body was inspected.",
      }] }),
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });
});
