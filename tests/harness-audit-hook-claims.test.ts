import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";
import { missingArtifactClaimSupported } from "../src/engine/harness-audit-missing-claim";

function output(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}

describe("harness audit hook claims", () => {
  test("does not use one missing hook entry as proof that another hook is missing", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-hook-identity-"));
    await mkdir(join(targetDir, ".claude/hooks"), { recursive: true });
    await writeFile(join(targetDir, ".farrier.json"), JSON.stringify({
      agents: ["claude"],
      hookIds: ["secret-shield", "write-guard"],
    }, null, 2));
    await writeFile(join(targetDir, ".claude/settings.json"), JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [
          { type: "command", command: ".claude/hooks/secret-shield.py" },
          { type: "command", command: ".claude/hooks/write-guard.py" },
        ] }],
      },
    }, null, 2));
    await writeFile(join(targetDir, ".claude/hooks/secret-shield.py"), "print('shield')\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.find((line) =>
      line.path === ".claude/settings.json" && line.text.includes("secret-shield.py"))!;
    const mismatchedCheck = corpus.checks.find((check) =>
      check.id === "check:manifest-hook-entry:write-guard")!;
    const matchingEvidence = corpus.lines.find((line) =>
      line.path === ".claude/settings.json" && line.text.includes("write-guard.py"))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "hook:missing-secret-shield-entry",
      layer: "hook",
      severity: "blocking",
      title: "Secret-shield hook entry is missing",
      defect: "The configured secret-shield hook points to a missing entrypoint.",
      evidence: [evidence.id],
      counterchecks: [mismatchedCheck.id],
      artifact: ".claude/settings.json",
      change: "Correct the existing secret-shield command to point at its installed entrypoint.",
      risk: "Secret scanning would not run before tool use.",
      uncertainty: "The hook command was inspected but not executed.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(mismatchedCheck.result).toBe("missing");
    expect(report.recommendations.some((item) => item.id === "hook:missing-secret-shield-entry"))
      .toBeFalse();
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
    expect(missingArtifactClaimSupported({
      claim: "The configured write-guard hook points to a missing entrypoint.",
      checks: [mismatchedCheck],
      artifactLines: [matchingEvidence],
    })).toBeTrue();
  });

  test("does not move a missing-path result onto another cited artifact", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-missing-artifact-scope-"));
    await writeFile(join(targetDir, "AGENTS.md"),
      "The workflow refers to `scripts/missing.sh`.\n");
    await writeFile(join(targetDir, "CLAUDE.md"),
      "Review this guidance before completion.\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const pathEvidence = corpus.lines.find((line) => line.path === "AGENTS.md")!;
    const artifactEvidence = corpus.lines.find((line) => line.path === "CLAUDE.md")!;
    const check = corpus.checks.find((item) =>
      item.description === "Checked referenced path scripts/missing.sh.")!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "guidance:missing-workflow-script",
      layer: "guidance",
      severity: "high",
      title: "Workflow script is missing",
      defect: "The workflow points to the missing scripts/missing.sh artifact.",
      evidence: [pathEvidence.id, artifactEvidence.id],
      counterchecks: [check.id],
      artifact: "CLAUDE.md",
      change: "Correct the existing workflow text in CLAUDE.md.",
      risk: "Agents cannot follow the workflow.",
      uncertainty: "The intended script location is unknown.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations.some((item) => item.id === "guidance:missing-workflow-script"))
      .toBeFalse();
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });
});
