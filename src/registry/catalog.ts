import type { FarrierConfig, RegistryConfigSource, RegistryEntryConfig } from "../config/farrier-config";
import { builtinDetectionOrder, getPack as getBuiltinPack, resolvePack as resolveBuiltinPack, supportedPackIds } from "../packs/index";
import {
  dedupe,
  mergeDetect,
  mergeSecondaryDetectors,
  mergeToolPolicyRules
} from "../packs/merge";
import type { Pack, PackHookRef, ResolvedPack, ResolvedRemoteHook, SkillRef } from "../packs/types";
import { RegistryClient, type RegistryFetchResult } from "./client";
import { parseItemRef } from "./ref";
import type { RegistryIndex, RegistryIndexItem, RegistryItem } from "./schema";

export type RegistryPin = {
  type: "pack" | "hook" | "skill";
  version: string;
  sha256: string;
  sourceIdentity?: string;
  ref?: string;
};

export type PackListing = {
  id: string;
  description?: string;
  source: "builtin" | "registry";
  cached: boolean;
};

export type PackCatalogWarning = {
  namespace: string;
  message: string;
};

export type PackCatalog = {
  packIds(): string[];
  listings(): PackListing[];
  getPack(id: string): Pack | undefined;
  resolvePack(id: string): ResolvedPack;
  remoteHook(id: string): ResolvedRemoteHook | undefined;
  detectablePackIds(): string[];
  registryPins(): Record<string, RegistryPin>;
  latestRegistryPins?(): Record<string, RegistryPin>;
  warnings: PackCatalogWarning[];
};

export type RegistryCatalogClient = {
  fetchRegistryIndex(namespace: string, entry: RegistryEntryConfig, configSource?: RegistryConfigSource): Promise<RegistryFetchResult<RegistryIndex>>;
  fetchRegistryItem(namespace: string, entry: RegistryEntryConfig, item: RegistryIndexItem, configSource?: RegistryConfigSource): Promise<RegistryFetchResult<RegistryItem>>;
  fetchRegistryItemPinned?(
    namespace: string,
    entry: RegistryEntryConfig,
    item: RegistryIndexItem,
    pin: {
      type: RegistryIndexItem["type"];
      version: string;
      sha256: string;
      sourceIdentity: string;
    },
    configSource?: RegistryConfigSource
  ): Promise<RegistryFetchResult<RegistryItem> | undefined>;
};

type RemotePackRecord = {
  pack: Pack;
  description?: string;
  version: string;
  sha256: string;
  fromCache: boolean;
};

type RemoteSkillRecord = {
  refs: SkillRef[];
  version: string;
  sha256: string;
  fromCache: boolean;
};

type LoadedRegistry = {
  namespace: string;
  entry: RegistryEntryConfig;
  index: RegistryFetchResult<RegistryIndex>;
  items: Array<RegistryFetchResult<RegistryItem>>;
};

function registryErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pinFor(namespace: string, result: RegistryFetchResult<RegistryItem>): RegistryPin {
  return {
    type: result.value.type,
    version: result.value.version,
    sha256: result.sha256,
    sourceIdentity: result.sourceIdentity,
    ref: `${namespace}/${result.value.name}`
  };
}

function itemId(namespace: string, name: string): `@${string}` {
  return `${namespace}/${name}` as `@${string}`;
}

function remoteHookFrom(
  id: `@${string}`,
  result: RegistryFetchResult<Extract<RegistryItem, { type: "hook" }>>
): ResolvedRemoteHook {
  return {
    id,
    version: result.value.version,
    sha256: result.sha256,
    sourceIdentity: result.sourceIdentity,
    registryRef: id,
    fromCache: result.fromCache,
    hookVersion: result.value.hook.hookVersion,
    events: result.value.hook.events,
    entry: result.value.hook.entry,
    runner: result.value.hook.runner,
    files: result.value.hook.files
  };
}

function packFrom(namespace: string, result: RegistryFetchResult<Extract<RegistryItem, { type: "pack" }>>): RemotePackRecord {
  const id = itemId(namespace, result.value.name);
  return {
    pack: {
      id,
      extends: result.value.pack.extends,
      detect: result.value.pack.detect,
      generator: result.value.pack.generator,
      skills: result.value.pack.skills,
      hooks: result.value.pack.hooks as PackHookRef[],
      toolPolicyRules: result.value.pack.toolPolicyRules,
      konsistentTemplate: result.value.pack.konsistentTemplate,
      konsistentTool: result.value.pack.konsistentTool,
      verbs: result.value.pack.verbs ?? ({} as Pack["verbs"]),
      agentsRules: result.value.pack.agentsRules,
      secondaryDetectors: result.value.pack.secondaryDetectors
    },
    description: result.value.description,
    version: result.value.version,
    sha256: result.sha256,
    fromCache: result.fromCache
  };
}

function resolveRegistrySkills(skills: SkillRef[], remoteSkills: Map<string, RemoteSkillRecord>): SkillRef[] {
  return skills.flatMap((skill) => {
    const parsed = parseItemRef(skill);
    if (!parsed) {
      return [skill];
    }

    const remoteSkill = remoteSkills.get(parsed.id);
    if (!remoteSkill) {
      throw new Error(`Unsupported registry skill '${skill}'`);
    }

    return remoteSkill.refs;
  });
}

function mergeResolvedPack(parent: ResolvedPack, pack: Pack, remoteHooks: ResolvedRemoteHook[], skills: SkillRef[]): ResolvedPack {
  return {
    ...parent,
    ...pack,
    id: pack.id,
    extends: pack.extends,
    detect: mergeDetect(parent.detect, pack.detect),
    generator: pack.generator ?? parent.generator,
    skills: dedupe([...parent.skills, ...skills]),
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
    remoteHooks: dedupe([...parent.remoteHooks, ...remoteHooks])
  };
}

function createCatalog(input: {
  useDefaultPacks: boolean;
  remotePackOrder: string[];
  remotePacks: Map<string, RemotePackRecord>;
  remoteHooks: Map<string, ResolvedRemoteHook>;
  remoteSkills: Map<string, RemoteSkillRecord>;
  pins: Record<string, RegistryPin>;
  latestPins?: Record<string, RegistryPin>;
  warnings: PackCatalogWarning[];
}): PackCatalog {
  function getPack(id: string): Pack | undefined {
    return input.remotePacks.get(id)?.pack ?? getBuiltinPack(id);
  }

  function resolvePack(id: string, seen: string[] = []): ResolvedPack {
    if (seen.includes(id)) {
      throw new Error(`Pack extends cycle detected: ${[...seen, id].join(" -> ")}`);
    }

    const remote = input.remotePacks.get(id);
    if (!remote) {
      const builtin = getBuiltinPack(id);
      if (!builtin) {
        throw new Error(`Unsupported stack '${id}'. Supported stacks: ${catalog.packIds().join(", ")}`);
      }
      return resolveBuiltinPack(id);
    }

    const pack = remote.pack;
    const skills = resolveRegistrySkills(pack.skills, input.remoteSkills);
    const remoteHooks = pack.hooks.flatMap((hook) => {
      const parsed = parseItemRef(hook);
      if (!parsed) {
        return [];
      }

      const remoteHook = input.remoteHooks.get(parsed.id);
      if (!remoteHook) {
        throw new Error(`Unsupported registry hook '${hook}'`);
      }

      return [remoteHook];
    });

    if (!pack.extends) {
      return {
        ...pack,
        skills,
        toolPolicyRules: pack.toolPolicyRules ?? [],
        agentsRules: pack.agentsRules ?? [],
        secondaryDetectors: pack.secondaryDetectors ?? [],
        packIds: [pack.id],
        remoteHooks
      };
    }

    return mergeResolvedPack(resolvePack(pack.extends, [...seen, id]), pack, remoteHooks, skills);
  }

  const catalog: PackCatalog = {
    packIds() {
      return [...(input.useDefaultPacks ? supportedPackIds() : []), ...input.remotePackOrder];
    },
    listings() {
      const builtins: PackListing[] = input.useDefaultPacks
        ? supportedPackIds().map((id) => ({
            id,
            source: "builtin",
            cached: false
          }))
        : [];

      const remotes = input.remotePackOrder.map((id) => {
        const remote = input.remotePacks.get(id)!;
        return {
          id,
          description: remote.description,
          source: "registry" as const,
          cached: remote.fromCache
        };
      });

      return [...builtins, ...remotes];
    },
    getPack,
    resolvePack,
    remoteHook(id: string) {
      return input.remoteHooks.get(id);
    },
    detectablePackIds() {
      return [...(input.useDefaultPacks ? builtinDetectionOrder() : []), ...input.remotePackOrder];
    },
    registryPins() {
      return { ...input.pins };
    },
    latestRegistryPins() {
      return { ...(input.latestPins ?? input.pins) };
    },
    warnings: input.warnings
  };

  return catalog;
}

export function builtinCatalog(): PackCatalog {
  return createCatalog({
    useDefaultPacks: true,
    remotePackOrder: [],
    remotePacks: new Map(),
    remoteHooks: new Map(),
    remoteSkills: new Map(),
    pins: {},
    latestPins: {},
    warnings: []
  });
}

async function loadRegistry(
  namespace: string,
  entry: RegistryEntryConfig,
  client: RegistryCatalogClient,
  configSource?: RegistryConfigSource
): Promise<LoadedRegistry> {
  const index = await client.fetchRegistryIndex(namespace, entry, configSource);
  const items = await Promise.all(
    index.value.items.map((item: RegistryIndexItem) => client.fetchRegistryItem(namespace, entry, item, configSource))
  );

  return {
    namespace,
    entry,
    index,
    items
  };
}

export async function loadPackCatalog(input: {
  config: FarrierConfig;
  client?: RegistryCatalogClient;
  requireNamespaces?: Iterable<string> | Map<string, string>;
  requiredPins?: Record<string, RegistryPin>;
  registrySources?: Record<string, RegistryConfigSource>;
}): Promise<PackCatalog> {
  const registryEntries = Object.entries(input.config.registries);
  const required = input.requireNamespaces instanceof Map
    ? new Map(input.requireNamespaces)
    : new Map(Array.from(input.requireNamespaces ?? []).map((namespace) => [namespace, namespace]));

  if (registryEntries.length === 0 && input.config.useDefaultPacks && required.size === 0) {
    return builtinCatalog();
  }

  const client = input.client ?? new RegistryClient();
  const seenNamespaces = new Set<string>();
  const warnings: PackCatalogWarning[] = [];
  const remotePackOrder: string[] = [];
  const remotePacks = new Map<string, RemotePackRecord>();
  const remoteHooks = new Map<string, ResolvedRemoteHook>();
  const remoteSkills = new Map<string, RemoteSkillRecord>();
  const pins: Record<string, RegistryPin> = {};
  const latestPins: Record<string, RegistryPin> = {};

  for (const [namespace, entry] of registryEntries) {
    seenNamespaces.add(namespace);
    let loaded: LoadedRegistry;
    try {
      loaded = await loadRegistry(namespace, entry, client, input.registrySources?.[namespace]);
    } catch (error) {
      const message = registryErrorMessage(error);
      const requiredRef = required.get(namespace);
      if (requiredRef) {
        throw new Error(`cannot resolve ${requiredRef}: registry ${namespace} unreachable and no local cache`);
      }
      warnings.push({ namespace, message });
      continue;
    }

    const resolvedItems: Array<RegistryFetchResult<RegistryItem>> = [];
    for (const latestResult of loaded.items) {
      const id = itemId(namespace, latestResult.value.name);
      const latestPin = pinFor(namespace, latestResult);
      latestPins[id] = latestPin;
      const requiredPin = input.requiredPins?.[id];
      let result = latestResult;
      if (requiredPin?.sourceIdentity) {
        if (
          latestResult.sha256 !== requiredPin.sha256 ||
          latestResult.sourceIdentity !== requiredPin.sourceIdentity
        ) {
          const descriptor = loaded.index.value.items.find((item) => item.name === latestResult.value.name)!;
          const pinned = await client.fetchRegistryItemPinned?.(
            namespace,
            entry,
            descriptor,
            {
              type: requiredPin.type,
              version: requiredPin.version,
              sha256: requiredPin.sha256,
              sourceIdentity: requiredPin.sourceIdentity
            },
            input.registrySources?.[namespace]
          );
          if (!pinned) {
            throw new Error(
              `cannot resolve exact pin ${id}@${requiredPin.version} (${requiredPin.sha256.slice(0, 12)}): source-bound cache entry is unavailable; restore the original cache or run farrier update --dir <target> --yes to explicitly migrate`
            );
          }
          result = pinned;
        }
      } else if (requiredPin) {
        warnings.push({
          namespace,
          message: `legacy registry pin ${id} is source-unbound; review current provenance and run farrier update --dir <target> --yes to migrate safely`
        });
      }
      resolvedItems.push(result);
      pins[id] = pinFor(namespace, result);

      if (result.value.type === "pack") {
        remotePackOrder.push(id);
        remotePacks.set(id, packFrom(namespace, result as RegistryFetchResult<Extract<RegistryItem, { type: "pack" }>>));
      } else if (result.value.type === "hook") {
        remoteHooks.set(id, remoteHookFrom(id, result as RegistryFetchResult<Extract<RegistryItem, { type: "hook" }>>));
      } else {
        remoteSkills.set(id, {
          refs: result.value.skill.refs,
          version: result.value.version,
          sha256: result.sha256,
          fromCache: result.fromCache
        });
      }
    }

    loaded.items = resolvedItems;
    if (loaded.index.fromCache || resolvedItems.some((item) => item.fromCache)) {
      warnings.push({
        namespace,
        message: `registry ${namespace} loaded from cache (cached)`
      });
    }
  }

  for (const [namespace, ref] of required) {
    if (!seenNamespaces.has(namespace)) {
      throw new Error(`cannot resolve ${ref}: registry ${namespace} unreachable and no local cache`);
    }
  }

  return createCatalog({
    useDefaultPacks: input.config.useDefaultPacks,
    remotePackOrder,
    remotePacks,
    remoteHooks,
    remoteSkills,
    pins,
    latestPins,
    warnings
  });
}
