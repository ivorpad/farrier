import { createHash } from "node:crypto";
import {
  openContainedRepository,
  readContainedDirectory,
  readContainedFile,
  type ContainedRepository,
} from "./repository-paths";
import type { ProfileCoverage, RepositoryFact } from "./skill-types";

const maxEntries = 4_000;
const maxFacts = 500;
const maxFileBytes = 320_000;
const ignoredDirectories = new Set([
  ".git", ".cache", ".farrier-staging", ".mypy_cache", ".next", ".pytest_cache", ".ruff_cache",
  ".turbo", ".venv", "build", "coverage", "dist", "node_modules", "__pycache__", "target", "tmp", "vendor",
]);

export type FactCollection = {
  facts: RepositoryFact[];
  coverage: ProfileCoverage;
};

function evidenceId(prefix: string, value: string): string {
  const normalized = value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `project:${prefix}:${normalized}`;
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function lineFor(text: string, value: string): number | undefined {
  const index = text.indexOf(value);
  return index < 0 ? undefined : text.slice(0, index).split("\n").length;
}

function lastLineFor(text: string, value: string): number | undefined {
  const index = text.lastIndexOf(value);
  return index < 0 ? undefined : text.slice(0, index).split("\n").length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function addFact(collection: FactCollection, fact: RepositoryFact): void {
  if (collection.facts.some((item) => item.id === fact.id)) return;
  if (collection.facts.length >= maxFacts) {
    if (!collection.coverage.skippedPaths.some((item) => item.reason === "fact-limit")) {
      collection.coverage.skippedPaths.push({ path: fact.path, reason: "fact-limit" });
    }
    return;
  }
  collection.facts.push(fact);
}

function dependencyCapability(name: string): {
  id: string;
  summary: string;
} | undefined {
  if (name === "drizzle-orm" || name === "drizzle-kit") {
    return { id: "project:capability:orm:drizzle", summary: "Drizzle ORM capability" };
  }
  if (["pg", "postgres", "postgresql", "@neondatabase/serverless", "psycopg", "psycopg2", "asyncpg"].includes(name)) {
    return { id: "project:capability:database:postgresql", summary: "PostgreSQL capability" };
  }
  if (name === "typescript" || name === "ts-node" || name === "tsx") {
    return { id: "project:capability:runtime:typescript", summary: "TypeScript runtime capability" };
  }
  return undefined;
}

function addDependency(
  collection: FactCollection,
  input: { name: string; group: string; path: string; text: string; contentDigest: string; extractor: string },
): void {
  const name = input.name.toLowerCase();
  addFact(collection, {
    id: evidenceId("dependency", name),
    kind: "dependency",
    summary: `${name} dependency (${input.group})`,
    path: input.path,
    line: lastLineFor(input.text, `"${input.name}"`) ?? lastLineFor(input.text, input.name),
    extractor: input.extractor,
    confidence: "exact",
    contentDigest: input.contentDigest,
  });
  const capability = dependencyCapability(name);
  if (capability) {
    addFact(collection, {
      id: capability.id,
      kind: "capability",
      summary: capability.summary,
      path: input.path,
      line: lineFor(input.text, input.name),
      extractor: input.extractor,
      confidence: "inferred",
      contentDigest: input.contentDigest,
    });
  }
}

function extractPackageJson(
  collection: FactCollection,
  path: string,
  text: string,
  contentDigest: string,
): void {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error("package root");
  const groups = [
    ["runtime", stringRecord(parsed.dependencies)],
    ["development", stringRecord(parsed.devDependencies)],
    ["optional", stringRecord(parsed.optionalDependencies)],
  ] as const;
  for (const [group, values] of groups) {
    for (const name of Object.keys(values).sort()) {
      addDependency(collection, {
        name,
        group,
        path,
        text,
        contentDigest,
        extractor: "package-json-v1",
      });
    }
  }
  for (const name of Object.keys(stringRecord(parsed.scripts)).sort()) {
    addFact(collection, {
      id: evidenceId("workflow:package-json", name),
      kind: "workflow",
      summary: `${name} package script`,
      path,
      line: lineFor(text, `"${name}"`),
      extractor: "package-json-v1",
      confidence: "exact",
      contentDigest,
    });
  }
}

function dependencyName(specifier: string): string {
  const marker = specifier.search(/[<>=!~\s\[]/);
  return (marker === -1 ? specifier : specifier.slice(0, marker)).trim();
}

function tomlArray(text: string, key: string): string[] {
  const start = text.search(new RegExp(`^\\s*${key}\\s*=\\s*\\[`, "m"));
  if (start < 0) return [];
  const open = text.indexOf("[", start);
  let quote: string | undefined;
  for (let index = open + 1; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "]") {
      return Array.from(text.slice(open + 1, index).matchAll(/["']([^"']+)["']/g), (match) => match[1]!);
    }
  }
  return [];
}

function extractPyproject(
  collection: FactCollection,
  path: string,
  text: string,
  contentDigest: string,
): void {
  const dependencies = tomlArray(text, "dependencies").map(dependencyName);
  for (const section of text.matchAll(
    /^\[tool\.poetry\.(dependencies|group\.[^.]+\.dependencies)\]\s*$([\s\S]*?)(?=^\[|\s*$)/gm,
  )) {
    for (const line of section[2]!.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)) {
      if (line[1]!.toLowerCase() !== "python") dependencies.push(line[1]!);
    }
  }
  for (const name of dependencies.filter(Boolean)) {
    addDependency(collection, {
      name,
      group: "runtime",
      path,
      text,
      contentDigest,
      extractor: "pyproject-v1",
    });
  }
}

function extractGemfile(
  collection: FactCollection,
  path: string,
  text: string,
  contentDigest: string,
): void {
  for (const match of text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) {
    addDependency(collection, {
      name: match[1]!,
      group: "runtime",
      path,
      text,
      contentDigest,
      extractor: "gemfile-v1",
    });
  }
}

function extractInstruction(
  collection: FactCollection,
  path: string,
  contentDigest: string,
): void {
  const prefix = path.endsWith("AGENTS.md") ? "config:agents" : "config:claude";
  addFact(collection, {
    id: evidenceId(prefix, path),
    kind: "instruction",
    summary: `${path} repository instructions`,
    path,
    line: 1,
    extractor: "repository-instructions-v1",
    confidence: "exact",
    contentDigest,
  });
}

function extractSkill(
  collection: FactCollection,
  path: string,
  contentDigest: string,
): void {
  const match = path.match(/(?:^|\/)(?:skills|\.agents\/skills|\.claude\/skills)\/([^/]+)\/SKILL\.md$/);
  if (!match) return;
  addFact(collection, {
    id: evidenceId("config:skills", path),
    kind: "installed-skill",
    summary: `Installed skill ${match[1]}`,
    path,
    line: 1,
    extractor: "installed-skill-v1",
    confidence: "exact",
    contentDigest,
  });
}

function extractCi(
  collection: FactCollection,
  path: string,
  text: string,
  contentDigest: string,
): void {
  const name = text.match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim() ?? path.split("/").at(-1)!;
  addFact(collection, {
    id: evidenceId("ci", path),
    kind: "workflow",
    summary: `${name} workflow`,
    path,
    line: lineFor(text, "name:") ?? 1,
    extractor: "ci-workflow-v1",
    confidence: "exact",
    contentDigest,
  });
}

function candidateKind(path: string): "package" | "pyproject" | "gemfile" | "instruction" | "skill" | "ci" | undefined {
  if (path === "package.json") return "package";
  if (path === "pyproject.toml") return "pyproject";
  if (path === "Gemfile") return "gemfile";
  if (/(^|\/)(?:AGENTS|CLAUDE)\.md$/.test(path)) return "instruction";
  if (/(^|\/)SKILL\.md$/.test(path)) return "skill";
  if (/^\.github\/workflows\/[^/]+$/.test(path)
    || /^\.circleci\/[^/]+$/.test(path)
    || path === ".gitlab-ci.yml"
    || path === "Jenkinsfile") return "ci";
  return undefined;
}

async function repositoryPaths(
  repository: ContainedRepository,
  collection: FactCollection,
): Promise<string[]> {
  const candidates: string[] = [];
  let entriesSeen = 0;
  let limited = false;

  async function visit(relativeDir: string): Promise<void> {
    if (limited) return;
    const directory = await readContainedDirectory(repository, relativeDir);
    const displayPath = relativeDir ? `${relativeDir}/` : ".";
    if (directory.status !== "read") {
      collection.coverage.readErrors.push({ path: displayPath, reason: directory.status });
      return;
    }
    collection.coverage.visitedPaths.push(displayPath);
    for (const entry of directory.entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      entriesSeen += 1;
      if (entriesSeen > maxEntries) {
        collection.coverage.skippedPaths.push({ path, reason: "entry-limit" });
        limited = true;
        return;
      }
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          collection.coverage.skippedPaths.push({ path: `${path}/`, reason: "ignored-directory" });
        } else {
          await visit(path);
        }
      } else if (entry.isFile()) {
        if (candidateKind(path)) candidates.push(path);
        else collection.coverage.skippedPaths.push({ path, reason: "no-extractor" });
      } else {
        collection.coverage.skippedPaths.push({
          path,
          reason: entry.isSymbolicLink() ? "symlink" : "special-file",
        });
      }
    }
  }

  await visit("");
  return candidates.sort((left, right) => left.localeCompare(right));
}

async function extractCandidate(path: string, repository: ContainedRepository, collection: FactCollection): Promise<void> {
  const result = await readContainedFile(repository, path, maxFileBytes);
  if (result.status === "oversized") {
    collection.coverage.truncatedPaths.push({ path, maxBytes: maxFileBytes });
    collection.coverage.skippedPaths.push({ path, reason: "oversized" });
    return;
  }
  if (result.status !== "read") {
    collection.coverage.readErrors.push({ path, reason: result.status });
    return;
  }

  collection.coverage.visitedPaths.push(path);
  const contentDigest = digest(result.text);
  try {
    const kind = candidateKind(path);
    if (kind === "package") extractPackageJson(collection, path, result.text, contentDigest);
    else if (kind === "pyproject") extractPyproject(collection, path, result.text, contentDigest);
    else if (kind === "gemfile") extractGemfile(collection, path, result.text, contentDigest);
    else if (kind === "instruction") extractInstruction(collection, path, contentDigest);
    else if (kind === "skill") extractSkill(collection, path, contentDigest);
    else if (kind === "ci") extractCi(collection, path, result.text, contentDigest);
  } catch {
    collection.coverage.skippedPaths.push({ path, reason: "parse-error" });
  }
}

export async function inspectRepositoryFacts(targetDir: string): Promise<FactCollection> {
  const repository = await openContainedRepository(targetDir);
  const collection: FactCollection = {
    facts: [],
    coverage: {
      visitedPaths: [],
      skippedPaths: [],
      readErrors: [],
      truncatedPaths: [],
      limits: { maxEntries, maxFacts, maxFileBytes },
      complete: false,
    },
  };
  const candidates = await repositoryPaths(repository, collection);
  for (const path of candidates) await extractCandidate(path, repository, collection);

  collection.facts.sort((left, right) =>
    left.id.localeCompare(right.id)
    || left.path.localeCompare(right.path)
    || (left.line ?? 0) - (right.line ?? 0));
  collection.coverage.visitedPaths.sort((left, right) => left.localeCompare(right));
  collection.coverage.skippedPaths.sort((left, right) =>
    left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason));
  collection.coverage.readErrors.sort((left, right) =>
    left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason));
  collection.coverage.truncatedPaths.sort((left, right) => left.path.localeCompare(right.path));
  collection.coverage.complete = collection.coverage.skippedPaths.length === 0
    && collection.coverage.readErrors.length === 0
    && collection.coverage.truncatedPaths.length === 0;
  return collection;
}
