import { dirname } from "node:path";
import type { HarnessAuditCorpus } from "./harness-audit-evidence";
import { packagePathForCheck } from "./harness-audit-package-evidence";
import type { HarnessAuditCheck, HarnessAuditLine } from "./harness-audit-types";

function scopedPackageScriptsCheck(
  corpus: HarnessAuditCorpus,
  line: HarnessAuditLine,
): HarnessAuditCheck | undefined {
  return corpus.checks.map((check) => ({ check, path: packagePathForCheck(check) }))
    .filter((item): item is { check: HarnessAuditCheck; path: string } => Boolean(item.path))
    .filter((item) => {
      const directory = dirname(item.path);
      return directory === "." || line.path.startsWith(`${directory}/`);
    })
    .sort((left, right) => dirname(right.path).length - dirname(left.path).length)[0]?.check;
}

export function generatedOutputBuiltBeforeReference(
  corpus: HarnessAuditCorpus,
  line: HarnessAuditLine,
  path: string,
): boolean {
  if (!/(?:^|\/)(?:build|dist|out|target)(?:\/|$)/i.test(path)) return false;
  const pathIndex = line.text.indexOf(path);
  if (pathIndex < 0) return false;
  const invokedTasks = Array.from(
    line.text.slice(0, pathIndex)
      .matchAll(/\b(?:bun|npm|pnpm|yarn)\s+run\s+([A-Za-z0-9][A-Za-z0-9:_-]*)\s*&&/g),
    (match) => match[1]!,
  );
  const buildTask = invokedTasks.find((task) =>
    /(?:^|[:_-])(?:assemble|build|bundle|compile|generate|package)(?:$|[:_-])/i.test(task));
  if (!buildTask) return false;
  const check = scopedPackageScriptsCheck(corpus, line);
  return Boolean(check && new Set(check.result.split(", ").filter(Boolean)).has(buildTask));
}
