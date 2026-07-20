import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { referencedPathForLine, type HarnessAuditCorpus } from "./harness-audit-evidence";
import type {
  HarnessAuditCheck,
  HarnessAuditCitation,
  HarnessAuditLine,
  HarnessAuditRecommendation,
} from "./harness-audit-types";

function citation(line: HarnessAuditLine): HarnessAuditCitation {
  return { path: line.path, line: line.line, excerpt: line.text.trim().slice(0, 320) };
}

function sameLineConditionalFallback(line: HarnessAuditLine, sourcePath: string): boolean {
  const index = line.text.indexOf(sourcePath);
  if (index < 0 || /\b(?:e\.g\.|for example)\b/i.test(line.text)) return false;
  const before = line.text.slice(Math.max(0, index - 80), index);
  const after = line.text.slice(index + sourcePath.length, index + sourcePath.length + 100);
  return /\b(?:extend\s+via|fall\s+back\s+to|use|consult|read|load)\b/i.test(before)
    && /\b(?:if|when)\b/i.test(after);
}

function contextualFallback(
  corpus: HarnessAuditCorpus,
  line: HarnessAuditLine,
  sourcePath: string,
): HarnessAuditLine[] | undefined {
  if (sameLineConditionalFallback(line, sourcePath)) return [line];
  const document = corpus.documents.find((item) => item.path === line.path);
  if (!document) return undefined;
  const sourceLines = document.text.split("\n");
  for (let index = line.line - 2; index >= Math.max(0, line.line - 5); index -= 1) {
    const text = sourceLines[index]?.trimEnd() ?? "";
    if (!text.trim()) continue;
    if (/\b(?:e\.g\.|example|for example|optional)\b|\b(?:if|when)\s+(?:available|present)\b/i.test(text)) {
      return undefined;
    }
    if (!/\b(?:consult|load|read|review|see|use)\b[^.\n]{0,100}\b(?:docs?|documentation|files?|references?|resources?)\b[^.\n]{0,120}\b(?:if|when)\b/i.test(text)) {
      continue;
    }
    return [{
      id: `local:${line.path}:${index + 1}`,
      path: line.path,
      line: index + 1,
      text,
      kind: "skill",
    }, line];
  }
  return undefined;
}

function recommendationId(line: HarnessAuditLine, path: string): string {
  const digest = createHash("sha256")
    .update(`${line.path}:${line.line}:${path}`, "utf8").digest("hex").slice(0, 10);
  return `skill:${digest}`;
}

export function conditionalSkillFallbackFindings(
  corpus: HarnessAuditCorpus,
): HarnessAuditRecommendation[] {
  const coverage = corpus.checks.find((check) => check.id === "check:audit-coverage");
  const groups = new Map<string, Array<{
    line: HarnessAuditLine;
    path: string;
    sourcePath: string;
    citations: HarnessAuditLine[];
    check: HarnessAuditCheck;
  }>>();
  for (const check of corpus.checks.filter((item) =>
    item.id.startsWith("check:path:") && item.result === "missing")) {
    const path = check.description.match(/^Checked referenced path (.+)\.$/)?.[1];
    if (!path) continue;
    for (const line of corpus.lines.filter((item) =>
      item.kind === "skill" && referencedPathForLine(item).includes(path))) {
      const prefix = `${dirname(line.path)}/`;
      const sourcePath = path.startsWith(prefix) ? path.slice(prefix.length) : path;
      const citations = contextualFallback(corpus, line, sourcePath);
      if (!citations) continue;
      const key = citations.length > 1
        ? `${line.path}:${citations[0]!.line}`
        : `${line.path}:${line.line}:${path}`;
      groups.set(key, [...groups.get(key) ?? [], { line, path, sourcePath, citations, check }]);
    }
  }
  return [...groups.values()].map((matches): HarnessAuditRecommendation => {
    const first = matches[0]!;
    const sourcePaths = [...new Set(matches.map((item) => item.sourcePath))];
    const citations = [...new Map(matches.flatMap((item) => item.citations)
      .map((line) => [`${line.path}:${line.line}`, line])).values()]
      .sort((left, right) => left.line - right.line);
    const checks = [...new Map(matches.map((item) => [item.check.id, item.check])).values()];
    const listedPaths = sourcePaths.map((path) => `\`${path}\``).join(", ");
    const plural = sourcePaths.length > 1;
    return {
      id: recommendationId(citations[0]!, sourcePaths.join(",")),
      layer: "skill",
      severity: "medium",
      title: "Skill fallback references a missing resource",
      defect: `${first.line.path} offers ${sourcePaths.join(", ")} as conditional fallback${plural ? "s" : ""}, but the contained path ${plural ? "checks found no such resources" : "check found no such resource"}.`,
      citations: citations.map(citation),
      counterchecks: [...checks, coverage]
        .filter((item): item is HarnessAuditCheck => Boolean(item))
        .map((item) => ({ description: item.description, result: item.result })),
      proposal: {
        artifact: first.line.path,
        change: plural
          ? `Remove the unavailable fallback entries ${listedPaths} under ${first.line.path}:${citations[0]!.line}. Reintroduce each only after its resource exists and has been reviewed.`
          : `Remove the unavailable ${listedPaths} fallback sentence at ${first.line.path}:${first.line.line}. Reintroduce it only after the fallback resource exists and has been reviewed.`,
      },
      risk: `When the stated condition occurs, the skill directs the agent to fallback${plural ? "s" : ""} that cannot be loaded.`,
      uncertainty: `The audit proves the fallback path${plural ? "s are" : " is"} absent from the bounded repository snapshot, but did not test the primary sources or determine whether removal or restoration is intended.`,
      source: "deterministic",
    };
  });
}
