import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { redactEvidence } from "./behavior-evidence";
import type { ProjectDependency, ProjectWorkflow } from "./advice-types";

const maxReadChars = 80_000;

export async function readProjectFile(root: string, path: string): Promise<string | undefined> {
  try {
    const absolute = join(root, path);
    if (!(await stat(absolute)).isFile()) return undefined;
    return (await readFile(absolute, "utf8")).slice(0, maxReadChars);
  } catch {
    return undefined;
  }
}

type ManifestInventory = {
  dependencies: ProjectDependency[];
  packageManagers: string[];
  workspaces: string[];
  workflows: ProjectWorkflow[];
  summaries: Array<{ id: string; path: string; summary: string }>;
};

function scriptKind(name: string, command: string): ProjectWorkflow["kind"] | undefined {
  const value = `${name} ${command}`.toLowerCase();
  if (/\b(?:test|spec|pytest|playwright|vitest|jest)\b/.test(value)) return "test";
  if (/\b(?:lint|eslint|ruff|rubocop)\b/.test(value)) return "lint";
  if (/\b(?:typecheck|type-check|tsc|mypy|pyright)\b/.test(value)) return "typecheck";
  if (/\b(?:format|prettier|biome)\b/.test(value)) return "format";
  if (/\b(?:migrate|migration|schema|drizzle|prisma|database|db:)\b/.test(value)) return "database";
  if (/\b(?:release|publish|version|changeset)\b/.test(value)) return "release";
  if (/\b(?:deploy|deployment|vercel|serverless)\b/.test(value)) return "deployment";
  if (/\b(?:openapi|swagger|api-doc)\b/.test(value)) return "api";
  if (/\b(?:docs|typedoc|jsdoc|sphinx)\b/.test(value)) return "docs";
  if (/\b(?:build|compile|bundle)\b/.test(value)) return "build";
  return undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function workspaceValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const packages = (value as Record<string, unknown>).packages;
    return Array.isArray(packages) ? packages.filter((item): item is string => typeof item === "string") : [];
  }
  return [];
}

function packageManager(value: unknown, paths: string[]): string[] {
  if (typeof value === "string" && value.trim()) return [value.split("@")[0]!.toLowerCase()];
  if (paths.includes("bun.lock") || paths.includes("bun.lockb")) return ["bun"];
  if (paths.includes("pnpm-lock.yaml")) return ["pnpm"];
  if (paths.includes("yarn.lock")) return ["yarn"];
  return paths.includes("package-lock.json") ? ["npm"] : [];
}

function parsePackageJson(text: string, paths: string[]): ManifestInventory {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const groups: Array<[ProjectDependency["group"], Record<string, string>]> = [
    ["runtime", stringRecord(parsed.dependencies)],
    ["development", stringRecord(parsed.devDependencies)],
    ["optional", stringRecord(parsed.optionalDependencies)]
  ];
  const dependencies = groups.flatMap(([group, entries]) => Object.entries(entries).map(([name, version]) => ({
    name: name.toLowerCase(), manifest: "package.json", group, version: redactEvidence(version.slice(0, 120))
  })));
  const scripts = stringRecord(parsed.scripts);
  const workflows = Object.entries(scripts).flatMap(([name, command]): ProjectWorkflow[] => {
    const kind = scriptKind(name, command);
    if (!kind) return [];
    const id = `project:workflow:package-json:${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    return [{ kind, name, path: "package.json", command: redactEvidence(command.slice(0, 500)), evidence: [id] }];
  });
  const names = dependencies.map((item) => item.name).sort();
  return {
    dependencies,
    packageManagers: packageManager(parsed.packageManager, paths),
    workspaces: workspaceValues(parsed.workspaces).slice(0, 30),
    workflows,
    summaries: [{ id: "project:manifest:package-json", path: "package.json", summary: `package.json dependencies: ${names.slice(0, 80).join(", ") || "none"}` }]
  };
}

function dependencyName(specifier: string): string {
  const marker = specifier.search(/[<>=!~\s\[]/);
  return (marker === -1 ? specifier : specifier.slice(0, marker)).trim().toLowerCase();
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
    else if (char === "]") return Array.from(text.slice(open + 1, index).matchAll(/["']([^"']+)["']/g), (match) => match[1]!);
  }
  return [];
}

function parsePyproject(text: string): ManifestInventory {
  const dependencies: ProjectDependency[] = [];
  for (const specifier of tomlArray(text, "dependencies")) {
    const name = dependencyName(specifier);
    if (name) dependencies.push({ name, manifest: "pyproject.toml", group: "runtime" });
  }
  for (const section of text.matchAll(/^\[(?:tool\.poetry\.(dependencies|group\.[^.]+\.dependencies)|dependency-groups)\]\s*$([\s\S]*?)(?=^\[|\s*$)/gm)) {
    for (const line of section[2]!.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)) {
      const name = line[1]!.toLowerCase();
      if (name !== "python") dependencies.push({ name, manifest: "pyproject.toml", group: section[1]?.includes("group") ? "development" : "runtime" });
    }
  }
  const toolNames = Array.from(new Set(Array.from(text.matchAll(/^\[tool\.([^\].]+)/gm), (match) => match[1]!.toLowerCase()))).sort();
  return {
    dependencies: Array.from(new Map(dependencies.map((item) => [`${item.group}:${item.name}`, item])).values()),
    packageManagers: text.includes("[tool.uv") ? ["uv"] : text.includes("[tool.poetry") ? ["poetry"] : [],
    workspaces: [], workflows: [],
    summaries: [{ id: "project:manifest:pyproject", path: "pyproject.toml", summary: `pyproject.toml dependencies: ${dependencies.map((item) => item.name).slice(0, 80).join(", ") || "none"}; tools: ${toolNames.slice(0, 30).join(", ") || "none"}` }]
  };
}

function parseGemfile(text: string): ManifestInventory {
  const names = Array.from(text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm), (match) => match[1]!.toLowerCase());
  return {
    dependencies: Array.from(new Set(names)).map((name) => ({ name, manifest: "Gemfile", group: "runtime" as const })),
    packageManagers: ["bundler"], workspaces: [], workflows: [],
    summaries: [{ id: "project:manifest:gemfile", path: "Gemfile", summary: `Gemfile dependencies: ${Array.from(new Set(names)).slice(0, 80).join(", ") || "none"}` }]
  };
}

export async function inspectProjectManifests(root: string, paths: string[]): Promise<ManifestInventory> {
  const inventories: ManifestInventory[] = [];
  const packageText = await readProjectFile(root, "package.json");
  if (packageText) {
    try { inventories.push(parsePackageJson(packageText, paths)); } catch { /* profile the remaining manifests */ }
  }
  const pyprojectText = await readProjectFile(root, "pyproject.toml");
  if (pyprojectText) inventories.push(parsePyproject(pyprojectText));
  const gemfileText = await readProjectFile(root, "Gemfile");
  if (gemfileText) inventories.push(parseGemfile(gemfileText));
  return {
    dependencies: inventories.flatMap((item) => item.dependencies).slice(0, 200),
    packageManagers: Array.from(new Set(inventories.flatMap((item) => item.packageManagers))),
    workspaces: Array.from(new Set(inventories.flatMap((item) => item.workspaces))),
    workflows: inventories.flatMap((item) => item.workflows).slice(0, 80),
    summaries: inventories.flatMap((item) => item.summaries)
  };
}
