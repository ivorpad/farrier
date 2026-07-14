import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { detectPacksWithEvidence } from "./detect";
import { inspectProjectManifests, readProjectFile } from "./project-manifests";
import type {
  AdviceCategory,
  AdviceEvidence,
  ProjectAutomation,
  ProjectCapability,
  ProjectProfile,
  ProjectWorkflow
} from "./advice-types";

const ignoredDirectories = new Set([
  ".git", ".cache", ".farrier-staging", ".mypy_cache", ".next", ".pytest_cache", ".ruff_cache",
  ".turbo", ".venv", "build", "coverage", "dist", "node_modules", "__pycache__", "target", "tmp", "vendor"
]);
const maxWalkEntries = 4_000;

async function walk(root: string): Promise<string[]> {
  const paths: string[] = [];
  async function visit(relativeDir: string): Promise<void> {
    if (paths.length >= maxWalkEntries) return;
    let entries;
    try { entries = await readdir(join(root, relativeDir), { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (paths.length >= maxWalkEntries) break;
      const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue;
        paths.push(`${path}/`);
        await visit(path);
      } else if (entry.isFile() || entry.isSymbolicLink()) paths.push(path);
    }
  }
  await visit("");
  return paths;
}

function evidenceId(prefix: string, value: string): string {
  return `project:${prefix}:${value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`;
}

function addEvidence(evidence: AdviceEvidence[], input: Omit<AdviceEvidence, "source">): void {
  if (!evidence.some((entry) => entry.id === input.id)) evidence.push({ ...input, source: "project" });
}

function matchingPaths(paths: string[], patterns: RegExp[], limit = 30): string[] {
  return paths.filter((path) => patterns.some((pattern) => pattern.test(path))).slice(0, limit);
}

function summarizeConfiguration(path: string, text: string): string {
  if (path.endsWith(".md")) {
    const headings = Array.from(text.matchAll(/^#{1,4}\s+(.+)$/gm), (match) => match[1]!.trim()).slice(0, 12);
    const refs = Array.from(new Set(Array.from(text.matchAll(/\b([A-Za-z0-9._/-]+\.md)\b/g), (match) => match[1]!))).slice(0, 8);
    return `${headings.length ? `headings: ${headings.join(", ")}` : "no headings"}${refs.length ? `; delegates to: ${refs.join(", ")}` : ""}`.slice(0, 500);
  }
  if (path.endsWith(".json")) {
    try {
      const value = JSON.parse(text);
      const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort().slice(0, 20) : [];
      return `top-level keys: ${keys.join(", ") || "none"}`;
    } catch { return "present but not valid JSON"; }
  }
  if (path.endsWith(".toml")) {
    const sections = Array.from(text.matchAll(/^\s*\[([^\]]+)\]/gm), (match) => match[1]!.trim()).slice(0, 20);
    return `sections: ${sections.join(", ") || "none"}`;
  }
  return "present";
}

function detectedLanguages(paths: string[]): string[] {
  const rules: Array<[string, RegExp]> = [
    ["TypeScript", /\.(?:ts|tsx)$/], ["JavaScript", /\.(?:js|jsx|mjs|cjs)$/], ["Python", /\.py$/],
    ["Ruby", /\.rb$/], ["Rust", /\.rs$/], ["Go", /\.go$/], ["Java", /\.java$/], ["Swift", /\.swift$/]
  ];
  return rules.filter(([, pattern]) => paths.some((path) => pattern.test(path))).map(([name]) => name);
}

const configPatterns: Record<string, RegExp[]> = {
  agents: [/(^|\/)AGENTS\.md$/],
  claude: [/(^|\/)CLAUDE\.md$/, /^\.claude\//],
  codex: [/(^|\/)\.codex\//],
  hooks: [/(^|\/)hooks?\//, /settings\.json$/],
  skills: [/(^|\/)\.agents\/skills\//, /(^|\/)\.claude\/skills\//, /SKILL\.md$/],
  subagents: [/(^|\/)(?:\.codex\/agents|\.claude\/agents|subagents)\//],
  plugins: [/(^|\/)\.agents\/plugins\//, /\.codex-plugin\/plugin\.json$/],
  mcp: [/(^|\/)\.mcp\.json$/, /(^|\/)\.codex\/config\.toml$/]
};

function capability(capabilities: ProjectCapability[], group: ProjectCapability["group"], name: string, evidence: string[]): void {
  const id = `${group}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const existing = capabilities.find((item) => item.id === id);
  if (existing) existing.evidence = Array.from(new Set([...existing.evidence, ...evidence]));
  else capabilities.push({ id, group, name, evidence: Array.from(new Set(evidence)) });
}

function dependencyEvidence(name: string): string { return evidenceId("dependency", name); }

function deriveCapabilities(input: {
  paths: string[];
  stacks: string[];
  languages: string[];
  dependencies: string[];
  workflows: ProjectWorkflow[];
  tests: string[];
  ci: string[];
  configuration: Record<string, string[]>;
}): ProjectCapability[] {
  const values: ProjectCapability[] = [];
  for (const language of input.languages) capability(values, "language", language, [evidenceId("language", language)]);
  const frameworkByStack: Record<string, string[]> = {
    "python-fastapi": ["FastAPI"],
    rails: ["Rails"],
    "ts-react-vite": ["React", "Vite"]
  };
  for (const stack of input.stacks) {
    for (const framework of frameworkByStack[stack] ?? []) capability(values, "framework", framework, [`project:stack:${stack}`]);
  }
  const deps = new Set(input.dependencies);
  const has = (...names: string[]) => names.some((name) => deps.has(name));
  if (has("typescript", "ts-node", "tsx")) capability(values, "runtime", "TypeScript", [dependencyEvidence("typescript")]);
  if (has("drizzle-orm", "drizzle-kit")) capability(values, "orm", "Drizzle", [dependencyEvidence(has("drizzle-orm") ? "drizzle-orm" : "drizzle-kit")]);
  if (has("pg", "postgres", "postgresql", "@neondatabase/serverless", "psycopg", "psycopg2", "asyncpg")) {
    const match = [...deps].find((name) => ["pg", "postgres", "postgresql", "@neondatabase/serverless", "psycopg", "psycopg2", "asyncpg"].includes(name));
    capability(values, "database", "PostgreSQL", match ? [dependencyEvidence(match)] : []);
  }
  if (has("prisma", "@prisma/client")) capability(values, "orm", "Prisma", [dependencyEvidence(has("prisma") ? "prisma" : "@prisma/client")]);
  const migrationPaths = matchingPaths(input.paths, [/(^|\/)(?:migrate|migrations?|drizzle)\//, /drizzle\.config\.[^/]+$/, /schema\.prisma$/]).filter((path) => !path.endsWith("/"));
  if (migrationPaths.length) capability(values, "migrations", "Database migrations", migrationPaths.map((path) => evidenceId("workflow", path)));
  if (input.tests.length || input.workflows.some((item) => item.kind === "test")) capability(values, "testing", "Automated tests", input.tests.slice(0, 6).map((path) => evidenceId("tests", path)));
  if (input.ci.length) capability(values, "ci", "CI workflows", input.ci.map((path) => evidenceId("ci", path)));
  const apiPaths = matchingPaths(input.paths, [/(^|\/)(?:openapi|swagger)(?:\.|\/)/i, /openapi\.ya?ml$/i]).filter((path) => !path.endsWith("/"));
  if (apiPaths.length || input.workflows.some((item) => item.kind === "api")) capability(values, "api", "OpenAPI", apiPaths.map((path) => evidenceId("workflow", path)));
  if (input.workflows.some((item) => item.kind === "release")) capability(values, "release", "Release workflow", input.workflows.filter((item) => item.kind === "release").flatMap((item) => item.evidence));
  if (input.workflows.some((item) => item.kind === "deployment")) capability(values, "deployment", "Deployment workflow", input.workflows.filter((item) => item.kind === "deployment").flatMap((item) => item.evidence));
  for (const [name, paths] of Object.entries(input.configuration)) if (paths.length) capability(values, "automation", name, paths.map((path) => evidenceId(`config:${name}`, path)));
  return values;
}

function automationInventory(configuration: Record<string, string[]>): ProjectAutomation[] {
  const categoryByConfig: Partial<Record<string, AdviceCategory>> = {
    agents: "guidance", claude: "guidance", codex: "guidance", hooks: "hooks", skills: "skills",
    subagents: "subagents", plugins: "plugins", mcp: "mcp"
  };
  return Object.entries(configuration).flatMap(([name, paths]) => paths.slice(0, 20).map((path) => ({
    category: categoryByConfig[name] ?? "guidance", path, summary: `${name} automation at ${path}`
  })));
}

async function ciWorkflows(root: string, paths: string[], evidence: AdviceEvidence[]): Promise<ProjectWorkflow[]> {
  const workflows: ProjectWorkflow[] = [];
  for (const path of paths) {
    const text = await readProjectFile(root, path);
    const name = text?.match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim() ?? basename(path);
    const triggers = text ? Array.from(new Set(Array.from(text.matchAll(/^\s{2}([A-Za-z_][\w-]*):?\s*$/gm), (match) => match[1]!))).slice(0, 12) : [];
    const id = evidenceId("ci", path);
    addEvidence(evidence, { id, kind: "ci", summary: `${path}; workflow: ${name}${triggers.length ? `; triggers: ${triggers.join(", ")}` : ""}`, path });
    workflows.push({ kind: "ci", name, path, triggers, evidence: [id] });
  }
  return workflows;
}

function artifactWorkflows(paths: string[], evidence: AdviceEvidence[]): ProjectWorkflow[] {
  const groups: Array<{ kind: ProjectWorkflow["kind"]; name: string; patterns: RegExp[] }> = [
    { kind: "database", name: "Database migration or schema", patterns: [/(^|\/)(?:migrate|migrations?|drizzle)\//, /(?:^|\/)(?:schema\.prisma|schema\.sql|db\/schema\.rb|drizzle\.config\.[^/]+)$/] },
    { kind: "api", name: "API specification", patterns: [/(^|\/)(?:openapi|swagger)(?:\.|\/)/i] },
    { kind: "generation", name: "Component or code template", patterns: [/(^|\/)(?:templates?|generators?)\//, /(?:^|\/)plopfile\.[^/]+$/i] },
    { kind: "test", name: "Test fixture or factory", patterns: [/(^|\/)(?:fixtures?|factories)\//] },
    { kind: "docs", name: "Documentation generator", patterns: [/(?:^|\/)(?:typedoc\.json|mkdocs\.ya?ml|docusaurus\.config\.[^/]+|conf\.py)$/i] }
  ];
  const claimed = new Set<string>();
  const workflows: ProjectWorkflow[] = [];
  for (const group of groups) {
    for (const path of matchingPaths(paths, group.patterns, 20).filter((item) => !item.endsWith("/"))) {
      if (claimed.has(path) || workflows.length >= 40) continue;
      claimed.add(path);
      const id = evidenceId("workflow", path);
      addEvidence(evidence, { id, kind: `workflow:${group.kind}`, summary: `${group.name}: ${path}`, path });
      workflows.push({ kind: group.kind, name: group.name, path, evidence: [id] });
    }
  }
  return workflows;
}

export async function profileProject(targetDirInput: string): Promise<ProjectProfile> {
  const targetDir = resolve(targetDirInput);
  const paths = await walk(targetDir);
  const [packEvidence, manifests] = await Promise.all([
    detectPacksWithEvidence(targetDir).catch(() => []), inspectProjectManifests(targetDir, paths)
  ]);
  const evidence: AdviceEvidence[] = [];
  addEvidence(evidence, { id: "project:root", kind: "structure", summary: `Resolved project root: ${targetDir}`, path: "." });
  for (const pack of packEvidence) addEvidence(evidence, {
    id: `project:stack:${pack.packId}`, kind: "stack", summary: `${pack.packId}: ${pack.evidence.join(", ")}`,
    path: pack.evidence.find((item) => !item.includes(" dependency:"))?.replace(/\/$/, "")
  });
  for (const item of manifests.summaries) addEvidence(evidence, { ...item, kind: "manifest" });
  for (const dependency of manifests.dependencies) addEvidence(evidence, {
    id: dependencyEvidence(dependency.name), kind: "dependency",
    summary: `${dependency.name}${dependency.version ? ` ${dependency.version}` : ""} (${dependency.group})`, path: dependency.manifest
  });
  for (const workflow of manifests.workflows) addEvidence(evidence, {
    id: workflow.evidence[0]!, kind: "workflow", summary: `${workflow.name}: ${workflow.command}`, path: workflow.path
  });

  const tests = matchingPaths(paths, [/(^|\/)(?:test|tests|spec|specs)\//, /(?:\.test|\.spec)\.[^.]+$/, /pytest\.ini$/, /playwright\.config/]);
  const ci = matchingPaths(paths, [/^\.github\/workflows\/.+/, /^\.circleci\/.+/, /^\.gitlab-ci\.yml$/, /^Jenkinsfile$/]).filter((path) => !path.endsWith("/"));
  const services = matchingPaths(paths, [/docker-compose/, /compose\.ya?ml$/, /Dockerfile$/, /serverless\.ya?ml$/, /template\.ya?ml$/, /terraform\//, /\.tf$/]);
  const structure = paths.filter((path) => path.endsWith("/") && !path.slice(0, -1).includes("/")).slice(0, 30);
  const configuration = Object.fromEntries(Object.entries(configPatterns).map(([name, patterns]) => [name, matchingPaths(paths, patterns)]));
  for (const path of tests.slice(0, 8)) addEvidence(evidence, { id: evidenceId("tests", path), kind: "tests", summary: path, path });
  for (const path of services) addEvidence(evidence, { id: evidenceId("service", path), kind: "service", summary: path, path });
  for (const [name, configPaths] of Object.entries(configuration)) {
    for (const path of configPaths.slice(0, 8)) {
      const text = path.endsWith("/") ? undefined : await readProjectFile(targetDir, path);
      addEvidence(evidence, { id: evidenceId(`config:${name}`, path), kind: `config:${name}`, summary: `${name} configuration at ${path}${text ? `; ${summarizeConfiguration(path, text)}` : ""}`, path });
    }
  }
  const ciInventory = await ciWorkflows(targetDir, ci, evidence);
  const artifactInventory = artifactWorkflows(paths, evidence);
  const languages = detectedLanguages(paths);
  for (const language of languages) addEvidence(evidence, { id: evidenceId("language", language), kind: "language", summary: `${language} source files detected.` });
  const workflows = [...manifests.workflows, ...artifactInventory, ...ciInventory];
  const capabilities = deriveCapabilities({
    paths, stacks: packEvidence.map((entry) => entry.packId), languages,
    dependencies: manifests.dependencies.map((item) => item.name), workflows, tests, ci, configuration
  });
  for (const item of capabilities) addEvidence(evidence, {
    id: `project:capability:${item.id}`, kind: `capability:${item.group}`,
    summary: `${item.name} capability from ${item.evidence.join(", ") || "project structure"}`
  });
  return {
    targetDir, stacks: packEvidence.map((entry) => entry.packId), languages, tests, ci, services, structure, configuration,
    dependencies: manifests.dependencies, packageManagers: manifests.packageManagers, workspaces: manifests.workspaces,
    workflows, capabilities, automations: automationInventory(configuration), evidence
  };
}

export function projectProfileSummary(profile: ProjectProfile): string {
  const config = Object.entries(profile.configuration).filter(([, paths]) => paths.length).map(([name, paths]) => `${name}=${paths.join(",")}`).join("; ");
  return [
    `Project: ${basename(profile.targetDir)}`,
    `Stacks: ${profile.stacks.join(", ") || "generic"}`,
    `Languages: ${profile.languages.join(", ") || "unknown"}`,
    `Package managers: ${(profile.packageManagers ?? []).join(", ") || "unknown"}`,
    `Dependencies: ${(profile.dependencies ?? []).map((item) => item.name).slice(0, 100).join(", ") || "none detected"}`,
    `Capabilities: ${(profile.capabilities ?? []).map((item) => `${item.group}:${item.name}`).join(", ") || "none detected"}`,
    `Workflows: ${(profile.workflows ?? []).map((item) => `${item.kind}:${item.name}`).join(", ") || "none detected"}`,
    `Tests: ${profile.tests.slice(0, 20).join(", ") || "none detected"}`,
    `CI: ${profile.ci.join(", ") || "none detected"}`,
    `Services: ${profile.services.join(", ") || "none detected"}`,
    `Top-level structure: ${profile.structure.join(", ") || "none"}`,
    `Agent configuration: ${config || "none detected"}`
  ].join("\n");
}
