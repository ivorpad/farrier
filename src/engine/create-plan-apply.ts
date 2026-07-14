import { lstat, mkdir, rm, rmdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  assertHarnessChangePlanWritable,
  inspectHarnessChangePlan,
  type ApplyHarnessChangePlanDeps,
  type ApplyHarnessChangePlanOptions,
  type ApplyHarnessChangePlanResult,
  type HarnessFileChange,
} from "./create-plan";
import {
  assertStableDirectoryChain,
  commitStagedCreation,
  commitStagedReplacement,
  directoryIdentity,
  pathMatchesFingerprint,
  removeStaged,
  sameFingerprint,
  snapshotRegularFile,
  stageFile,
  type DirectoryIdentity,
  type FileFingerprint,
  type FileSnapshot,
} from "./create-plan-fs";
import { renderPlanDigest, type RenderPlan } from "./render";

type OriginalFile = { existed: false } | { existed: true; snapshot: FileSnapshot };
type AppliedChange = { path: string; absolutePath: string; original: OriginalFile; written: FileFingerprint };

export class HarnessApplyError extends Error {
  readonly mutationState: "rolled-back" | "rollback-incomplete";
  readonly backupDir: string | null;

  constructor(message: string, options: { mutationState: "rolled-back" | "rollback-incomplete"; backupDir: string | null; cause: unknown }) {
    super(options.backupDir ? `${message}; recovery backup retained at ${options.backupDir}` : message, { cause: options.cause });
    this.name = "HarnessApplyError";
    this.mutationState = options.mutationState;
    this.backupDir = options.backupDir;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

async function maybeLstat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function nowFrom(options: ApplyHarnessChangePlanOptions): Date {
  return typeof options.now === "function" ? options.now() : (options.now ?? new Date());
}

function backupDirectory(date: Date): string {
  const timestamp = date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return join(".farrier-staging", "backups", timestamp);
}

async function ensureDirectory(targetRoot: string, absoluteDirectory: string, created: Set<string>): Promise<void> {
  const fromRoot = relative(targetRoot, absoluteDirectory);
  let current = targetRoot;
  for (const component of fromRoot.split(sep).filter(Boolean)) {
    current = join(current, component);
    const info = await maybeLstat(current);
    if (info) {
      if (info.isSymbolicLink()) throw new Error(`Refusing symbolic-link directory ${relative(targetRoot, current)}`);
      if (!info.isDirectory()) throw new Error(`Refusing non-directory parent ${relative(targetRoot, current)}`);
      continue;
    }
    try {
      await mkdir(current);
      created.add(current);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const raced = await lstat(current);
      if (raced.isSymbolicLink() || !raced.isDirectory()) throw new Error(`Refusing unsafe parent ${relative(targetRoot, current)}`);
    }
  }
}

async function snapshotFor(change: HarnessFileChange, absolutePath: string): Promise<OriginalFile> {
  const info = await maybeLstat(absolutePath);
  if (change.action === "create") {
    if (info) throw new Error(`${change.path} appeared after the change plan was inspected`);
    return { existed: false };
  }
  if (!info || info.isSymbolicLink() || !info.isFile()) throw new Error(`${change.path} changed to an unsafe file type after the change plan was inspected`);
  const snapshot = await snapshotRegularFile(absolutePath);
  if (!change.inspection || !sameFingerprint(snapshot.fingerprint, change.inspection)) throw new Error(`${change.path} changed after the creation plan was inspected`);
  return { existed: true, snapshot };
}

async function writeBackup(
  targetRoot: string,
  backupDir: string,
  path: string,
  original: Extract<OriginalFile, { existed: true }>,
  rootIdentity: DirectoryIdentity,
  backupDirectories: Set<string>,
  backupFiles: Map<string, FileFingerprint>,
): Promise<void> {
  const absoluteBackup = join(targetRoot, backupDir, path);
  await ensureDirectory(targetRoot, dirname(absoluteBackup), backupDirectories);
  await assertStableDirectoryChain(targetRoot, rootIdentity, dirname(absoluteBackup));
  const ignorePath = join(targetRoot, ".farrier-staging", ".gitignore");
  if (!(await maybeLstat(ignorePath))) {
    const ignore = await stageFile(ignorePath, "*\n", 0o644);
    try {
      await commitStagedCreation(ignore, ignorePath);
      backupFiles.set(ignorePath, ignore.fingerprint);
    } finally {
      await removeStaged(ignore.path).catch(() => undefined);
    }
  }
  const staged = await stageFile(absoluteBackup, original.snapshot.content, original.snapshot.fingerprint.mode);
  try {
    await commitStagedCreation(staged, absoluteBackup);
    backupFiles.set(absoluteBackup, staged.fingerprint);
  } finally {
    await removeStaged(staged.path).catch(() => undefined);
  }
}

async function removeEmptyDirectories(directories: Set<string>, failures: string[]): Promise<void> {
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (!new Set(["ENOENT", "ENOTEMPTY", "EEXIST"]).has(errorCode(error) ?? "")) failures.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function restoreChange(change: AppliedChange): Promise<string | undefined> {
  if (!(await pathMatchesFingerprint(change.absolutePath, change.written))) return `${change.path}: rollback conflict; the path changed after Farrier wrote it`;
  if (!change.original.existed) {
    if (!(await pathMatchesFingerprint(change.absolutePath, change.written))) return `${change.path}: rollback conflict before removing the created file`;
    await rm(change.absolutePath, { force: true });
    return undefined;
  }

  const staged = await stageFile(change.absolutePath, change.original.snapshot.content, change.original.snapshot.fingerprint.mode);
  try {
    if (!(await pathMatchesFingerprint(change.absolutePath, change.written))) return `${change.path}: rollback conflict before restoring the original`;
    await commitStagedReplacement(staged, change.absolutePath);
    const restored = await snapshotRegularFile(change.absolutePath);
    if (restored.fingerprint.sha256 !== change.original.snapshot.fingerprint.sha256 || restored.fingerprint.mode !== change.original.snapshot.fingerprint.mode) {
      return `${change.path}: restored content or permissions did not match the original`;
    }
    return undefined;
  } finally {
    await removeStaged(staged.path).catch(() => undefined);
  }
}

async function restoreChanges(changes: AppliedChange[]): Promise<string[]> {
  const failures: string[] = [];
  for (const change of [...changes].reverse()) {
    try {
      const failure = await restoreChange(change);
      if (failure) failures.push(failure);
    } catch (error) {
      failures.push(`${change.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

async function cleanupFailedRunBackups(backupFiles: Map<string, FileFingerprint>, backupDirectories: Set<string>): Promise<string[]> {
  const failures: string[] = [];
  for (const [file, fingerprint] of backupFiles) {
    try {
      if (!(await pathMatchesFingerprint(file, fingerprint))) {
        failures.push(`${file}: rollback conflict; backup path changed before cleanup`);
        continue;
      }
      await rm(file, { force: true });
    } catch (error) {
      failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await removeEmptyDirectories(backupDirectories, failures);
  return failures;
}

async function ensureTargetRoot(targetRoot: string, createdDirectories: Set<string>): Promise<DirectoryIdentity> {
  const existing = await maybeLstat(targetRoot);
  if (!existing) {
    await mkdir(targetRoot, { recursive: true });
    createdDirectories.add(targetRoot);
  } else if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new Error("Target directory changed to an unsafe type after the creation plan was inspected");
  }
  return directoryIdentity(targetRoot);
}

async function assertOriginalStillCurrent(change: HarnessFileChange, original: OriginalFile, absolutePath: string): Promise<void> {
  if (!original.existed) {
    if (await maybeLstat(absolutePath)) throw new Error(`${change.path} appeared after the creation plan was inspected`);
    return;
  }
  const current = await snapshotRegularFile(absolutePath);
  if (!sameFingerprint(current.fingerprint, original.snapshot.fingerprint)) throw new Error(`${change.path} changed after the creation plan was inspected`);
}

export async function applyHarnessChangePlan(renderPlan: RenderPlan, options: ApplyHarnessChangePlanOptions, deps: ApplyHarnessChangePlanDeps = {}): Promise<ApplyHarnessChangePlanResult> {
  if (renderPlan.reviewedDigest && renderPlanDigest(renderPlan.files) !== renderPlan.reviewedDigest) {
    throw new HarnessApplyError(
      "Refusing to apply: rendered bytes changed after review; rerun preview and review the new executable payload",
      { cause: new Error("review digest mismatch"), mutationState: "rolled-back", backupDir: null }
    );
  }
  const plan = await inspectHarnessChangePlan(renderPlan);
  assertHarnessChangePlanWritable(plan, options);
  const targetRoot = resolve(renderPlan.targetDir);
  const changeByPath = new Map(plan.files.map((file) => [file.path, file]));
  const written: string[] = [];
  const unchanged = plan.files.filter((file) => file.action === "unchanged").map((file) => file.path);
  const applied: AppliedChange[] = [];
  const createdDirectories = new Set<string>();
  const backupDirectories = new Set<string>();
  const backupFiles = new Map<string, FileFingerprint>();
  const stagedPaths = new Set<string>();
  const backupDir = plan.replacementPaths.length > 0 ? backupDirectory(nowFrom(options)) : null;

  try {
    const rootIdentity = await ensureTargetRoot(targetRoot, createdDirectories);
    for (const [index, file] of renderPlan.files.entries()) {
      const change = changeByPath.get(file.path);
      if (!change || change.action === "unchanged") continue;

      const absolutePath = resolve(targetRoot, file.path);
      await ensureDirectory(targetRoot, dirname(absolutePath), createdDirectories);
      await assertStableDirectoryChain(targetRoot, rootIdentity, dirname(absolutePath));
      const original = await snapshotFor(change, absolutePath);
      if (change.action === "replace" && backupDir && original.existed) {
        await writeBackup(targetRoot, backupDir, file.path, original, rootIdentity, backupDirectories, backupFiles);
      }

      const finalMode = file.mode ?? (original.existed ? original.snapshot.fingerprint.mode : undefined);
      const staged = await stageFile(absolutePath, file.content, finalMode);
      stagedPaths.add(staged.path);
      await deps.beforeWrite?.({ file, change, index });
      await assertStableDirectoryChain(targetRoot, rootIdentity, dirname(absolutePath));
      await assertOriginalStillCurrent(change, original, absolutePath);
      if (original.existed) await commitStagedReplacement(staged, absolutePath);
      else await commitStagedCreation(staged, absolutePath);
      await removeStaged(staged.path).catch(() => undefined);
      stagedPaths.delete(staged.path);
      applied.push({ path: file.path, absolutePath, original, written: staged.fingerprint });
      if (!(await pathMatchesFingerprint(absolutePath, staged.fingerprint))) throw new Error(`${file.path} changed while Farrier was committing it`);
      written.push(file.path);
    }
  } catch (error) {
    await Promise.all([...stagedPaths].map((path) => removeStaged(path).catch(() => undefined)));
    const rollbackFailures = await restoreChanges(applied);
    if (rollbackFailures.length === 0) rollbackFailures.push(...(await cleanupFailedRunBackups(backupFiles, backupDirectories)));
    await removeEmptyDirectories(createdDirectories, rollbackFailures);
    const message = error instanceof Error ? error.message : String(error);
    const incomplete = rollbackFailures.length > 0;
    throw new HarnessApplyError(incomplete ? `${message}; rollback incomplete: ${rollbackFailures.join("; ")}` : message, {
      cause: error,
      mutationState: incomplete ? "rollback-incomplete" : "rolled-back",
      backupDir: incomplete ? backupDir : null,
    });
  }

  return { written, unchanged, writtenFiles: written, unchangedFiles: unchanged, backupDir };
}
