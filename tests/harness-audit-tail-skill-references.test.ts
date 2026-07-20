import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

async function withSkill(lines: string[], run: (targetDir: string) => Promise<void>): Promise<void> {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-tail-skill-reference-"));
  try {
    const skillDir = join(targetDir, ".agents", "skills", "long-reference");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), lines.join("\n"));
    await run(targetDir);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

function skillBody(body: string[]): string[] {
  return [
    "---",
    "name: long-reference",
    "description: Use repository documentation when behavior is unclear.",
    "---",
    "# Long reference skill",
    ...body,
  ];
}

describe("tail skill references", () => {
  test("a conditional repository-doc reference at the end of a long skill remains auditable", async () => {
    await withSkill(skillBody([
      ...Array.from({ length: 405 }, (_, index) => `Workflow detail ${index + 1}.`),
      "## References",
      "See these docs in this repo when behavior is unclear:",
      "- `docs/orca-cli-focused-v1-status.md`",
      "- `docs/orca-cli-v1-spec.md`",
      "- `docs/orca-runtime-layer-design.md`",
      "",
    ]), async (targetDir) => {
      const corpus = await collectHarnessAuditCorpus(targetDir);
      const report = await auditHarness({ targetDir, mode: "quick", maxModelCalls: 0 });

      expect(corpus.skipped).toContainEqual({
        path: ".agents/skills/long-reference/SKILL.md",
        reason: "line-limit",
      });
      for (const path of [
        "docs/orca-cli-focused-v1-status.md",
        "docs/orca-cli-v1-spec.md",
        "docs/orca-runtime-layer-design.md",
      ]) {
        expect(corpus.checks).toContainEqual(expect.objectContaining({
          description: `Checked referenced path ${path}.`,
          result: "missing",
        }));
      }
      expect(report.metrics.modelCalls).toBe(0);
      expect(report.recommendations).toHaveLength(1);
      expect(report.recommendations[0]).toMatchObject({
        layer: "skill",
        severity: "medium",
        title: "Skill fallback references a missing resource",
        proposal: { artifact: ".agents/skills/long-reference/SKILL.md" },
        source: "deterministic",
      });
      expect(report.recommendations[0]!.citations).toEqual([
        expect.objectContaining({ line: 412, excerpt: "See these docs in this repo when behavior is unclear:" }),
        expect.objectContaining({ line: 413, excerpt: "- `docs/orca-cli-focused-v1-status.md`" }),
        expect.objectContaining({ line: 414, excerpt: "- `docs/orca-cli-v1-spec.md`" }),
        expect.objectContaining({ line: 415, excerpt: "- `docs/orca-runtime-layer-design.md`" }),
      ]);
      expect(report.recommendations[0]!.counterchecks).toEqual(expect.arrayContaining([
        expect.objectContaining({ result: "missing" }),
        expect.objectContaining({ result: "1 path or line limits recorded" }),
      ]));
      expect(report.recommendations[0]!.proposal.change).toContain("Remove the unavailable");
      expect(report.recommendations[0]!.proposal.change).toContain("docs/orca-cli-v1-spec.md");
      expect(report.recommendations[0]!.proposal.change).toContain("docs/orca-runtime-layer-design.md");
      expect(report.recommendations[0]!.uncertainty).toContain("primary sources");
    });
  });

  test("examples and availability-qualified references do not create findings", async () => {
    for (const context of [
      "For example, see these docs in this repo:",
      "See these docs in this repo if available:",
    ]) {
      await withSkill(skillBody([
        "## References",
        context,
        "- `docs/optional.md`",
        "",
      ]), async (targetDir) => {
        const report = await auditHarness({ targetDir, mode: "quick", maxModelCalls: 0 });
        expect(report.recommendations).toEqual([]);
      });
    }
  });
});
