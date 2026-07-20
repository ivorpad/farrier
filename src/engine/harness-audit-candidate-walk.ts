import { readContainedDirectory, type ContainedRepository } from "./repository-paths";

export type HarnessAuditCandidateWalkOptions = {
  maxEntries: number;
  ignoredDirectoryNames: ReadonlySet<string>;
  excludedDirectoryPaths: ReadonlySet<string>;
  isCandidatePath: (path: string) => boolean;
  includeCandidatePath?: (path: string) => boolean;
  skipCandidatePath?: (path: string) => string | undefined;
};

export type HarnessAuditCandidateWalk = {
  paths: string[];
  skipped: Array<{ path: string; reason: string }>;
};

export async function walkHarnessAuditCandidates(
  repository: ContainedRepository,
  options: HarnessAuditCandidateWalkOptions,
): Promise<HarnessAuditCandidateWalk> {
  const paths: string[] = [];
  const skipped: HarnessAuditCandidateWalk["skipped"] = [];
  const queue = [""];
  let entries = 0;
  let limited = false;

  const admit = (path: string): boolean => {
    entries += 1;
    if (entries <= options.maxEntries) return true;
    skipped.push({ path, reason: "entry-limit" });
    limited = true;
    return false;
  };

  while (queue.length && !limited) {
    const relativeDir = queue.shift()!;
    const directory = await readContainedDirectory(repository, relativeDir);
    if (directory.status !== "read") {
      skipped.push({ path: relativeDir || ".", reason: directory.status });
      continue;
    }
    if (relativeDir && directory.entries.some((entry) => entry.name === ".git")) {
      skipped.push({ path: relativeDir, reason: "nested-repository" });
      continue;
    }
    for (const entry of directory.entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (options.ignoredDirectoryNames.has(entry.name)
          || options.excludedDirectoryPaths.has(path)) continue;
        if (!admit(path)) break;
        queue.push(path);
      } else if (options.isCandidatePath(path)) {
        const skipReason = options.skipCandidatePath?.(path);
        if (skipReason) {
          skipped.push({ path, reason: skipReason });
          continue;
        }
        if (!admit(path)) break;
        if (entry.isFile()) {
          if (options.includeCandidatePath?.(path) ?? true) paths.push(path);
        } else {
          skipped.push({ path, reason: entry.isSymbolicLink() ? "symlink" : "special-file" });
        }
      }
    }
  }
  return { paths, skipped };
}
