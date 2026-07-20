import { constants, type BigIntStats, type Dirent } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

export type ContainedRepository = {
  root: string;
};

export type ContainedFileFingerprint = {
  device: string;
  inode: string;
  size: number;
  mtimeNs: string;
  ctimeNs: string;
};

type ContainedFailureStatus =
  | "missing"
  | "symlink"
  | "outside-root"
  | "special-file"
  | "changed"
  | "unreadable";

type ContainedFailure<Status extends string = ContainedFailureStatus> = {
  status: Status;
  path: string;
};

export type ContainedDirectoryResult =
  | { status: "read"; path: string; entries: Dirent[]; fingerprint: ContainedFileFingerprint }
  | ContainedFailure;

export type ContainedReadResult =
  | {
      status: "read";
      path: string;
      text: string;
      bytesRead: number;
      truncated: false;
      fingerprint: ContainedFileFingerprint;
    }
  | ContainedFailure<ContainedFailureStatus | "oversized">;

function failure<Status extends string>(status: Status, path: string): ContainedFailure<Status> {
  return { status, path };
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function fingerprint(stats: BigIntStats): ContainedFileFingerprint {
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    size: Number(stats.size),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString(),
  };
}

function sameFingerprint(left: ContainedFileFingerprint, right: ContainedFileFingerprint): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function normalizedSegments(path: string, allowRoot = false): string[] | undefined {
  if (path.includes("\0") || isAbsolute(path)) return undefined;
  if (!path) return allowRoot ? [] : undefined;
  const segments = path.split(/[\\/]/);
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return undefined;
  return segments;
}

function isWithinRoot(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

async function revalidateCurrentPath(
  repository: ContainedRepository,
  path: string,
  absolutePath: string,
  expected: ContainedFileFingerprint,
  kind: "file" | "directory",
): Promise<ContainedFailure | undefined> {
  try {
    const current = await lstat(absolutePath, { bigint: true });
    if (current.isSymbolicLink()) return failure("symlink", path);
    if (kind === "file" ? !current.isFile() : !current.isDirectory()) {
      return failure("special-file", path);
    }
    if (!sameFingerprint(expected, fingerprint(current))) return failure("changed", path);
    const canonicalPath = await realpath(absolutePath);
    const canonicalParent = await realpath(dirname(absolutePath));
    if (canonicalPath !== absolutePath
      || !isWithinRoot(repository.root, canonicalPath)
      || (absolutePath !== repository.root && !isWithinRoot(repository.root, canonicalParent))) {
      return failure("outside-root", path);
    }
  } catch (error) {
    return failure(errorCode(error) === "ENOENT" ? "missing" : "unreadable", path);
  }
  return undefined;
}

async function validateComponents(
  repository: ContainedRepository,
  path: string,
  segments: string[],
): Promise<ContainedFailure | undefined> {
  let current = repository.root;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) return failure("symlink", path);
      if (index < segments.length - 1 && !entry.isDirectory()) return failure("special-file", path);
    } catch (error) {
      return failure(errorCode(error) === "ENOENT" ? "missing" : "unreadable", path);
    }
  }

  try {
    const canonicalParent = await realpath(dirname(current));
    if (!isWithinRoot(repository.root, canonicalParent)) return failure("outside-root", path);
  } catch (error) {
    return failure(errorCode(error) === "ENOENT" ? "missing" : "unreadable", path);
  }
  return undefined;
}

export async function openContainedRepository(input: string): Promise<ContainedRepository> {
  const root = await realpath(input);
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) throw new Error("Project root is not a directory.");
  return { root };
}

export async function readContainedDirectory(
  repository: ContainedRepository,
  path = "",
): Promise<ContainedDirectoryResult> {
  const segments = normalizedSegments(path, true);
  if (!segments) return failure("outside-root", path);

  const componentFailure = segments.length
    ? await validateComponents(repository, path, segments)
    : undefined;
  if (componentFailure) return componentFailure;

  const absolutePath = segments.length ? join(repository.root, ...segments) : repository.root;
  try {
    const beforeStats = await lstat(absolutePath, { bigint: true });
    if (beforeStats.isSymbolicLink()) return failure("symlink", path);
    if (!beforeStats.isDirectory()) return failure("special-file", path);

    const canonicalPath = await realpath(absolutePath);
    if (canonicalPath !== absolutePath || !isWithinRoot(repository.root, canonicalPath)) {
      return failure("outside-root", path);
    }

    const entries = await readdir(absolutePath, { withFileTypes: true });
    const afterStats = await lstat(absolutePath, { bigint: true });
    if (!afterStats.isDirectory()
      || !sameFingerprint(fingerprint(beforeStats), fingerprint(afterStats))) {
      return failure("changed", path);
    }
    // Node has no portable openat-style API. Rechecking the live pathname and
    // canonical parent narrows ancestor-swap races but cannot eliminate them.
    const revalidation = await revalidateCurrentPath(
      repository,
      path,
      absolutePath,
      fingerprint(afterStats),
      "directory",
    );
    if (revalidation) return revalidation;

    return {
      status: "read",
      path,
      entries,
      fingerprint: fingerprint(afterStats),
    };
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return failure("missing", path);
    if (code === "ELOOP") return failure("symlink", path);
    return failure("unreadable", path);
  }
}

export async function readContainedFile(
  repository: ContainedRepository,
  path: string,
  maxBytes: number,
): Promise<ContainedReadResult> {
  const segments = normalizedSegments(path);
  if (!segments) return failure("outside-root", path);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return failure("unreadable", path);

  const componentFailure = await validateComponents(repository, path, segments);
  if (componentFailure) return componentFailure;

  const absolutePath = join(repository.root, ...segments);
  let handle;
  try {
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return failure("missing", path);
    if (code === "ELOOP") return failure("symlink", path);
    return failure("unreadable", path);
  }

  try {
    const beforeStats = await handle.stat({ bigint: true });
    if (!beforeStats.isFile()) return failure("special-file", path);
    if (beforeStats.size > BigInt(maxBytes)) return failure("oversized", path);
    const before = fingerprint(beforeStats);
    const openedPath = await revalidateCurrentPath(repository, path, absolutePath, before, "file");
    if (openedPath) return openedPath;

    const expectedBytes = Number(beforeStats.size);
    const buffer = Buffer.alloc(expectedBytes);
    let bytesRead = 0;
    while (bytesRead < expectedBytes) {
      const requestedBytes = Math.min(64 * 1024, expectedBytes - bytesRead);
      const chunk = await handle.read(buffer, bytesRead, requestedBytes, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }

    const afterStats = await handle.stat({ bigint: true });
    const after = fingerprint(afterStats);
    if (bytesRead !== expectedBytes || !sameFingerprint(before, after)) return failure("changed", path);
    const revalidation = await revalidateCurrentPath(repository, path, absolutePath, after, "file");
    if (revalidation) return revalidation;

    return {
      status: "read",
      path,
      text: buffer.toString("utf8", 0, bytesRead),
      bytesRead,
      truncated: false,
      fingerprint: after,
    };
  } catch {
    return failure("unreadable", path);
  } finally {
    await handle.close().catch(() => undefined);
  }
}
