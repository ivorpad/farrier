import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySkillPlacement,
  inspectSkillPlacement,
  placeSkillTrees,
  type StagedSkillCopy
} from "../src/engine/skill-placement";

async function fixture(manifest: string | null = '{"skills":[]}\n'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "farrier-placement-"));
  if (manifest !== null) await writeFile(join(root, ".farrier.json"), manifest);
  return root;
}

async function staged(root: string, author: "claude" | "codex", name: string, body: string = author): Promise<StagedSkillCopy> {
  const sourcePath = `staged/${author}/${name}`;
  await mkdir(join(root, sourcePath), { recursive: true });
  await writeFile(join(root, sourcePath, "SKILL.md"), body);
  return { author, name, sourcePath };
}

test("independent placement writes real native trees and deterministic manifest refs without a lock entry", async () => {
  const root = await fixture('{"skills":["vendor/pkg@one","./.agents/skills@old"]}\n');
  await writeFile(join(root, "skills-lock.json"), "lock stays byte exact\n");
  const codex = await staged(root, "codex", "codex-copy");
  const claude = await staged(root, "claude", "claude-copy");

  const result = await placeSkillTrees({ targetDir: root, copies: [codex, claude], layout: "native" });
  const manifest = JSON.parse(await readFile(join(root, ".farrier.json"), "utf8")) as { skills: string[] };

  expect(result.installed).toBe(true);
  expect(manifest.skills).toEqual([
    "vendor/pkg@one",
    "./.claude/skills@claude-copy",
    "./.agents/skills@codex-copy",
    "./.agents/skills@old"
  ]);
  expect(await readFile(join(root, ".claude/skills/claude-copy/SKILL.md"), "utf8")).toBe("claude");
  expect(await readFile(join(root, ".agents/skills/codex-copy/SKILL.md"), "utf8")).toBe("codex");
  expect(await readFile(join(root, "skills-lock.json"), "utf8")).toBe("lock stays byte exact\n");
});

test("shared placement creates the exact link and can proceed without a manifest", async () => {
  const root = await fixture(null);
  const copy = await staged(root, "claude", "shared-demo", "winner");
  const result = await placeSkillTrees({ targetDir: root, copies: [copy], layout: "shared" });

  expect(await readFile(join(root, ".agents/skills/shared-demo/SKILL.md"), "utf8")).toBe("winner");
  expect(await readlink(join(root, ".claude/skills/shared-demo"))).toBe("../../.agents/skills/shared-demo");
  expect(result.notes.join(" ")).toContain("not recorded because .farrier.json is missing");
});

test("a collision at either shared destination blocks all writes; force replaces both with backups", async () => {
  const root = await fixture();
  const copy = await staged(root, "codex", "shared-demo", "new");
  await mkdir(join(root, ".claude/skills/shared-demo"), { recursive: true });
  await writeFile(join(root, ".claude/skills/shared-demo/SKILL.md"), "old Claude tree");

  await expect(placeSkillTrees({ targetDir: root, copies: [copy], layout: "shared" })).rejects.toThrow(".claude/skills/shared-demo already exists");
  expect(await Bun.file(join(root, ".agents/skills/shared-demo/SKILL.md")).exists()).toBe(false);

  const replaced = await placeSkillTrees({ targetDir: root, copies: [copy], layout: "shared", force: true });
  expect(replaced.backupDir).toContain(".farrier-staging/backups/");
  expect(await readFile(join(root, ".agents/skills/shared-demo/SKILL.md"), "utf8")).toBe("new");
  expect(await readlink(join(root, ".claude/skills/shared-demo"))).toBe("../../.agents/skills/shared-demo");
});

test("invalid manifest data is preserved and reported", async () => {
  const root = await fixture("not json\n");
  const copy = await staged(root, "codex", "native-demo");
  const result = await placeSkillTrees({ targetDir: root, copies: [copy], layout: "native" });

  expect(await readFile(join(root, ".farrier.json"), "utf8")).toBe("not json\n");
  expect(result.notes.join(" ")).toContain("not recorded because .farrier.json is invalid");
});

test("a manifest race aborts placement and rolls the native tree back", async () => {
  const root = await fixture();
  const copy = await staged(root, "codex", "raced-demo");
  const reviewed = await inspectSkillPlacement({ targetDir: root, copies: [copy], layout: "native" });
  await writeFile(join(root, ".farrier.json"), '{"skills":["concurrent/ref@x"]}\n');

  await expect(applySkillPlacement(reviewed.plan, reviewed.inspection)).rejects.toThrow(".farrier.json changed after the mutation plan was inspected");
  expect(await Bun.file(join(root, ".agents/skills/raced-demo/SKILL.md")).exists()).toBe(false);
  expect(await readFile(join(root, ".farrier.json"), "utf8")).toContain("concurrent/ref@x");
});
