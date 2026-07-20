import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";
import { packageManagerArtifactSupported, packageManagerPolicySupported } from "../src/engine/harness-audit-package-manager-claim";

describe("harness audit package-manager claims", () => {
  test("binds explicit identity, absence, and pinning claims to the declaration", () => {
    expect(packageManagerPolicySupported("packageManager selects npm", "pnpm@10.3.0")).toBeFalse();
    expect(packageManagerPolicySupported("`packageManager` selects npm", "pnpm@10.3.0")).toBeFalse();
    expect(packageManagerPolicySupported("packageManager selects pnpm", "pnpm@10.3.0")).toBeTrue();
    expect(packageManagerPolicySupported("packageManager is unpinned", "pnpm@10.3.0")).toBeFalse();
    expect(packageManagerPolicySupported("packageManager is not declared", "not declared")).toBeTrue();
    expect(packageManagerArtifactSupported({
      claim: "packageManager selects pnpm, but AGENTS.md routes installs through npm.",
      artifact: "AGENTS.md",
      declarationPath: "package.json",
    })).toBeTrue();
    expect(packageManagerArtifactSupported({
      claim: "packageManager is floating at pnpm@latest.",
      artifact: "AGENTS.md",
      declarationPath: "package.json",
    })).toBeFalse();
  });

  test("rejects an explicit manager identity contradicted by packageManager", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-manager-identity-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@10.3.0",
      scripts: { test: "vitest" },
    }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) => item.path === "package.json");
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "toolchain:wrong-package-manager-identity",
        layer: "toolchain",
        severity: "high",
        title: "`packageManager` selects npm",
        defect: "The `packageManager` field selects npm for repository commands.",
        evidence: evidence.map((item) => item.id),
        counterchecks: ["check:package-manager"],
        artifact: "package.json",
        change: "Replace the npm declaration with pnpm@10.3.0.",
        risk: "Installs can use a package manager that does not match the repository lockfile.",
        uncertainty: "Developer shell aliases were not inspected.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(corpus.checks.find((item) => item.id === "check:package-manager")?.result).toBe("pnpm@10.3.0");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("rejects a manager-routing claim when the manifest citation omits the declaration", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-manager-unrelated-citation-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Run `npm install` before repository tasks.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@10.3.0",
    }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const guidance = corpus.lines.find((item) => item.path === "AGENTS.md")!;
    const unrelated = corpus.lines.find((item) => item.path === "package.json" && item.line === 1)!;
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "toolchain:guidance-bypasses-package-manager",
        layer: "toolchain",
        severity: "high",
        title: "Guidance bypasses the selected package manager",
        defect: "The packageManager field selects pnpm, but AGENTS.md requires npm install.",
        evidence: [guidance.id, unrelated.id],
        counterchecks: ["check:package-manager"],
        artifact: "AGENTS.md",
        change: "Replace npm install with pnpm install in the repository task instructions.",
        risk: "Agents can create dependency state with the wrong package manager.",
        uncertainty: "Developer-local package-manager shims were not inspected.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(unrelated.text).toBe("{");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("package-manager claim lacks exact declaration evidence")))
      .toBeTrue();
  });

  test("rejects a package-manager field change aimed at a different cited artifact", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-manager-artifact-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Use pnpm for repository commands.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@latest",
    }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) => item.path === "AGENTS.md" || item.path === "package.json");
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ recommendations: [{
        id: "toolchain:floating-manager-wrong-artifact",
        layer: "toolchain",
        severity: "high",
        title: "packageManager is unpinned",
        defect: "The packageManager field floats at pnpm@latest instead of an exact version.",
        evidence: evidence.map((item) => item.id),
        counterchecks: ["check:package-manager"],
        artifact: "AGENTS.md",
        change: "Replace pnpm@latest with the exact pnpm version used by the repository.",
        risk: "Agent installs can resolve different package-manager releases.",
        uncertainty: "The intended exact pnpm version was not inferred.",
      }] }),
      stderr: "",
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("package-manager change does not target its declaration")))
      .toBeTrue();
  });

});
