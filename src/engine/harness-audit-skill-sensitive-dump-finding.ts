import { createHash } from "node:crypto";
import type { HarnessAuditCorpus } from "./harness-audit-evidence";
import type {
  HarnessAuditCheck,
  HarnessAuditCitation,
  HarnessAuditLine,
  HarnessAuditRecommendation,
} from "./harness-audit-types";

type SensitiveDump = {
  destination: string;
  redacted: boolean;
  restrictiveMode: boolean;
};

function citation(line: HarnessAuditLine): HarnessAuditCitation {
  return { path: line.path, line: line.line, excerpt: line.text.trim().slice(0, 320) };
}

function sensitiveDump(line: HarnessAuditLine): SensitiveDump | undefined {
  const destination = line.text.match(
    /(?:^|\b)(?:fs\.)?writeFile(?:Sync)?\s*\(\s*[`'"](\/tmp\/[^`'"]+)[`'"]/,
  )?.[1];
  if (!destination) return undefined;
  const payload = line.text.slice(line.text.indexOf(destination) + destination.length);
  if (!/\b(?:body(?:str|string)?|content|messages?|payload|prompt|request(?:body|content|messages?|payload)?)\b/i.test(payload)) {
    return undefined;
  }
  return {
    destination,
    redacted: /\b(?:mask|redact|sanitize|scrub)\w*\s*\(/i.test(payload),
    restrictiveMode: /\bmode\s*:\s*0o600\b/i.test(payload),
  };
}

function prohibitedDump(sourceLines: string[], line: HarnessAuditLine): boolean {
  const context = sourceLines.slice(Math.max(0, line.line - 6), line.line).join(" ");
  return /\b(?:do not|don't|must not|never|avoid)\b[^.!?\n]{0,120}\b(?:dump|save|write)\b[^.!?\n]{0,80}\b(?:body|content|messages?|payload|prompt|request)\b/i.test(context)
    || /\b(?:unsafe|insecure|dangerous|historical|old implementation)\b[^.!?\n]{0,120}\b(?:do not|don't|must not|never|avoid)\b/i.test(context);
}

function check(description: string, result: string): HarnessAuditCheck {
  return { id: description, layers: ["skill"], description, result };
}

function findingId(line: HarnessAuditLine, destination: string): string {
  const digest = createHash("sha256").update(`${line.path}:${line.line}:${destination}`, "utf8")
    .digest("hex").slice(0, 10);
  return `skill:${digest}`;
}

export function skillSensitiveDumpFindings(corpus: HarnessAuditCorpus): HarnessAuditRecommendation[] {
  const coverage = corpus.checks.find((item) => item.id === "check:audit-coverage");
  const findings: HarnessAuditRecommendation[] = [];
  for (const document of corpus.documents.filter((item) => item.kind === "skill")) {
    const sourceLines = document.text.split("\n");
    for (const line of corpus.lines.filter((item) => item.path === document.path && item.kind === "skill")) {
      const dump = sensitiveDump(line);
      if (!dump || prohibitedDump(sourceLines, line) || (dump.redacted && dump.restrictiveMode)) continue;
      const checks = [
        check(
          `Inspected the diagnostic write at ${line.path}:${line.line}.`,
          `writes request body data to predictable shared path ${dump.destination}`,
        ),
        check(
          `Checked the payload expression at ${line.path}:${line.line} for required redaction.`,
          dump.redacted ? "redaction is applied before the write" : "no required redaction found",
        ),
        check(
          `Checked the diagnostic file at ${line.path}:${line.line} for user-only permissions.`,
          dump.restrictiveMode ? "file mode 0o600 is required" : "no restrictive file mode found",
        ),
        coverage,
      ].filter((item): item is HarnessAuditCheck => Boolean(item));
      findings.push({
        id: findingId(line, dump.destination),
        layer: "skill",
        severity: "blocking",
        title: "Skill writes request bodies to an unprotected shared path",
        defect: `${line.path} instructs agents to write request body data to ${dump.destination} without requiring both redaction and user-only file permissions.`,
        citations: [citation(line)],
        counterchecks: checks.map((item) => ({ description: item.description, result: item.result })),
        proposal: {
          artifact: line.path,
          change: `Replace the dump snippet at ${line.path}:${line.line} with redacted metadata only. If full payload capture is unavoidable, redact it before writing, create the file with mode 0o600 in a private temporary directory, and delete it in a finally block.`,
        },
        risk: "Request bodies can contain prompts, messages, or tool inputs; another local user or a later process could read data left in the shared temporary directory.",
        uncertainty: "The request body contents were not inspected and the snippet was not executed; a runtime wrapper or host policy could restrict access, but the selected skill does not require it.",
        source: "deterministic",
      });
    }
  }
  return findings;
}
