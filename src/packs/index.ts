import type { Pack, ResolvedPack } from "./types";
import { genericPack } from "./generic";
import {
  dedupe,
  mergeDetect,
  mergeSecondaryDetectors,
  mergeToolPolicyRules
} from "./merge";
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
      packIds: [pack.id],
      remoteHooks: []
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
    konsistentTool: pack.konsistentTool ?? parent.konsistentTool,
    verbs: {
      ...parent.verbs,
      ...pack.verbs
    },
    agentsRules: dedupe([...parent.agentsRules, ...(pack.agentsRules ?? [])]),
    secondaryDetectors: mergeSecondaryDetectors(parent.secondaryDetectors, pack.secondaryDetectors ?? []),
    packIds: [...parent.packIds, pack.id],
    remoteHooks: [...parent.remoteHooks]
  };
}
