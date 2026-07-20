import { createHash } from "node:crypto";
import { posix } from "node:path";
import { referencedPathForLine, type HarnessAuditCorpus } from "./harness-audit-evidence";
import { invokedLocalCommandPath } from "./harness-audit-path-context";
import type {
  HarnessAuditCheck,
  HarnessAuditCitation,
  HarnessAuditLine,
  HarnessAuditRecommendation,
} from "./harness-audit-types";

type ScriptPathCandidate = {
  manifestPath: string;
  name: string;
  body: string;
  path: string;
  line: HarnessAuditLine;
  check: HarnessAuditCheck;
};

export type PackageScriptPathAudit = {
  findings: HarnessAuditRecommendation[];
  missingPaths: ReadonlySet<string>;
};

function citation(line: HarnessAuditLine): HarnessAuditCitation {
  return { path: line.path, line: line.line, excerpt: line.text.trim().slice(0, 320) };
}

function exactMissingCheck(corpus: HarnessAuditCorpus, path: string): HarnessAuditCheck | undefined {
  return corpus.checks.find((check) =>
    check.description === `Checked referenced path ${path}.` && check.result === "missing");
}

function scriptLine(
  corpus: HarnessAuditCorpus,
  manifestPath: string,
  name: string,
  body: string,
): HarnessAuditLine | undefined {
  return corpus.lines.find((line) => line.path === manifestPath
    && line.text.includes(JSON.stringify(name))
    && line.text.includes(JSON.stringify(body)));
}

function candidates(corpus: HarnessAuditCorpus): ScriptPathCandidate[] {
  const result: ScriptPathCandidate[] = [];
  for (const document of corpus.documents.filter((item) => /(?:^|\/)package\.json$/.test(item.path))) {
    let raw: { scripts?: unknown };
    try {
      raw = JSON.parse(document.text) as { scripts?: unknown };
    } catch {
      continue;
    }
    if (!raw.scripts || typeof raw.scripts !== "object" || Array.isArray(raw.scripts)) continue;
    for (const [name, value] of Object.entries(raw.scripts)) {
      if (typeof value !== "string") continue;
      const localPath = invokedLocalCommandPath(value);
      if (!localPath) continue;
      const path = posix.normalize(posix.join(posix.dirname(document.path), localPath));
      const line = scriptLine(corpus, document.path, name, value);
      const check = exactMissingCheck(corpus, path);
      if (!line || !check || !referencedPathForLine(line).includes(path)) continue;
      result.push({ manifestPath: document.path, name, body: value, path, line, check });
    }
  }
  return result;
}

function recommendationId(candidate: ScriptPathCandidate): string {
  const seed = `${candidate.manifestPath}:${candidate.name}:${candidate.body}:${candidate.path}`;
  const digest = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 10);
  return `toolchain:${digest}`;
}

export function packageScriptPathAudit(corpus: HarnessAuditCorpus): PackageScriptPathAudit {
  const missing = candidates(corpus);
  const coverage = corpus.checks.find((check) => check.id === "check:audit-coverage");
  return {
    missingPaths: new Set(missing.map((item) => item.path)),
    findings: missing.map((item) => ({
      id: recommendationId(item),
      layer: "toolchain",
      severity: "high",
      title: "Package task invokes a missing local executable",
      defect: `${item.manifestPath} defines task ${item.name} as \`${item.body}\`, but the contained path check found no ${item.path} artifact.`,
      citations: [citation(item.line)],
      counterchecks: [item.check, coverage].filter((check): check is HarnessAuditCheck => Boolean(check))
        .map((check) => ({ description: check.description, result: check.result })),
      proposal: {
        artifact: item.manifestPath,
        change: `Remove the \`${item.name}\` task from \`scripts\` in ${item.manifestPath}. Reintroduce it only after ${item.path} exists and the command has been reviewed.`,
      },
      risk: `Running package task \`${item.name}\` fails before its intended behavior because ${item.path} is absent.`,
      uncertainty: "The audit proves the invoked local path is absent, but not whether the intended repair is removal, restoration, or replacement with another existing command.",
      source: "deterministic",
    })),
  };
}
