import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, open, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectFile } from "../src/engine/project-manifests";
import {
  openContainedRepository,
  readContainedDirectory,
  readContainedFile,
} from "../src/engine/repository-paths";

async function tempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `farrier-contained-${label}-`));
}

describe("contained repository reads", () => {
  test("reads a regular file beneath a canonicalized symlink root", async () => {
    const parent = await tempDir("root");
    const root = join(parent, "project");
    const linkedRoot = join(parent, "selected-project");
    await mkdir(root);
    await writeFile(join(root, "package.json"), '{"name":"example"}\n', "utf8");
    await symlink(root, linkedRoot);

    const repository = await openContainedRepository(linkedRoot);
    const result = await readContainedFile(repository, "package.json", 1_024);

    expect(repository.root).toBe(await realpath(root));
    expect(result).toEqual(expect.objectContaining({
      status: "read",
      path: "package.json",
      text: '{"name":"example"}\n',
      bytesRead: 19,
      truncated: false,
    }));
  });

  test("rejects traversal, absolute paths, NULs, and empty segments", async () => {
    const root = await tempDir("paths");
    const repository = await openContainedRepository(root);

    for (const path of ["../outside.txt", "/outside.txt", "nested//file.txt", "nested/../file.txt", "bad\0file"]) {
      await expect(readContainedFile(repository, path, 100)).resolves.toEqual({
        status: "outside-root",
        path,
      });
    }
  });

  test("rejects final and intermediate symlinks without reading their targets", async () => {
    const parent = await tempDir("links");
    const root = join(parent, "project");
    const outside = join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "outside-content", "utf8");
    await symlink(join(outside, "secret.txt"), join(root, "linked-file"));
    await symlink(outside, join(root, "linked-directory"));
    const repository = await openContainedRepository(root);

    await expect(readContainedFile(repository, "linked-file", 1_024)).resolves.toEqual({
      status: "symlink",
      path: "linked-file",
    });
    await expect(readContainedFile(repository, "linked-directory/secret.txt", 1_024)).resolves.toEqual({
      status: "symlink",
      path: "linked-directory/secret.txt",
    });
    await expect(readContainedDirectory(repository, "linked-directory")).resolves.toEqual({
      status: "symlink",
      path: "linked-directory",
    });
  });

  test("distinguishes missing, special, and oversized paths", async () => {
    const root = await tempDir("kinds");
    await mkdir(join(root, "directory"));
    await writeFile(join(root, "large.txt"), "12345", "utf8");
    const repository = await openContainedRepository(root);

    await expect(readContainedFile(repository, "missing.txt", 10)).resolves.toEqual({
      status: "missing",
      path: "missing.txt",
    });
    await expect(readContainedFile(repository, "directory", 10)).resolves.toEqual({
      status: "special-file",
      path: "directory",
    });
    await expect(readContainedFile(repository, "large.txt", 4)).resolves.toEqual({
      status: "oversized",
      path: "large.txt",
    });
  });

  test("discards a file changed while it is being read", async () => {
    const root = await tempDir("changed");
    const path = join(root, "changing.txt");
    await writeFile(path, Buffer.alloc(8 * 1024 * 1024, 65));
    const repository = await openContainedRepository(root);
    const writer = await open(path, "r+");
    let mutate = true;
    let writes = 0;
    const mutator = (async () => {
      const byte = Buffer.alloc(1);
      while (mutate) {
        byte[0] = writes % 2 === 0 ? 66 : 67;
        await writer.write(byte, 0, 1, 0);
        writes += 1;
        await Bun.sleep(0);
      }
    })();

    while (writes === 0) await Bun.sleep(0);
    const result = await readContainedFile(repository, "changing.txt", 8 * 1024 * 1024);
    mutate = false;
    await mutator;
    await writer.close();

    expect(result).toEqual({ status: "changed", path: "changing.txt" });
  });

  test("rejects a live pathname replaced while its opened file is read", async () => {
    const root = await tempDir("replaced");
    const path = join(root, "selected.txt");
    const moved = join(root, "opened.txt");
    const replacement = join(root, "replacement");
    await writeFile(path, Buffer.alloc(32 * 1024 * 1024, 65));
    await writeFile(moved, "replacement target", "utf8");
    await symlink("opened.txt", replacement);
    const repository = await openContainedRepository(root);

    const reading = readContainedFile(repository, "selected.txt", 32 * 1024 * 1024);
    await Bun.sleep(0);
    await rename(replacement, path);

    const result = await reading;
    expect(["changed", "symlink", "outside-root"]).toContain(result.status);
    expect(result.path).toBe("selected.txt");
  });

  test("keeps the compatibility reader best-effort and bounded", async () => {
    const root = await tempDir("compat");
    await writeFile(join(root, "regular.txt"), "contents", "utf8");

    await expect(readProjectFile(root, "regular.txt")).resolves.toBe("contents");
    await expect(readProjectFile(root, "../outside.txt")).resolves.toBeUndefined();
    await expect(readProjectFile(root, "missing.txt")).resolves.toBeUndefined();
  });
});
