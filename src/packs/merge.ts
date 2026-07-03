import type { PackDetect, SecondaryDetector, ToolPolicyRule } from "./types";

export function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function mergeStringList(parentValues: string[] | undefined, childValues: string[] | undefined): string[] | undefined {
  const merged = dedupe([...(parentValues ?? []), ...(childValues ?? [])]);
  return merged.length > 0 ? merged : undefined;
}

export function mergeDetect(parentDetect: PackDetect, childDetect: PackDetect): PackDetect {
  return {
    ...parentDetect,
    ...childDetect,
    files: mergeStringList(parentDetect.files, childDetect.files),
    anyFiles: mergeStringList(parentDetect.anyFiles, childDetect.anyFiles),
    globs: mergeStringList(parentDetect.globs, childDetect.globs),
    pyprojectDependencies: mergeStringList(parentDetect.pyprojectDependencies, childDetect.pyprojectDependencies),
    packageJsonDependencies: mergeStringList(parentDetect.packageJsonDependencies, childDetect.packageJsonDependencies),
    packageJsonDevDependencies: mergeStringList(parentDetect.packageJsonDevDependencies, childDetect.packageJsonDevDependencies),
    packageJsonAnyDependencies: mergeStringList(parentDetect.packageJsonAnyDependencies, childDetect.packageJsonAnyDependencies),
    gemfileGems: mergeStringList(parentDetect.gemfileGems, childDetect.gemfileGems),
    any:
      parentDetect.any || childDetect.any
        ? [...(parentDetect.any ?? []), ...(childDetect.any ?? [])]
        : undefined
  };
}

export function mergeToolPolicyRules(parentRules: ToolPolicyRule[], childRules: ToolPolicyRule[]): ToolPolicyRule[] {
  const merged = [...parentRules];
  const indexById = new Map(parentRules.map((rule, index) => [rule.id, index]));

  for (const rule of childRules) {
    const existingIndex = indexById.get(rule.id);

    if (existingIndex === undefined) {
      indexById.set(rule.id, merged.length);
      merged.push(rule);
      continue;
    }

    merged[existingIndex] = rule;
  }

  return merged;
}

export function mergeSecondaryDetectors(
  parentDetectors: SecondaryDetector[],
  childDetectors: SecondaryDetector[]
): SecondaryDetector[] {
  const merged = [...parentDetectors];
  const indexById = new Map(parentDetectors.map((detector, index) => [detector.id, index]));

  for (const detector of childDetectors) {
    const existingIndex = indexById.get(detector.id);

    if (existingIndex === undefined) {
      indexById.set(detector.id, merged.length);
      merged.push(detector);
      continue;
    }

    merged[existingIndex] = detector;
  }

  return merged;
}
