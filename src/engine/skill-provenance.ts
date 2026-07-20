import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegistryPin } from "../registry/catalog";
import { parseItemRef } from "../registry/ref";
import {
  normalizeManifestProvenance,
  type ManifestProvenanceMetadata,
  type NormalizedManifest,
} from "./manifest";
import {
  openContainedRepository,
  readContainedFile,
  type ContainedRepository,
} from "./repository-paths";
import {
  compareSkillInventoryText,
  snapshotSkillTree,
} from "./skill-tree-inventory";

const metadataFileLimit = 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const skillNamePattern = /^[a-z0-9][a-z0-9-]*$/;
const externalRefPattern = /^(?<source>[^@\s]+)@(?<name>[a-z0-9][a-z0-9-]*)$/;

const bundledLocations = new Map([
  [".agents/skills/codex-automation-recommender", "codex-automation-recommender"],
  [".agents/skills/farrier-project-advisor", "farrier-project-advisor"],
  [".claude/skills/claude-automation-recommender", "claude-automation-recommender"],
  [".claude/skills/harness-advisor", "harness-advisor"],
]);

export type SkillProvenanceKind =
  | "bundled"
  | "registry"
  | "third-party"
  | "project"
  | "unknown";

export type SkillLockEntry = {
  source: string;
  sourceType: string;
  skillPath: string;
  computedHash: string;
};

export type SkillMetadataStatus = "provided" | "read" | "missing" | "invalid";

export type SkillProvenanceMetadata = {
  manifest?: ManifestProvenanceMetadata;
  manifestStatus: SkillMetadataStatus;
  lockStatus: Exclude<SkillMetadataStatus, "provided">;
  lockEntries: Record<string, SkillLockEntry>;
  malformedLockEntries: string[];
  bundledTreeDigests: Record<string, string>;
  notes: string[];
};

export type SkillProvenance = {
  kind: SkillProvenanceKind;
  evidence: string[];
  manifestRefs: string[];
  registryPin?: {
    ref: string;
    version: string;
    sha256: string;
    sourceIdentity: string;
  };
  lock?: SkillLockEntry;
};

export type SkillProvenanceInput = {
  name: string;
  paths: string[];
  treeDigests: Record<string, string | undefined>;
  topologyValid: boolean;
  metadata: SkillProvenanceMetadata;
};

type ParsedManifestRef =
  | { kind: "registry"; ref: string; name: string }
  | { kind: "external"; ref: string; name: string; source: string }
  | { kind: "ambiguous"; ref: string; name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseManifestRef(ref: string): ParsedManifestRef | undefined {
  const registry = parseItemRef(ref);
  if (registry) return { kind: "registry", ref, name: registry.name };

  const external = ref.match(externalRefPattern);
  if (external?.groups) {
    return {
      kind: "external",
      ref,
      name: external.groups.name,
      source: external.groups.source,
    };
  }

  if (skillNamePattern.test(ref)) return { kind: "ambiguous", ref, name: ref };
  return undefined;
}

function validRegistryPin(ref: string, pin: RegistryPin | undefined): pin is RegistryPin & {
  sourceIdentity: string;
  ref: string;
} {
  return Boolean(
    pin
    && pin.type === "skill"
    && nonEmptyString(pin.version)
    && sha256Pattern.test(pin.sha256)
    && nonEmptyString(pin.sourceIdentity)
    && pin.ref === ref,
  );
}

function parseLockEntry(value: unknown): SkillLockEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !nonEmptyString(value.source)
    || !nonEmptyString(value.sourceType)
    || !nonEmptyString(value.skillPath)
    || typeof value.computedHash !== "string"
    || !sha256Pattern.test(value.computedHash)
  ) {
    return undefined;
  }
  return {
    source: value.source,
    sourceType: value.sourceType,
    skillPath: value.skillPath,
    computedHash: value.computedHash.toLowerCase(),
  };
}

function parseLock(text: string): Pick<
  SkillProvenanceMetadata,
  "lockStatus" | "lockEntries" | "malformedLockEntries" | "notes"
> {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.skills)) {
      return {
        lockStatus: "invalid",
        lockEntries: {},
        malformedLockEntries: [],
        notes: ["skills-lock.json is malformed or has an unsupported version"],
      };
    }

    const lockEntries: Record<string, SkillLockEntry> = {};
    const malformedLockEntries: string[] = [];
    for (const name of Object.keys(raw.skills).sort(compareSkillInventoryText)) {
      const entry = parseLockEntry(raw.skills[name]);
      if (entry) lockEntries[name] = entry;
      else malformedLockEntries.push(name);
    }
    return {
      lockStatus: "read",
      lockEntries,
      malformedLockEntries,
      notes: malformedLockEntries.length
        ? ["skills-lock.json has malformed entries: " + malformedLockEntries.join(", ")]
        : [],
    };
  } catch {
    return {
      lockStatus: "invalid",
      lockEntries: {},
      malformedLockEntries: [],
      notes: ["skills-lock.json is not valid JSON"],
    };
  }
}

async function localManifest(
  repository: ContainedRepository,
): Promise<Pick<SkillProvenanceMetadata, "manifest" | "manifestStatus" | "notes">> {
  const result = await readContainedFile(repository, ".farrier.json", metadataFileLimit);
  if (result.status === "missing") return { manifestStatus: "missing", notes: [] };
  if (result.status !== "read") {
    return {
      manifestStatus: "invalid",
      notes: [".farrier.json was not read: " + result.status],
    };
  }

  try {
    return {
      manifest: normalizeManifestProvenance(JSON.parse(result.text) as unknown),
      manifestStatus: "read",
      notes: [],
    };
  } catch {
    return {
      manifestStatus: "invalid",
      notes: [".farrier.json could not be normalized for provenance"],
    };
  }
}

async function packagedBundledTreeDigests(): Promise<{
  digests: Record<string, string>;
  notes: string[];
}> {
  const templateRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "templates",
    "skills",
  );
  try {
    const repository = await openContainedRepository(templateRoot);
    const digests: Record<string, string> = {};
    for (const [path, name] of [...bundledLocations.entries()].sort((left, right) =>
      compareSkillInventoryText(left[0], right[0]))) {
      const snapshot = await snapshotSkillTree(repository, name);
      if (snapshot.status !== "valid") {
        return { digests: {}, notes: ["packaged bundled skill could not be verified: " + name] };
      }
      digests[path] = snapshot.tree.treeDigest;
    }
    return { digests, notes: [] };
  } catch {
    return { digests: {}, notes: ["packaged bundled skills could not be inspected"] };
  }
}

export async function readSkillProvenanceMetadata(
  repository: ContainedRepository,
  manifest?: NormalizedManifest,
): Promise<SkillProvenanceMetadata> {
  const manifestResult = manifest
    ? { manifest, manifestStatus: "provided" as const, notes: [] }
    : await localManifest(repository);

  const lockResult = await readContainedFile(repository, "skills-lock.json", metadataFileLimit);
  const parsedLock = lockResult.status === "read"
    ? parseLock(lockResult.text)
    : {
        lockStatus: lockResult.status === "missing" ? "missing" as const : "invalid" as const,
        lockEntries: {},
        malformedLockEntries: [],
        notes: lockResult.status === "missing"
          ? []
          : ["skills-lock.json was not read: " + lockResult.status],
      };

  const bundled = await packagedBundledTreeDigests();
  return {
    ...manifestResult,
    ...parsedLock,
    bundledTreeDigests: bundled.digests,
    notes: [...manifestResult.notes, ...parsedLock.notes, ...bundled.notes]
      .sort(compareSkillInventoryText),
  };
}

function unknown(refs: string[], evidence: string[], lock?: SkillLockEntry): SkillProvenance {
  return {
    kind: "unknown",
    evidence: [...new Set(evidence)].sort(compareSkillInventoryText),
    manifestRefs: refs,
    ...(lock ? { lock } : {}),
  };
}

export function classifySkillProvenance(input: SkillProvenanceInput): SkillProvenance {
  const refs = (input.metadata.manifest?.skills ?? [])
    .map(parseManifestRef)
    .filter((ref): ref is ParsedManifestRef => ref?.name === input.name)
    .sort((left, right) => compareSkillInventoryText(left.ref, right.ref));
  const manifestRefs = refs.map((ref) => ref.ref);
  const lock = input.metadata.lockEntries[input.name];
  const malformedLock = input.metadata.malformedLockEntries.includes(input.name);
  const evidence: string[] = [];

  if (!input.topologyValid) evidence.push("topology is invalid");
  if (input.metadata.manifestStatus === "invalid") evidence.push("manifest metadata is invalid");
  if (input.metadata.lockStatus === "invalid") evidence.push("lock metadata is invalid");
  if (malformedLock) evidence.push("matching lock entry is malformed");
  if (refs.some((ref) => ref.kind === "ambiguous")) evidence.push("matching manifest ref has no source");
  if (new Set(manifestRefs).size > 1) evidence.push("multiple manifest refs match this skill");

  const registryRef = refs.find((ref): ref is Extract<ParsedManifestRef, { kind: "registry" }> =>
    ref.kind === "registry");
  const externalRef = refs.find((ref): ref is Extract<ParsedManifestRef, { kind: "external" }> =>
    ref.kind === "external");
  const pin = registryRef ? input.metadata.manifest?.registry.items[registryRef.ref] : undefined;

  if (registryRef && !validRegistryPin(registryRef.ref, pin)) {
    evidence.push("registry ref has no matching source-bound skill pin");
  }
  if (registryRef && (externalRef || lock)) evidence.push("registry and third-party metadata conflict");
  if (externalRef && lock && externalRef.source !== lock.source) {
    evidence.push("manifest and lock sources conflict");
  }

  const bundledPaths = input.paths.filter((path) => bundledLocations.has(path));
  const bundledPath = bundledPaths[0];
  const bundledVerified = Boolean(
    bundledPath
    && bundledPaths.length === 1
    && input.paths.length === 1
    && input.metadata.manifest
    && input.metadata.bundledTreeDigests[bundledPath]
    && input.treeDigests[bundledPath] === input.metadata.bundledTreeDigests[bundledPath],
  );
  if (bundledPaths.length > 0 && !bundledVerified) {
    evidence.push("bundled location lacks matching manifest and packaged tree evidence");
  }
  if (bundledPaths.length > 0 && (manifestRefs.length > 0 || lock || malformedLock)) {
    evidence.push("bundled location conflicts with external metadata");
  }

  if (evidence.length > 0) return unknown(manifestRefs, evidence, lock);

  if (bundledPath && bundledVerified) {
    return {
      kind: "bundled",
      evidence: [
        bundledPath,
        "bundled-tree:" + input.metadata.bundledTreeDigests[bundledPath],
        "farrier-manifest:" + input.metadata.manifestStatus,
      ],
      manifestRefs,
    };
  }

  if (registryRef && validRegistryPin(registryRef.ref, pin)) {
    return {
      kind: "registry",
      evidence: ["manifest:" + registryRef.ref, "registry-source:" + pin.sourceIdentity],
      manifestRefs,
      registryPin: {
        ref: registryRef.ref,
        version: pin.version,
        sha256: pin.sha256,
        sourceIdentity: pin.sourceIdentity,
      },
    };
  }

  if (externalRef || lock) {
    return {
      kind: "third-party",
      evidence: [
        ...(externalRef ? ["manifest:" + externalRef.ref] : []),
        ...(lock ? ["lock:" + input.name] : []),
      ].sort(compareSkillInventoryText),
      manifestRefs,
      ...(lock ? { lock } : {}),
    };
  }

  return {
    kind: "project",
    evidence: input.paths.map((path) => "project:" + path).sort(compareSkillInventoryText),
    manifestRefs,
  };
}
