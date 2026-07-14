import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyMutationPlan,
  inspectMutationPlan,
  MutationTransactionError,
  type MutationOperation,
} from "../src/engine/mutation-transaction";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-transaction-"));
}

async function contents(root: string, paths: string[]): Promise<string[]> {
  return Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
}

describe("closed mutation transaction", () => {
  test("failure after every commit step restores the complete old state", async () => {
    for (let failureIndex = 0; failureIndex < 3; failureIndex++) {
      const root = await tempDir();
      await writeFile(join(root, "a.txt"), "old-a");
      await writeFile(join(root, "b.txt"), "old-b");
      await writeFile(join(root, "c.txt"), "old-c");
      const paths = ["a.txt", "b.txt", "c.txt"];
      const operations: MutationOperation[] = paths.map((path) => ({ kind: "write-file", path, content: `new-${path[0]}` }));
      const plan = await inspectMutationPlan(root, operations);

      await expect(applyMutationPlan(plan, {
        afterCommit: ({ index }) => {
          if (index === failureIndex) throw new Error(`injected after ${index}`);
        }
      })).rejects.toMatchObject({ mutationState: "rolled-back", recoveryPath: null });
      expect(await contents(root, paths)).toEqual(["old-a", "old-b", "old-c"]);
    }
  });

  test("a concurrent edit to transaction output is retained with exact recovery material", async () => {
    const root = await tempDir();
    await writeFile(join(root, "a.txt"), "old-a");
    await writeFile(join(root, "b.txt"), "old-b");
    const plan = await inspectMutationPlan(root, [
      { kind: "write-file", path: "a.txt", content: "new-a" },
      { kind: "write-file", path: "b.txt", content: "new-b" },
    ]);

    let caught: unknown;
    try {
      await applyMutationPlan(plan, {
        afterCommit: async ({ index }) => {
          if (index === 0) await writeFile(join(root, "a.txt"), "user-edit");
          if (index === 1) throw new Error("stop");
        }
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MutationTransactionError);
    expect(caught).toMatchObject({ mutationState: "rollback-incomplete" });
    const recoveryPath = (caught as MutationTransactionError).recoveryPath!;
    expect(recoveryPath).toContain(".farrier-staging/transactions/");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("user-edit");
    expect(await readFile(join(root, recoveryPath, "a.txt"), "utf8")).toBe("old-a");
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("old-b");
  });

  test("parent substitution with a symlink is rejected before target writes", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await mkdir(join(root, "safe"));
    await writeFile(join(root, "safe", "value.txt"), "old");
    const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "safe/value.txt", content: "new" }]);

    await expect(applyMutationPlan(plan, {
      beforeCommit: async () => {
        await rename(join(root, "safe"), join(root, "moved"));
        await symlink(outside, join(root, "safe"), "dir");
      }
    })).rejects.toThrow(/unsafe|symbolic|changed/i);
    expect((await lstat(join(root, "safe"))).isSymbolicLink()).toBe(true);
    expect(await lstat(join(outside, "value.txt")).catch(() => undefined)).toBeUndefined();
  });

  test("reviewed links must resolve inside the transaction root", async () => {
    const root = await tempDir();
    await expect(inspectMutationPlan(root, [{ kind: "link", path: "link", target: "../outside" }])).rejects.toThrow("escapes target");
  });

  test("rejects a pre-existing backup file without deleting data or leaving staging residue", async () => {
    const root = await tempDir();
    await writeFile(join(root, "value.txt"), "old");
    await writeFile(join(root, "occupied"), "keep-me");
    const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "value.txt", content: "new" }]);

    await expect(applyMutationPlan(plan, { backupBase: "occupied" })).rejects.toThrow("Backup path already exists");
    expect(await readFile(join(root, "value.txt"), "utf8")).toBe("old");
    expect(await readFile(join(root, "occupied"), "utf8")).toBe("keep-me");
    expect((await readdir(root)).sort()).toEqual(["occupied", "value.txt"]);
  });

  test("rejects a pre-existing backup directory without deleting data or leaving staging residue", async () => {
    const root = await tempDir();
    await writeFile(join(root, "value.txt"), "old");
    await mkdir(join(root, "occupied"));
    await writeFile(join(root, "occupied", "keep.txt"), "keep-me");
    const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "value.txt", content: "new" }]);

    await expect(applyMutationPlan(plan, { backupBase: "occupied" })).rejects.toThrow("Backup path already exists");
    expect(await readFile(join(root, "value.txt"), "utf8")).toBe("old");
    expect(await readFile(join(root, "occupied", "keep.txt"), "utf8")).toBe("keep-me");
    expect((await readdir(root)).sort()).toEqual(["occupied", "value.txt"]);
    expect(await readdir(join(root, "occupied"))).toEqual(["keep.txt"]);
  });

  test("rejects invalid backup paths before touching the target", async () => {
    for (const backupBase of ["", ".", "../escape", "/absolute", "not/../normalized", "./relative"]) {
      const root = await tempDir();
      await writeFile(join(root, "value.txt"), "old");
      const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "value.txt", content: "new" }]);
      await expect(applyMutationPlan(plan, { backupBase })).rejects.toThrow(/normalized relative|Mutation path/);
      expect(await readFile(join(root, "value.txt"), "utf8")).toBe("old");
      expect(await readdir(root)).toEqual(["value.txt"]);
    }
  });

  test("a pre-backup hook failure cleans staged output and restores the exact tree", async () => {
    const root = await tempDir();
    await writeFile(join(root, "value.txt"), "old");
    const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "value.txt", content: "new" }]);

    await expect(applyMutationPlan(plan, {
      beforeBackup: () => { throw new Error("injected before backup"); }
    })).rejects.toMatchObject({ mutationState: "rolled-back" });
    expect(await readFile(join(root, "value.txt"), "utf8")).toBe("old");
    expect(await readdir(root)).toEqual(["value.txt"]);
  });

  test("tree review rejects a source file replaced by an external symlink", async () => {
    const root = await tempDir();
    const source = await tempDir();
    const outside = await tempDir();
    await mkdir(join(root, "skill"));
    await writeFile(join(root, "skill", "SKILL.md"), "old");
    await writeFile(join(source, "SKILL.md"), "reviewed");
    await writeFile(join(outside, "secret"), "outside-secret");
    const plan = await inspectMutationPlan(root, [{ kind: "replace-tree", path: "skill", sourcePath: source }]);

    await expect(applyMutationPlan(plan, {
      beforeCommit: async () => {
        await rm(join(source, "SKILL.md"));
        await symlink(join(outside, "secret"), join(source, "SKILL.md"));
      }
    })).rejects.toThrow("symbolic link");
    expect(await readFile(join(root, "skill", "SKILL.md"), "utf8")).toBe("old");
    expect((await readdir(root)).sort()).toEqual(["skill"]);
  });

  test("a dangling reviewed link target after backup restores the existing destination", async () => {
    const root = await tempDir();
    await mkdir(join(root, "winner"));
    await mkdir(join(root, "link"));
    await writeFile(join(root, "winner", "SKILL.md"), "winner");
    await writeFile(join(root, "link", "SKILL.md"), "original");
    const plan = await inspectMutationPlan(root, [{ kind: "link", path: "link", target: "winner" }]);

    await expect(applyMutationPlan(plan, {
      afterBackup: async () => rm(join(root, "winner"), { recursive: true })
    })).rejects.toMatchObject({ mutationState: "rolled-back", recoveryPath: null });
    expect(await readFile(join(root, "link", "SKILL.md"), "utf8")).toBe("original");
  });

  test("replace-tree source mutation after inspection leaves the destination untouched", async () => {
    const root = await tempDir();
    const source = await tempDir();
    await mkdir(join(root, "skill"));
    await writeFile(join(root, "skill", "SKILL.md"), "old");
    await writeFile(join(source, "SKILL.md"), "reviewed");
    const plan = await inspectMutationPlan(root, [{ kind: "replace-tree", path: "skill", sourcePath: source }]);

    await expect(applyMutationPlan(plan, {
      beforeCommit: async () => writeFile(join(source, "SKILL.md"), "changed")
    })).rejects.toThrow("source changed after review");
    expect(await readFile(join(root, "skill", "SKILL.md"), "utf8")).toBe("old");
  });

  test("link target substitution outside the root leaves the original destination untouched", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await mkdir(join(root, "winner"));
    await mkdir(join(root, "loser"));
    await writeFile(join(root, "winner", "SKILL.md"), "winner");
    await writeFile(join(root, "loser", "SKILL.md"), "loser");
    const plan = await inspectMutationPlan(root, [{ kind: "link", path: "loser", target: "winner" }]);

    await expect(applyMutationPlan(plan, {
      beforeCommit: async () => {
        await rm(join(root, "winner"), { recursive: true });
        await symlink(outside, join(root, "winner"), "dir");
      }
    })).rejects.toThrow(/target changed|escaped/i);
    expect(await readFile(join(root, "loser", "SKILL.md"), "utf8")).toBe("loser");
  });

  test("resolved link target content mutation leaves the original destination untouched", async () => {
    const root = await tempDir();
    await mkdir(join(root, "winner"));
    await mkdir(join(root, "loser"));
    await writeFile(join(root, "winner", "SKILL.md"), "winner");
    await writeFile(join(root, "loser", "SKILL.md"), "loser");
    const plan = await inspectMutationPlan(root, [{ kind: "link", path: "loser", target: "winner" }]);

    await expect(applyMutationPlan(plan, {
      beforeCommit: async () => writeFile(join(root, "winner", "SKILL.md"), "changed")
    })).rejects.toThrow("target changed after review");
    expect(await readFile(join(root, "loser", "SKILL.md"), "utf8")).toBe("loser");
  });

  test("rollback removes a transaction-created target root when it remains empty", async () => {
    const parent = await tempDir();
    const root = join(parent, "absent", "project");
    const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "nested/value.txt", content: "new" }]);

    await expect(applyMutationPlan(plan, {
      afterCommit: () => { throw new Error("stop"); }
    })).rejects.toMatchObject({ mutationState: "rolled-back" });
    expect(await lstat(join(parent, "absent")).catch(() => undefined)).toBeUndefined();
  });
});
