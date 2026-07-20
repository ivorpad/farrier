import { createHash } from "node:crypto";
import { dirname, posix } from "node:path";
import { redactText } from "./behavior-evidence";
import {
  allocateHarnessAuditLineIndexes,
  spreadHarnessAuditLineIndexes,
} from "./harness-audit-line-allocation";
import { packageScriptPaths } from "./harness-audit-path-context";
import { skillReferenceRoot } from "./harness-audit-reference-root";
import type { HarnessAuditLine } from "./harness-audit-types";

const maxLines = 1_200;
const maxLinesPerFile = 400;
const fencedCodeLines = new WeakSet<HarnessAuditLine>();
const packageScriptPathsByLine = new WeakMap<HarnessAuditLine, string[]>();

export type HarnessAuditDocument = {
  path: string;
  kind: HarnessAuditLine["kind"];
  text: string;
};

type Skipped = Array<{ path: string; reason: string }>;

function shortDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

export function harnessAuditLineIsFenced(line: HarnessAuditLine): boolean {
  return fencedCodeLines.has(line);
}

export function harnessAuditPackageScriptPaths(line: HarnessAuditLine): string[] {
  return packageScriptPathsByLine.get(line) ?? [];
}

export function collectHarnessAuditEvidenceLines(
  documents: HarnessAuditDocument[],
  skipped: Skipped,
  priorityPaths: ReadonlySet<string>,
): HarnessAuditLine[] {
  const prepared = documents.map((document) => {
    const sourceLines = document.text.split("\n");
    const availableIndexes = sourceLines.flatMap((source, index) =>
      redactText(source.trimEnd()).trim() ? [index] : []);
    const indexes = spreadHarnessAuditLineIndexes(availableIndexes, maxLinesPerFile);
    return { document, sourceLines, availableIndexes, indexes };
  });
  const allocated = allocateHarnessAuditLineIndexes(prepared.map(({ document, indexes }) => ({
    path: document.path,
    indexes,
    priority: priorityPaths.has(document.path),
  })), maxLines);
  const result: HarnessAuditLine[] = [];

  for (const { document, sourceLines, availableIndexes, indexes } of prepared) {
    const selected = new Set(allocated.get(document.path) ?? []);
    const packageRoot = /(?:^|\/)package\.json$/.test(document.path) ? dirname(document.path) : undefined;
    const scripts = packageRoot === undefined ? [] : packageScriptPaths(document.text).map((script) => ({
      ...script,
      path: posix.normalize(posix.join(packageRoot, script.path)),
    }));
    let fenceDelimiter: string | undefined;
    const declaredRoot = document.kind === "guidance"
      ? document.text.match(
        /\b(?:intended\s+)?project\s+root\s+as\s+`((?:\.\.\/)*\.\.)`\s+from\s+this\s+workspace/i,
      )?.[1]
      : undefined;
    const guidanceRoot = declaredRoot ? posix.normalize(posix.join(dirname(document.path), declaredRoot)) : undefined;

    for (let index = 0; index < sourceLines.length; index += 1) {
      const fence = sourceLines[index]!.match(/^\s*(`{3,}|~{3,})/);
      const fencedCode = Boolean(fenceDelimiter);
      if (fence && (!fenceDelimiter || fence[1]!.startsWith(fenceDelimiter))) {
        fenceDelimiter = fenceDelimiter ? undefined : fence[1]![0];
      }
      if (!selected.has(index)) continue;
      const text = redactText(sourceLines[index]!.trimEnd());
      const referenceRoot = guidanceRoot
        ?? (packageRoot && packageRoot !== "." ? packageRoot : undefined)
        ?? skillReferenceRoot(document, documents, text);
      const line: HarnessAuditLine = {
        id: `line:${shortDigest(`${document.path}:${index + 1}:${text}`)}`,
        path: document.path,
        line: index + 1,
        text: text.slice(0, 1_200),
        kind: document.kind,
        ...(referenceRoot ? { referenceRoot } : {}),
      };
      if (fencedCode || fence) fencedCodeLines.add(line);
      const scriptPaths = scripts.filter((item) => text.includes(JSON.stringify(item.name))
        && text.includes(JSON.stringify(item.body))).map((item) => item.path);
      if (scriptPaths.length) packageScriptPathsByLine.set(line, scriptPaths);
      result.push(line);
    }
    if (availableIndexes.length > indexes.length || selected.size < indexes.length) {
      skipped.push({ path: document.path, reason: "line-limit" });
    }
  }
  return result;
}
