import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { planHarnessAudit } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus, referencedPathForLine } from "../src/engine/harness-audit-evidence";
import {
  harnessAuditScopeHasModelEvidence,
  projectHarnessAuditCorpus,
  validateHarnessAuditResponse,
} from "../src/engine/harness-audit-model";
import { quickHarnessAudit } from "../src/engine/harness-audit-quick";

const fixtures = resolve(import.meta.dir, "fixtures/harness-audit");

describe("deep harness audit scope selection", () => {
  test("selects only scopes with an unresolved supported claim opportunity", async () => {
    const scopeNames = ["guidance", "verification", "skill", "hook", "toolchain"] as const;
    const selected = async (fixture: string) => {
      const corpus = await collectHarnessAuditCorpus(resolve(fixtures, fixture));
      const specialist = scopeNames
        .filter((layer) => harnessAuditScopeHasModelEvidence(corpus, { kind: "specialist", layer }));
      return harnessAuditScopeHasModelEvidence(corpus, { kind: "generalist" })
        ? [...specialist, "generalist"]
        : specialist;
    };

    expect(await selected("known-defects")).toEqual([]);
    expect(await selected("clean")).toEqual([]);
    expect(await selected("seeded")).toEqual(["verification", "toolchain"]);
    expect(await selected("deep-opportunities"))
      .toEqual(["verification", "toolchain", "generalist"]);
  });

  test("missing-path outputs from guidance, skill, and hook specialists duplicate quick findings", async () => {
    const corpus = await collectHarnessAuditCorpus(resolve(fixtures, "seeded"));
    const deterministic = quickHarnessAudit(corpus);

    for (const layer of ["guidance", "skill", "hook"] as const) {
      const projected = projectHarnessAuditCorpus(corpus, { kind: "specialist", layer });
      const check = projected.checks.find((item) => item.id.startsWith("check:path:") && item.result === "missing")!;
      const path = check.description.match(/^Checked referenced path (.+)\.$/)![1]!;
      const line = projected.lines.find((item) => referencedPathForLine(item).includes(path))!;
      const result = validateHarnessAuditResponse({
        corpus: projected,
        layer,
        deterministic,
        parsed: { recommendations: [{
          id: `${layer}:missing-referenced-artifact`,
          layer,
          severity: "high",
          title: "Referenced artifact is missing",
          defect: `${line.path} requires ${path}, but the path is missing.`,
          evidence: [line.id],
          counterchecks: [check.id],
          artifact: line.path,
          change: `Remove or correct the stale ${path} reference.`,
          risk: "The configured procedure cannot run.",
          uncertainty: "The intended replacement path is unknown.",
        }] },
      });

      expect(result.recommendations).toEqual([]);
      expect(result.rejections).toEqual([expect.stringContaining("duplicates a deterministic finding")]);
    }
  });

  test("an existence check does not support a hook ordering claim", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-hook-support-"));
    await mkdir(join(targetDir, ".claude/hooks"), { recursive: true });
    await writeFile(join(targetDir, ".claude/settings.json"), JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: ".claude/hooks/guard.py" }] }] },
    }));
    await writeFile(join(targetDir, ".claude/hooks/guard.py"), "print('guard')\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const deterministic = quickHarnessAudit(corpus);
    const scope = { kind: "specialist", layer: "hook" } as const;
    const projected = projectHarnessAuditCorpus(corpus, scope);
    const line = projected.lines.find((item) => item.path === ".claude/settings.json"
      && item.text.includes("guard.py"))!;
    const check = projected.checks.find((item) => item.description.includes(".claude/hooks/guard.py"))!;
    expect(check.result).toBe("regular file exists");

    const result = validateHarnessAuditResponse({
      corpus: projected,
      layer: "hook",
      deterministic,
      parsed: { recommendations: [{
        id: "hook:wrong-event-order",
        layer: "hook",
        severity: "blocking",
        title: "PreToolUse runs after tool execution",
        defect: "The configured hook runs after the tool and cannot block it.",
        evidence: [line.id],
        counterchecks: [check.id],
        artifact: line.path,
        change: "Move the hook to the pre-execution event.",
        risk: "Commands could run before policy enforcement.",
        uncertainty: "Provider runtime behavior was not exercised.",
      }] },
    });

    expect(result.recommendations).toEqual([]);
    expect(result.rejections).toEqual([expect.stringContaining("counterchecks do not test the claim")]);
  });

  test("does not spend a verification call on a test policy from another package scope", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-deep-policy-scope-"));
    await mkdir(join(targetDir, "web"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      scripts: { test: "bun test" },
    }, null, 2));
    await writeFile(join(targetDir, "web/AGENTS.md"), "Do not run the test suite before completion.\n");
    await writeFile(join(targetDir, "web/package.json"), JSON.stringify({
      scripts: { lint: "eslint ." },
    }, null, 2));

    const plan = await planHarnessAudit({ targetDir, mode: "deep" });

    expect(plan.scopes.map((scope) => scope.scope)).not.toContain("verification");
    expect(plan.plannedModelCalls).toBe(0);
  });

  test("does not borrow another package's gate body for a completion target", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-deep-gate-scope-"));
    await mkdir(join(targetDir, "web"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      scripts: { check: "tsc --noEmit", test: "bun test" },
    }, null, 2));
    await writeFile(join(targetDir, "web/AGENTS.md"), "Run `pnpm run check` before completion.\n");
    await writeFile(join(targetDir, "web/package.json"), JSON.stringify({
      scripts: { check: "pnpm test", test: "vitest run" },
    }, null, 2));

    const plan = await planHarnessAudit({ targetDir, mode: "deep" });

    expect(plan.scopes.map((scope) => scope.scope)).not.toContain("verification");
    expect(plan.plannedModelCalls).toBe(0);
  });

  test("does not borrow a nested package manager for a root repository skill", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-deep-manager-scope-"));
    await mkdir(join(targetDir, "web"));
    await mkdir(join(targetDir, ".agents/skills/demo"), { recursive: true });
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@10.3.0",
    }, null, 2));
    await writeFile(join(targetDir, "web/AGENTS.md"), "Nested package instructions.\n");
    await writeFile(join(targetDir, "web/package.json"), JSON.stringify({
      packageManager: "npm@11.4.0",
    }, null, 2));
    await writeFile(join(targetDir, ".agents/skills/demo/SKILL.md"), [
      "---", "name: demo", "description: Run repository setup.", "---", "",
      "For repository setup, run `pnpm install`.", "",
    ].join("\n"));

    const plan = await planHarnessAudit({ targetDir, mode: "deep" });

    expect(plan.scopes.map((scope) => scope.scope)).not.toContain("generalist");
    expect(plan.plannedModelCalls).toBe(0);
  });
});
