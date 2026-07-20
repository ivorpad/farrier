import { createHash } from "node:crypto";
import { dirname, posix } from "node:path";
import {
  readContainedDirectory,
  readContainedFile,
  type ContainedRepository,
} from "./repository-paths";
import { relativeModuleSpecifiers } from "./harness-audit-path-context";
import type { HarnessAuditCheck, HarnessAuditLayer, HarnessAuditLine } from "./harness-audit-types";

const localResource = /^(?:scripts|docs|tests?|rules|references|referencias|assets|sub-agents|modes|themes)\//;

type ReferenceEntry = {
  layers: Set<HarnessAuditLayer>;
  lines: HarnessAuditLine[];
};

type PathDocument = { path: string; text: string };

type HatchForceIncludeMapping = {
  manifestPath: string;
  line: number;
  target: string;
  source: string;
  destination: string;
};

export async function containedPathStatus(repository: ContainedRepository, path: string): Promise<string> {
  const file = await readContainedFile(repository, path, 192_000);
  if (file.status === "read" || file.status === "oversized") return "regular file exists";
  const directory = await readContainedDirectory(repository, path);
  if (directory.status === "read") return "directory exists";
  return file.status;
}

function repositoryRootAlternative(line: HarnessAuditLine, path: string): string | undefined {
  if (line.kind !== "skill" || !/\buv\s+run\s+scripts\//.test(line.text)) return undefined;
  const prefix = `${dirname(line.path)}/`;
  if (!path.startsWith(prefix)) return undefined;
  const alternative = path.slice(prefix.length);
  return localResource.test(alternative) ? alternative : undefined;
}

function existingPath(result: string): boolean {
  return result === "regular file exists" || result === "directory exists";
}

function hookRelativeModuleImport(path: string, entry: ReferenceEntry): boolean {
  return entry.lines.some((line) => line.kind === "hook" && relativeModuleSpecifiers(line).some((specifier) => {
    const root = dirname(line.path);
    const resolved = posix.normalize(root === "." ? specifier : `${root}/${specifier}`);
    return resolved !== ".." && !resolved.startsWith("../") && resolved === path;
  }));
}

async function resolvedHookModule(
  repository: ContainedRepository,
  path: string,
): Promise<string | undefined> {
  if (posix.extname(path)) return undefined;
  const suffixes = [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
  for (const candidate of [
    ...suffixes.map((suffix) => `${path}${suffix}`),
    ...suffixes.map((suffix) => `${path}/index${suffix}`),
  ]) {
    const result = await containedPathStatus(repository, candidate);
    if (result === "regular file exists") return `${candidate}: ${result}`;
  }
  return undefined;
}

function rubyRelativeRequire(path: string, entry: ReferenceEntry): boolean {
  return entry.lines.some((line) => Array.from(
    line.text.matchAll(/\brequire_relative\s*(?:\(\s*)?["']([^"']+)["']/g),
    (match) => match[1]!.replace(/^\.\//, ""),
  ).includes(path));
}

function jsonStringProperty(text: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`))?.[1];
}

function jsonStringArray(text: string, property: string): string[] | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = text.match(new RegExp(`"${escaped}"\\s*:\\s*\\[([\\s\\S]*?)\\]`))?.[1];
  return body ? Array.from(body.matchAll(/"([^"]+)"/g), (match) => match[1]!) : undefined;
}

function manifestRelativePath(manifestPath: string, value: string): string | undefined {
  const clean = value.replace(/^\.\//, "").replace(/\\/g, "/");
  if (!clean || posix.isAbsolute(clean)) return undefined;
  const root = dirname(manifestPath);
  const path = posix.normalize(root === "." ? clean : `${root}/${clean}`);
  return path === ".." || path.startsWith("../") ? undefined : path;
}

function hatchForceIncludeMappings(documents: PathDocument[]): HatchForceIncludeMapping[] {
  const mappings: HatchForceIncludeMapping[] = [];
  for (const document of documents.filter((item) => /(?:^|\/)pyproject\.toml$/.test(item.path))) {
    let target: string | undefined;
    for (const [index, line] of document.text.split("\n").entries()) {
      const section = line.match(
        /^\s*\[tool\.hatch\.build\.targets\.([A-Za-z0-9_-]+)\.force-include\]\s*(?:#.*)?$/,
      );
      if (section) {
        target = section[1];
        continue;
      }
      if (/^\s*\[/.test(line)) {
        target = undefined;
        continue;
      }
      if (!target) continue;
      const assignment = line.match(/^\s*(["'])([^"']+)\1\s*=\s*(["'])([^"']+)\3\s*(?:#.*)?$/);
      if (!assignment) continue;
      const source = manifestRelativePath(document.path, assignment[2]!);
      const destination = manifestRelativePath(document.path, assignment[4]!);
      if (!source || !destination) continue;
      mappings.push({
        manifestPath: document.path,
        line: index + 1,
        target,
        source,
        destination,
      });
    }
  }
  return mappings;
}

function hatchForceIncludeDestination(
  path: string,
  entry: ReferenceEntry,
  mappings: HatchForceIncludeMapping[],
): HatchForceIncludeMapping | undefined {
  return mappings.find((mapping) => mapping.destination === path
    && entry.lines.some((line) =>
      line.path === mapping.manifestPath && line.line === mapping.line));
}

function globPattern(pattern: string): RegExp {
  const clean = pattern.replace(/^\.\//, "").replace(/\\/g, "/");
  let result = "^";
  for (let index = 0; index < clean.length; index += 1) {
    const character = clean[index]!;
    if (character === "*" && clean[index + 1] === "*") {
      if (clean[index + 2] === "/") {
        result += "(?:.*/)?";
        index += 2;
      } else {
        result += ".*";
        index += 1;
      }
    } else if (character === "*") {
      result += "[^/]*";
    } else if (character === "?") {
      result += "[^/]";
    } else {
      result += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${result}$`);
}

function tsconfigIncludesSource(config: PathDocument, source: string): boolean {
  const configRoot = dirname(config.path);
  const relative = configRoot === "." ? source : source.slice(`${configRoot}/`.length);
  if (relative === source && configRoot !== ".") return false;
  const files = jsonStringArray(config.text, "files");
  const includes = jsonStringArray(config.text, "include");
  const inFiles = files?.some((pattern) => globPattern(pattern).test(relative)) ?? false;
  const inInclude = includes?.some((pattern) => globPattern(pattern).test(relative)) ?? false;
  if ((files || includes) && !inFiles && !inInclude) return false;
  const excludes = jsonStringArray(config.text, "exclude") ?? [];
  return inFiles || !excludes.some((pattern) => globPattern(pattern).test(relative));
}

function sourceSuffixes(output: string): string[] {
  if (output.endsWith(".mjs")) return [`${output.slice(0, -4)}.mts`];
  if (output.endsWith(".cjs")) return [`${output.slice(0, -4)}.cts`];
  return output.endsWith(".js")
    ? [`${output.slice(0, -3)}.ts`, `${output.slice(0, -3)}.tsx`]
    : [];
}

async function typescriptSourceRoot(
  repository: ContainedRepository,
  manifest: PathDocument,
  config: PathDocument,
  packageRoot: string,
  outDir: string,
): Promise<string | undefined> {
  const rootDirValue = jsonStringProperty(config.text, "rootDir");
  if (rootDirValue) {
    const sourceRoot = posix.normalize(packageRoot === "." ? rootDirValue : `${packageRoot}/${rootDirValue}`)
      .replace(/\/+$/, "");
    return sourceRoot === ".." || sourceRoot.startsWith("../") ? undefined : sourceRoot;
  }
  const roots = new Set<string>();
  for (const rawOutput of Array.from(manifest.text.matchAll(/"([^"\n]+\.(?:js|mjs|cjs))"/g), (match) => match[1]!)) {
    const output = posix.normalize(packageRoot === "." ? rawOutput : `${packageRoot}/${rawOutput}`);
    if (!output.startsWith(`${outDir}/`)) continue;
    const relativeOutput = output.slice(outDir.length + 1);
    for (const relativeSource of sourceSuffixes(relativeOutput)) {
      const source = packageRoot === "." ? relativeSource : `${packageRoot}/${relativeSource}`;
      if (!tsconfigIncludesSource(config, source)) continue;
      if (await containedPathStatus(repository, source) !== "regular file exists") continue;
      roots.add(relativeSource.split("/")[0]!);
    }
  }
  return roots.size >= 2 ? packageRoot : undefined;
}

async function generatedTypeScriptOutput(
  repository: ContainedRepository,
  path: string,
  entry: ReferenceEntry,
  documents: PathDocument[],
): Promise<string | undefined> {
  const manifests = new Set(entry.lines
    .filter((line) => /(?:^|\/)package\.json$/.test(line.path))
    .map((line) => line.path));
  for (const manifestPath of manifests) {
    const root = dirname(manifestPath);
    const manifest = documents.find((item) => item.path === manifestPath);
    const configPath = root === "." ? "tsconfig.json" : `${root}/tsconfig.json`;
    const config = documents.find((item) => item.path === configPath);
    const build = manifest && jsonStringProperty(manifest.text, "build");
    if (!config || !build || !/\btsc\b/.test(build) || /(?:^|\s)(?:-p|--project)(?:\s|=)/.test(build)) continue;
    const outDirValue = jsonStringProperty(config.text, "outDir");
    if (!outDirValue) continue;
    const outDir = posix.normalize(root === "." ? outDirValue : `${root}/${outDirValue}`).replace(/\/+$/, "");
    if (outDir === ".." || outDir.startsWith("../") || !path.startsWith(`${outDir}/`)) continue;
    const relativeOutput = path.slice(outDir.length + 1);
    const sourceRoot = await typescriptSourceRoot(repository, manifest, config, root, outDir);
    if (!sourceRoot) continue;
    for (const relativeSource of sourceSuffixes(relativeOutput)) {
      const source = sourceRoot === "." ? relativeSource : `${sourceRoot}/${relativeSource}`;
      if (!tsconfigIncludesSource(config, source)) continue;
      if (await containedPathStatus(repository, source) !== "regular file exists") continue;
      const outDirLabel = outDirValue.replace(/^\.\//, "").replace(/\/+$/, "");
      return `missing generated output; source ${source} is a regular file included by ${configPath}; ${manifestPath} build runs tsc into ${configPath} outDir ${outDirLabel}`;
    }
  }
  return undefined;
}

function sameDocumentFullPaths(
  path: string,
  entry: ReferenceEntry,
  refs: Map<string, ReferenceEntry>,
): string[] {
  const sourceDocuments = new Set(entry.lines.map((line) => line.path));
  return [...refs.entries()]
    .filter(([candidate, candidateEntry]) => candidate.endsWith(`/${path}`)
      && candidateEntry.lines.some((line) => sourceDocuments.has(line.path)))
    .map(([candidate]) => candidate)
    .sort();
}

function prospectiveWorkflowInput(
  path: string,
  entry: ReferenceEntry,
  lines: HarnessAuditLine[],
): { prerequisite: HarnessAuditLine; use: HarnessAuditLine } | undefined {
  const filename = path.split("/").at(-1) ?? "";
  const subject = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  if (subject.length < 3) return undefined;
  const subjectPattern = new RegExp(`\\b${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  for (const use of entry.lines) {
    if (!/\b(?:consume|import|load|parse|process|read|use)\b/i.test(use.text)) continue;
    const prerequisite = lines
      .filter((line) => line.path === use.path && line.line < use.line && use.line - line.line <= 2)
      .sort((left, right) => right.line - left.line)[0];
    if (!prerequisite
      || !/\b(?:create|generate|obtain|provide|write)\b/i.test(prerequisite.text)
      || !subjectPattern.test(prerequisite.text)) continue;
    return { prerequisite, use };
  }
  return undefined;
}

function prospectiveAddTarget(entry: ReferenceEntry): HarnessAuditLine | undefined {
  return entry.lines.find((line) => /^\s*(?:[-*]\s*)?add\s+to\s+[`"']?/i.test(line.text));
}

export async function pathChecks(
  repository: ContainedRepository,
  lines: HarnessAuditLine[],
  references: (line: HarnessAuditLine) => string[],
  documents: PathDocument[] = [],
): Promise<HarnessAuditCheck[]> {
  const refs = new Map<string, ReferenceEntry>();
  const forceIncludes = hatchForceIncludeMappings(documents);
  for (const line of lines) {
    for (const path of references(line)) {
      const entry = refs.get(path) ?? { layers: new Set<HarnessAuditLayer>(), lines: [] };
      entry.layers.add(line.kind === "skill"
        ? "skill"
        : line.kind === "hook"
          ? "hook"
          : line.kind === "toolchain"
            ? "toolchain"
            : "guidance");
      entry.lines.push(line);
      refs.set(path, entry);
    }
  }
  const checks: HarnessAuditCheck[] = [];
  for (const [path, entry] of [...refs.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    let result = await containedPathStatus(repository, path);
    if ((result === "missing" || result === "directory exists") && hookRelativeModuleImport(path, entry)) {
      result = await resolvedHookModule(repository, path) ?? result;
    }
    if (result === "missing" && path.split("/").includes("node_modules")) continue;
    if (result === "missing") {
      const mapping = hatchForceIncludeDestination(path, entry, forceIncludes);
      if (mapping) {
        const sourceResult = await containedPathStatus(repository, mapping.source);
        result = `missing Hatch ${mapping.target} build destination; ${mapping.manifestPath}:${mapping.line} maps source ${mapping.source}: ${sourceResult} to ${mapping.destination}`;
      }
    }
    if (result === "missing" && rubyRelativeRequire(path, entry)) {
      for (const alternative of [`${path}.rb`, `${path}.so`]) {
        const alternativeResult = await containedPathStatus(repository, alternative);
        if (!existingPath(alternativeResult)) continue;
        result = `${alternative}: ${alternativeResult}`;
        break;
      }
      if (result === "missing") result = "missing; exact, .rb, and .so targets are absent";
    }
    if (result === "missing") result = await generatedTypeScriptOutput(repository, path, entry, documents) ?? result;
    if (result === "missing") {
      const workflow = prospectiveWorkflowInput(path, entry, lines);
      if (workflow) {
        result = `missing; ${workflow.prerequisite.path}:${workflow.prerequisite.line} creates or obtains the input before ${workflow.use.path}:${workflow.use.line} uses it`;
      }
      const addTarget = prospectiveAddTarget(entry);
      if (result === "missing" && addTarget) {
        result = `missing; ${addTarget.path}:${addTarget.line} treats this path as an add-to workflow target`;
      }
      if (result === "missing") {
        const alternatives = new Set(entry.lines.flatMap((line) => repositoryRootAlternative(line, path) ?? []));
        for (const alternative of alternatives) {
          const alternativeResult = await containedPathStatus(repository, alternative);
          if (!existingPath(alternativeResult)) continue;
          result = `skill-local path missing; repository-root alternative ${alternative}: ${alternativeResult}`;
          break;
        }
      }
      if (result === "missing") {
        for (const alternative of sameDocumentFullPaths(path, entry, refs)) {
          const alternativeResult = await containedPathStatus(repository, alternative);
          if (!existingPath(alternativeResult)) continue;
          result = `short path missing; same-document full path ${alternative}: ${alternativeResult}`;
          break;
        }
      }
    }
    checks.push({
      id: `check:path:${shortDigest(path)}`,
      layers: [...entry.layers],
      description: `Checked referenced path ${path}.`,
      result,
    });
  }
  return checks;
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}
