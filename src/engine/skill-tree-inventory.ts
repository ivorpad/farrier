import { createHash } from "node:crypto";
import { constants, type BigIntStats, type Dirent } from "node:fs";
import { lstat, open, opendir, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ContainedRepository } from "./repository-paths";

export const skillInventoryLimits = {
  maxEntriesPerTree: 500,
  maxFileBytes: 1024 * 1024,
  maxTreeBytes: 10 * 1024 * 1024,
  maxSkillsPerRoot: 500,
} as const;

export type SkillRootKind = "legacy" | "codex" | "claude";

export type SkillTreeFile = {
  path: string;
  kind: "directory" | "file" | "link";
  mode: number;
  size: number;
  digest?: string;
  linkTarget?: string;
};

export type SkillTreeSnapshot = {
  path: string;
  treeDigest: string;
  files: SkillTreeFile[];
  entryCount: number;
  totalBytes: number;
};

export type SkillLocation = {
  root: SkillRootKind;
  path: string;
  state: "tree" | "linked" | "invalid";
  tree?: SkillTreeSnapshot;
  linkTarget?: string;
  issues: string[];
};

type ScanResult =
  | { status: "valid"; tree: SkillTreeSnapshot }
  | { status: "invalid"; issue: string };

function relativePath(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function compareSkillInventoryText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function normalizedMode(stats: BigIntStats): number {
  return Number(stats.mode & 0o777n);
}

function fingerprint(stats: BigIntStats): string {
  return [
    stats.dev,
    stats.ino,
    stats.size,
    stats.mtimeNs,
    stats.ctimeNs,
    stats.mode,
  ].join(":");
}

function isWithin(parent: string, child: string): boolean {
  const fromParent = relative(parent, child);
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function absolute(repository: ContainedRepository, path: string): string {
  return join(repository.root, ...path.split("/"));
}

async function safeStats(path: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true });
  } catch {
    return undefined;
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export type BoundedSkillDirectoryResult =
  | { status: "read"; entries: Dirent[] }
  | { status: "missing" | "symlink" | "outside-root" | "special-file" | "unreadable" | "changed" | "oversized" };

export async function readBoundedSkillDirectory(
  repository: ContainedRepository,
  path: string,
  maxEntries: number,
): Promise<BoundedSkillDirectoryResult> {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) return { status: "unreadable" };
  const directoryPath = absolute(repository, path);
  let before: BigIntStats;
  try {
    before = await lstat(directoryPath, { bigint: true });
    if (before.isSymbolicLink()) return { status: "symlink" };
    if (!before.isDirectory()) return { status: "special-file" };
    if ((before.mode & 0o555n) === 0n) return { status: "unreadable" };
    const canonical = await realpath(directoryPath);
    if (canonical !== directoryPath || !isWithin(repository.root, canonical)) {
      return { status: "outside-root" };
    }
  } catch (error) {
    return { status: errorCode(error) === "ENOENT" ? "missing" : "unreadable" };
  }

  let handle;
  try {
    handle = await opendir(directoryPath);
  } catch (error) {
    return { status: errorCode(error) === "ENOENT" ? "missing" : "unreadable" };
  }

  const entries: Dirent[] = [];
  try {
    while (true) {
      const entry = await handle.read();
      if (!entry) break;
      entries.push(entry);
      if (entries.length > maxEntries) return { status: "oversized" };
    }
  } catch {
    return { status: "unreadable" };
  } finally {
    try {
      await handle.close();
    } catch {
      // Reading the final entry may have already closed the directory handle.
    }
  }

  const after = await safeStats(directoryPath);
  if (!after || !after.isDirectory() || fingerprint(before) !== fingerprint(after)) {
    return { status: "changed" };
  }
  entries.sort((left, right) => compareSkillInventoryText(left.name, right.name));
  return { status: "read", entries };
}

async function validateInternalLink(treeRoot: string, linkPath: string, target: string): Promise<string | undefined> {
  if (!target || target.includes("\0")) return "malformed-link";
  if (isAbsolute(target)) return "absolute-link";

  const destination = resolve(dirname(linkPath), target);
  if (!isWithin(treeRoot, destination)) return "escaped-link";

  const targetPath = relative(treeRoot, destination);
  if (!targetPath) return "chained-link";

  let current = treeRoot;
  for (const segment of targetPath.split(sep)) {
    current = join(current, segment);
    const stats = await safeStats(current);
    if (!stats) return "broken-link";
    if (stats.isSymbolicLink()) return "chained-link";
  }
  return undefined;
}

async function readRegularFile(
  path: string,
  stats: BigIntStats,
  totalBytes: number,
): Promise<{ file?: SkillTreeFile; issue?: string; bytes?: number }> {
  if ((stats.mode & 0o444n) === 0n) return { issue: "unreadable-file" };
  if (stats.size > BigInt(skillInventoryLimits.maxFileBytes)) return { issue: "oversized-file" };
  if (BigInt(totalBytes) + stats.size > BigInt(skillInventoryLimits.maxTreeBytes)) {
    return { issue: "oversized-tree" };
  }

  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return { issue: "unreadable-file" };
  }

  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) return { issue: "special-file" };
    if (fingerprint(before) !== fingerprint(stats)) return { issue: "changed-file" };

    const size = Number(before.size);
    const content = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const chunk = await handle.read(content, offset, Math.min(64 * 1024, size - offset), offset);
      if (chunk.bytesRead === 0) break;
      offset += chunk.bytesRead;
    }

    const after = await handle.stat({ bigint: true });
    if (offset !== size || fingerprint(before) !== fingerprint(after)) {
      return { issue: "changed-file" };
    }
    return {
      file: {
        path: "",
        kind: "file",
        mode: normalizedMode(after),
        size,
        digest: sha256(content),
      },
      bytes: size,
    };
  } catch {
    return { issue: "unreadable-file" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readLinkEntry(
  treeRoot: string,
  path: string,
  stats: BigIntStats,
): Promise<{ file?: SkillTreeFile; issue?: string }> {
  try {
    const target = await readlink(path);
    const after = await lstat(path, { bigint: true });
    if (!after.isSymbolicLink() || fingerprint(stats) !== fingerprint(after)) {
      return { issue: "changed-link" };
    }
    const issue = await validateInternalLink(treeRoot, path, target);
    if (issue) return { issue };
    return {
      file: {
        path: "",
        kind: "link",
        mode: normalizedMode(after),
        size: Buffer.byteLength(target),
        linkTarget: target,
      },
    };
  } catch {
    return { issue: "unreadable-link" };
  }
}

function digestTree(files: SkillTreeFile[]): string {
  return sha256(JSON.stringify(files.map((file) => ({
    path: file.path,
    kind: file.kind,
    mode: file.mode,
    size: file.size,
    digest: file.digest ?? null,
    linkTarget: file.linkTarget ?? null,
  }))));
}

export async function snapshotSkillTree(repository: ContainedRepository, skillPath: string): Promise<ScanResult> {
  const treeRoot = absolute(repository, skillPath);
  const rootStats = await safeStats(treeRoot);
  if (!rootStats || !rootStats.isDirectory()) return { status: "invalid", issue: "not-a-directory" };
  if ((rootStats.mode & 0o555n) === 0n) return { status: "invalid", issue: "unreadable-directory" };

  const files: SkillTreeFile[] = [{
    path: ".",
    kind: "directory",
    mode: normalizedMode(rootStats),
    size: 0,
  }];
  const pending = [skillPath];
  let entryCount = 0;
  let totalBytes = 0;

  while (pending.length > 0) {
    pending.sort(compareSkillInventoryText);
    const directoryPath = pending.shift();
    if (!directoryPath) break;

    const remainingEntries = skillInventoryLimits.maxEntriesPerTree - entryCount;
    const directory = await readBoundedSkillDirectory(repository, directoryPath, remainingEntries);
    if (directory.status === "oversized") {
      return { status: "invalid", issue: "oversized-tree:entry-limit" };
    }
    if (directory.status !== "read") {
      return { status: "invalid", issue: "unreadable-directory:" + directory.status };
    }

    const entries = directory.entries;
    entryCount += entries.length;

    for (const entry of entries) {
      const childPath = directoryPath + "/" + entry.name;
      const childAbsolute = absolute(repository, childPath);
      const stats = await safeStats(childAbsolute);
      if (!stats) return { status: "invalid", issue: "unreadable:" + childPath };
      const pathInTree = relativePath(relative(treeRoot, childAbsolute));

      if (stats.isDirectory()) {
        if ((stats.mode & 0o555n) === 0n) {
          return { status: "invalid", issue: "unreadable-directory:" + childPath };
        }
        files.push({ path: pathInTree, kind: "directory", mode: normalizedMode(stats), size: 0 });
        pending.push(childPath);
        continue;
      }

      if (stats.isFile()) {
        const result = await readRegularFile(childAbsolute, stats, totalBytes);
        if (!result.file || result.bytes === undefined) {
          return { status: "invalid", issue: (result.issue ?? "unreadable-file") + ":" + childPath };
        }
        result.file.path = pathInTree;
        files.push(result.file);
        totalBytes += result.bytes;
        continue;
      }

      if (stats.isSymbolicLink()) {
        const result = await readLinkEntry(treeRoot, childAbsolute, stats);
        if (!result.file) {
          return { status: "invalid", issue: (result.issue ?? "unreadable-link") + ":" + childPath };
        }
        result.file.path = pathInTree;
        files.push(result.file);
        continue;
      }
      return { status: "invalid", issue: "special-file:" + childPath };
    }
  }

  const afterRoot = await safeStats(treeRoot);
  if (!afterRoot || fingerprint(rootStats) !== fingerprint(afterRoot)) {
    return { status: "invalid", issue: "changed-tree" };
  }

  files.sort((left, right) => compareSkillInventoryText(left.path, right.path));
  const skillFile = files.find((file) => file.path === "SKILL.md");
  if (!skillFile || skillFile.kind !== "file") {
    return { status: "invalid", issue: "missing-regular-SKILL.md" };
  }

  return {
    status: "valid",
    tree: {
      path: skillPath,
      treeDigest: digestTree(files),
      files,
      entryCount,
      totalBytes,
    },
  };
}

async function inspectSharedLink(
  repository: ContainedRepository,
  name: string,
  path: string,
  stats: BigIntStats,
): Promise<SkillLocation> {
  try {
    const linkPath = absolute(repository, path);
    const target = await readlink(linkPath);
    const after = await lstat(linkPath, { bigint: true });
    if (!after.isSymbolicLink() || fingerprint(stats) !== fingerprint(after)) {
      return { root: "claude", path, state: "invalid", issues: ["changed-link"] };
    }
    if (!target || target.includes("\0")) {
      return { root: "claude", path, state: "invalid", issues: ["malformed-link"] };
    }
    if (isAbsolute(target)) {
      return { root: "claude", path, state: "invalid", issues: ["absolute-link"] };
    }

    const expectedPath = ".agents/skills/" + name;
    const destination = resolve(dirname(linkPath), target);
    if (destination !== absolute(repository, expectedPath)) {
      const reason = isWithin(repository.root, destination) ? "unexpected-link" : "escaped-link";
      return { root: "claude", path, state: "invalid", linkTarget: target, issues: [reason] };
    }

    const destinationRead = await readBoundedSkillDirectory(
      repository,
      expectedPath,
      skillInventoryLimits.maxEntriesPerTree,
    );
    if (destinationRead.status !== "read") {
      return {
        root: "claude",
        path,
        state: "invalid",
        linkTarget: target,
        issues: ["chained-or-broken-link:" + destinationRead.status],
      };
    }
    return { root: "claude", path, state: "linked", linkTarget: target, issues: [] };
  } catch {
    return { root: "claude", path, state: "invalid", issues: ["unreadable-link"] };
  }
}

export async function inspectSkillLocation(
  repository: ContainedRepository,
  root: SkillRootKind,
  rootPath: string,
  name: string,
): Promise<SkillLocation> {
  const path = rootPath + "/" + name;
  const stats = await safeStats(absolute(repository, path));
  if (!stats) return { root, path, state: "invalid", issues: ["unreadable-location"] };

  if (stats.isSymbolicLink()) {
    if (root !== "claude") {
      return { root, path, state: "invalid", issues: ["unexpected-top-level-link"] };
    }
    return inspectSharedLink(repository, name, path, stats);
  }
  if (!stats.isDirectory()) {
    return { root, path, state: "invalid", issues: ["special-or-regular-file-location"] };
  }

  const scan = await snapshotSkillTree(repository, path);
  if (scan.status === "invalid") {
    return { root, path, state: "invalid", issues: [scan.issue] };
  }
  return { root, path, state: "tree", tree: scan.tree, issues: [] };
}
