import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";

test("repeated references to one missing artifact produce one finding with every citation", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-missing-path-deduplication-"));
  await writeFile(join(targetDir, "AGENTS.md"), [
    "Read `docs/policy.md` before changing guidance.",
    "Load `docs/policy.md` before reviewing a policy edit.",
    "`docs/policy.md` is required for every guidance change.", "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.recommendations).toHaveLength(1);
  expect(report.recommendations[0]?.layer).toBe("guidance");
  expect(report.recommendations[0]?.citations.map((item) => item.line)).toEqual([1, 2, 3]);
  expect(report.recommendations[0]?.counterchecks.map((item) => item.result))
    .toEqual(["missing", "all selected harness files read"]);
});

test("missing guidance and skill artifacts propose a concrete removal without speculative creation", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-missing-path-proposal-"));
  await mkdir(join(targetDir, ".agents/skills/release"), { recursive: true });
  await writeFile(join(targetDir, "AGENTS.md"), "Read `docs/policy.md` before changing guidance.\n");
  await writeFile(join(targetDir, ".agents/skills/release/SKILL.md"), [
    "---", "name: release", "description: Check releases.", "---", "Run `scripts/check.py` before release.", "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });
  const changes = new Map(report.recommendations.map((item) => [item.layer, item.proposal.change]));

  expect(changes.get("guidance")).toBe(
    "Delete every cited instruction that requires docs/policy.md from AGENTS.md. Reintroduce it only after the referenced artifact exists and has been reviewed.",
  );
  expect(changes.get("skill")).toBe(
    "Delete every cited instruction that requires .agents/skills/release/scripts/check.py from .agents/skills/release/SKILL.md. Reintroduce it only after the referenced artifact exists and has been reviewed.",
  );
  expect([...changes.values()].some((change) => /Correct or|Create that artifact/.test(change))).toBeFalse();
});

test("a missing conditional skill fallback removes only the unavailable option", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-missing-skill-fallback-"));
  const skillDir = join(targetDir, ".agents/skills/research");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), [
    "---", "name: research", "description: Research primary sources.", "---", "",
    "Extend via `references/source-urls.md` if primary sources are down.", "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.recommendations).toHaveLength(1);
  expect(report.recommendations[0]).toMatchObject({
    layer: "skill",
    severity: "medium",
    title: "Skill fallback references a missing resource",
    citations: [expect.objectContaining({
      path: ".agents/skills/research/SKILL.md",
      line: 6,
    })],
    proposal: { artifact: ".agents/skills/research/SKILL.md" },
  });
  expect(report.recommendations[0]!.proposal.change).toContain("Remove the unavailable");
  expect(report.recommendations[0]!.proposal.change).not.toMatch(/\b(?:add|create|restore)\b/i);
  expect(report.recommendations[0]!.counterchecks).toContainEqual(expect.objectContaining({
    result: "missing",
  }));
});
