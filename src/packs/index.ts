import type { Pack, PackDetect, ResolvedPack, SecondaryDetector, ToolPolicyRule } from "./types";
import { genericPack } from "./generic";
import { pythonFastapiPack } from "./python-fastapi";
import { pythonLambdaPowertoolsPack } from "./python-lambda-powertools";
import { pythonUvPack } from "./python-uv";
import { railsPack } from "./rails";
import { tsBasePack } from "./ts-base";
import { tsLambdaPack } from "./ts-lambda";
import { tsNextjsPack } from "./ts-nextjs";
import { tsReactVitePack } from "./ts-react-vite";

const packs = new Map<string, Pack>([
  [pythonUvPack.id, pythonUvPack],
  [pythonFastapiPack.id, pythonFastapiPack],
  [pythonLambdaPowertoolsPack.id, pythonLambdaPowertoolsPack],
  [tsBasePack.id, tsBasePack],
  [tsReactVitePack.id, tsReactVitePack],
  [tsNextjsPack.id, tsNextjsPack],
  [tsLambdaPack.id, tsLambdaPack],
  [railsPack.id, railsPack],
  [genericPack.id, genericPack]
]);

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function mergeStringList(parentValues: string[] | undefined, childValues: string[] | undefined): string[] | undefined {
  const merged = dedupe([...(parentValues ?? []), ...(childValues ?? [])]);
  return merged.length > 0 ? merged : undefined;
}

function mergeDetect(parentDetect: PackDetect, childDetect: PackDetect): PackDetect {
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

function mergeToolPolicyRules(parentRules: ToolPolicyRule[], childRules: ToolPolicyRule[]): ToolPolicyRule[] {
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

function mergeSecondaryDetectors(
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

export function supportedPackIds(): string[] {
  return Array.from(packs.keys()).sort();
}

export function getPack(id: string): Pack | undefined {
  return packs.get(id);
}

export function resolvePack(id: string): ResolvedPack {
  const pack = packs.get(id);

  if (!pack) {
    throw new Error(`Unsupported stack '${id}'. Supported stacks: ${supportedPackIds().join(", ")}`);
  }

  if (!pack.extends) {
    return {
      ...pack,
      toolPolicyRules: pack.toolPolicyRules ?? [],
      agentsRules: pack.agentsRules ?? [],
      secondaryDetectors: pack.secondaryDetectors ?? [],
      packIds: [pack.id]
    };
  }

  const parent = resolvePack(pack.extends);

  return {
    ...parent,
    ...pack,
    id: pack.id,
    extends: pack.extends,
    detect: mergeDetect(parent.detect, pack.detect),
    generator: pack.generator ?? parent.generator,
    skills: dedupe([...parent.skills, ...pack.skills]),
    hooks: dedupe([...parent.hooks, ...pack.hooks]),
    toolPolicyRules: mergeToolPolicyRules(parent.toolPolicyRules, pack.toolPolicyRules ?? []),
    konsistentTemplate: pack.konsistentTemplate ?? parent.konsistentTemplate,
    verbs: {
      ...parent.verbs,
      ...pack.verbs
    },
    agentsRules: dedupe([...parent.agentsRules, ...(pack.agentsRules ?? [])]),
    secondaryDetectors: mergeSecondaryDetectors(parent.secondaryDetectors, pack.secondaryDetectors ?? []),
    packIds: [...parent.packIds, pack.id]
  };
}
