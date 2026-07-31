import type { PackVerbs, ResolvedPack } from "../packs/types";
import {
  openContainedRepository,
  readContainedFile,
  type ContainedRepository,
} from "./repository-paths";

export type JsPackageManager = "bun" | "pnpm" | "yarn" | "npm";
export type JsTestRunner = "vitest" | "jest";

/**
 * The effective toolchain for a render plan, resolved from repository
 * evidence at plan time. Sibling of evaluatePackRules: lockfiles pick the
 * package manager, package.json dependencies pick the test runner, and the
 * pack's verbs are derived from both so generated commands run with the
 * repository's own tools instead of the pack family's default (found on the
 * vibestage eval: the ts pack rendered `bun test` on a pnpm+vitest repo,
 * which always fails and blocks every Stop).
 */
export type ToolchainResolution = {
  verbs: PackVerbs;
  /** Undefined without lockfile evidence: the pack choice was explicit, keep its defaults. */
  packageManager?: JsPackageManager;
  testRunner?: JsTestRunner;
  /** Repository files and dependencies that justified the derivation. */
  evidence: string[];
  /** Competing-lockfile warnings for previews; `farrier audit` carries the full finding. */
  notes: string[];
};

type RepositoryInput = string | ContainedRepository;

const maxToolchainReadBytes = 320_000;

// Precedence when several lockfiles exist: the ts pack family implies bun, so
// bun evidence beats a stray lockfile from another manager; the rest prefer
// the more specific lockfile over npm's default package-lock.json.
const lockfileEvidence: ReadonlyArray<{ manager: JsPackageManager; files: readonly string[] }> = [
  { manager: "bun", files: ["bun.lock", "bun.lockb"] },
  { manager: "pnpm", files: ["pnpm-lock.yaml"] },
  { manager: "yarn", files: ["yarn.lock"] },
  { manager: "npm", files: ["package-lock.json"] },
];

const execPrefixes: Record<Exclude<JsPackageManager, "bun">, string> = {
  pnpm: "pnpm exec",
  yarn: "yarn run",
  npm: "npx",
};

export function packUsesJsToolchain(pack: Pick<ResolvedPack, "packIds">): boolean {
  return pack.packIds.includes("ts-base");
}

async function repositoryFileExists(repository: ContainedRepository, path: string): Promise<boolean> {
  const result = await readContainedFile(repository, path, maxToolchainReadBytes);
  return result.status === "read" || result.status === "oversized";
}

type PackageJsonDependencies = {
  dependencies: Set<string>;
  devDependencies: Set<string>;
};

function keySet(value: unknown): Set<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Set();
  }

  return new Set(Object.keys(value));
}

async function readPackageJsonDependencies(repository: ContainedRepository): Promise<PackageJsonDependencies | undefined> {
  const result = await readContainedFile(repository, "package.json", maxToolchainReadBytes);
  if (result.status !== "read") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(result.text) as Record<string, unknown>;
    return {
      dependencies: keySet(parsed.dependencies),
      devDependencies: keySet(parsed.devDependencies),
    };
  } catch {
    return undefined;
  }
}

function detectTestRunner(dependencies: PackageJsonDependencies | undefined): { runner: JsTestRunner; evidence: string } | undefined {
  if (!dependencies) {
    return undefined;
  }

  for (const runner of ["vitest", "jest"] as const) {
    if (dependencies.dependencies.has(runner)) {
      return { runner, evidence: `package.json dependency: ${runner}` };
    }
    if (dependencies.devDependencies.has(runner)) {
      return { runner, evidence: `package.json devDependency: ${runner}` };
    }
  }

  return undefined;
}

function derivedVerbs(
  packVerbs: PackVerbs,
  manager: Exclude<JsPackageManager, "bun">,
  runner: JsTestRunner | undefined
): PackVerbs {
  const exec = execPrefixes[manager];
  const checkFast = `${exec} tsc --noEmit`;
  // Without a recognized runner the manager's `test` script is the only
  // repo-native fallback; the pack default (`bun test`) would be wrong here.
  const test = runner === undefined ? `${manager} test` : runner === "vitest" ? `${exec} vitest run` : `${exec} jest`;

  return {
    // The lockfile is the evidence for the manager itself; each verb keeps
    // the pack's own gate so a repo without a tsconfig or prettier still does
    // not get a recipe naming them.
    lint: packVerbs.lint && { ...packVerbs.lint, command: checkFast, evidence: `${packVerbs.lint.evidence ?? "declared"}, run through ${manager}` },
    test: packVerbs.test && { ...packVerbs.test, command: test, evidence: `${manager} provides the test script` },
    fmt: packVerbs.fmt && { ...packVerbs.fmt, command: `${exec} prettier --write .`, evidence: `${packVerbs.fmt.evidence ?? "declared"}, run through ${manager}` }
  };
}

/**
 * Resolve the effective verbs for a pack against the target directory.
 * Only the ts pack family participates; every other pack keeps its verbs.
 * No lockfile means no evidence: the pack or manifest choice was explicit
 * (greenfield), so nothing is guessed.
 */
export async function resolveToolchain(
  dir: RepositoryInput,
  pack: Pick<ResolvedPack, "packIds" | "verbs">
): Promise<ToolchainResolution> {
  const defaults: ToolchainResolution = { verbs: { ...pack.verbs }, evidence: [], notes: [] };
  if (!packUsesJsToolchain(pack)) {
    return defaults;
  }

  let repository: ContainedRepository;
  try {
    repository = typeof dir === "string" ? await openContainedRepository(dir) : dir;
  } catch {
    // Unreadable or not-yet-created target directory: no evidence.
    return defaults;
  }

  const present: Array<{ manager: JsPackageManager; file: string }> = [];
  for (const { manager, files } of lockfileEvidence) {
    for (const file of files) {
      if (await repositoryFileExists(repository, file)) {
        present.push({ manager, file });
      }
    }
  }

  if (present.length === 0) {
    return defaults;
  }

  const chosen = present[0]!;
  const ignored = present.filter((entry) => entry.manager !== chosen.manager);
  const notes =
    ignored.length > 0
      ? [
          `Competing JavaScript lockfiles: verbs follow ${chosen.file} (${chosen.manager}); ignoring ${ignored
            .map((entry) => entry.file)
            .join(", ")}. Run farrier audit for the full finding.`,
        ]
      : [];

  if (chosen.manager === "bun") {
    // The pack family's own toolchain: keep its verbs byte for byte.
    return { ...defaults, packageManager: "bun", evidence: [chosen.file], notes };
  }

  const runner = detectTestRunner(await readPackageJsonDependencies(repository));

  return {
    verbs: derivedVerbs(pack.verbs, chosen.manager, runner?.runner),
    packageManager: chosen.manager,
    testRunner: runner?.runner,
    evidence: [chosen.file, ...(runner ? [runner.evidence] : [])],
    notes,
  };
}
