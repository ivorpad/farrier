import { posix } from "node:path";
import type { HarnessAuditCorpus } from "./harness-audit-evidence";

export function packageCheckForBase(
  checks: HarnessAuditCorpus["checks"],
  base: string,
): HarnessAuditCorpus["checks"][number] | undefined {
  return checks.find((check) => check.id === base || check.id.startsWith(`${base}:`));
}

export function packagePathForCheck(check: HarnessAuditCorpus["checks"][number]): string | undefined {
  if (!/^check:package-(?:manager|scripts|script-definitions|json-parse)(?::|$)/.test(check.id)) return undefined;
  return check.description.match(/ for (.+\/package\.json)(?:\.| before\b)/)?.[1] ?? "package.json";
}

function nearestPackagePath(
  line: HarnessAuditCorpus["lines"][number],
  packagePaths: Set<string>,
): string | undefined {
  if (/(?:^|\/)package\.json$/.test(line.path)) return line.path;
  let directory = posix.dirname(line.path);
  while (true) {
    const candidate = directory === "." ? "package.json" : `${directory}/package.json`;
    if (packagePaths.has(candidate)) return candidate;
    if (directory === ".") return undefined;
    directory = posix.dirname(directory);
  }
}

export function packageCountercheckMatchesLine(
  corpus: HarnessAuditCorpus,
  check: HarnessAuditCorpus["checks"][number],
  line: HarnessAuditCorpus["lines"][number],
): boolean {
  const checkPath = packagePathForCheck(check);
  if (!checkPath) return false;
  const packagePaths = new Set(corpus.documents.map((item) => item.path)
    .filter((path) => /(?:^|\/)package\.json$/.test(path)));
  return nearestPackagePath(line, packagePaths) === checkPath;
}

export function packageCounterchecksMatchCitations(input: {
  corpus: HarnessAuditCorpus;
  checks: HarnessAuditCorpus["checks"];
  lines: HarnessAuditCorpus["lines"];
  artifact: string;
}): boolean {
  const checkPaths = input.checks.map(packagePathForCheck).filter((path): path is string => Boolean(path));
  if (!checkPaths.length) return true;
  const packagePaths = new Set(input.corpus.documents.map((item) => item.path)
    .filter((path) => /(?:^|\/)package\.json$/.test(path)));
  const citedScopes = new Set(input.lines.filter((line) => line.path === input.artifact)
    .map((line) => nearestPackagePath(line, packagePaths))
    .filter((path): path is string => Boolean(path)));
  return checkPaths.every((path) => citedScopes.has(path));
}
