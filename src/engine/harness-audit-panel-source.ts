import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readdir, readlink, realpath, symlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const maxTrackedFiles = 50_000;
const maxTrackedBytes = 1024 * 1024 * 1024;
const maxGitOutputBytes = 8 * 1024 * 1024;
const allowedEnvironmentExamples = /^\.env\.(?:example|sample|template)$/i;
const privateFileName = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|credentials?)(?:\.[A-Za-z0-9_-]+)?$|\.(?:jks|key|keystore|p12|pfx|pk8|pem)$/i;
const privateDirectoryName = /^(?:\.aws|\.gnupg|\.ssh)$/;

export type HarnessAuditPanelSourceInspection = {
  sourceDir: string;
  commit: string;
  trackedPaths: string[];
  contentDigest: string;
};

export type HarnessAuditPanelSnapshot = {
  contentDigest: string;
  filesCopied: number;
  bytesCopied: number;
  linksCopied: number;
  omittedSensitivePaths: number;
};

async function gitText(sourceDir: string, args: string[]): Promise<string> {
  const process = Bun.spawn({
    cmd: ["git", "-C", sourceDir, ...args],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    const detail = stderr.replace(/\s+/g, " ").trim().slice(0, 240);
    throw new Error(`Cannot freeze panel source with git${detail ? `: ${detail}` : "."}`);
  }
  if (stdout.byteLength > maxGitOutputBytes) {
    throw new Error("Panel source git metadata exceeds the bounded output limit.");
  }
  return new TextDecoder().decode(stdout);
}

function normalizedTrackedPath(path: string): string | undefined {
  if (!path || path.includes("\0") || isAbsolute(path)) return undefined;
  const normalized = path.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) return undefined;
  return normalized;
}

function sensitivePath(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((part) => privateDirectoryName.test(part))) return true;
  const name = parts.at(-1)!;
  if (name.startsWith(".env") && !allowedEnvironmentExamples.test(name)) return true;
  return privateFileName.test(name);
}

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function parentDirectories(paths: string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    let directory = dirname(path).replaceAll("\\", "/");
    while (directory !== ".") {
      directories.add(directory);
      directory = dirname(directory).replaceAll("\\", "/");
    }
  }
  return [...directories].sort();
}

async function digestSnapshotPaths(root: string, paths: string[], directories: string[]): Promise<string> {
  const contentHash = createHash("sha256");
  for (const path of directories.sort()) contentHash.update(`directory\0${path}\0`);
  let bytesRead = 0;
  for (const path of paths.sort()) {
    const targetPath = join(root, path);
    const stats = await lstat(targetPath);
    if (stats.isSymbolicLink()) {
      const link = await readlink(targetPath);
      const resolvedTarget = resolve(dirname(targetPath), link);
      if (isAbsolute(link) || !within(root, resolvedTarget)) {
        throw new Error("Panel snapshot contains an absolute or escaping symlink.");
      }
      contentHash.update(`link\0${path}\0${link}\0`);
      continue;
    }
    if (!stats.isFile()) throw new Error("Panel snapshot contains a special file.");
    bytesRead += stats.size;
    if (bytesRead > maxTrackedBytes) throw new Error("Panel snapshot exceeds the byte limit.");
    contentHash.update(`file\0${path}\0${stats.mode & 0o111 ? "executable" : "regular"}\0`);
    for await (const chunk of createReadStream(targetPath)) contentHash.update(chunk);
    contentHash.update("\0");
  }
  return contentHash.digest("hex");
}

export async function digestHarnessAuditPanelSnapshot(targetDir: string): Promise<string> {
  const root = await realpath(targetDir);
  const pending = [""];
  const directories: string[] = [];
  const paths: string[] = [];
  while (pending.length) {
    const directory = pending.pop()!;
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        directories.push(path);
        pending.push(path);
      }
      else paths.push(path);
      if (paths.length > maxTrackedFiles || directories.length > maxTrackedFiles * 4) {
        throw new Error("Panel snapshot exceeds the tracked-file limit.");
      }
    }
  }
  return digestSnapshotPaths(root, paths, directories);
}

export async function inspectHarnessAuditPanelSource(
  inputDir: string,
): Promise<HarnessAuditPanelSourceInspection> {
  const requested = resolve(inputDir);
  const requestedStats = await lstat(requested).catch(() => undefined);
  if (!requestedStats?.isDirectory() || requestedStats.isSymbolicLink()) {
    throw new Error("Panel source must be a physical directory.");
  }
  const sourceDir = await realpath(requested);
  const topLevel = await realpath((await gitText(sourceDir, ["rev-parse", "--show-toplevel"])).trim());
  if (topLevel !== sourceDir) throw new Error("Panel source must be the root of its Git repository.");
  const dirty = await gitText(sourceDir, ["status", "--porcelain=v1", "--untracked-files=no"]);
  if (dirty.trim()) throw new Error("Panel source has tracked worktree changes; commit or discard them before freezing.");
  const commit = (await gitText(sourceDir, ["rev-parse", "HEAD"])).trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Panel source has no valid frozen commit.");
  const listed = await gitText(sourceDir, ["ls-files", "-z"]);
  const trackedPaths = listed.split("\0").filter(Boolean).map(normalizedTrackedPath);
  if (trackedPaths.some((path) => path === undefined)) {
    throw new Error("Panel source contains an unsafe tracked path.");
  }
  if (trackedPaths.length === 0) throw new Error("Panel source has no tracked files.");
  if (trackedPaths.length > maxTrackedFiles) throw new Error("Panel source exceeds the tracked-file limit.");
  const normalized = trackedPaths as string[];
  if (normalized.some(sensitivePath)) {
    throw new Error("Panel source contains tracked environment or private-key material; sanitize it before freezing.");
  }
  const sortedPaths = normalized.sort();
  const contentDigest = await digestSnapshotPaths(sourceDir, [...sortedPaths], parentDirectories(sortedPaths));
  const [finalDirty, finalCommit] = await Promise.all([
    gitText(sourceDir, ["status", "--porcelain=v1", "--untracked-files=no"]),
    gitText(sourceDir, ["rev-parse", "HEAD"]),
  ]);
  if (finalDirty.trim() || finalCommit.trim() !== commit) {
    throw new Error("Panel source changed while its committed content was frozen.");
  }
  return { sourceDir, commit, trackedPaths: sortedPaths, contentDigest };
}

export async function snapshotHarnessAuditPanelSource(
  source: HarnessAuditPanelSourceInspection,
  targetDir: string,
): Promise<HarnessAuditPanelSnapshot> {
  await mkdir(targetDir, { recursive: false, mode: 0o755 });
  let filesCopied = 0;
  let bytesCopied = 0;
  let linksCopied = 0;
  let omittedSensitivePaths = 0;
  for (const path of source.trackedPaths) {
    if (sensitivePath(path)) {
      omittedSensitivePaths += 1;
      continue;
    }
    const sourcePath = join(source.sourceDir, path);
    const targetPath = join(targetDir, path);
    const stats = await lstat(sourcePath).catch(() => undefined);
    if (!stats) throw new Error("Panel source changed after Git inspection.");
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o755 });
    if (stats.isSymbolicLink()) {
      const link = await readlink(sourcePath);
      const resolvedTarget = resolve(dirname(sourcePath), link);
      if (isAbsolute(link) || !within(source.sourceDir, resolvedTarget)) {
        throw new Error("Panel source contains an absolute or escaping tracked symlink.");
      }
      await symlink(link, targetPath);
      linksCopied += 1;
      continue;
    }
    if (!stats.isFile()) throw new Error("Panel source contains a tracked special file or submodule.");
    bytesCopied += stats.size;
    if (bytesCopied > maxTrackedBytes) throw new Error("Panel source exceeds the snapshot byte limit.");
    await copyFile(sourcePath, targetPath);
    await chmod(targetPath, stats.mode & 0o111 ? 0o555 : 0o444);
    filesCopied += 1;
  }
  return {
    contentDigest: await digestHarnessAuditPanelSnapshot(targetDir),
    filesCopied,
    bytesCopied,
    linksCopied,
    omittedSensitivePaths,
  };
}

export function panelSourceDisplayName(sourceDir: string): string {
  return basename(sourceDir);
}
