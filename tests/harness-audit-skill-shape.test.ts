import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";

test("missing skill metadata proposes exact values from cited repository evidence", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-skill-shape-"));
  const skillDir = join(targetDir, ".agents/skills/release-helper");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), [
    "# Release helper", "", "Use this skill to prepare releases safely.", "", "Follow the release checklist.", "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });
  const finding = report.recommendations.find((item) => item.title === "Skill metadata is incomplete");

  expect(finding?.citations.map((item) => item.line)).toEqual([1, 3]);
  expect(finding?.counterchecks.map((item) => item.result)).toContain(
    "name=release-helper; description from .agents/skills/release-helper/SKILL.md:3",
  );
  expect(finding?.proposal.change).toBe([
    "Insert this exact YAML frontmatter before line 1:",
    "---",
    "name: release-helper",
    'description: "Use this skill to prepare releases safely."',
    "---",
  ].join("\n"));
});
