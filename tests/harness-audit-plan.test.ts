import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { auditHarness, planHarnessAudit } from "../src/engine/harness-audit";
import { formatHarnessAuditPlan } from "../src/engine/harness-audit-format";
import type { BackendCommandRunner } from "../src/engine/backend";
import type { HarnessAuditMode } from "../src/engine/harness-audit-types";

const repoRoot = join(import.meta.dir, "..");
const fixtures = resolve(import.meta.dir, "fixtures/harness-audit");

function emptyModelResult() {
  return { exitCode: 0, stdout: JSON.stringify({ recommendations: [] }), stderr: "" };
}

async function runCli(args: string[]) {
  const child = Bun.spawn({
    cmd: [process.execPath, join(repoRoot, "src", "cli.ts"), ...args],
    cwd: repoRoot,
    env: { ...Bun.env, PATH: "/farrier-test-no-backends" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("harness audit cost plan", () => {
  test("help states the paid-call boundary and controlled comparison rule", async () => {
    const result = await runCli(["advise", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("same explicit backend and model");
    expect(result.stdout).toContain("deep (up to 3 evidence-gated calls)");
    expect(result.stdout).toContain("Provider overhead, output tokens, and retries are not capped");
    expect(result.stdout).toContain("Claude model calls fail closed");
    expect(result.stdout).toContain("--max-provider-cost-usd-per-call");
    expect(result.stdout).toContain("Report-only prevents writes, not provider calls");
  });

  test("reports adaptive scopes and prompt sizes without model calls", async () => {
    const quick = await planHarnessAudit({ targetDir: resolve(fixtures, "seeded"), mode: "quick" });
    const baseline = await planHarnessAudit({ targetDir: resolve(fixtures, "seeded"), mode: "baseline" });
    const seededDeep = await planHarnessAudit({ targetDir: resolve(fixtures, "seeded"), mode: "deep" });
    const cleanDeep = await planHarnessAudit({ targetDir: resolve(fixtures, "clean"), mode: "deep" });
    const knownDeep = await planHarnessAudit({ targetDir: resolve(fixtures, "known-defects"), mode: "deep" });

    expect(quick.plannedModelCalls).toBe(0);
    expect(quick.promptBytes).toBe(0);
    expect(quick.estimatedInputTokens).toBe(0);
    expect(quick.scopes).toEqual([]);
    expect(baseline.plannedModelCalls).toBe(1);
    expect(baseline.scopes.map((scope) => scope.scope)).toEqual(["baseline"]);
    expect(baseline.promptBytes).toBeGreaterThan(0);
    expect(seededDeep.plannedModelCalls).toBe(2);
    expect(seededDeep.scopes.map((scope) => scope.scope)).toEqual(["verification", "toolchain"]);
    expect(seededDeep.skippedScopes).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "guidance" }),
      expect.objectContaining({ scope: "skill" }),
      expect.objectContaining({ scope: "hook" }),
    ]));
    expect(cleanDeep.plannedModelCalls).toBe(0);
    expect(cleanDeep.scopes).toEqual([]);
    expect(cleanDeep.skippedScopes).toHaveLength(6);
    expect(cleanDeep.promptBytes).toBe(cleanDeep.scopes.reduce((sum, scope) => sum + scope.promptBytes, 0));
    expect(cleanDeep.estimatedInputTokens)
      .toBe(cleanDeep.scopes.reduce((sum, scope) => sum + scope.estimatedInputTokens, 0));
    expect(knownDeep.scopes).toEqual([]);
    expect(knownDeep.skippedScopes).toContainEqual(expect.objectContaining({
      scope: "generalist",
      reason: expect.stringContaining("specialists already receive every supplied non-skill line"),
    }));
    expect(formatHarnessAuditPlan(cleanDeep)).toContain("zero model calls made");
    expect(formatHarnessAuditPlan(cleanDeep)).toContain(`Corpus digest: ${cleanDeep.corpus.digest}`);
  });

  test("changes the corpus digest when selected harness content changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "farrier-audit-digest-"));
    try {
      await writeFile(join(root, "AGENTS.md"), "Run `just check` before stopping.\n");
      const before = await planHarnessAudit({ targetDir: root, mode: "quick" });
      await writeFile(join(root, "AGENTS.md"), "Run `just test` before stopping.\n");
      const after = await planHarnessAudit({ targetDir: root, mode: "quick" });

      expect(before.corpus.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(after.corpus.digest).not.toBe(before.corpus.digest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("plans the same number of model calls that execution selects", async () => {
    const cases: Array<{ mode: HarnessAuditMode; fixture: "seeded" | "clean" }> = [
      { mode: "quick", fixture: "seeded" },
      { mode: "baseline", fixture: "seeded" },
      { mode: "deep", fixture: "seeded" },
      { mode: "deep", fixture: "clean" },
    ];
    for (const item of cases) {
      let runnerCalls = 0;
      const executionPromptBytes: number[] = [];
      const runner: BackendCommandRunner = async (input) => {
        runnerCalls += 1;
        const prompt = input.stdin ?? input.cmd.at(-1) ?? "";
        executionPromptBytes.push(Buffer.byteLength(prompt, "utf8"));
        return emptyModelResult();
      };
      const targetDir = resolve(fixtures, item.fixture);
      const plan = await planHarnessAudit({ targetDir, mode: item.mode });
      const report = await auditHarness({
        targetDir,
        mode: item.mode,
        ...(item.mode === "quick" ? {} : { backend: "codex" as const }),
        runner,
      });

      expect(report.metrics.modelCalls).toBe(plan.plannedModelCalls);
      expect(report.corpus.digest).toBe(plan.corpus.digest);
      expect(report.corpus.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(runnerCalls).toBe(plan.plannedModelCalls);
      expect(executionPromptBytes.sort((left, right) => left - right))
        .toEqual(plan.scopes.map((scope) => scope.promptBytes).sort((left, right) => left - right));
    }
  });

  test("skips a baseline call when no artifact line can satisfy the citation contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "farrier-audit-empty-baseline-"));
    try {
      const plan = await planHarnessAudit({ targetDir: root, mode: "baseline" });
      expect(plan.plannedModelCalls).toBe(0);
      expect(plan.promptBytes).toBe(0);
      expect(plan.estimatedInputTokens).toBe(0);
      expect(plan.scopes).toEqual([]);
      expect(plan.skippedScopes).toEqual([expect.objectContaining({
        scope: "baseline",
        reason: expect.stringContaining("exact file-and-line citation"),
      })]);

      let runnerCalls = 0;
      const report = await auditHarness({
        targetDir: root,
        mode: "baseline",
        backend: "codex",
        maxModelCalls: 0,
        maxEstimatedInputTokens: 0,
        runner: async () => {
          runnerCalls += 1;
          return emptyModelResult();
        },
      });
      expect(runnerCalls).toBe(0);
      expect(report.metrics).toEqual(expect.objectContaining({
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        tokenAccounting: "none",
      }));
      expect(report.recommendations).toEqual([]);
      expect(report.coverage.every((item) => item.status === "not-run")).toBeTrue();
      expect(report.notes.some((note) => note.includes("exact file-and-line citation"))).toBeTrue();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("CLI plan bypasses an explicitly requested unavailable backend", async () => {
    const result = await runCli([
      "advise", "--dir", resolve(fixtures, "clean"), "--mode", "deep",
      "--plan", "--backend", "claude", "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const plan = JSON.parse(result.stdout);
    expect(plan.planOnly).toBe(true);
    expect(plan.plannedModelCalls).toBe(0);
    expect(plan.estimateNote).toContain("output tokens are not included");
  });

  test("budget guards reject before model use and allow exact plan limits", async () => {
    const targetDir = resolve(fixtures, "seeded");
    const deepPlan = await planHarnessAudit({ targetDir, mode: "deep" });
    const baselinePlan = await planHarnessAudit({ targetDir, mode: "baseline" });
    let runnerCalls = 0;
    const runner: BackendCommandRunner = async () => {
      runnerCalls += 1;
      return emptyModelResult();
    };

    await expect(auditHarness({
      targetDir,
      mode: "deep",
      backend: "codex",
      maxModelCalls: deepPlan.plannedModelCalls - 1,
      runner,
    })).rejects.toThrow("stopped before model use");
    await expect(auditHarness({
      targetDir,
      mode: "baseline",
      backend: "codex",
      maxEstimatedInputTokens: baselinePlan.estimatedInputTokens - 1,
      runner,
    })).rejects.toThrow("Provider overhead and output tokens are not included");
    expect(runnerCalls).toBe(0);

    const report = await auditHarness({
      targetDir,
      mode: "baseline",
      backend: "codex",
      maxModelCalls: baselinePlan.plannedModelCalls,
      maxEstimatedInputTokens: baselinePlan.estimatedInputTokens,
      runner,
    });
    expect(report.metrics.modelCalls).toBe(1);
    expect(runnerCalls).toBe(1);
    expect(report.executionBudget).toEqual({
      maxModelCalls: baselinePlan.plannedModelCalls,
      maxEstimatedInputTokens: baselinePlan.estimatedInputTokens,
    });
  });

  test("Claude audits fail closed without a native per-call spend ceiling", async () => {
    const targetDir = resolve(fixtures, "seeded");
    let runnerCalls = 0;
    const commands: string[][] = [];
    const runner: BackendCommandRunner = async (input) => {
      runnerCalls += 1;
      commands.push(input.cmd);
      return emptyModelResult();
    };

    await expect(auditHarness({
      targetDir,
      mode: "baseline",
      backend: "claude",
      runner,
    })).rejects.toThrow("require --max-provider-cost-usd-per-call");
    expect(runnerCalls).toBe(0);

    const report = await auditHarness({
      targetDir,
      mode: "baseline",
      backend: "claude",
      maxProviderCostUsdPerCall: 0.05,
      runner,
    });
    expect(runnerCalls).toBe(1);
    expect(commands[0]).toContain("--max-budget-usd");
    expect(commands[0]).toContain("0.05");
    expect(report.executionBudget?.maxProviderCostUsdPerCall).toBe(0.05);
  });

  test("CLI budget failure precedes unavailable backend discovery", async () => {
    const result = await runCli([
      "advise", "--dir", resolve(fixtures, "deep-opportunities"), "--mode", "deep",
      "--max-model-calls", "2", "--backend", "claude", "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("3 planned calls exceed the approved maximum of 2");
    expect(result.stderr).not.toContain("was not found on PATH");
  });

  test("CLI rejects plan without an audit mode before backend discovery", async () => {
    const result = await runCli(["advise", "--plan", "--backend", "claude"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--plan requires --mode quick, baseline, or deep");
    expect(result.stderr).not.toContain("was not found on PATH");
  });
});
