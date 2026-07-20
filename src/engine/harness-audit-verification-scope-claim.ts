import type { HarnessAuditCheck, HarnessAuditLine } from "./harness-audit-types";

const checkDescription = /^Compared mandatory verification scopes with documented exemptions in (.+)\.$/;
const requiredScopeLine = /\bCI workflows?\b/i;
const exemptionLine = /\b(?:skip|exempt|waive|do not run)\b[^\n]{0,240}(?:\.github|CI workflows?)/i;

export function verificationScopeRecommendationSupported(input: {
  claim: string;
  checks: HarnessAuditCheck[];
  lines: HarnessAuditLine[];
  artifact: string;
}): boolean {
  const checks = input.checks.filter((check) => check.id.startsWith("check:verification-scope:"));
  if (!checks.length) return true;
  if (!requiredScopeLine.test(input.claim) || !/\.github\b/i.test(input.claim)) return false;
  return checks.every((check) => {
    const path = check.description.match(checkDescription)?.[1];
    if (!path || input.artifact !== path) return false;
    const lines = input.lines.filter((line) => line.path === path);
    return lines.some((line) => requiredScopeLine.test(line.text))
      && lines.some((line) => exemptionLine.test(line.text));
  });
}
