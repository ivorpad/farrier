import { builtinDetectionOrder, getPack } from "../packs/index";
import type { PackDetect, PackRuleBlock, ResolvedPack, SecondaryDetectionFinding, ToolPolicyRule } from "../packs/types";
import type { PackCatalog } from "../registry/catalog";
import {
  openContainedRepository,
  readContainedDirectory,
  readContainedFile,
  type ContainedReadResult,
  type ContainedRepository,
} from "./repository-paths";

type PackageJsonSignals = {
  dependencies: Set<string>;
  devDependencies: Set<string>;
};

export type ProjectSignals = {
  existingFiles: Set<string>;
  allRelativeFiles: string[];
  pyprojectText?: string;
  packageJson?: PackageJsonSignals;
  gemfileText?: string;
};

export type DetectedPackEvidence = {
  packId: string;
  evidence: string[];
};

export type DetectedPackEvidenceInputs = DetectedPackEvidence & {
  evidencePaths: string[];
};

type MatchedDetectEvidence = {
  evidence: string[];
  evidencePaths: string[];
};

type DetectRequirements = {
  files: Set<string>;
  globs: Set<string>;
  needsPyproject: boolean;
  needsPackageJson: boolean;
  needsGemfile: boolean;
};

const ignoredWalkDirectories = new Set([".git", ".venv", "node_modules", "vendor"]);
const maxGlobEvidencePaths = 20;
const maxDetectionReadBytes = 320_000;

export type RepositoryInput = string | ContainedRepository;

async function repositoryFor(input: RepositoryInput): Promise<ContainedRepository> {
  return typeof input === "string" ? openContainedRepository(input) : input;
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addRequirements(requirements: DetectRequirements, detect: PackDetect): void {
  for (const file of detect.files ?? []) {
    requirements.files.add(normalizeRelativePath(file));
  }

  for (const file of detect.anyFiles ?? []) {
    requirements.files.add(normalizeRelativePath(file));
  }

  for (const glob of detect.globs ?? []) {
    requirements.globs.add(normalizeRelativePath(glob));
  }

  if ((detect.pyprojectDependencies ?? []).length > 0 || (detect.pyprojectTables ?? []).length > 0) {
    requirements.needsPyproject = true;
    requirements.files.add("pyproject.toml");
  }

  if ((detect.packageJsonDependencies ?? []).length > 0 || (detect.packageJsonDevDependencies ?? []).length > 0 || (detect.packageJsonAnyDependencies ?? []).length > 0) {
    requirements.needsPackageJson = true;
    requirements.files.add("package.json");
  }

  if ((detect.gemfileGems ?? []).length > 0) {
    requirements.needsGemfile = true;
    requirements.files.add("Gemfile");
  }

  for (const child of detect.any ?? []) {
    addRequirements(requirements, child);
  }
}

function collectRequirements(detects: PackDetect[]): DetectRequirements {
  const requirements: DetectRequirements = {
    files: new Set(),
    globs: new Set(),
    needsPyproject: false,
    needsPackageJson: false,
    needsGemfile: false,
  };

  for (const detect of detects) {
    addRequirements(requirements, detect);
  }

  return requirements;
}

function dependencySet(value: unknown): Set<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Set();
  }

  return new Set(Object.keys(value));
}

function parsePackageJson(text: string | undefined): PackageJsonSignals | undefined {
  if (text === undefined) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;

    return {
      dependencies: dependencySet(parsed.dependencies),
      devDependencies: dependencySet(parsed.devDependencies),
    };
  } catch {
    return undefined;
  }
}

async function walkProject(repository: ContainedRepository, prefix = ""): Promise<string[]> {
  const directory = await readContainedDirectory(repository, prefix);
  if (directory.status !== "read") return [];

  const paths: string[] = [];

  for (const entry of directory.entries) {
    const relativePath = normalizeRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name);

    if (entry.isDirectory()) {
      if (ignoredWalkDirectories.has(entry.name)) {
        continue;
      }

      paths.push(`${relativePath}/`);
      paths.push(...(await walkProject(repository, relativePath)));
      continue;
    }

    if (entry.isFile()) {
      paths.push(relativePath);
    }
  }

  return paths;
}

export async function scanProject(input: RepositoryInput, detects: PackDetect[]): Promise<ProjectSignals> {
  const repository = await repositoryFor(input);
  const requirements = collectRequirements(detects);
  const reads = new Map<string, ContainedReadResult>();

  await Promise.all(Array.from(requirements.files, async (file) => {
    reads.set(file, await readContainedFile(repository, file, maxDetectionReadBytes));
  }));

  const existingFiles = new Set(Array.from(reads)
    .filter(([, result]) => result.status === "read" || result.status === "oversized")
    .map(([file]) => file));
  const text = (path: string): string | undefined => {
    const result = reads.get(path);
    return result?.status === "read" ? result.text : undefined;
  };
  const allRelativeFiles = requirements.globs.size > 0 ? await walkProject(repository) : [];

  return {
    existingFiles,
    allRelativeFiles,
    pyprojectText: text("pyproject.toml"),
    packageJson: parsePackageJson(text("package.json")),
    gemfileText: text("Gemfile"),
  };
}

function containsPyprojectDependency(pyprojectText: string | undefined, dependency: string): boolean {
  if (pyprojectText === undefined) {
    return false;
  }

  const escaped = escapeRegExp(dependency);
  const pattern = new RegExp(`(^|["'\\s,\\[])(?:${escaped})(?:\\[[A-Za-z0-9_,.-]+\\])?(?=\\s*(?:[<>=!~]=|=|;)|["'\\s,\\]])`, "im");

  return pattern.test(pyprojectText);
}

/**
 * Matches a TOML table header, so "tool.ruff" matches `[tool.ruff]` and its
 * subtables (`[tool.ruff.lint]`) but never a dependency string that happens to
 * contain the name.
 */
function containsPyprojectTable(pyprojectText: string | undefined, table: string): boolean {
  if (pyprojectText === undefined) {
    return false;
  }

  const pattern = new RegExp(`^\\s*\\[\\s*${escapeRegExp(table)}(?:\\.[A-Za-z0-9_.-]+)?\\s*\\]`, "im");

  return pattern.test(pyprojectText);
}

function containsGemfileGem(gemfileText: string | undefined, gem: string): boolean {
  if (gemfileText === undefined) {
    return false;
  }

  const escaped = escapeRegExp(gem);
  const pattern = new RegExp(`(^|\\n)\\s*gem\\s*\\(?\\s*["']${escaped}["']`, "im");

  return pattern.test(gemfileText);
}

function containsPackageJsonDependency(packageJson: PackageJsonSignals | undefined, dependency: string): boolean {
  if (packageJson === undefined) {
    return false;
  }

  return packageJson.dependencies.has(dependency);
}

function containsPackageJsonDevDependency(packageJson: PackageJsonSignals | undefined, dependency: string): boolean {
  if (packageJson === undefined) {
    return false;
  }

  return packageJson.devDependencies.has(dependency);
}

function containsPackageJsonAnyDependency(packageJson: PackageJsonSignals | undefined, dependency: string): boolean {
  if (packageJson === undefined) {
    return false;
  }

  return packageJson.dependencies.has(dependency) || packageJson.devDependencies.has(dependency);
}

function globToRegExp(glob: string): RegExp {
  const normalized = normalizeRelativePath(glob);
  let pattern = "";

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (char === "*") {
      if (normalized[i + 1] === "*") {
        // `**/` spans zero or more path segments, so "tests/**/*.py" matches
        // "tests/a.py" as well as "tests/unit/a.py". Requiring at least one
        // segment silently missed every flat directory.
        if (normalized[i + 2] === "/") {
          pattern += "(?:[^/]*/)*";
          i += 2;
        } else {
          pattern += ".*";
          i += 1;
        }
      } else {
        pattern += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      pattern += "[^/]";
      continue;
    }

    pattern += escapeRegExp(char);
  }

  return new RegExp(`^${pattern}$`);
}

function matchingGlobPaths(signals: ProjectSignals, glob: string): string[] {
  const pattern = globToRegExp(glob);
  return signals.allRelativeFiles.filter((path) => pattern.test(path)).sort();
}

function appendUnique(target: string[], values: string[]): void {
  const seen = new Set(target);

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      target.push(value);
    }
  }
}

function matchedDetectEvidenceInputs(signals: ProjectSignals, detect: PackDetect): MatchedDetectEvidence | undefined {
  const evidence: string[] = [];
  const evidencePaths: string[] = [];

  for (const file of detect.files ?? []) {
    const normalized = normalizeRelativePath(file);
    if (!signals.existingFiles.has(normalized)) {
      return undefined;
    }

    appendUnique(evidence, [normalized]);
    appendUnique(evidencePaths, [normalized]);
  }

  if ((detect.anyFiles ?? []).length > 0) {
    const presentFiles = (detect.anyFiles ?? []).map(normalizeRelativePath).filter((file) => signals.existingFiles.has(file));

    if (presentFiles.length === 0) {
      return undefined;
    }

    appendUnique(evidence, presentFiles);
    appendUnique(evidencePaths, presentFiles);
  }

  for (const glob of detect.globs ?? []) {
    const matches = matchingGlobPaths(signals, glob);
    if (matches.length === 0) {
      return undefined;
    }

    const displayedMatches = matches.slice(0, maxGlobEvidencePaths);
    appendUnique(evidence, displayedMatches);
    appendUnique(evidencePaths, displayedMatches);
  }

  for (const dependency of detect.pyprojectDependencies ?? []) {
    if (!containsPyprojectDependency(signals.pyprojectText, dependency)) {
      return undefined;
    }

    appendUnique(evidence, [`pyproject.toml dependency: ${dependency}`]);
    appendUnique(evidencePaths, ["pyproject.toml"]);
  }

  for (const table of detect.pyprojectTables ?? []) {
    if (!containsPyprojectTable(signals.pyprojectText, table)) {
      return undefined;
    }

    appendUnique(evidence, [`pyproject.toml [${table}]`]);
    appendUnique(evidencePaths, ["pyproject.toml"]);
  }

  for (const dependency of detect.packageJsonDependencies ?? []) {
    if (!containsPackageJsonDependency(signals.packageJson, dependency)) {
      return undefined;
    }

    appendUnique(evidence, [`package.json dependency: ${dependency}`]);
    appendUnique(evidencePaths, ["package.json"]);
  }

  for (const dependency of detect.packageJsonDevDependencies ?? []) {
    if (!containsPackageJsonDevDependency(signals.packageJson, dependency)) {
      return undefined;
    }

    appendUnique(evidence, [`package.json devDependency: ${dependency}`]);
    appendUnique(evidencePaths, ["package.json"]);
  }

  for (const dependency of detect.packageJsonAnyDependencies ?? []) {
    if (!containsPackageJsonAnyDependency(signals.packageJson, dependency)) {
      return undefined;
    }

    const sections = [
      containsPackageJsonDependency(signals.packageJson, dependency) ? `package.json dependency: ${dependency}` : undefined,
      containsPackageJsonDevDependency(signals.packageJson, dependency) ? `package.json devDependency: ${dependency}` : undefined,
    ].filter((value): value is string => value !== undefined);
    appendUnique(evidence, sections);
    appendUnique(evidencePaths, ["package.json"]);
  }

  for (const gem of detect.gemfileGems ?? []) {
    if (!containsGemfileGem(signals.gemfileText, gem)) {
      return undefined;
    }

    appendUnique(evidence, [`Gemfile gem: ${gem}`]);
    appendUnique(evidencePaths, ["Gemfile"]);
  }

  if ((detect.any ?? []).length > 0) {
    const matchedBranches = (detect.any ?? [])
      .map((child) => matchedDetectEvidenceInputs(signals, child))
      .filter((branch): branch is MatchedDetectEvidence => branch !== undefined);

    if (matchedBranches.length === 0) {
      return undefined;
    }

    for (const branch of matchedBranches) {
      appendUnique(evidence, branch.evidence);
      appendUnique(evidencePaths, branch.evidencePaths);
    }
  }

  return { evidence, evidencePaths };
}

export function matchedDetectEvidence(signals: ProjectSignals, detect: PackDetect): string[] | undefined {
  return matchedDetectEvidenceInputs(signals, detect)?.evidence;
}

function matchesDetect(signals: ProjectSignals, detect: PackDetect): boolean {
  return matchedDetectEvidence(signals, detect) !== undefined;
}

export async function detectPacksWithEvidence(dir: RepositoryInput, catalog?: PackCatalog): Promise<DetectedPackEvidence[]> {
  const detected = await detectPacksWithEvidenceInputs(dir, catalog);
  return detected.map(({ packId, evidence }) => ({ packId, evidence }));
}

export async function detectPacksWithEvidenceInputs(
  dir: RepositoryInput,
  catalog?: PackCatalog,
): Promise<DetectedPackEvidenceInputs[]> {
  const packIds = catalog ? catalog.detectablePackIds() : builtinDetectionOrder();
  const packs = packIds.map((id) => (catalog ? catalog.getPack(id) : getPack(id))).filter((pack): pack is NonNullable<typeof pack> => pack !== undefined);

  const signals = await scanProject(
    dir,
    packs.map((pack) => pack.detect),
  );

  return packs.flatMap((pack) => {
    const matched = matchedDetectEvidenceInputs(signals, pack.detect);
    return matched === undefined ? [] : [{ packId: pack.id, ...matched }];
  });
}

export async function detectPacks(dir: RepositoryInput, catalog?: PackCatalog): Promise<string[]> {
  const detected = await detectPacksWithEvidence(dir, catalog);
  return detected.map((pack) => pack.packId);
}

export type EvaluatedRuleBlock = {
  id: string;
  evidence: string;
  matched: boolean;
  matchedPaths: string[];
};

export type EvaluatedPackRules = {
  /** Base pack detection evidence, or undefined when the stack was selected explicitly and does not match. */
  packEvidence: string[] | undefined;
  agentsRules: string[];
  toolPolicyRules: ToolPolicyRule[];
  blocks: EvaluatedRuleBlock[];
};

/**
 * Evaluate a pack's conditional rule blocks against the target directory.
 * Rules from non-matching blocks are omitted so generated policy always has
 * repository evidence behind it.
 */
export async function evaluatePackRules(
  dir: RepositoryInput,
  pack: Pick<ResolvedPack, "detect" | "agentsRules" | "toolPolicyRules" | "ruleBlocks">
): Promise<EvaluatedPackRules> {
  const blocks: PackRuleBlock[] = pack.ruleBlocks ?? [];

  let signals: ProjectSignals;
  try {
    signals = await scanProject(dir, [pack.detect, ...blocks.map((block) => block.when)]);
  } catch {
    // Unreadable or not-yet-created target directory: no evidence, so no
    // conditional rules. Base pack rules still apply.
    return {
      packEvidence: undefined,
      agentsRules: [...pack.agentsRules],
      toolPolicyRules: [...pack.toolPolicyRules],
      blocks: blocks.map((block) => ({ id: block.id, evidence: block.evidence, matched: false, matchedPaths: [] })),
    };
  }

  const evaluated = blocks.map((block) => {
    const matchedPaths = matchedDetectEvidence(signals, block.when);
    return {
      id: block.id,
      evidence: block.evidence,
      matched: matchedPaths !== undefined,
      matchedPaths: matchedPaths ?? [],
    };
  });
  const matchedBlocks = blocks.filter((_, index) => evaluated[index].matched);

  return {
    packEvidence: matchedDetectEvidence(signals, pack.detect),
    agentsRules: [...pack.agentsRules, ...matchedBlocks.flatMap((block) => block.agentsRules ?? [])],
    toolPolicyRules: [...pack.toolPolicyRules, ...matchedBlocks.flatMap((block) => block.toolPolicyRules ?? [])],
    blocks: evaluated,
  };
}

export async function detectSecondary(dir: RepositoryInput, pack: Pick<ResolvedPack, "secondaryDetectors">): Promise<SecondaryDetectionFinding[]> {
  const detectors = pack.secondaryDetectors ?? [];

  if (detectors.length === 0) {
    return [];
  }

  const signals = await scanProject(
    dir,
    detectors.map((detector) => detector.detect),
  );

  return detectors
    .filter((detector) => matchesDetect(signals, detector.detect))
    .map((detector) => ({
      id: detector.id,
      description: detector.description,
      suggestSkills: detector.suggestSkills ?? [],
      suggestPackIds: detector.suggestPackIds ?? [],
      notes: detector.notes ?? [],
    }));
}
