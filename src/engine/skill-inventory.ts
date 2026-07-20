import type { NormalizedManifest } from "./manifest";
import { unknownSkillPermissions } from "./skill-permissions";
import {
  classifySkillProvenance,
  readSkillProvenanceMetadata,
  type SkillProvenance,
} from "./skill-provenance";
import {
  compareSkillInventoryText,
  inspectSkillLocation,
  readBoundedSkillDirectory,
  skillInventoryLimits,
  type SkillLocation,
} from "./skill-tree-inventory";
import { openContainedRepository } from "./repository-paths";
import type { SkillPermissionSummary } from "./skill-types";

const roots = [
  { kind: "legacy", path: "skills" },
  { kind: "codex", path: ".agents/skills" },
  { kind: "claude", path: ".claude/skills" },
] as const;

export { skillInventoryLimits } from "./skill-tree-inventory";
export type {
  SkillLocation,
  SkillRootKind,
  SkillTreeFile,
  SkillTreeSnapshot,
} from "./skill-tree-inventory";

export type SkillTopologyKind =
  | "legacy-canonical"
  | "codex-native"
  | "claude-native"
  | "linked-shared"
  | "copied-identical"
  | "divergent"
  | "invalid";

export type SkillTopologyFinding = {
  kind: SkillTopologyKind;
  paths: string[];
  treeDigests: string[];
  reason?: string;
};

export type SkillInventoryEntry = {
  name: string;
  topologies: SkillTopologyFinding[];
  locations: SkillLocation[];
  provenance: SkillProvenance;
  permissions: SkillPermissionSummary;
};

export type SkillInventoryCoverage = {
  roots: Array<{
    path: string;
    status: "read" | "missing" | "invalid" | "oversized";
    skillLocations: number;
  }>;
  limits: typeof skillInventoryLimits;
  complete: boolean;
};

export type SkillInventory = {
  entries: SkillInventoryEntry[];
  malformedLocations: Array<{ path: string; reason: string }>;
  coverage: SkillInventoryCoverage;
  notes: string[];
};

export type SkillInventoryInput = {
  targetDir: string;
  manifest?: NormalizedManifest;
};

function topologyFor(locations: SkillLocation[]): SkillTopologyFinding[] {
  const invalid = locations.filter((location) => location.state === "invalid");
  if (invalid.length > 0) {
    return [{
      kind: "invalid",
      paths: invalid.map((location) => location.path).sort(compareSkillInventoryText),
      treeDigests: [],
      reason: invalid.flatMap((location) => location.issues).sort(compareSkillInventoryText).join(", "),
    }];
  }

  const findings: SkillTopologyFinding[] = [];
  const legacy = locations.find((location) => location.root === "legacy");
  const codex = locations.find((location) => location.root === "codex");
  const claude = locations.find((location) => location.root === "claude");

  if (legacy?.tree) {
    findings.push({
      kind: "legacy-canonical",
      paths: [legacy.path],
      treeDigests: [legacy.tree.treeDigest],
    });
  }

  if (claude?.state === "linked" && codex?.tree) {
    findings.push({
      kind: "linked-shared",
      paths: [codex.path, claude.path].sort(compareSkillInventoryText),
      treeDigests: [codex.tree.treeDigest],
    });
  } else if (codex?.tree && claude?.tree) {
    const identical = codex.tree.treeDigest === claude.tree.treeDigest;
    findings.push({
      kind: identical ? "copied-identical" : "divergent",
      paths: [codex.path, claude.path].sort(compareSkillInventoryText),
      treeDigests: [codex.tree.treeDigest, claude.tree.treeDigest].sort(compareSkillInventoryText),
    });
  } else if (codex?.tree) {
    findings.push({
      kind: "codex-native",
      paths: [codex.path],
      treeDigests: [codex.tree.treeDigest],
    });
  } else if (claude?.tree) {
    findings.push({
      kind: "claude-native",
      paths: [claude.path],
      treeDigests: [claude.tree.treeDigest],
    });
  }
  return findings;
}

export async function inventoryProjectSkills(input: SkillInventoryInput): Promise<SkillInventory> {
  const repository = await openContainedRepository(input.targetDir);
  const metadata = await readSkillProvenanceMetadata(repository, input.manifest);
  const byName = new Map<string, SkillLocation[]>();
  const coverageRoots: SkillInventoryCoverage["roots"] = [];
  const malformedLocations: SkillInventory["malformedLocations"] = [];

  for (const root of roots) {
    const result = await readBoundedSkillDirectory(
      repository,
      root.path,
      skillInventoryLimits.maxSkillsPerRoot,
    );
    if (result.status === "missing") {
      coverageRoots.push({ path: root.path, status: "missing", skillLocations: 0 });
      continue;
    }
    if (result.status !== "read") {
      const status = result.status === "oversized" ? "oversized" : "invalid";
      coverageRoots.push({ path: root.path, status, skillLocations: 0 });
      malformedLocations.push({
        path: root.path,
        reason: result.status === "oversized" ? "skill-location-limit" : result.status,
      });
      continue;
    }

    const entries = result.entries;
    coverageRoots.push({ path: root.path, status: "read", skillLocations: entries.length });
    for (const entry of entries) {
      const location = await inspectSkillLocation(repository, root.kind, root.path, entry.name);
      const current = byName.get(entry.name) ?? [];
      current.push(location);
      byName.set(entry.name, current);
      if (location.state === "invalid") {
        malformedLocations.push({ path: location.path, reason: location.issues.join(", ") });
      }
    }
  }

  const entries: SkillInventoryEntry[] = [];
  for (const name of [...byName.keys()].sort(compareSkillInventoryText)) {
    const locations = (byName.get(name) ?? []).sort((left, right) =>
      compareSkillInventoryText(left.path, right.path));
    const topologies = topologyFor(locations);
    const topologyValid = topologies.length > 0
      && topologies.every((topology) => topology.kind !== "invalid");
    const paths = locations.map((location) => location.path).sort(compareSkillInventoryText);
    const treeDigests = Object.fromEntries(locations.map((location) => [
      location.path,
      location.tree?.treeDigest,
    ]));
    entries.push({
      name,
      topologies,
      locations,
      provenance: classifySkillProvenance({
        name,
        paths,
        treeDigests,
        topologyValid,
        metadata,
      }),
      permissions: unknownSkillPermissions(),
    });
  }

  malformedLocations.sort((left, right) =>
    compareSkillInventoryText(left.path, right.path)
    || compareSkillInventoryText(left.reason, right.reason));

  return {
    entries,
    malformedLocations,
    coverage: {
      roots: coverageRoots,
      limits: skillInventoryLimits,
      complete: malformedLocations.length === 0,
    },
    notes: metadata.notes,
  };
}
