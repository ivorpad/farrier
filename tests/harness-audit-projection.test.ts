import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";
import { projectHarnessAuditCorpus, validateHarnessAuditResponse } from "../src/engine/harness-audit-model";
import { quickHarnessAudit } from "../src/engine/harness-audit-quick";

describe("harness audit claim-oriented projection", () => {
  test("removes distant prose and deterministic-only hook evidence from deep prompts", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-projection-"));
    await mkdir(join(targetDir, ".claude"), { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), [
      ...Array.from({ length: 180 }, (_, index) => `Product naming note ${index + 1}.`),
      "Do not run the test suite before completion.",
    ].join("\n"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@latest",
      scripts: { test: "vitest run", check: "pnpm test && tsc --noEmit" },
    }, null, 2));
    await writeFile(join(targetDir, ".claude/settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(mkdir -p .claude/plans)"] },
    }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const verification = projectHarnessAuditCorpus(corpus, { kind: "specialist", layer: "verification" });
    const toolchain = projectHarnessAuditCorpus(corpus, { kind: "specialist", layer: "toolchain" });
    const generalist = projectHarnessAuditCorpus(corpus, { kind: "generalist" });

    expect(verification.lines.some((line) => line.text.includes("Do not run the test suite"))).toBeTrue();
    expect(toolchain.lines.some((line) => line.text.includes('"packageManager"'))).toBeTrue();
    expect(verification.lines.some((line) => line.text === "Product naming note 1.")).toBeFalse();
    expect(verification.lines.length).toBeLessThan(corpus.lines.length / 2);
    expect(generalist.lines.some((line) => line.kind === "hook")).toBeFalse();
    expect(generalist.checks.some((check) => check.id.startsWith("check:path:"))).toBeFalse();
  });

  test("retains evidence for supported verification and toolchain claims", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-projection-claims-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Do not run the test suite before completion.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@latest",
      scripts: { test: "vitest run" },
    }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const deterministic = quickHarnessAudit(corpus);
    const verification = projectHarnessAuditCorpus(corpus, { kind: "specialist", layer: "verification" });
    const prohibition = verification.lines.find((line) => line.text.includes("Do not run"))!;
    const scripts = verification.checks.find((check) => check.id === "check:package-scripts")!;
    const verificationRaw = {
      id: "verification:test-prohibition",
      layer: "verification",
      severity: "high",
      title: "Completion guidance prohibits the available test suite",
      defect: "The guidance prohibits tests although package.json defines a test task.",
      evidence: [prohibition.id],
      counterchecks: [scripts.id],
      artifact: prohibition.path,
      change: "Require the existing test task before completion.",
      risk: "Changes can be reported complete without tests.",
      uncertainty: "The test task was inspected but not executed.",
    };
    const verificationResult = validateHarnessAuditResponse({
      corpus: verification,
      layer: "verification",
      deterministic,
      parsed: { recommendations: [verificationRaw] },
    });
    const generalist = projectHarnessAuditCorpus(corpus, { kind: "generalist" });
    const generalistResult = validateHarnessAuditResponse({
      corpus: generalist,
      deterministic,
      parsed: { recommendations: [verificationRaw] },
    });

    const toolchain = projectHarnessAuditCorpus(corpus, { kind: "specialist", layer: "toolchain" });
    const managerLine = toolchain.lines.find((line) => line.text.includes('"packageManager"'))!;
    const managerCheck = toolchain.checks.find((check) => check.id === "check:package-manager")!;
    const toolchainResult = validateHarnessAuditResponse({
      corpus: toolchain,
      layer: "toolchain",
      deterministic,
      parsed: { recommendations: [{
        id: "toolchain:floating-package-manager",
        layer: "toolchain",
        severity: "high",
        title: "Package manager is unpinned",
        defect: "packageManager uses pnpm@latest rather than an exact version.",
        evidence: [managerLine.id],
        counterchecks: [managerCheck.id],
        artifact: managerLine.path,
        change: "Replace pnpm@latest with the intended exact pnpm version.",
        risk: "Machines can resolve different package-manager releases.",
        uncertainty: "The intended pnpm version is not supplied.",
      }] },
    });

    expect(verificationResult.recommendations.map((item) => item.id)).toEqual(["verification:test-prohibition"]);
    expect(generalistResult.recommendations.map((item) => item.id)).toEqual(["verification:test-prohibition"]);
    expect(toolchainResult.recommendations.map((item) => item.id)).toEqual(["toolchain:floating-package-manager"]);
  });
});
