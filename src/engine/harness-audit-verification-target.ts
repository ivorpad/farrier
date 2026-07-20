import type { HarnessAuditCheck } from "./harness-audit-types";

const subjectPattern = "(?:script|target|task|recipe|gate)";
const knownTargetPattern = "(?:test|check|verify|verification|lint|typecheck|type-check|build|ci)";

function targetPhrases(claim: string): Array<{ index: number; length: number; target: string }> {
  const phrases: Array<{ index: number; length: number; target: string }> = [];
  const patterns = [
    new RegExp("[`'\"]([A-Za-z0-9][A-Za-z0-9:_.-]*)[`'\"]\\s+" + subjectPattern, "gi"),
    new RegExp(`\\b(${knownTargetPattern})\\s+${subjectPattern}\\b`, "gi"),
  ];
  for (const pattern of patterns) {
    for (const match of claim.matchAll(pattern)) {
      phrases.push({ index: match.index, length: match[0].length, target: match[1]!.toLowerCase() });
    }
  }
  return phrases;
}

function absentTarget(claim: string): string | undefined {
  for (const phrase of targetPhrases(claim)) {
    const before = claim.slice(Math.max(0, phrase.index - 48), phrase.index);
    const after = claim.slice(phrase.index + phrase.length, phrase.index + phrase.length + 48);
    const absentBefore = /(?:missing|absent|undefined|nonexistent|not defined|does not define|no)(?:\s+(?:a|an|the))?\s*$/i;
    const absentAfter = /^\s*(?:is|are)?\s*(?:missing|absent|undefined|nonexistent|not defined)(?=\s*(?:[.,;]|$|\b(?:from|for|in)\b))/i;
    if (absentBefore.test(before) || absentAfter.test(after)) return phrase.target;
  }
  return undefined;
}

function inventoryTargets(check: HarnessAuditCheck): string[] | undefined {
  if (check.id === "check:just-targets" || check.id === "check:make-targets"
    || check.id === "check:package-scripts" || check.id.startsWith("check:package-scripts:")) {
    return check.result.split(/,\s*/).map((item) => item.trim().toLowerCase());
  }
  if (check.id === "check:package-script-definitions"
    || check.id.startsWith("check:package-script-definitions:")) {
    return check.result.split(/;\s*/).map((item) => item.slice(0, item.indexOf("=")).trim().toLowerCase())
      .filter(Boolean);
  }
  return undefined;
}

export function verificationTargetAbsenceSupported(
  claim: string,
  checks: HarnessAuditCheck[],
): boolean | undefined {
  const target = absentTarget(claim);
  if (!target) return undefined;
  const inventories = checks.map(inventoryTargets).filter((item): item is string[] => Boolean(item));
  return inventories.length > 0 && inventories.every((items) => !items.includes(target));
}
