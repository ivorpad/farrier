import type { HookId, PackHookRef, SkillRef } from "../packs/types";
import { builtinCatalog, type PackCatalog, type RegistryPin } from "../registry/catalog";
import { parseItemRef } from "../registry/ref";
import { normalizeAgents, type EnforcementAgent } from "./agent-selection";
import { hookCatalogVersions, type FarrierManifestInput } from "./render";
import { openContainedRepository, readContainedFile } from "./repository-paths";

export const notFarrierProjectMessage = "not a farrier project; run farrier create first";
const manifestByteLimit = 1024 * 1024;

export type ManifestReadInput = {
  targetDir: string;
  catalog?: PackCatalog;
};

export type NormalizedManifest = {
  farrierVersion: string | null;
  agents: EnforcementAgent[];
  packIds: string[];
  currentPackId: string;
  hookIds: PackHookRef[];
  skills: SkillRef[];
  advisors: boolean;
  secondaryAcknowledged: string[];
  learn: {
    enabled: boolean;
  };
  judge?: unknown;
  guards?: unknown;
  quality?: unknown;
  versions: {
    farrierManifest: number | null;
    hooks: Record<string, number>;
    prompts?: unknown;
  };
  registry: {
    items: Record<string, RegistryPin>;
  };
};

const hookIds = Object.keys(hookCatalogVersions) as HookId[];
const hookIdSet = new Set<string>(hookIds);

function targetDirFromInput(input: ManifestReadInput | string): string {
  return typeof input === "string" ? input : input.targetDir;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item) => typeof item === "string")) return undefined;
  return [...value];
}

function requiredStringArray(value: unknown, field: string): string[] {
  const values = stringArray(value);
  if (!values || values.length === 0) {
    throw new Error(`invalid .farrier.json: ${field} must be a non-empty string array`);
  }
  return values;
}

function isHookId(value: string): value is HookId {
  return hookIdSet.has(value);
}

function isSupportedHookId(value: string, catalog: PackCatalog): value is PackHookRef {
  if (isHookId(value)) return true;
  const parsed = parseItemRef(value);
  return Boolean(parsed && catalog.remoteHook(parsed.id));
}

function parseHookIds(value: unknown, fallback: PackHookRef[], catalog: PackCatalog): PackHookRef[] {
  const values = value === undefined ? [...fallback] : stringArray(value);
  if (!values) throw new Error("invalid .farrier.json: hookIds must be a string array");

  const supported = values.filter((hookId): hookId is PackHookRef => isSupportedHookId(hookId, catalog));
  if (supported.length !== values.length) {
    const invalid = values.find((hookId) => !isSupportedHookId(hookId, catalog));
    throw new Error(`invalid .farrier.json: unsupported hook id '${invalid}'`);
  }
  return supported;
}

function parseVersions(value: unknown): NormalizedManifest["versions"] {
  if (!isRecord(value)) {
    return {
      farrierManifest: null,
      hooks: {},
    };
  }

  const hooks: Record<string, number> = {};
  if (isRecord(value.hooks)) {
    for (const [key, item] of Object.entries(value.hooks)) {
      if (typeof item === "number" && Number.isFinite(item)) hooks[key] = item;
    }
  }

  return {
    farrierManifest:
      typeof value.farrierManifest === "number" && Number.isFinite(value.farrierManifest)
        ? value.farrierManifest
        : null,
    hooks,
    prompts: value.prompts,
  };
}

function parseRegistry(value: unknown): NormalizedManifest["registry"] {
  if (!isRecord(value) || !isRecord(value.items)) return { items: {} };

  const items: Record<string, RegistryPin> = {};
  for (const [id, pin] of Object.entries(value.items)) {
    if (!isRecord(pin)) continue;
    if (
      (pin.type === "pack" || pin.type === "hook" || pin.type === "skill")
      && typeof pin.version === "string"
      && typeof pin.sha256 === "string"
    ) {
      items[id] = {
        type: pin.type,
        version: pin.version,
        sha256: pin.sha256,
        ...(typeof pin.sourceIdentity === "string" ? { sourceIdentity: pin.sourceIdentity } : {}),
        ...(typeof pin.ref === "string" ? { ref: pin.ref } : {}),
      };
    }
  }
  return { items };
}

function parseLearn(value: unknown): { enabled: boolean } {
  return { enabled: isRecord(value) && value.enabled === true };
}

// v2 manifests predate the field and always materialized the advisor skill
// trees; migration treats them as opt-out so update prunes unmodified trees.
function parseAdvisors(raw: Record<string, unknown>): boolean {
  return raw.advisors === true;
}

export function normalizeManifest(raw: unknown, catalog: PackCatalog = builtinCatalog()): NormalizedManifest {
  if (!isRecord(raw)) throw new Error("invalid .farrier.json: root must be an object");

  const packIds = requiredStringArray(raw.packIds, "packIds");
  const currentPackId = packIds[packIds.length - 1];
  if (!currentPackId) {
    throw new Error("invalid .farrier.json: packIds must be a non-empty string array");
  }

  const resolvedPack = catalog.resolvePack(currentPackId);
  return {
    farrierVersion: optionalString(raw.farrierVersion),
    agents: normalizeAgents(raw.agents),
    packIds,
    currentPackId,
    hookIds: parseHookIds(raw.hookIds, resolvedPack.hooks, catalog),
    skills: stringArray(raw.skills) ?? [...resolvedPack.skills],
    advisors: parseAdvisors(raw),
    secondaryAcknowledged: stringArray(raw.secondaryAcknowledged) ?? [],
    learn: parseLearn(raw.learn),
    judge: raw.judge,
    guards: raw.guards,
    quality: raw.quality,
    versions: parseVersions(raw.versions),
    registry: parseRegistry(raw.registry),
  };
}

export type ManifestProvenanceMetadata = Pick<NormalizedManifest, "skills" | "registry">;

export function normalizeManifestProvenance(raw: unknown): ManifestProvenanceMetadata {
  if (!isRecord(raw)) throw new Error("invalid .farrier.json: root must be an object");
  requiredStringArray(raw.packIds, "packIds");
  const skills = raw.skills === undefined ? [] : stringArray(raw.skills);
  if (!skills) throw new Error("invalid .farrier.json: skills must be a string array");
  return { skills, registry: parseRegistry(raw.registry) };
}

export function manifestToInput(manifest: NormalizedManifest): FarrierManifestInput {
  return {
    farrierVersion: manifest.farrierVersion ?? undefined,
    agents: [...manifest.agents],
    packIds: [...manifest.packIds],
    hookIds: [...manifest.hookIds],
    skills: [...manifest.skills],
    advisors: manifest.advisors,
    secondaryAcknowledged: [...manifest.secondaryAcknowledged],
    learn: {
      enabled: manifest.learn.enabled,
    },
    judge: manifest.judge,
    guards: manifest.guards,
    quality: manifest.quality,
    versions: {
      farrierManifest: manifest.versions.farrierManifest ?? undefined,
      hooks: { ...manifest.versions.hooks },
      prompts: manifest.versions.prompts,
    },
    registry: {
      items: { ...manifest.registry.items },
    },
  };
}

export async function readManifest(input: ManifestReadInput | string): Promise<NormalizedManifest> {
  const targetDir = targetDirFromInput(input);
  const catalog = typeof input === "string" ? builtinCatalog() : input.catalog ?? builtinCatalog();
  const repository = await openContainedRepository(targetDir);
  const result = await readContainedFile(repository, ".farrier.json", manifestByteLimit);
  if (result.status === "missing") throw new Error(notFarrierProjectMessage);
  if (result.status !== "read") {
    throw new Error(`invalid .farrier.json: manifest was not read (${result.status})`);
  }
  const text = result.text;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid .farrier.json: ${message}`);
  }
  return normalizeManifest(raw, catalog);
}
