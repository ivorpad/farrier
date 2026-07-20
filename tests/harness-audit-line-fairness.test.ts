import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

function filledGuidance(label: string): string {
  return Array.from({ length: 400 }, (_, index) => `${label} rule ${index + 1}`).join("\n");
}

function filledSkill(name: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: Exercise ${name} workflows.`,
    "---",
    ...Array.from({ length: 395 }, (_, index) => `${name} workflow detail ${index + 1}`),
    "Read `references/required.md` before completion.",
  ].join("\n");
}

test("the global line budget represents every selected skill and reports truncation", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-line-fairness-"));
  await writeFile(join(targetDir, "AGENTS.md"), filledGuidance("agent"));
  await writeFile(join(targetDir, "CLAUDE.md"), filledGuidance("claude"));

  const skillNames = ["alpha", "bravo", "charlie", "delta", "echo"];
  for (const name of skillNames) {
    const skillDir = join(targetDir, ".agents/skills", name);
    await mkdir(join(skillDir, "references"), { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), filledSkill(name));
    await writeFile(join(skillDir, "references/required.md"), `# ${name}\n`);
  }

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(corpus.lines).toHaveLength(1_200);
  for (const name of skillNames) {
    const path = `.agents/skills/${name}/SKILL.md`;
    expect(corpus.lines.some((line) => line.path === path)).toBeTrue();
    expect(corpus.checks).toContainEqual(expect.objectContaining({
      description: `Checked referenced path .agents/skills/${name}/references/required.md.`,
      result: "regular file exists",
    }));
    expect(corpus.skipped).toContainEqual({ path, reason: "line-limit" });
  }
  expect(corpus.checks.find((check) => check.id === "check:audit-coverage")?.result)
    .not.toBe("all selected harness files read");
  expect(report.recommendations).toEqual([]);
  expect(report.metrics.modelCalls).toBe(0);
});
