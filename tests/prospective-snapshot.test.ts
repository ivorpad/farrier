import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stageProspectiveSnapshot } from "../src/engine/evaluations/prospective-snapshot";

const temporaryDirectories: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<{ code: number; output: string }> {
  const process = Bun.spawn(["git", ...args], {
    cwd,
    env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { code, output: code === 0 ? stdout.trim() : stderr.trim() };
}

async function repository(): Promise<{
  root: string;
  firstCommit: string;
  firstTree: string;
  futureCommit: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "farrier-prospective-source-"));
  temporaryDirectories.push(root);
  expect((await git(root, "init", "--quiet")).code).toBe(0);
  await Bun.write(join(root, "feature.ts"), "export const value = 1;\n");
  expect((await git(root, "add", "--all")).code).toBe(0);
  expect((await git(
    root,
    "-c", "user.name=Test",
    "-c", "user.email=test@example.invalid",
    "commit", "--quiet", "--no-gpg-sign", "-m", "task cutoff",
  )).code).toBe(0);
  const firstCommit = (await git(root, "rev-parse", "HEAD")).output;
  const firstTree = (await git(root, "rev-parse", "HEAD^{tree}")).output;
  await Bun.write(join(root, "feature.ts"), "export const value = 2;\n");
  await Bun.write(join(root, "future-solution.ts"), "export const answer = 42;\n");
  expect((await git(root, "add", "--all")).code).toBe(0);
  expect((await git(
    root,
    "-c", "user.name=Test",
    "-c", "user.email=test@example.invalid",
    "commit", "--quiet", "--no-gpg-sign", "-m", "future solution",
  )).code).toBe(0);
  return {
    root,
    firstCommit,
    firstTree,
    futureCommit: (await git(root, "rev-parse", "HEAD")).output,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("prospective snapshot staging", () => {
  test("materializes the exact cutoff tree without future commits, refs, or remotes", async () => {
    const source = await repository();
    const parent = await mkdtemp(join(tmpdir(), "farrier-prospective-parent-"));
    const destination = join(parent, "snapshot");
    const secondDestination = join(parent, "snapshot-again");
    temporaryDirectories.push(parent);
    await mkdir(destination);

    const evidence = await stageProspectiveSnapshot({
      sourceRepository: source.root,
      commit: source.firstCommit,
      expectedTree: source.firstTree,
      destination,
    });

    expect(evidence).toMatchObject({
      sourceCommit: source.firstCommit,
      sourceTree: source.firstTree,
      stagedTree: source.firstTree,
      referenceCount: 1,
      remoteCount: 0,
      unreachableObjectCount: 0,
      historyMode: "snapshot-root",
      noFutureObjects: true,
    });
    expect(evidence.contentManifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.sourceStateSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(join(destination, "feature.ts"), "utf8")).toBe("export const value = 1;\n");
    expect(await Bun.file(join(destination, "future-solution.ts")).exists()).toBe(false);
    expect((await git(destination, "cat-file", "-e", source.futureCommit)).code).not.toBe(0);

    const repeated = await stageProspectiveSnapshot({
      sourceRepository: source.root,
      commit: source.firstCommit,
      expectedTree: source.firstTree,
      destination: secondDestination,
    });
    expect(repeated.stagedRootCommit).toBe(evidence.stagedRootCommit);
    expect(repeated.contentManifestSha256).toBe(evidence.contentManifestSha256);
    expect(repeated.sourceStateSha256).toBe(evidence.sourceStateSha256);
  });

  test("rejects an expected tree that does not belong to the cutoff commit", async () => {
    const source = await repository();
    const destination = join(await mkdtemp(join(tmpdir(), "farrier-prospective-parent-")), "snapshot");
    temporaryDirectories.push(destination.slice(0, -"/snapshot".length));

    await expect(stageProspectiveSnapshot({
      sourceRepository: source.root,
      commit: source.firstCommit,
      expectedTree: "f".repeat(40),
      destination,
    })).rejects.toThrow("does not match expected tree");
  });
});
