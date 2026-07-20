import type { HarnessAuditCorpus } from "./harness-audit-evidence";
import { packageManagerVersionIsExact } from "./harness-audit-package-manager-claim";
import { packageCountercheckMatchesLine } from "./harness-audit-package-scope";
import { packageScriptOmissionSupported } from "./harness-audit-script-claim";
import type { HarnessAuditLayer } from "./harness-audit-types";

type OpportunityScope =
  | { kind: "generalist" }
  | { kind: "specialist"; layer: HarnessAuditLayer };

function completionTargets(corpus: HarnessAuditCorpus): Array<{
  line: HarnessAuditCorpus["lines"][number];
  target: string;
}> {
  const targets: Array<{ line: HarnessAuditCorpus["lines"][number]; target: string }> = [];
  for (const line of corpus.lines.filter((item) => item.kind === "guidance")) {
    if (!/\b(?:before (?:completion|completing)|completion (?:check|gate)|before stopping|report(?:ing)? (?:complete|success))\b/i.test(line.text)) continue;
    for (const match of line.text.matchAll(/`((?:npm|bun|pnpm|yarn)\s+(?:run\s+)?[A-Za-z0-9][A-Za-z0-9:_-]*)[^`]*`/g)) {
      const target = match[1]!.match(/^(?:npm|bun|pnpm|yarn)\s+(?:run\s+)?([A-Za-z0-9][A-Za-z0-9:_-]*)/)?.[1];
      if (target) targets.push({ line, target });
    }
  }
  return targets;
}

function verificationOpportunity(corpus: HarnessAuditCorpus): boolean {
  if (corpus.checks.some((check) => check.id.startsWith("check:verification-scope:"))) return true;
  if (corpus.checks.some((check) => check.id.startsWith("check:mypy-override:")
    && /module target .+: missing;/.test(check.result))) return true;

  const definitions = corpus.checks.filter((check) =>
    check.id === "check:package-script-definitions"
      || check.id.startsWith("check:package-script-definitions:"));
  const prohibitedTestHasTask = corpus.lines.some((line) => line.kind === "guidance"
    && /\b(?:do not|don't|never)\s+run\b[^.]{0,60}\btests?\b|\bskip\b[^.]{0,60}\btests?\b/i.test(line.text)
    && definitions.some((check) => packageCountercheckMatchesLine(corpus, check, line)
      && /(?:^|; )test(?::[^=]+)?=|\b(?:test|vitest|jest|pytest|mocha)\b/i.test(check.result)));
  if (prohibitedTestHasTask) return true;

  return completionTargets(corpus).some(({ line, target }) => definitions.some((check) =>
    packageCountercheckMatchesLine(corpus, check, line)
      && packageScriptOmissionSupported(`${target} gate does not run tests`, check.result)));
}

function toolchainOpportunity(corpus: HarnessAuditCorpus): boolean {
  return corpus.checks.some((check) =>
    (check.id === "check:package-manager" || check.id.startsWith("check:package-manager:"))
      && /^(?:npm|bun|pnpm|yarn)@/.test(check.result)
      && !packageManagerVersionIsExact(check.result));
}

function crossLayerSkillOpportunity(corpus: HarnessAuditCorpus): boolean {
  for (const line of corpus.lines.filter((item) => item.kind === "skill")) {
    const managers = new Set(corpus.checks.flatMap((check) => {
      if ((check.id !== "check:package-manager" && !check.id.startsWith("check:package-manager:"))
        || !packageCountercheckMatchesLine(corpus, check, line)) return [];
      const manager = check.result.match(/^(npm|bun|pnpm|yarn)(?:@|$)/)?.[1];
      return manager ? [manager] : [];
    }));
    if (!managers.size) continue;
    const context = corpus.lines.filter((item) => item.path === line.path && Math.abs(item.line - line.line) <= 2)
      .map((item) => item.text).join(" ");
    if (!/\brepository\b/i.test(context)) continue;
    for (const match of line.text.matchAll(/`(npm|bun|pnpm|yarn)\s+(?:install|add|run)\b[^`]*`/g)) {
      if ([...managers].some((manager) => manager !== match[1])) return true;
    }
  }
  return false;
}

export function harnessAuditScopeOpportunity(
  corpus: HarnessAuditCorpus,
  scope: OpportunityScope,
): boolean {
  if (scope.kind === "generalist") return crossLayerSkillOpportunity(corpus);
  if (scope.layer === "verification") return verificationOpportunity(corpus);
  if (scope.layer === "toolchain") return toolchainOpportunity(corpus);
  return false;
}
