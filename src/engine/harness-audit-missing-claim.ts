import { referencedPathForLine, type HarnessAuditCorpus } from "./harness-audit-evidence";
import { generatedOutputBuiltBeforeReference } from "./harness-audit-generated-output";

type Check = HarnessAuditCorpus["checks"][number];
type Line = HarnessAuditCorpus["lines"][number];

function includesSubject(value: string, subject: string): boolean {
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`, "i").test(value);
}

function referencedPath(check: Check): string | undefined {
  return check.description.match(/^Checked referenced path (.+)\.$/)?.[1];
}

function manifestEntry(check: Check): { id: string; path: string } | undefined {
  const match = check.description.match(/^Checked manifest-selected hook (.+) entrypoint (.+)\.$/);
  return match ? { id: match[1]!, path: match[2]! } : undefined;
}

function manifestBinding(check: Check): { agent: string; path: string } | undefined {
  const match = check.description.match(/^Checked (claude|codex) binding for manifest-selected hooks at (.+)\.$/);
  return match ? { agent: match[1]!, path: match[2]! } : undefined;
}

export function missingArtifactClaimSupported(input: {
  claim: string;
  checks: Check[];
  artifactLines: Line[];
  corpus?: HarnessAuditCorpus;
}): boolean | undefined {
  const physical = input.checks.map((check) => ({
    check,
    referenced: referencedPath(check),
    entry: manifestEntry(check),
    binding: manifestBinding(check),
  })).filter((item) => item.referenced || item.entry || item.binding);
  if (!physical.length) return undefined;

  const citedPaths = new Set(input.artifactLines.flatMap(referencedPathForLine));
  const citedText = input.artifactLines.map((line) => line.text).join(" ");
  return physical.some(({ check, referenced, entry, binding }) => {
    if (check.result !== "missing" && check.result !== "missing; exact, .rb, and .so targets are absent") return false;
    if (referenced) {
      const shortPath = referenced.split("/").slice(-2).join("/");
      if (input.corpus && input.artifactLines.some((line) =>
        generatedOutputBuiltBeforeReference(input.corpus!, line, referenced))) return false;
      return citedPaths.has(referenced)
        && (input.claim.includes(referenced) || input.claim.includes(shortPath));
    }
    if (entry) {
      const claimMatches = input.claim.includes(entry.path) || includesSubject(input.claim, entry.id);
      const citationMatches = citedPaths.has(entry.path) || includesSubject(citedText, entry.id);
      return claimMatches && citationMatches;
    }
    return Boolean(binding
      && (input.claim.includes(binding.path) || includesSubject(input.claim, binding.agent))
      && (citedPaths.has(binding.path) || citedText.includes(binding.path)));
  });
}
