import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyMutationPlan,
  inspectMutationPlan,
  MutationApplyError,
  type MutationOperation
} from "../src/engine/mutation-transaction";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-mutation-"));
}

async function tree(root: string, path: string, body: string): Promise<void> {
  await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, path, "SKILL.md"), body);
}

function sharedOperations(sourcePath = "staged/demo"): MutationOperation[] {
  return [
    { type: "replace-tree", path: ".agents/skills/demo", sourcePath },
    { type: "link", path: ".claude/skills/demo", target: "../../.agents/skills/demo" }
  ];
}

test("a link can target an earlier reviewed tree in the same transaction", async () => {
  const root = await fixture();
  await tree(root, "staged/demo", "new");
  const inspection = await inspectMutationPlan(root, sharedOperations());
  const result = await applyMutationPlan(inspection);

  expect(await readFile(join(root, ".agents/skills/demo/SKILL.md"), "utf8")).toBe("new");
  expect(await readlink(join(root, ".claude/skills/demo"))).toBe("../../.agents/skills/demo");
  expect(result.links).toEqual([{
    path: ".claude/skills/demo",
    target: "../../.agents/skills/demo",
    resolvesTo: ".agents/skills/demo"
  }]);
});

test("planned targets must be earlier tree operations and reviewed sources cannot change", async () => {
  const root = await fixture();
  await tree(root, "staged/demo", "reviewed");
  await expect(inspectMutationPlan(root, [...sharedOperations()].reverse())).rejects.toThrow("earlier replace-tree");

  const inspection = await inspectMutationPlan(root, sharedOperations());
  await writeFile(join(root, "staged/demo/SKILL.md"), "changed after review");
  await expect(applyMutationPlan(inspection)).rejects.toMatchObject({ mutationState: "rolled-back" });
  expect(await Bun.file(join(root, ".agents/skills/demo/SKILL.md")).exists()).toBe(false);
  expect(await Bun.file(join(root, ".claude/skills/demo")).exists()).toBe(false);
});

test("force reviews an existing target tree against the replacement source, not its old content", async () => {
  const root = await fixture();
  await tree(root, "staged/demo", "new");
  await tree(root, ".agents/skills/demo", "old");
  await tree(root, ".claude/skills/demo", "old Claude tree");

  const inspection = await inspectMutationPlan(root, sharedOperations(), { force: true });
  const result = await applyMutationPlan(inspection);

  expect(await readFile(join(root, ".agents/skills/demo/SKILL.md"), "utf8")).toBe("new");
  expect(await readlink(join(root, ".claude/skills/demo"))).toBe("../../.agents/skills/demo");
  expect(result.backupDir).toContain(".farrier-staging/backups/");
});

test("a destination edit after inspection aborts before replacing it", async () => {
  const root = await fixture();
  await tree(root, "staged/demo", "new");
  await tree(root, ".agents/skills/demo", "old");
  const inspection = await inspectMutationPlan(root, [sharedOperations()[0]!], { force: true });
  await writeFile(join(root, ".agents/skills/demo/SKILL.md"), "concurrent");

  await expect(applyMutationPlan(inspection)).rejects.toThrow("changed after the mutation plan was inspected");
  expect(await readFile(join(root, ".agents/skills/demo/SKILL.md"), "utf8")).toBe("concurrent");
});

test("rollback removes the link first and retains recovery material on a conflicting tree edit", async () => {
  const root = await fixture();
  await tree(root, "staged/demo", "new");
  await tree(root, ".agents/skills/demo", "old");
  const operations: MutationOperation[] = [
    ...sharedOperations(),
    { type: "replace-file", path: "marker.json", content: "{}\n" }
  ];
  const inspection = await inspectMutationPlan(root, operations, { force: true });

  let caught: unknown;
  try {
    await applyMutationPlan(inspection, {
      beforeOperation: async (_item, index) => {
        if (index !== 2) return;
        await writeFile(join(root, ".agents/skills/demo/SKILL.md"), "concurrent owner edit");
        throw new Error("injected final-operation failure");
      }
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(MutationApplyError);
  expect(caught).toMatchObject({ mutationState: "rollback-incomplete" });
  expect((caught as MutationApplyError).backupDir).toContain(".farrier-staging/backups/");
  expect(await Bun.file(join(root, ".claude/skills/demo")).exists()).toBe(false);
  expect(await readFile(join(root, ".agents/skills/demo/SKILL.md"), "utf8")).toBe("concurrent owner edit");
});
