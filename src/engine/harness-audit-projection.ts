import type { HarnessAuditLine } from "./harness-audit-types";

export type ClaimProjectionScope = "verification" | "toolchain" | "generalist";

const verificationSignal = /`(?:npm|bun|pnpm|yarn|just|make|uv|pytest|mypy|ruff)\b[^`]*`|\b(?:tests?|testing|lint(?:s|ing)?|type[- ]?checks?|checks?|verification|verify|builds?|formats?|ci|completion|complete|gate|coverage|quality|mypy|pytest|vitest|jest|exempt|skip|waive|workflow|auto-?fix|dirty tree)\b/i;
const toolchainSignal = /\b(?:packageManager|package manager|npm|bun|pnpm|yarn|uv|pip|python|runtime|lockfiles?|dependenc(?:y|ies)|devDependencies|install|runner|toolchain|build[- ]?backend|build-system|requires-python)\b/i;

function signalFor(scope: ClaimProjectionScope): RegExp {
  if (scope === "verification") return verificationSignal;
  if (scope === "toolchain") return toolchainSignal;
  return new RegExp(`${verificationSignal.source}|${toolchainSignal.source}`, "i");
}

export function claimOrientedLines(
  lines: HarnessAuditLine[],
  scope: ClaimProjectionScope,
): HarnessAuditLine[] {
  const signal = signalFor(scope);
  const selected = new Set<string>();
  const groups = new Map<string, HarnessAuditLine[]>();
  for (const line of lines) {
    const group = groups.get(line.path) ?? [];
    group.push(line);
    groups.set(line.path, group);
  }
  for (const group of groups.values()) {
    for (let index = 0; index < group.length; index += 1) {
      const line = group[index]!;
      if (!signal.test(line.text)) continue;
      for (let offset = -2; offset <= 2; offset += 1) {
        const nearby = group[index + offset];
        if (nearby && Math.abs(nearby.line - line.line) <= 3) selected.add(nearby.id);
      }
    }
  }
  return lines.filter((line) => selected.has(line.id));
}
