import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { cp, lstat, mkdir, open, readdir, readlink, realpath, rename, rm, rmdir, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import {
  assertStableDirectoryChain,
  commitStagedCreation,
  commitStagedReplacement,
  directoryIdentity,
  stageFile,
  type DirectoryIdentity,
} from "./create-plan-fs";

export type PathFingerprint =
  | { kind: "absent" }
  | { kind: "file"; dev: string; ino: string; size: string; mtimeNs: string; mode: number; sha256: string }
  | { kind: "tree"; dev: string; ino: string; mode: number; sha256: string }
  | { kind: "link"; dev: string; ino: string; target: string };

export type MutationOperation =
  | { kind: "write-file"; path: string; content: string | Buffer; mode?: number }
  | { kind: "replace-tree"; path: string; sourcePath: string }
  | { kind: "remove-tree"; path: string }
  | { kind: "link"; path: string; target: string };

type ReviewedLinkTarget = {
  path: string; expected: PathFingerprint; realPath: string; realExpected: PathFingerprint;
};

export type InspectedMutationOperation = MutationOperation & {
  expected: PathFingerprint; sourceExpected?: PathFingerprint; linkTarget?: ReviewedLinkTarget;
};

export type MutationPlan = { targetDir: string; operations: InspectedMutationOperation[] };

export type MutationResult = { written: string[]; unchanged: string[]; backupDir: string | null };

export type MutationApplyDeps = {
  beforeCommit?: (input: { operation: InspectedMutationOperation; index: number }) => void | Promise<void>;
  beforeBackup?: (input: { operation: InspectedMutationOperation; index: number }) => void | Promise<void>;
  afterBackup?: (input: { operation: InspectedMutationOperation; index: number }) => void | Promise<void>;
  afterCommit?: (input: { operation: InspectedMutationOperation; index: number }) => void | Promise<void>;
  backupBase?: string;
  retainBackupsOnSuccess?: boolean;
};

type Applied = {
  operation: InspectedMutationOperation; output?: PathFingerprint; backupPath?: string; absolutePath: string;
};

type CreatedDirectory = { path: string; identity: DirectoryIdentity };

export class MutationTransactionError extends Error {
  readonly mutationState: "rolled-back" | "rollback-incomplete";
  readonly recoveryPath: string | null;

  constructor(message: string, state: "rolled-back" | "rollback-incomplete", recoveryPath: string | null, cause: unknown) {
    super(recoveryPath ? `${message}; recovery material retained at ${recoveryPath}` : message, { cause });
    this.name = "MutationTransactionError";
    this.mutationState = state;
    this.recoveryPath = recoveryPath;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

function safeRelativePath(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some((part) => part === ".." || part === "")) {
    throw new Error(`Mutation path must be a normalized relative path: ${path}`);
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function absoluteInside(root: string, path: string): string {
  safeRelativePath(path);
  const absolute = resolve(root, path);
  if (!inside(root, absolute)) throw new Error(`Mutation path escaped target: ${path}`);
  return absolute;
}

function hash(parts: Array<string | Buffer>): string {
  const digest = createHash("sha256");
  for (const part of parts) digest.update(part);
  return digest.digest("hex");
}

async function fingerprintTree(path: string): Promise<string> {
  const parts: Array<string | Buffer> = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(current, entry.name);
      const stats = await lstat(absolute, { bigint: true });
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
        throw new Error(`Tree contains unsupported ${stats.isSymbolicLink() ? "symbolic link" : "special file"}: ${relativePath}`);
      }
      parts.push(`${entry.isDirectory() ? "d" : "f"}\0${relativePath}\0${Number(stats.mode & 0o7777n)}\0`);
      if (entry.isDirectory()) {
        await walk(absolute, relativePath);
      } else {
        const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const content = await handle.readFile();
          const after = await handle.stat({ bigint: true });
          if (after.dev !== stats.dev || after.ino !== stats.ino || after.size !== stats.size || after.mtimeNs !== stats.mtimeNs) {
            throw new Error(`${absolute} changed while its tree was inspected`);
          }
          parts.push(content);
        } finally {
          await handle.close();
        }
      }
    }
  };
  await walk(path, "");
  return hash(parts);
}

export async function fingerprintPath(path: string): Promise<PathFingerprint> {
  let stats;
  try {
    stats = await lstat(path, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { kind: "absent" };
    throw error;
  }
  const identity = { dev: stats.dev.toString(), ino: stats.ino.toString() };
  if (stats.isSymbolicLink()) return { kind: "link", ...identity, target: await readlink(path) };
  if (stats.isFile()) {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const content = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (after.dev !== stats.dev || after.ino !== stats.ino || after.mtimeNs !== stats.mtimeNs || after.size !== stats.size) {
        throw new Error(`${path} changed while it was inspected`);
      }
      return {
        kind: "file", ...identity, size: stats.size.toString(), mtimeNs: stats.mtimeNs.toString(),
        mode: Number(stats.mode & 0o7777n), sha256: hash([content]),
      };
    } finally {
      await handle.close();
    }
  }
  if (stats.isDirectory()) {
    return { kind: "tree", ...identity, mode: Number(stats.mode & 0o7777n), sha256: await fingerprintTree(path) };
  }
  throw new Error(`${path} is a special file and cannot be mutated`);
}

function sameFingerprint(left: PathFingerprint, right: PathFingerprint): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameTreeContent(left: PathFingerprint, right: PathFingerprint): boolean {
  return left.kind === "tree" && right.kind === "tree" && left.mode === right.mode && left.sha256 === right.sha256;
}

async function inspectLinkTarget(root: string, absolute: string, target: string, operationPath: string): Promise<ReviewedLinkTarget> {
  const path = resolve(dirname(absolute), target);
  if (!inside(root, path)) throw new Error(`Reviewed link escapes target: ${operationPath}`);
  const expected = await fingerprintPath(path);
  if (expected.kind === "absent") throw new Error(`Reviewed link target is missing: ${operationPath}`);
  const realRoot = await realpath(root);
  const realPath = await realpath(path);
  if (!inside(realRoot, realPath)) throw new Error(`Reviewed link escapes target: ${operationPath}`);
  const realExpected = await fingerprintPath(realPath);
  if (realExpected.kind !== "tree") throw new Error(`Reviewed link target is not a regular tree: ${operationPath}`);
  return { path, expected, realPath, realExpected };
}

export async function inspectMutationPlan(targetDir: string, operations: MutationOperation[]): Promise<MutationPlan> {
  const root = resolve(targetDir);
  const seen = new Set<string>();
  const inspected: InspectedMutationOperation[] = [];
  for (const operation of operations) {
    const absolute = absoluteInside(root, operation.path);
    if (seen.has(absolute)) throw new Error(`Mutation plan contains duplicate path: ${operation.path}`);
    seen.add(absolute);
    const expected = await fingerprintPath(absolute);
    if (operation.kind === "replace-tree") {
      const sourceExpected = await fingerprintPath(operation.sourcePath);
      if (sourceExpected.kind !== "tree") throw new Error(`Replacement source is not a regular tree: ${operation.sourcePath}`);
      inspected.push({ ...operation, expected, sourceExpected });
      continue;
    }
    if (operation.kind === "remove-tree") {
      if (expected.kind !== "tree") throw new Error(`Removal target is not a regular tree: ${operation.path}`);
    }
    if (operation.kind === "link") {
      inspected.push({ ...operation, expected, linkTarget: await inspectLinkTarget(root, absolute, operation.target, operation.path) });
      continue;
    }
    inspected.push({ ...operation, expected });
  }
  return { targetDir: root, operations: inspected };
}

async function ensureRoot(root: string, created: Map<string, CreatedDirectory>): Promise<DirectoryIdentity> {
  const missing: string[] = [];
  let current = root;
  while (true) {
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${current} is not a regular directory`);
      break;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      missing.push(current);
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
  await mkdir(root, { recursive: true });
  for (const path of [...missing].reverse()) created.set(path, { path, identity: await directoryIdentity(path) });
  return directoryIdentity(root);
}

async function ensureParents(
  root: string,
  rootIdentity: DirectoryIdentity,
  absolute: string,
  created: Map<string, CreatedDirectory>,
): Promise<void> {
  const rel = relative(root, dirname(absolute));
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Unsafe mutation parent: ${relative(root, current)}`);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      try {
        await mkdir(current);
        created.set(current, { path: current, identity: await directoryIdentity(current) });
      } catch (mkdirError) {
        if (errorCode(mkdirError) !== "EEXIST") throw mkdirError;
        const raced = await lstat(current);
        if (raced.isSymbolicLink() || !raced.isDirectory()) throw new Error(`Unsafe raced mutation parent: ${relative(root, current)}`);
      }
    }
  }
  await assertStableDirectoryChain(root, rootIdentity, dirname(absolute));
}

async function validateSource(operation: InspectedMutationOperation): Promise<void> {
  if (operation.kind !== "replace-tree" || !operation.sourceExpected) return;
  if (!sameFingerprint(await fingerprintPath(operation.sourcePath), operation.sourceExpected)) {
    throw new Error(`Replacement source changed after review: ${operation.path}`);
  }
}

async function validateLinkTarget(root: string, operation: InspectedMutationOperation): Promise<void> {
  if (operation.kind !== "link" || !operation.linkTarget) return;
  const reviewed = operation.linkTarget;
  if (!sameFingerprint(await fingerprintPath(reviewed.path), reviewed.expected)) {
    throw new Error(`Link target changed after review: ${operation.path}`);
  }
  const realRoot = await realpath(root);
  const currentReal = await realpath(reviewed.path);
  if (!inside(realRoot, currentReal) || currentReal !== reviewed.realPath) {
    throw new Error(`Link target changed or escaped after review: ${operation.path}`);
  }
  if (!sameFingerprint(await fingerprintPath(currentReal), reviewed.realExpected)) {
    throw new Error(`Resolved link target changed after review: ${operation.path}`);
  }
}

async function stageTree(operation: InspectedMutationOperation, destination: string): Promise<PathFingerprint> {
  if (operation.kind !== "replace-tree" || !operation.sourceExpected) throw new Error("missing reviewed replacement source");
  await validateSource(operation);
  await cp(operation.sourcePath, destination, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  await validateSource(operation);
  const staged = await fingerprintPath(destination);
  if (!sameTreeContent(staged, operation.sourceExpected)) throw new Error(`Replacement source changed while staging: ${operation.path}`);
  return staged;
}

async function removeUnchanged(path: string, expected: PathFingerprint): Promise<void> {
  const current = await fingerprintPath(path);
  if (!sameFingerprint(current, expected)) throw new Error(`${path} changed after Farrier committed it`);
  await rm(path, { recursive: current.kind === "tree" || current.kind === "link", force: true });
}

async function rollback(applied: Applied[]): Promise<string[]> {
  const failures: string[] = [];
  for (const change of [...applied].reverse()) {
    try {
      if (change.output) {
        await removeUnchanged(change.absolutePath, change.output);
      } else {
        const current = await fingerprintPath(change.absolutePath);
        if (current.kind !== "absent") throw new Error(`${change.absolutePath} has unverified output; original retained in recovery backup`);
      }
      if (change.backupPath) await rename(change.backupPath, change.absolutePath);
    } catch (error) {
      failures.push(`${change.operation.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

async function removeBackupRootIfOwned(
  backupRoot: string,
  created: Map<string, CreatedDirectory>,
): Promise<boolean> {
  const owned = created.get(backupRoot);
  if (!owned) return false;
  try {
    const current = await directoryIdentity(backupRoot);
    if (current.dev !== owned.identity.dev || current.ino !== owned.identity.ino) return false;
    await rm(backupRoot, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function cleanupCreatedDirectories(created: Map<string, CreatedDirectory>, failures: string[]): Promise<void> {
  const ordered = [...created.values()].sort((left, right) => right.path.length - left.path.length);
  for (const entry of ordered) {
    try {
      const current = await directoryIdentity(entry.path);
      if (current.dev !== entry.identity.dev || current.ino !== entry.identity.ino) throw new Error("directory identity changed");
      if ((await readdir(entry.path)).length === 0) await rmdir(entry.path);
    } catch (error) {
      if (errorCode(error) !== "ENOENT" && error instanceof Error && error.message === "directory identity changed") {
        failures.push(`${entry.path}: ${error.message}`);
      }
    }
  }
}

export async function applyMutationPlan(plan: MutationPlan, deps: MutationApplyDeps = {}): Promise<MutationResult> {
  const root = resolve(plan.targetDir);
  const transactionId = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const backupRelative = deps.backupBase ?? join(".farrier-staging", "transactions", transactionId);
  safeRelativePath(backupRelative);
  if (backupRelative === "." || normalize(backupRelative) !== backupRelative) {
    throw new Error(`Backup path must be a normalized relative path: ${backupRelative}`);
  }
  const backupRoot = absoluteInside(root, backupRelative);
  for (const operation of plan.operations) {
    const target = absoluteInside(root, operation.path);
    if (inside(backupRoot, target) || inside(target, backupRoot)) {
      throw new Error(`Backup path overlaps mutation target: ${operation.path}`);
    }
  }
  const retainBackups = deps.retainBackupsOnSuccess ?? true;
  const applied: Applied[] = [];
  const written: string[] = [];
  const unchanged: string[] = [];
  const createdDirectories = new Map<string, CreatedDirectory>();
  const backupDirectories = new Map<string, CreatedDirectory>();
  const stagedArtifacts = new Set<string>();
  let hasBackup = false;
  let ownsBackupRoot = false;

  try {
    const rootIdentity = await ensureRoot(root, createdDirectories);
    try {
      await lstat(backupRoot);
      throw new Error(`Backup path already exists: ${backupRelative}`);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    await ensureParents(root, rootIdentity, join(backupRoot, ".farrier-owner"), backupDirectories);
    ownsBackupRoot = backupDirectories.has(backupRoot);
    if (!ownsBackupRoot) throw new Error(`Backup path was not created by this transaction: ${backupRelative}`);
    for (const [index, operation] of plan.operations.entries()) {
      const absolute = absoluteInside(root, operation.path);
      await ensureParents(root, rootIdentity, absolute, createdDirectories);
      const current = await fingerprintPath(absolute);
      if (!sameFingerprint(current, operation.expected)) throw new Error(`${operation.path} changed after review`);
      await validateSource(operation);
      await validateLinkTarget(root, operation);

      if (operation.kind === "write-file") {
        const content = typeof operation.content === "string" ? Buffer.from(operation.content) : operation.content;
        if (current.kind === "file" && current.sha256 === hash([content]) && (operation.mode === undefined || current.mode === operation.mode)) {
          unchanged.push(operation.path);
          continue;
        }
      }

      await deps.beforeCommit?.({ operation, index });
      await assertStableDirectoryChain(root, rootIdentity, dirname(absolute));
      if (!sameFingerprint(await fingerprintPath(absolute), operation.expected)) throw new Error(`${operation.path} changed before commit`);
      await validateSource(operation);
      await validateLinkTarget(root, operation);

      let staged: string | undefined;
      let stagedOutput: PathFingerprint | undefined;
      let stagedFile: Awaited<ReturnType<typeof stageFile>> | undefined;
      if (operation.kind === "write-file") {
        stagedFile = await stageFile(absolute, operation.content, operation.mode ?? (current.kind === "file" ? current.mode : undefined));
        stagedArtifacts.add(stagedFile.path);
        stagedOutput = await fingerprintPath(stagedFile.path);
      }
      if (operation.kind === "replace-tree") {
        staged = join(dirname(absolute), `.farrier-tree-${transactionId}-${index}`);
        stagedArtifacts.add(staged);
        stagedOutput = await stageTree(operation, staged);
      }

      let backupPath: string | undefined;
      await deps.beforeBackup?.({ operation, index });
      if (current.kind !== "absent") {
        backupPath = join(backupRoot, operation.path);
        const owned = backupDirectories.get(backupRoot);
        const currentBackupIdentity = await directoryIdentity(backupRoot);
        if (!owned || currentBackupIdentity.dev !== owned.identity.dev || currentBackupIdentity.ino !== owned.identity.ino) {
          throw new Error(`Transaction backup path changed before use: ${backupRelative}`);
        }
        await ensureParents(root, rootIdentity, backupPath, backupDirectories);
        await rename(absolute, backupPath);
        hasBackup = true;
      }
      const change: Applied = { operation, backupPath, absolutePath: absolute };
      applied.push(change);

      try {
        await deps.afterBackup?.({ operation, index });
        await validateSource(operation);
        await validateLinkTarget(root, operation);
        if (operation.kind === "write-file") {
          if (!stagedFile || !stagedOutput) throw new Error("missing staged file");
          if (current.kind === "absent") await commitStagedCreation(stagedFile, absolute);
          else await commitStagedReplacement(stagedFile, absolute);
          change.output = stagedOutput;
        } else if (operation.kind === "replace-tree") {
          if (!staged || !stagedOutput) throw new Error("missing staged tree");
          await rename(staged, absolute);
          change.output = stagedOutput;
        } else if (operation.kind === "link") {
          await symlink(operation.target, absolute, "dir");
          change.output = await fingerprintPath(absolute);
          const committedReal = await realpath(absolute);
          if (!operation.linkTarget || committedReal !== operation.linkTarget.realPath) {
            throw new Error(`Committed link does not resolve to reviewed target: ${operation.path}`);
          }
          await validateLinkTarget(root, operation);
        } else {
          change.output = { kind: "absent" };
        }
        written.push(operation.path);
        await deps.afterCommit?.({ operation, index });
      } finally {
        if (stagedFile) {
          await rm(stagedFile.path, { force: true }).catch(() => undefined);
          stagedArtifacts.delete(stagedFile.path);
        }
        if (staged) {
          await rm(staged, { recursive: true, force: true }).catch(() => undefined);
          stagedArtifacts.delete(staged);
        }
      }
    }
  } catch (error) {
    await Promise.all([...stagedArtifacts].map((path) => rm(path, { recursive: true, force: true }).catch(() => undefined)));
    const failures = await rollback(applied);
    const incomplete = failures.length > 0;
    if (ownsBackupRoot && (!incomplete || !hasBackup)) {
      await removeBackupRootIfOwned(backupRoot, backupDirectories);
    }
    await cleanupCreatedDirectories(incomplete ? createdDirectories : new Map([...createdDirectories, ...backupDirectories]), failures);
    const rollbackIncomplete = failures.length > 0;
    const message = error instanceof Error ? error.message : String(error);
    throw new MutationTransactionError(
      rollbackIncomplete ? `${message}; rollback incomplete: ${failures.join("; ")}` : message,
      rollbackIncomplete ? "rollback-incomplete" : "rolled-back",
      rollbackIncomplete && hasBackup ? backupRelative : null,
      error,
    );
  }

  if (ownsBackupRoot && (!hasBackup || !retainBackups)) {
    if (!await removeBackupRootIfOwned(backupRoot, backupDirectories)) {
      throw new Error(`Transaction backup path changed before cleanup: ${backupRelative}`);
    }
    const failures: string[] = [];
    await cleanupCreatedDirectories(backupDirectories, failures);
    if (failures.length > 0) throw new Error(`Failed to clean transaction backup directories: ${failures.join("; ")}`);
  }
  return { written, unchanged, backupDir: hasBackup && retainBackups ? backupRelative : null };
}
