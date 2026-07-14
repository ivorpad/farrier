import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { builtinDetectionOrder, getPack } from "../packs/index";
import type { PackDetect, ResolvedPack, SecondaryDetectionFinding } from "../packs/types";
import type { PackCatalog } from "../registry/catalog";

type PackageJsonSignals = {
  dependencies: Set<string>;
  devDependencies: Set<string>;
};

type ProjectSignals = {
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

type DetectRequirements = {
  files: Set<string>;
  globs: Set<string>;
  needsPyproject: boolean;
  needsPackageJson: boolean;
  needsGemfile: boolean;
};

const ignoredWalkDirectories = new Set([".git", ".venv", "node_modules", "vendor"]);
const maxGlobEvidencePaths = 20;

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

  if ((detect.pyprojectDependencies ?? []).length > 0) {
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
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

async function walkProject(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(join(dir, prefix), { withFileTypes: true });
  } catch {
    return [];
  }

  const paths: string[] = [];

  for (const entry of entries) {
    const relativePath = normalizeRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name);

    if (entry.isDirectory()) {
      if (ignoredWalkDirectories.has(entry.name)) {
        continue;
      }

      paths.push(`${relativePath}/`);
      paths.push(...(await walkProject(dir, relativePath)));
      continue;
    }

    if (entry.isFile() || entry.isSymbolicLink()) {
      paths.push(relativePath);
    }
  }

  return paths;
}

async function scanProject(dir: string, detects: PackDetect[]): Promise<ProjectSignals> {
  const requirements = collectRequirements(detects);
  const existingFiles = new Set<string>();

  for (const file of requirements.files) {
    if (await exists(join(dir, file))) {
      existingFiles.add(file);
    }
  }

  const [pyprojectText, packageJsonText, gemfileText, allRelativeFiles] = await Promise.all([
    requirements.needsPyproject || requirements.files.has("pyproject.toml") ? readOptionalText(join(dir, "pyproject.toml")) : Promise.resolve(undefined),
    requirements.needsPackageJson || requirements.files.has("package.json") ? readOptionalText(join(dir, "package.json")) : Promise.resolve(undefined),
    requirements.needsGemfile || requirements.files.has("Gemfile") ? readOptionalText(join(dir, "Gemfile")) : Promise.resolve(undefined),
    requirements.globs.size > 0 ? walkProject(dir) : Promise.resolve([]),
  ]);

  return {
    existingFiles,
    allRelativeFiles,
    pyprojectText,
    packageJson: parsePackageJson(packageJsonText),
    gemfileText,
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
        pattern += ".*";
        i += 1;
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

function matchedDetectEvidence(signals: ProjectSignals, detect: PackDetect): string[] | undefined {
  const evidence: string[] = [];

  for (const file of detect.files ?? []) {
    const normalized = normalizeRelativePath(file);
    if (!signals.existingFiles.has(normalized)) {
      return undefined;
    }

    appendUnique(evidence, [normalized]);
  }

  if ((detect.anyFiles ?? []).length > 0) {
    const presentFiles = (detect.anyFiles ?? []).map(normalizeRelativePath).filter((file) => signals.existingFiles.has(file));

    if (presentFiles.length === 0) {
      return undefined;
    }

    appendUnique(evidence, presentFiles);
  }

  for (const glob of detect.globs ?? []) {
    const matches = matchingGlobPaths(signals, glob);
    if (matches.length === 0) {
      return undefined;
    }

    appendUnique(evidence, matches.slice(0, maxGlobEvidencePaths));
  }

  for (const dependency of detect.pyprojectDependencies ?? []) {
    if (!containsPyprojectDependency(signals.pyprojectText, dependency)) {
      return undefined;
    }

    appendUnique(evidence, [`pyproject.toml dependency: ${dependency}`]);
  }

  for (const dependency of detect.packageJsonDependencies ?? []) {
    if (!containsPackageJsonDependency(signals.packageJson, dependency)) {
      return undefined;
    }

    appendUnique(evidence, [`package.json dependency: ${dependency}`]);
  }

  for (const dependency of detect.packageJsonDevDependencies ?? []) {
    if (!containsPackageJsonDevDependency(signals.packageJson, dependency)) {
      return undefined;
    }

    appendUnique(evidence, [`package.json devDependency: ${dependency}`]);
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
  }

  for (const gem of detect.gemfileGems ?? []) {
    if (!containsGemfileGem(signals.gemfileText, gem)) {
      return undefined;
    }

    appendUnique(evidence, [`Gemfile gem: ${gem}`]);
  }

  if ((detect.any ?? []).length > 0) {
    const matchedBranches = (detect.any ?? []).map((child) => matchedDetectEvidence(signals, child)).filter((branch): branch is string[] => branch !== undefined);

    if (matchedBranches.length === 0) {
      return undefined;
    }

    for (const branch of matchedBranches) {
      appendUnique(evidence, branch);
    }
  }

  return evidence;
}

function matchesDetect(signals: ProjectSignals, detect: PackDetect): boolean {
  return matchedDetectEvidence(signals, detect) !== undefined;
}

export async function detectPacksWithEvidence(dir: string, catalog?: PackCatalog): Promise<DetectedPackEvidence[]> {
  const packIds = catalog ? catalog.detectablePackIds() : builtinDetectionOrder();
  const packs = packIds.map((id) => (catalog ? catalog.getPack(id) : getPack(id))).filter((pack): pack is NonNullable<typeof pack> => pack !== undefined);

  const signals = await scanProject(
    dir,
    packs.map((pack) => pack.detect),
  );

  return packs.flatMap((pack) => {
    const evidence = matchedDetectEvidence(signals, pack.detect);
    return evidence === undefined ? [] : [{ packId: pack.id, evidence }];
  });
}

export async function detectPacks(dir: string, catalog?: PackCatalog): Promise<string[]> {
  const detected = await detectPacksWithEvidence(dir, catalog);
  return detected.map((pack) => pack.packId);
}

export async function detectSecondary(dir: string, pack: Pick<ResolvedPack, "secondaryDetectors">): Promise<SecondaryDetectionFinding[]> {
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
