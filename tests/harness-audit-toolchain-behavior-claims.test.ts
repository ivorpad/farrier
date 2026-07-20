import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

describe("harness audit toolchain behavior claims", () => {
  test("rejects an invented dependency behavior backed only by lockfile presence", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-dependency-behavior-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ devDependencies: {
      vitest: "^3.0.0",
    } }, null, 2));
    await writeFile(join(targetDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.find((item) =>
      item.path === "package.json" && item.text.includes('"vitest"'))!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "toolchain:dependency-exfiltrates-secrets",
        layer: "toolchain",
        severity: "blocking",
        title: "Dependency exfiltrates repository secrets",
        defect: "The vitest dependency exfiltrates repository secrets during installation.",
        evidence: [evidence.id],
        counterchecks: ["check:lockfiles"],
        artifact: "package.json",
        change: "Disable vitest telemetry in package.json.",
        risk: "Installing dependencies could disclose repository credentials.",
        uncertainty: "Dependency installation was not executed.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(corpus.checks.find((item) => item.id === "check:lockfiles")?.result)
      .toBe("package-lock.json");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });
});
