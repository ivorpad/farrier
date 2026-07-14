import type { CapabilityAgent, HookCapability, HookId, Pack, PackCapabilityProjection, ResolvedPack } from "./types";
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

const builtinDetectionIds = [
  "python-lambda-powertools",
  "python-fastapi",
  "python-uv",
  "ts-nextjs",
  "ts-react-vite",
  "ts-lambda",
  "ts-base",
  "rails"
] as const;

export const hookCapabilities: Record<HookId, HookCapability> = {
  "secret-shield": {
    agents: {
      claude: [{ event: "PreToolUse", matcher: "Read|Bash|Grep", fileName: "secret-shield.py" }],
      codex: [{ event: "PreToolUse", matcher: "^Bash$", fileName: "secret-shield.py" }]
    }
  },
  "tool-policy": {
    agents: {
      claude: [{ event: "PreToolUse", matcher: "Bash", fileName: "tool-policy.py" }],
      codex: [{ event: "PreToolUse", matcher: "^Bash$", fileName: "tool-policy.py" }]
    }
  },
  "write-guard": {
    agents: {
      claude: [{ event: "PreToolUse", matcher: "Edit|Write|MultiEdit|NotebookEdit", fileName: "write-guard.py" }],
      codex: [{ event: "PreToolUse", matcher: "^apply_patch$", fileName: "write-guard.py" }]
    }
  },
  "verb-runner": {
    agents: {
      claude: [
        { event: "PostToolUse", matcher: "Edit|Write|MultiEdit|NotebookEdit", fileName: "verb-runner.py" },
        { event: "Stop", fileName: "verb-runner.py" }
      ],
      codex: [
        { event: "PostToolUse", matcher: "^apply_patch$", fileName: "verb-runner.py" },
        { event: "Stop", fileName: "verb-runner.py" }
      ]
    }
  },
  "quality-judge": {
    agents: {
      claude: [{ event: "PostToolUse", matcher: "Edit|Write|MultiEdit|NotebookEdit", fileName: "quality-judge.py" }],
      codex: [{ event: "PostToolUse", matcher: "^apply_patch$", fileName: "quality-judge.py" }]
    }
  },
  "stop-judge": {
    agents: {
      claude: [{ event: "Stop", fileName: "stop-judge.py" }],
      codex: [{ event: "Stop", fileName: "stop-judge.py" }]
    }
  }
};

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

export function builtinDetectionOrder(): string[] {
  return [...builtinDetectionIds];
}

export function packCapabilityProjection(pack: ResolvedPack): PackCapabilityProjection {
  const order = builtinDetectionIds.indexOf(pack.id as (typeof builtinDetectionIds)[number]);
  const supportedAgents: CapabilityAgent[] = ["claude", "codex"];
  return {
    packId: pack.id,
    detection: { order: order < 0 ? null : order, explicitOnly: order < 0 },
    supportedAgents,
    hooks: pack.hooks.map((id) => ({
      id,
      agents: id.startsWith("@")
        ? (["claude"] as CapabilityAgent[])
        : supportedAgents.filter((agent) => (hookCapabilities[id as HookId].agents[agent]?.length ?? 0) > 0)
    })),
    limitations: pack.remoteHooks.length > 0
      ? ["Remote registry hooks retain their existing Claude event bindings and are not bound to Codex without explicit compatible metadata."]
      : []
  };
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
