import { builtinCatalog } from "../registry/catalog";
import { detectPacksWithEvidence } from "./detect";
import type { HarnessAuditCheck } from "./harness-audit-types";
import type { ContainedRepository } from "./repository-paths";
import { compareManifestStack, type StackComparisonStatus } from "./stack-comparison";

type ManifestDocument = {
  path: string;
  text: string;
};

export type HarnessAuditManifestStack = {
  status: StackComparisonStatus;
  manifestPackIds: string[];
  currentPackId: string;
  detectedPackId?: string;
  detectedPackIds: string[];
  detectedManifestPackIds: string[];
  evidence: string[];
};

export type HarnessAuditManifestStackInspection = {
  comparison: HarnessAuditManifestStack;
  check: HarnessAuditCheck;
};

function manifestPackIds(document: ManifestDocument): string[] {
  try {
    const parsed = JSON.parse(document.text) as { packIds?: unknown };
    return Array.isArray(parsed.packIds)
      ? parsed.packIds.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export async function inspectManifestStack(
  repository: ContainedRepository,
  documents: ManifestDocument[],
): Promise<HarnessAuditManifestStackInspection | undefined> {
  const manifest = documents.find((document) => document.path === ".farrier.json");
  if (!manifest) return undefined;
  const selected = manifestPackIds(manifest);
  const currentPackId = selected.at(-1);
  if (!currentPackId) return undefined;

  const detected = await detectPacksWithEvidence(repository);
  const first = detected[0];
  const comparisonResult = compareManifestStack({
    manifestPackIds: selected,
    currentPackId,
    detectedPackIds: detected.map((item) => item.packId),
    catalog: builtinCatalog(),
  });
  const { status, detectedManifestPackIds } = comparisonResult;
  const comparison: HarnessAuditManifestStack = {
    status,
    manifestPackIds: selected,
    currentPackId,
    ...(first ? { detectedPackId: first.packId } : {}),
    detectedPackIds: detected.map((item) => item.packId),
    detectedManifestPackIds,
    evidence: first?.evidence ?? [],
  };
  const result = status === "undetected"
    ? `no stack detected; manifest pack ${currentPackId} was not contradicted`
    : status === "match"
      ? `manifest pack ${currentPackId} matches detected stack ${first!.packId}; evidence: ${first!.evidence.join(", ")}`
      : status === "compatible"
        ? `manifest pack ${currentPackId} is an explicit or compatible selection for detected stack ${first!.packId}; evidence: ${first!.evidence.join(", ")}`
      : `manifest pack ${currentPackId} differs from detected stack ${first!.packId}; evidence: ${first!.evidence.join(", ")}`;

  return {
    comparison,
    check: {
      id: "check:manifest-stack",
      layers: ["toolchain", "hook"],
      description: "Compared the manifest's selected pack with deterministic repository-stack detection.",
      result,
    },
  };
}
