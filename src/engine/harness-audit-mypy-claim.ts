import type { HarnessAuditCorpus } from "./harness-audit-evidence";

type Check = HarnessAuditCorpus["checks"][number];
type Line = HarnessAuditCorpus["lines"][number];

function selectorForCheck(check: Check): string | undefined {
  return check.description.match(/^Checked mypy override (.+) against /)?.[1];
}

export function mypyOverrideSupported(claim: string, result: string): boolean {
  const targetStatus = result.match(/^module target .+: ([^;]+); invocation targets: /)?.[1];
  if (!targetStatus) return false;
  if (/\b(?:missing|stale|obsolete|nonexistent|dead)\b/i.test(claim)) {
    return targetStatus === "missing";
  }
  return false;
}

export function mypyClaimCitationSupported(check: Check, lines: Line[]): boolean {
  const selector = selectorForCheck(check);
  if (!selector) return false;
  return lines.some((line) => line.path === "pyproject.toml"
    && /^\s*module\s*=/.test(line.text)
    && line.text.includes(JSON.stringify(selector)));
}

export function mypyClaimNamesCheckedSelector(claim: string, check: Check): boolean {
  const subject = selectorForCheck(check)?.replace(/\.\*$/, "");
  if (!subject) return false;
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_.])${escaped}(?:\\.\\*)?(?=$|[^A-Za-z0-9_.])`, "i")
    .test(claim);
}
