import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

describe("harness audit module specifiers", () => {
  test("does not check bare dependency imports as repository paths", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-module-specifier-"));
    const skillDir = join(targetDir, ".agents/skills/demo");
    await mkdir(join(targetDir, ".agents/skills/lib"), { recursive: true });
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(targetDir, ".agents/skills/lib/local.ts"), "export const local = true;\n");
    await writeFile(join(skillDir, "SKILL.md"), [
      "---", "name: demo", "description: Show import routing.", "---", "",
      'import { always } from "eve/tools/approval";',
      "Use `once()` from `eve/tools/approval` for one approval.",
      "Import `katex/dist/katex.min.css` at the app root.",
      'import { local } from "../lib/local.ts";',
      "",
    ].join("\n"));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const line = corpus.lines.find((item) => item.text.includes("eve/tools/approval"))!;
    const bareCheck = corpus.checks.find((item) =>
      item.description.endsWith("eve/tools/approval."));
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ recommendations: [{
        id: "skill:missing-approval-module",
        layer: "skill",
        severity: "high",
        title: "Approval module is missing",
        defect: "eve/tools/approval is a missing repository artifact required by the skill.",
        evidence: [line.id],
        counterchecks: [bareCheck?.id ?? "check:audit-coverage"],
        artifact: ".agents/skills/demo/SKILL.md",
        change: "Replace the stale eve/tools/approval import.",
        risk: "The documented skill example cannot run.",
        uncertainty: "The module could be provided by an installed dependency.",
      }] }),
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(bareCheck).toBeUndefined();
    expect(corpus.checks.some((item) => item.description.includes("katex/dist/katex.min.css"))).toBeFalse();
    expect(corpus.checks).toContainEqual(expect.objectContaining({
      description: "Checked referenced path .agents/skills/lib/local.ts.",
      result: "regular file exists",
    }));
  });
});
