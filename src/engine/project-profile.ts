import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { detectPacksWithEvidence } from "./detect";
import type { AdviceEvidence, ProjectProfile } from "./advice-types";

const ignoredDirectories = new Set([
  ".git",
  ".cache",
  ".farrier-staging",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "__pycache__",
  "target",
  "tmp",
  "vendor"
]);
const maxWalkEntries = 4_000;
const maxReadChars = 80_000;

async function walk(root: string): Promise<string[]> {
  const paths: string[] = [];

  async function visit(relativeDir: string): Promise<void> {
    if (paths.length >= maxWalkEntries) return;
    let entries;
    try {
      entries = await readdir(join(root, relativeDir), { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (paths.length >= maxWalkEntries) break;
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue;
        paths.push(`${relativePath}/`);
        await visit(relativePath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        paths.push(relativePath);
      }
    }
  }

  await visit("");
  return paths;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    if (!(await stat(path)).isFile()) return undefined;
    return (await readFile(path, "utf8")).slice(0, maxReadChars);
  } catch {
    return undefined;
  }
}

function addEvidence(
  evidence: AdviceEvidence[],
  input: Omit<AdviceEvidence, "id" | "source"> & { id: string }
): void {
  if (evidence.some((entry) => entry.id === input.id)) return;
  evidence.push({ ...input, source: "project" });
}

function matchingPaths(paths: string[], patterns: RegExp[]): string[] {
  return paths.filter((path) => patterns.some((pattern) => pattern.test(path))).slice(0, 20);
}

function summarizeConfiguration(path: string, text: string): string {
  if (path.endsWith(".md")) {
    const headings = Array.from(text.matchAll(/^#{1,4}\s+(.+)$/gm), (match) => match[1]!.trim()).slice(0, 12);
    const references = Array.from(new Set(Array.from(text.matchAll(/\b([A-Za-z0-9._/-]+\.md)\b/g), (match) => match[1]!))).slice(0, 8);
    const nonEmptyLines = text.split(/\r?\n/).filter((line) => line.trim()).length;
    const details = [
      headings.length > 0 ? `headings: ${headings.join(", ")}` : `${nonEmptyLines} non-empty line(s); no headings`,
      references.length > 0 ? `delegates to: ${references.join(", ")}` : undefined
    ].filter(Boolean).join("; ");
    return details.slice(0, 500);
  }
  if (path.endsWith(".json")) {
    try {
      const parsed = JSON.parse(text);
      const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).sort().slice(0, 20) : [];
      return `top-level keys: ${keys.join(", ") || "none"}`;
    } catch {
      return "present but not valid JSON";
    }
  }
  if (path.endsWith(".toml")) {
    const sections = Array.from(text.matchAll(/^\s*\[([^\]]+)\]/gm), (match) => match[1]!.trim()).slice(0, 20);
    return `sections: ${sections.join(", ") || "none"}`;
  }
  return "present";
}

function parsePackageJson(text: string | undefined): {
  dependencies: string[];
  scripts: string[];
} {
  if (!text) return { dependencies: [], scripts: [] };
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const dependencyObjects = [value.dependencies, value.devDependencies].filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );
    const dependencies = Array.from(new Set(dependencyObjects.flatMap((item) => Object.keys(item)))).sort();
    const scripts = value.scripts && typeof value.scripts === "object" && !Array.isArray(value.scripts)
      ? Object.keys(value.scripts as Record<string, unknown>).sort()
      : [];
    return { dependencies, scripts };
  } catch {
    return { dependencies: [], scripts: [] };
  }
}

function detectedLanguages(paths: string[]): string[] {
  const rules: Array<[string, RegExp]> = [
    ["TypeScript", /\.(?:ts|tsx)$/],
    ["JavaScript", /\.(?:js|jsx|mjs|cjs)$/],
    ["Python", /\.py$/],
    ["Ruby", /\.rb$/],
    ["Rust", /\.rs$/],
    ["Go", /\.go$/],
    ["Java", /\.java$/],
    ["Swift", /\.swift$/]
  ];
  return rules.filter(([, pattern]) => paths.some((path) => pattern.test(path))).map(([name]) => name);
}

const configPatterns: Record<string, RegExp[]> = {
  agents: [/(^|\/)AGENTS\.md$/],
  claude: [/(^|\/)CLAUDE\.md$/, /^\.claude\//],
  codex: [/(^|\/)\.codex\//],
  hooks: [/(^|\/)hooks?\//, /settings\.json$/],
  skills: [/(^|\/)skills\//, /SKILL\.md$/],
  subagents: [/(^|\/)(?:agents|subagents)\//],
  plugins: [/(^|\/)plugins?\//, /plugin\.json$/],
  mcp: [/(^|\/)\.mcp\.json$/, /mcp.*\.json$/]
};

export async function profileProject(targetDirInput: string): Promise<ProjectProfile> {
  const targetDir = resolve(targetDirInput);
  const paths = await walk(targetDir);
  const [packEvidence, packageText, pyprojectText] = await Promise.all([
    detectPacksWithEvidence(targetDir).catch(() => []),
    readOptional(join(targetDir, "package.json")),
    readOptional(join(targetDir, "pyproject.toml"))
  ]);
  const packageJson = parsePackageJson(packageText);
  const evidence: AdviceEvidence[] = [];
  addEvidence(evidence, {
    id: "project:root",
    kind: "structure",
    summary: `Resolved project root: ${targetDir}`,
    path: "."
  });

  for (const pack of packEvidence) {
    addEvidence(evidence, {
      id: `project:stack:${pack.packId}`,
      kind: "stack",
      summary: `${pack.packId}: ${pack.evidence.join(", ")}`,
      path: pack.evidence.find((item) => !item.includes(" dependency:"))?.replace(/\/$/, "")
    });
  }

  const tests = matchingPaths(paths, [/(^|\/)(?:test|tests|spec|specs)\//, /(?:\.test|\.spec)\.[^.]+$/, /pytest\.ini$/, /playwright\.config/]);
  const ci = matchingPaths(paths, [/^\.github\/workflows\//, /^\.circleci\//, /^\.gitlab-ci\.yml$/, /^Jenkinsfile$/]);
  const servicePaths = matchingPaths(paths, [/docker-compose/, /compose\.ya?ml$/, /Dockerfile$/, /serverless\.ya?ml$/, /template\.ya?ml$/, /terraform\//, /\.tf$/]);
  const structure = paths.filter((path) => path.endsWith("/") && !path.slice(0, -1).includes("/")).slice(0, 30);
  const configuration = Object.fromEntries(
    Object.entries(configPatterns).map(([name, patterns]) => [name, matchingPaths(paths, patterns)])
  );

  for (const path of [...tests.slice(0, 6), ...ci, ...servicePaths]) {
    const kind = tests.includes(path) ? "tests" : ci.includes(path) ? "ci" : "service";
    addEvidence(evidence, { id: `project:${kind}:${path.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, kind, summary: path, path });
  }

  for (const [name, configPaths] of Object.entries(configuration)) {
    for (const path of configPaths.slice(0, 4)) {
      const contents = path.endsWith("/") ? undefined : await readOptional(join(targetDir, path));
      addEvidence(evidence, {
        id: `project:config:${name}:${path.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
        kind: `config:${name}`,
        summary: `${name} configuration at ${path}${contents === undefined ? "" : `; ${summarizeConfiguration(path, contents)}`}`,
        path
      });
    }
  }

  if (packageJson.scripts.length > 0) {
    addEvidence(evidence, {
      id: "project:package-scripts",
      kind: "workflow",
      summary: `package.json scripts: ${packageJson.scripts.slice(0, 20).join(", ")}`,
      path: "package.json"
    });
  }
  if (pyprojectText) {
    const toolNames = Array.from(pyprojectText.matchAll(/^\[tool\.([^\].]+).*$/gm), (match) => match[1]!).slice(0, 20);
    addEvidence(evidence, {
      id: "project:pyproject-tools",
      kind: "workflow",
      summary: `pyproject.toml tools: ${toolNames.join(", ") || "present"}`,
      path: "pyproject.toml"
    });
  }

  return {
    targetDir,
    stacks: packEvidence.map((entry) => entry.packId),
    languages: detectedLanguages(paths),
    tests,
    ci,
    services: servicePaths,
    structure,
    configuration,
    evidence
  };
}

export function projectProfileSummary(profile: ProjectProfile): string {
  const config = Object.entries(profile.configuration)
    .filter(([, paths]) => paths.length > 0)
    .map(([name, paths]) => `${name}=${paths.join(",")}`)
    .join("; ");
  return [
    `Project: ${basename(profile.targetDir)}`,
    `Stacks: ${profile.stacks.join(", ") || "generic"}`,
    `Languages: ${profile.languages.join(", ") || "unknown"}`,
    `Tests: ${profile.tests.slice(0, 20).join(", ") || "none detected"}`,
    `CI: ${profile.ci.join(", ") || "none detected"}`,
    `Services: ${profile.services.join(", ") || "none detected"}`,
    `Top-level structure: ${profile.structure.join(", ") || "none"}`,
    `Agent configuration: ${config || "none detected"}`
  ].join("\n");
}
