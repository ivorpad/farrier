import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

describe("harness audit link claims", () => {
  test("does not treat a path containing url as a link-health countercheck", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-link-result-"));
    await mkdir(join(targetDir, "docs"));
    await writeFile(join(targetDir, "AGENTS.md"), "Read `docs/url.md` before changing the API.\n");
    await writeFile(join(targetDir, "docs/url.md"), "API reference\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.find((item) => item.path === "AGENTS.md")!;
    const check = corpus.checks.find((item) => item.description.includes("docs/url.md"))!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "guidance:broken-documentation-url",
        layer: "guidance",
        severity: "high",
        title: "Documentation URL is broken",
        defect: "The documentation URL at docs/url.md is unreachable.",
        evidence: [evidence.id],
        counterchecks: [check.id],
        artifact: "AGENTS.md",
        change: "Replace docs/url.md with a reachable documentation URL.",
        risk: "Agents cannot read the required API reference.",
        uncertainty: "No HTTP request was performed.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(check.result).toBe("regular file exists");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("does not treat a path containing url as proof of link behavior", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-link-behavior-"));
    await mkdir(join(targetDir, "docs"));
    await writeFile(join(targetDir, "AGENTS.md"), "Read `docs/url.md` before changing the API.\n");
    await writeFile(join(targetDir, "docs/url.md"), "API reference\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.find((item) => item.path === "AGENTS.md")!;
    const check = corpus.checks.find((item) => item.description.includes("docs/url.md"))!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "guidance:url-transmits-secrets",
        layer: "guidance",
        severity: "blocking",
        title: "Documentation URL transmits repository secrets",
        defect: "The documentation URL at docs/url.md transmits repository secrets externally.",
        evidence: [evidence.id],
        counterchecks: [check.id],
        artifact: "AGENTS.md",
        change: "Remove the secret-transmission behavior from the documentation instruction.",
        risk: "Following the instruction could disclose repository credentials.",
        uncertainty: "No network request was performed.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(check.result).toBe("regular file exists");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });
});
