import type { PackVerb, PackVerbs, ResolvedVerbs } from "../packs/types";
import { matchedDetectEvidence, scanProject, type RepositoryInput } from "./detect";

/** One verb's evidence verdict, for previews and for doctor's drift check. */
export type EvaluatedVerb = {
  /** Verb slot: "lint", "test", or "fmt". */
  id: VerbId;
  command: string;
  /** Declared justification, or a generic label when the verb is unconditional. */
  evidence: string;
  matched: boolean;
  /** Repository paths and dependencies that satisfied `when`. */
  matchedPaths: string[];
};

export type VerbResolution = {
  verbs: ResolvedVerbs;
  evaluated: EvaluatedVerb[];
};

export type VerbId = "lint" | "test" | "fmt" | "full";

const verbOrder: VerbId[] = ["lint", "test", "fmt", "full"];

function unconditional(verb: PackVerb): EvaluatedVerb["evidence"] {
  return verb.evidence ?? "no evidence required";
}

/**
 * Compose the generated recipes from the verbs whose evidence the repository
 * actually supports.
 *
 * `check-full` is the surviving gate parts joined with `&&`, so a project with
 * a linter but no test runner still gets a real gate instead of a broken one.
 * When neither gate part survives there is no `check` at all, and the caller
 * is expected to drop the verb-runner binding: an empty verb set is the
 * correct harness for a day-0 project, not a Stop hook that always fails.
 */
export async function resolveVerbs(dir: RepositoryInput, verbs: PackVerbs): Promise<VerbResolution> {
  const present = verbOrder
    .map((id) => ({ id, verb: verbs[id] }))
    .filter((entry): entry is { id: VerbId; verb: PackVerb } => entry.verb !== undefined);

  const conditional = present.filter((entry) => entry.verb.when !== undefined);

  let evaluated: EvaluatedVerb[];
  if (conditional.length === 0) {
    evaluated = present.map((entry) => ({
      id: entry.id,
      command: entry.verb.command,
      evidence: unconditional(entry.verb),
      matched: true,
      matchedPaths: [],
    }));
  } else {
    let matchedFor: (entry: { verb: PackVerb }) => string[] | undefined;
    try {
      const signals = await scanProject(dir, conditional.map((entry) => entry.verb.when!));
      matchedFor = (entry) =>
        entry.verb.when === undefined ? [] : matchedDetectEvidence(signals, entry.verb.when);
    } catch {
      // Unreadable or not-yet-created target: no evidence, so only
      // unconditional verbs render. Guessing here is what produced gates that
      // could never pass.
      matchedFor = (entry) => (entry.verb.when === undefined ? [] : undefined);
    }

    evaluated = present.map((entry) => {
      const matchedPaths = matchedFor(entry);
      return {
        id: entry.id,
        command: entry.verb.command,
        evidence: unconditional(entry.verb),
        matched: matchedPaths !== undefined,
        matchedPaths: matchedPaths ?? [],
      };
    });
  }

  const commandFor = (id: VerbId): string | undefined =>
    evaluated.find((entry) => entry.id === id && entry.matched)?.command;

  const lint = commandFor("lint");
  const test = commandFor("test");
  // An explicit `full` wins: a legacy remote pack's aggregate may contain
  // stages that recomposing from lint and test would drop.
  const full = commandFor("full");
  const gate = [lint, test].filter((command): command is string => command !== undefined);
  const check = full ?? (gate.length > 0 ? gate.join(" && ") : undefined);

  return {
    verbs: {
      ...(check !== undefined ? { check } : {}),
      ...(lint !== undefined ? { checkFast: lint } : {}),
      ...(test !== undefined ? { test } : {}),
      ...(commandFor("fmt") !== undefined ? { fmt: commandFor("fmt") } : {}),
    },
    evaluated,
  };
}

/** True when the resolved verbs contain a gate worth binding verb-runner to. */
export function hasGate(verbs: ResolvedVerbs): boolean {
  return verbs.check !== undefined || verbs.checkFast !== undefined;
}

/**
 * The verbs a pack declares, ignoring evidence. Only for reconstructing what
 * an older farrier would have written to a justfile: those releases rendered
 * every declared verb unconditionally, so recognizing that output requires
 * reproducing it. Never use this to generate a harness.
 */
export function declaredVerbs(verbs: PackVerbs): ResolvedVerbs {
  const gate = [verbs.lint?.command, verbs.test?.command].filter(
    (command): command is string => command !== undefined
  );
  const check = verbs.full?.command ?? (gate.length > 0 ? gate.join(" && ") : undefined);

  return {
    ...(check !== undefined ? { check } : {}),
    ...(verbs.lint !== undefined ? { checkFast: verbs.lint.command } : {}),
    ...(verbs.test !== undefined ? { test: verbs.test.command } : {}),
    ...(verbs.fmt !== undefined ? { fmt: verbs.fmt.command } : {}),
  };
}
