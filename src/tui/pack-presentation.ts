import type { DetectedPackEvidence } from "../engine/detect";
import type { PackHookRef, ResolvedPack } from "../packs/types";
import type { PackCatalog } from "../registry/catalog";

export type DetectedPackPresentation = DetectedPackEvidence & {
  rank: number;
  label: "detected" | "also detected";
};

export type GeneratorPresentation = {
  source: string;
  command: string;
};

export function selectedPackForWizard(pack: ResolvedPack, selectedHooks: PackHookRef[]): ResolvedPack {
  const selected = new Set(selectedHooks);
  return {
    ...pack,
    hooks: [...selectedHooks],
    remoteHooks: pack.remoteHooks.filter((hook) => selected.has(hook.id)),
  };
}

/** Preserve detector order: it is the engine's most-specific-first ranking. */
export function detectedPackPresentations(detected: DetectedPackEvidence[]): DetectedPackPresentation[] {
  return detected.map((match, rank) => ({
    ...match,
    evidence: [...match.evidence],
    rank,
    label: rank === 0 ? "detected" : "also detected",
  }));
}

export function stackSelectionAssumption(selectedPackId: string, detected: DetectedPackEvidence[]): string {
  const mostSpecific = detected[0];
  if (!mostSpecific) {
    return "Assumption: no supported stack signals matched; review the selected fallback before continuing.";
  }

  if (selectedPackId !== mostSpecific.packId) {
    return `Explicit override: ${selectedPackId} selected; detected signals for ${mostSpecific.packId} did not override your choice.`;
  }

  const alternateCount = detected.length - 1;
  return alternateCount === 0
    ? "Assumption: selected the most-specific detected match."
    : `Assumption: selected the first, most-specific match; ${alternateCount} broader or alternate match${alternateCount === 1 ? " is" : "es are"} shown.`;
}

/** Find the nearest pack in the lineage that actually declared the resolved generator. */
export function generatorPresentation(pack: ResolvedPack, catalog: Pick<PackCatalog, "getPack">): GeneratorPresentation | undefined {
  if (!pack.generator) return undefined;

  const definingPack = [...pack.packIds].reverse().find((packId) => catalog.getPack(packId)?.generator !== undefined) ?? pack.id;
  return {
    source: definingPack,
    command: [pack.generator.command, ...pack.generator.args].join(" "),
  };
}
