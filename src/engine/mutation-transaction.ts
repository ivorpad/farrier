import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type ReplaceTreeOperation = { type: "replace-tree"; path: string; sourcePath: string };
export type LinkOperation = { type: "link"; path: string; target: string };
export type ReplaceFileOperation = { type: "replace-file"; path: string; content: string; mode?: number; managedExisting?: boolean };
export type RemoveOperation = { type: "remove"; path: string };
export type MutationOperation = ReplaceTreeOperation | LinkOperation | ReplaceFileOperation | RemoveOperation;

type MissingSnapshot = { type: "missing" };
type TreeSnapshot = { type: "tree"; sha256: string };
type FileSnapshot = { type: "file"; sha256: string; mode: number };
type LinkSnapshot = { type: "link"; target: string; resolvesTo: string };
type PathSnapshot = MissingSnapshot | TreeSnapshot | FileSnapshot | LinkSnapshot;

export type InspectedMutationOperation = {
  operation: MutationOperation;
  destination: PathSnapshot;
  source?: TreeSnapshot;
  plannedTargetPath?: string;
  plannedTargetSource?: TreeSnapshot;
};

export type MutationInspection = {
  targetDir: string;
  force: boolean;
  operations: InspectedMutationOperation[];
};

export type MutationApplyResult = {
  state: "committed";
  paths: string[];
  links: Array<{ path: string; target: string; resolvesTo: string }>;
  backupDir: string | null;
};

export class MutationApplyError extends Error {
  readonly mutationState: "rolled-back" | "rollback-incomplete";
  readonly backupDir: string | null;

  constructor(message: string, state: "rolled-back" | "rollback-incomplete", backupDir: string | null, cause: unknown) {
    super(backupDir ? `${message}; recovery material retained at ${backupDir}` : message, { cause });
    this.name = "MutationApplyError";
    this.mutationState = state;
    this.backupDir = backupDir;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

function outside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

function safeRelative(path: string, field: string): void {
  if (!path || isAbsolute(path) || path.includes("\0") || path.split(/[\\/]/).includes("..")) {
    throw new Error(`${field} must be a safe target-directory-relative path`);
  }
}

async function maybeLstat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function hashFile(path: string): Promise<{ sha256: string; mode: number }> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${path} is not a regular file`);
  const content = await readFile(path);
  return { sha256: createHash("sha256").update(content).digest("hex"), mode: info.mode & 0o7777 };
}

async function treeFingerprint(root: string): Promise<TreeSnapshot> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error(`${root} is not a regular directory tree`);
  const parts: string[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = [...new Bun.Glob("*").scanSync({ cwd: directory, dot: true, onlyFiles: false })].sort();
    for (const name of entries) {
      const path = join(directory, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`tree source contains unsupported symbolic link ${rel}`);
      if (info.isDirectory()) {
        parts.push(`d\0${rel}\0${info.mode & 0o7777}`);
        await walk(path, rel);
      } else if (info.isFile()) {
        const file = await hashFile(path);
        parts.push(`f\0${rel}\0${file.mode}\0${file.sha256}`);
      } else {
        throw new Error(`tree source contains unsupported special file ${rel}`);
      }
    }
  };
  await walk(root, "");
  return { type: "tree", sha256: createHash("sha256").update(parts.join("\n")).digest("hex") };
}

async function snapshotPath(root: string, relPath: string): Promise<PathSnapshot> {
  const absolute = resolve(root, relPath);
  const info = await maybeLstat(absolute);
  if (!info) return { type: "missing" };
  if (info.isSymbolicLink()) {
    const target = await readlink(absolute);
    const resolved = resolve(dirname(absolute), target);
    let real: string;
    try {
      real = await realpath(resolved);
    } catch {
      throw new Error(`${relPath} is a dangling symbolic link`);
    }
    if (outside(await realpath(root), real)) throw new Error(`${relPath} resolves outside the target directory`);
    return { type: "link", target, resolvesTo: relative(root, real).replaceAll(sep, "/") };
  }
  if (info.isDirectory()) return treeFingerprint(absolute);
  if (info.isFile()) return { type: "file", ...(await hashFile(absolute)) };
  throw new Error(`${relPath} is an unsupported special file`);
}

function sameSnapshot(left: PathSnapshot, right: PathSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function inspectParents(root: string, relPath: string): Promise<void> {
  let current = root;
  for (const component of dirname(relPath).split(/[\\/]/).filter((part) => part && part !== ".")) {
    current = join(current, component);
    const info = await maybeLstat(current);
    if (!info) return;
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`unsafe parent ${relative(root, current)}`);
  }
}

function acceptsExisting(operation: MutationOperation, snapshot: PathSnapshot, force: boolean, reviewOnly: boolean): boolean {
  if (snapshot.type === "missing") return operation.type !== "remove";
  if (operation.type === "replace-file") return snapshot.type === "file" && (operation.managedExisting === true || force || reviewOnly);
  if (operation.type === "remove") return snapshot.type === "tree" || snapshot.type === "link";
  return (force || reviewOnly) && (snapshot.type === "tree" || snapshot.type === "link");
}

export async function inspectMutationPlan(
  targetDir: string,
  operations: MutationOperation[],
  options: { force?: boolean; reviewOnly?: boolean } = {}
): Promise<MutationInspection> {
  const root = resolve(targetDir);
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("target directory must be a regular directory");
  const force = options.force ?? false;
  const seen = new Set<string>();
  const inspected: InspectedMutationOperation[] = [];

  for (const operation of operations) {
    safeRelative(operation.path, "mutation path");
    if (seen.has(operation.path)) throw new Error(`mutation plan repeats destination '${operation.path}'`);
    seen.add(operation.path);
    await inspectParents(root, operation.path);
    const destination = await snapshotPath(root, operation.path);
    if (!acceptsExisting(operation, destination, force, options.reviewOnly ?? false)) {
      if (operation.type === "remove" && destination.type === "missing") throw new Error(`${operation.path} does not exist`);
      throw new Error(`${operation.path} already exists; use --force to replace the reviewed ${destination.type}`);
    }

    if (operation.type === "replace-tree") {
      const sourceAbs = resolve(root, operation.sourcePath);
      if (outside(root, sourceAbs)) throw new Error(`tree source '${operation.sourcePath}' escapes the target directory`);
      inspected.push({ operation, destination, source: await treeFingerprint(sourceAbs) });
      continue;
    }
    if (operation.type === "link") {
      if (isAbsolute(operation.target) || operation.target.includes("\0")) throw new Error(`link target for ${operation.path} must be relative`);
      const targetAbs = resolve(dirname(resolve(root, operation.path)), operation.target);
      if (outside(root, targetAbs)) throw new Error(`link target for ${operation.path} escapes the target directory`);
      const targetPath = relative(root, targetAbs).replaceAll(sep, "/");
      const prior = inspected.find((item) => item.operation.type === "replace-tree" && item.operation.path === targetPath);
      if (prior?.source) {
        inspected.push({ operation, destination, plannedTargetPath: targetPath, plannedTargetSource: prior.source });
        continue;
      }
      const target = await maybeLstat(targetAbs);
      if (target) {
        const real = await realpath(targetAbs);
        if (outside(await realpath(root), real) || !(await lstat(real)).isDirectory()) throw new Error(`link target for ${operation.path} is not a safe in-root tree`);
        inspected.push({ operation, destination, plannedTargetPath: targetPath, plannedTargetSource: await treeFingerprint(real) });
        continue;
      }
      throw new Error(`link target for ${operation.path} must exist or be created by an earlier replace-tree operation`);
    }
    inspected.push({ operation, destination });
  }
  return { targetDir: root, force, operations: inspected };
}

async function ensureParents(root: string, relPath: string, created: Set<string>): Promise<void> {
  let current = root;
  for (const component of dirname(relPath).split(/[\\/]/).filter((part) => part && part !== ".")) {
    current = join(current, component);
    const info = await maybeLstat(current);
    if (!info) {
      await mkdir(current);
      created.add(current);
    } else if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`unsafe parent ${relative(root, current)}`);
    }
  }
}

async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(destination);
  const entries = [...new Bun.Glob("**/*").scanSync({ cwd: source, dot: true, onlyFiles: false })].sort();
  for (const rel of entries) {
    const from = join(source, rel);
    const to = join(destination, rel);
    const info = await lstat(from);
    if (info.isDirectory()) await mkdir(to, { recursive: true, mode: info.mode & 0o7777 });
    else if (info.isFile()) {
      await mkdir(dirname(to), { recursive: true });
      await Bun.write(to, Bun.file(from));
      await Bun.file(to).exists();
      const handle = await open(to, "r+");
      await handle.chmod(info.mode & 0o7777);
      await handle.close();
    } else throw new Error(`tree source changed to an unsupported type at ${rel}`);
  }
}

type Applied = { item: InspectedMutationOperation; written: PathSnapshot; backup?: string };

function backupRoot(): string {
  return `.farrier-staging/backups/${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID().slice(0, 8)}`;
}

async function removeEmptyCreated(created: Set<string>): Promise<void> {
  for (const path of [...created].sort((a, b) => b.length - a.length)) await rm(path, { recursive: false, force: true }).catch(() => undefined);
}

async function rollback(root: string, applied: Applied[], created: Set<string>): Promise<string[]> {
  const failures: string[] = [];
  for (const entry of [...applied].reverse()) {
    const path = entry.item.operation.path;
    const absolute = resolve(root, path);
    try {
      const current = await snapshotPath(root, path);
      if (!sameSnapshot(current, entry.written)) {
        failures.push(`${path}: rollback conflict; destination changed after Farrier wrote it`);
        continue;
      }
      await rm(absolute, { recursive: true, force: true });
      if (entry.backup) await rename(entry.backup, absolute);
    } catch (error) {
      failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await removeEmptyCreated(created);
  return failures;
}

export async function applyMutationPlan(
  inspection: MutationInspection,
  deps: { beforeOperation?: (item: InspectedMutationOperation, index: number) => Promise<void> | void } = {}
): Promise<MutationApplyResult> {
  const root = inspection.targetDir;
  const backupDir = inspection.operations.some((item) => item.destination.type !== "missing") ? backupRoot() : null;
  const created = new Set<string>();
  const applied: Applied[] = [];
  const links: MutationApplyResult["links"] = [];
  try {
    for (const [index, item] of inspection.operations.entries()) {
      await deps.beforeOperation?.(item, index);
      const operation = item.operation;
      await ensureParents(root, operation.path, created);
      const current = await snapshotPath(root, operation.path);
      if (!sameSnapshot(current, item.destination)) throw new Error(`${operation.path} changed after the mutation plan was inspected`);
      const absolute = resolve(root, operation.path);
      let backup: string | undefined;
      if (current.type !== "missing") {
        backup = resolve(root, backupDir!, operation.path);
        await ensureParents(root, relative(root, backup), created);
        await rename(absolute, backup);
      }

      try {
        if (operation.type === "replace-tree") {
          const source = resolve(root, operation.sourcePath);
          const sourceNow = await treeFingerprint(source);
          if (!item.source || !sameSnapshot(sourceNow, item.source)) throw new Error(`${operation.sourcePath} changed after review`);
          const temporary = `${absolute}.farrier-${randomUUID().slice(0, 8)}.tmp`;
          await copyTree(source, temporary);
          if (!sameSnapshot(await treeFingerprint(temporary), item.source)) throw new Error(`staged copy for ${operation.path} did not match reviewed content`);
          await rename(temporary, absolute);
        } else if (operation.type === "link") {
          const targetAbs = resolve(dirname(absolute), operation.target);
          const target = await treeFingerprint(targetAbs);
          if (!item.plannedTargetSource || !sameSnapshot(target, item.plannedTargetSource)) throw new Error(`planned link target ${item.plannedTargetPath} changed after review`);
          await symlink(operation.target, absolute, "dir");
          const real = await realpath(absolute);
          const [realRoot, expectedReal] = await Promise.all([realpath(root), realpath(resolve(root, item.plannedTargetPath!))]);
          if (outside(realRoot, real) || expectedReal !== real) throw new Error(`link ${operation.path} resolved to an unexpected path`);
          links.push({ path: operation.path, target: operation.target, resolvesTo: item.plannedTargetPath! });
        } else if (operation.type === "replace-file") {
          const temporary = `${absolute}.farrier-${randomUUID().slice(0, 8)}.tmp`;
          await writeFile(temporary, operation.content, { encoding: "utf8", flag: "wx", mode: operation.mode ?? 0o644 });
          await rename(temporary, absolute);
        }
        const written = operation.type === "remove" ? { type: "missing" } as const : await snapshotPath(root, operation.path);
        applied.push({ item, written, backup });
      } catch (error) {
        if (backup && !(await maybeLstat(absolute))) await rename(backup, absolute).catch(() => undefined);
        throw error;
      }
    }
  } catch (error) {
    const failures = await rollback(root, applied, created);
    const state = failures.length ? "rollback-incomplete" : "rolled-back";
    throw new MutationApplyError(
      failures.length ? `${error instanceof Error ? error.message : String(error)}; ${failures.join("; ")}` : error instanceof Error ? error.message : String(error),
      state,
      failures.length ? backupDir : null,
      error
    );
  }
  return {
    state: "committed",
    paths: inspection.operations.map((item) => item.operation.path),
    links,
    backupDir
  };
}
