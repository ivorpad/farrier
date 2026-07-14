import { expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectTrackedSkillHealth } from "../src/engine/native-skill-health";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-native-health-"));
}

async function skill(root: string, path: string): Promise<void> {
  await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, path, "SKILL.md"), "healthy\n");
}

test("tracked native health accepts independent trees and the exact shared topology", async () => {
  const root = await fixture();
  await skill(root, ".agents/skills/shared");
  await skill(root, ".claude/skills/independent");
  await mkdir(join(root, ".claude/skills"), { recursive: true });
  await symlink("../../.agents/skills/shared", join(root, ".claude/skills/shared"));

  const report = await inspectTrackedSkillHealth(root, [
    "./.claude/skills@shared",
    "./.agents/skills@shared",
    "./.claude/skills@independent"
  ]);
  expect(report.native.map((item) => item.status)).toEqual([
    "healthy-shared-link",
    "healthy-tree",
    "healthy-tree"
  ]);
});

test("tracked native health reports broken, external, reverse, duplicate, and legacy refs without repairing", async () => {
  const root = await fixture();
  const external = await fixture();
  await skill(external, "outside");
  await mkdir(join(root, ".claude/skills"), { recursive: true });
  await mkdir(join(root, ".agents/skills"), { recursive: true });
  await symlink("../../.agents/skills/missing", join(root, ".claude/skills/broken"));
  await symlink(join(external, "outside"), join(root, ".claude/skills/external"));
  await skill(root, ".claude/skills/reverse");
  await symlink("../../../.claude/skills/reverse", join(root, ".agents/skills/reverse"));

  const refs = [
    "./.claude/skills@broken",
    "./.claude/skills@external",
    "./.agents/skills@reverse",
    "./.agents/skills@reverse",
    "./skills@legacy-copy"
  ];
  const report = await inspectTrackedSkillHealth(root, refs);
  expect(Object.fromEntries(report.native.map((item) => [item.name, item.status]))).toEqual({
    broken: "broken-link",
    external: "external-link",
    reverse: "reverse-link"
  });
  expect(report.duplicateRefs).toEqual(["./.agents/skills@reverse"]);
  expect(report.legacyRefs).toEqual(["./skills@legacy-copy"]);
});
