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

/**
 * Languages the deterministic profile can report that have a builtin pack
 * family. A profiled language outside this set (Swift, Rust, Go, Java) can
 * never match a pack, so the zero-detection copy must not pretend farrier
 * "couldn't tell" — it saw the language and simply has no pack for it.
 */
const packBackedLanguages = new Set(["Python", "TypeScript", "JavaScript", "Ruby"]);

export function stackSelectionAssumption(
  selectedPackId: string,
  detected: DetectedPackEvidence[],
  profileLanguages: string[] = []
): string {
  const mostSpecific = detected[0];
  if (!mostSpecific) {
    if (selectedPackId) {
      return `Selected ${selectedPackId}; no supported stack signals matched, so nothing was assumed for you.`;
    }
    if (profileLanguages.length === 0) {
      return "We couldn't tell what your project uses. Pick one to continue.";
    }
    const names =
      profileLanguages.slice(0, 2).join(", ") + (profileLanguages.length > 2 ? ` +${profileLanguages.length - 2}` : "");
    return profileLanguages.some((language) => packBackedLanguages.has(language))
      ? `Detected ${names} sources, but no lockfile matched a pack. Pick the closest one.`
      : `Detected ${names} — no matching pack yet. Any language (neutral starter) still works.`;
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
