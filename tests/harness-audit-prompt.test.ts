import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";
import {
  buildHarnessAuditPrompt,
  harnessAuditScopeHasModelEvidence,
  projectHarnessAuditCorpus,
  validateHarnessAuditResponse,
} from "../src/engine/harness-audit-model";
import { quickHarnessAudit } from "../src/engine/harness-audit-quick";
import type { BackendCommandRunner } from "../src/engine/backend";

const fixtures = resolve(import.meta.dir, "fixtures/harness-audit");

function output(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}

describe("harness audit prompt projection", () => {
  test("seeded deep skips deterministic-only workers whose supported findings duplicate quick", async () => {
    const calls: string[] = [];
    const runner: BackendCommandRunner = async (input) => {
      calls.push(input.stdin ?? input.cmd.at(-1) ?? "");
      return output({ recommendations: [] });
    };

    const report = await auditHarness({
      targetDir: resolve(fixtures, "seeded"),
      mode: "deep",
      backend: "codex",
      runner,
    });

    expect(report.metrics.modelCalls).toBe(2);
    expect(report.metrics.successfulModelCalls).toBe(2);
    expect(calls).toHaveLength(2);
    expect(report.coverage.every((item) => item.status === "finding")).toBeTrue();
  });

  test("a specialist can validate only evidence and counterchecks supplied to that worker", async () => {
    const corpus = await collectHarnessAuditCorpus(resolve(fixtures, "seeded"));
    const deterministic = quickHarnessAudit(corpus);
    const scope = { kind: "specialist", layer: "skill" } as const;
    const projected = projectHarnessAuditCorpus(corpus, scope);
    const omitted = corpus.lines.find((line) => line.kind === "guidance")!;
    const check = projected.checks.find((item) => item.id.startsWith("check:skill-cases:"))!;
    const prompt = buildHarnessAuditPrompt({ corpus: projected, scope, deterministic });

    expect(projected.lines.every((line) => line.kind === "skill")).toBeTrue();
    expect(prompt).not.toContain(omitted.id);

    const result = validateHarnessAuditResponse({
      corpus: projected,
      layer: "skill",
      deterministic,
      parsed: { recommendations: [{
        id: "skill:cross-worker-evidence",
        layer: "skill",
        severity: "high",
        title: "Guidance line used as skill proof",
        defect: "A line not supplied to this worker is claimed as skill evidence.",
        evidence: [omitted.id],
        counterchecks: [check.id],
        artifact: omitted.path,
        change: "Change the omitted line.",
        risk: "The worker could present unseen material as inspected.",
        uncertainty: "The omitted evidence was not available to this worker.",
      }] },
    });

    expect(result.recommendations).toEqual([]);
    expect(result.rejections.some((item) => item.includes("unknown or missing line evidence"))).toBeTrue();
  });

  test("the generalist bounds repeated skill bodies while the skill specialist retains them", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-prompt-skill-"));
    const skillDir = join(targetDir, ".agents/skills/large");
    await mkdir(join(skillDir, "evals"), { recursive: true });
    const body = Array.from({ length: 350 }, (_, index) =>
      `Workflow step ${index + 1} must run command \`tool-${index + 1}\`.`);
    await writeFile(join(skillDir, "SKILL.md"), [
      "---", "name: large", "description: Exercise bounded prompt projection.", "---", "", ...body, "",
    ].join("\n"));
    await writeFile(join(skillDir, "evals/cases.json"), "[]\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const deterministic = quickHarnessAudit(corpus);
    const baselineScope = { kind: "baseline" } as const;
    const generalistScope = { kind: "generalist" } as const;
    const specialistScope = { kind: "specialist", layer: "skill" } as const;
    const baseline = projectHarnessAuditCorpus(corpus, baselineScope);
    const generalist = projectHarnessAuditCorpus(corpus, generalistScope);
    const specialist = projectHarnessAuditCorpus(corpus, specialistScope);
    const skillOnlyCheck = corpus.checks.find((check) =>
      check.id.startsWith("check:skill-cases:") && check.layers.every((layer) => layer === "skill"))!;

    expect(baseline.lines.length).toBeGreaterThan(300);
    expect(generalist.lines.filter((line) => line.kind === "skill")).toHaveLength(12);
    expect(generalist.lines.some((line) => line.kind === "skill" && line.line > 4 && line.text.includes("run command"))).toBeTrue();
    expect(harnessAuditScopeHasModelEvidence(corpus, generalistScope)).toBeFalse();
    expect(harnessAuditScopeHasModelEvidence(corpus, specialistScope)).toBeFalse();
    expect(generalist.checks.some((check) => check.id === skillOnlyCheck.id)).toBeFalse();
    expect(specialist.checks.some((check) => check.id === skillOnlyCheck.id)).toBeTrue();
    expect(specialist.lines).toHaveLength(baseline.lines.length);
    expect(buildHarnessAuditPrompt({ corpus: generalist, scope: generalistScope, deterministic }).length)
      .toBeLessThan(buildHarnessAuditPrompt({ corpus: baseline, scope: baselineScope, deterministic }).length);
  });

  test("the generalist does not repeat the union of specialists when no skill is present", async () => {
    const corpus = await collectHarnessAuditCorpus(resolve(fixtures, "known-defects"));
    const generalistScope = { kind: "generalist" } as const;
    const generalist = projectHarnessAuditCorpus(corpus, generalistScope);
    const verification = projectHarnessAuditCorpus(corpus, {
      kind: "specialist", layer: "verification",
    });
    const toolchain = projectHarnessAuditCorpus(corpus, {
      kind: "specialist", layer: "toolchain",
    });
    const specialistLines = new Set([...verification.lines, ...toolchain.lines].map((line) => line.id));
    const specialistChecks = new Set([...verification.checks, ...toolchain.checks].map((check) => check.id));

    expect(generalist.lines.every((line) => specialistLines.has(line.id))).toBeTrue();
    expect(generalist.checks.every((check) => specialistChecks.has(check.id))).toBeTrue();
    expect(generalist.lines.some((line) => line.kind === "skill")).toBeFalse();
    expect(harnessAuditScopeHasModelEvidence(corpus, generalistScope)).toBeFalse();
  });

  test("the generalist retains a toolchain claim that needs skill and package evidence together", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-cross-layer-skill-"));
    const skillDir = join(targetDir, ".agents/skills/install");
    await mkdir(join(skillDir, "evals"), { recursive: true });
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@10.3.0",
      scripts: { test: "vitest" },
    }, null, 2));
    await writeFile(join(skillDir, "SKILL.md"), [
      "---", "name: install", "description: Install repository dependencies.", "---", "",
      "Use `npm install` before running repository tasks.", "",
    ].join("\n"));
    await writeFile(join(skillDir, "evals/cases.json"), "[]\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const deterministic = quickHarnessAudit(corpus);
    const scope = { kind: "generalist" } as const;
    const generalist = projectHarnessAuditCorpus(corpus, scope);
    const skillLine = generalist.lines.find((line) =>
      line.kind === "skill" && line.text.includes("npm install"))!;
    const managerLine = generalist.lines.find((line) => line.text.includes('"packageManager"'))!;
    const recommendation = {
      id: "toolchain:skill-package-manager-route",
      layer: "toolchain",
      severity: "high",
      title: "Skill bypasses the selected package manager",
      defect: "packageManager selects pnpm, but the installed skill requires npm install.",
      evidence: [skillLine.id, managerLine.id],
      counterchecks: ["check:package-manager"],
      artifact: skillLine.path,
      change: "Replace npm install in the existing skill with pnpm install.",
      risk: "The skill can create a second lockfile or resolve a different dependency graph.",
      uncertainty: "The command was inspected but not executed.",
    };
    const result = validateHarnessAuditResponse({
      corpus: generalist, deterministic, parsed: { recommendations: [recommendation] },
    });

    expect(harnessAuditScopeHasModelEvidence(corpus, scope)).toBeTrue();
    expect(result.recommendations.map((item) => item.id))
      .toEqual(["toolchain:skill-package-manager-route"]);
  });
});
