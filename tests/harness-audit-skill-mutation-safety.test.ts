import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";

async function withSkill(text: string, run: (targetDir: string) => Promise<void>): Promise<void> {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-skill-mutation-"));
  try {
    const skillDir = join(targetDir, ".agents", "skills", "experiment");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), text);
    await run(targetDir);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

describe("skill mutation safety", () => {
  test("reports an imperative whole-worktree restore without isolation or a dirty-tree guard", async () => {
    await withSkill([
      "---",
      "name: experiment",
      "description: Run repeated experiments and retain improvements.",
      "---",
      "# Experiment",
      "Create a branch before starting.",
      "For a failed run, use `git checkout -- .` to discard it.",
    ].join("\n"), async (targetDir) => {
      const report = await auditHarness({ targetDir, mode: "quick", maxModelCalls: 0 });

      expect(report.metrics.modelCalls).toBe(0);
      expect(report.recommendations).toHaveLength(1);
      expect(report.recommendations[0]).toMatchObject({
        layer: "skill",
        severity: "blocking",
        proposal: { artifact: ".agents/skills/experiment/SKILL.md" },
        source: "deterministic",
      });
      expect(report.recommendations[0]!.citations).toEqual([
        expect.objectContaining({ path: ".agents/skills/experiment/SKILL.md", line: 7 }),
      ]);
      expect(report.recommendations[0]!.counterchecks).toEqual(expect.arrayContaining([
        expect.objectContaining({ result: "git checkout -- . restores the entire worktree" }),
        expect.objectContaining({ result: "no dedicated-worktree requirement found" }),
        expect.objectContaining({ result: "no pre-existing dirty-tree abort found" }),
      ]));
      expect(report.recommendations[0]!.proposal.change).toContain("never restore the whole user checkout");
      expect(report.recommendations[0]!.risk).toContain("pre-existing tracked changes");
      expect(report.recommendations[0]!.uncertainty).toContain("runtime");
    });
  });

  test("stays silent for prohibition, isolation, and dirty-tree controls", async () => {
    for (const body of [
      "Never run `git checkout -- .`; restore only experiment-owned paths.",
      "The command `git checkout -- .` is dangerous because it restores tracked files.",
      "Create and enter a dedicated git worktree before experiments. For a failed run, use `git checkout -- .` inside that worktree.",
      "Before experiments, run `git status --porcelain` and abort if pre-existing changes make the tree dirty. For a failed run, use `git checkout -- .`.",
    ]) {
      await withSkill([
        "---",
        "name: experiment",
        "description: Run repeated experiments safely.",
        "---",
        "# Experiment",
        body,
      ].join("\n"), async (targetDir) => {
        const report = await auditHarness({ targetDir, mode: "quick", maxModelCalls: 0 });
        expect(report.recommendations).toEqual([]);
      });
    }
  });
});
