import { constants, type BigIntStats } from "node:fs";
import { link, lstat, open, realpath, rename, rm, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

const noFollow = constants.O_NOFOLLOW ?? 0;

export type FileFingerprint = {
  dev: string;
  ino: string;
  size: string;
  mtimeNs: string;
  sha256: string;
  mode: number;
};

export type FileSnapshot = {
  content: Buffer;
  fingerprint: FileFingerprint;
};

export type DirectoryIdentity = { dev: string; ino: string };

export type StagedFile = {
  path: string;
  fingerprint: FileFingerprint;
};

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

function digest(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function identity(stats: BigIntStats): DirectoryIdentity {
  return { dev: stats.dev.toString(), ino: stats.ino.toString() };
}

function sameIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function fingerprint(stats: BigIntStats, content: Buffer): FileFingerprint {
  return {
    ...identity(stats),
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    sha256: digest(content),
    mode: Number(stats.mode & 0o7777n),
  };
}

export function sameFingerprint(left: FileFingerprint, right: FileFingerprint): boolean {
  return sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.sha256 === right.sha256 && left.mode === right.mode;
}

export async function snapshotRegularFile(path: string): Promise<FileSnapshot> {
  const before = await lstat(path, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`${path} is not a regular non-symbolic file`);

  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (errorCode(error) === "ELOOP") throw new Error(`${path} changed to a symbolic link`);
    throw error;
  }

  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameIdentity(identity(before), identity(opened))) throw new Error(`${path} changed while it was being inspected`);
    const content = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(identity(opened), identity(after)) || opened.size !== after.size || opened.mtimeNs !== after.mtimeNs) {
      throw new Error(`${path} changed while it was being read`);
    }
    return { content, fingerprint: fingerprint(after, content) };
  } finally {
    await handle.close();
  }
}

export async function maybeSnapshotRegularFile(path: string): Promise<FileSnapshot | undefined> {
  try {
    return await snapshotRegularFile(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

export async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  const stats = await lstat(path, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${path} is not a regular directory`);
  return identity(stats);
}

function outside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
}

export async function assertStableDirectoryChain(targetRoot: string, expectedRoot: DirectoryIdentity, absoluteDirectory: string): Promise<void> {
  const currentRoot = await directoryIdentity(targetRoot);
  if (!sameIdentity(currentRoot, expectedRoot)) throw new Error("Target directory changed after the creation plan was inspected");

  const fromRoot = relative(targetRoot, absoluteDirectory);
  if (outside(targetRoot, absoluteDirectory)) throw new Error("Generated parent path escaped the target directory");
  let current = targetRoot;
  for (const component of fromRoot.split(sep).filter(Boolean)) {
    current = join(current, component);
    const stats = await lstat(current, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Generated parent path changed to an unsafe type: ${relative(targetRoot, current)}`);
  }

  const [realRoot, realDirectory] = await Promise.all([realpath(targetRoot), realpath(absoluteDirectory)]);
  if (outside(realRoot, realDirectory)) throw new Error("Generated parent path resolves outside the target directory");
}

export async function stageFile(absoluteTarget: string, content: Buffer | string, exactMode?: number): Promise<StagedFile> {
  const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const path = join(dirname(absoluteTarget), `.farrier-${process.pid}-${randomUUID()}.tmp`);
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, exactMode ?? 0o666);
  try {
    await handle.writeFile(buffer);
    if (exactMode !== undefined) await handle.chmod(exactMode);
    await handle.sync();
    const stats = await handle.stat({ bigint: true });
    return { path, fingerprint: fingerprint(stats, buffer) };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function commitStagedReplacement(staged: StagedFile, absoluteTarget: string): Promise<void> {
  await rename(staged.path, absoluteTarget);
}

export async function commitStagedCreation(staged: StagedFile, absoluteTarget: string): Promise<void> {
  await link(staged.path, absoluteTarget);
  await unlink(staged.path).catch(() => undefined);
}

export async function pathMatchesFingerprint(path: string, expected: FileFingerprint): Promise<boolean> {
  try {
    return sameFingerprint((await snapshotRegularFile(path)).fingerprint, expected);
  } catch {
    return false;
  }
}

export async function removeStaged(path: string): Promise<void> {
  await rm(path, { force: true });
}
