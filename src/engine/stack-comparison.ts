import type { PackCatalog } from "../registry/catalog";

export type StackComparisonStatus = "match" | "compatible" | "drift" | "undetected";

export type StackComparison = {
  status: StackComparisonStatus;
  currentPackId: string;
  detectedPackId?: string;
  detectedPackIds: string[];
  detectedManifestPackIds: string[];
};

/**
 * Compare the manifest's explicit pack chain with deterministic detection.
 * A parent pack remains a valid explicit choice for a more specific detected
 * child, and a child remains valid when only its parent signals are present.
 */
export function compareManifestStack(input: {
  manifestPackIds: readonly string[];
  currentPackId: string;
  detectedPackIds: readonly string[];
  catalog: Pick<PackCatalog, "resolvePack">;
}): StackComparison {
  const detectedPackIds = [...input.detectedPackIds];
  const detectedPackId = detectedPackIds[0];
  const detectedManifestPackIds = detectedPackId
    ? input.catalog.resolvePack(detectedPackId).packIds
    : [];
  const status: StackComparisonStatus = detectedPackId === undefined
    ? "undetected"
    : detectedPackId === input.currentPackId
      ? "match"
      : input.currentPackId === "generic"
        || input.manifestPackIds.some((id) => detectedManifestPackIds.includes(id))
        ? "compatible"
        : "drift";

  return {
    status,
    currentPackId: input.currentPackId,
    ...(detectedPackId ? { detectedPackId } : {}),
    detectedPackIds,
    detectedManifestPackIds,
  };
}
