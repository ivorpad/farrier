import { createHash } from "node:crypto";
import { dirname, posix } from "node:path";
import type { HookId } from "../packs/types";
import { walkHarnessAuditCandidates } from "./harness-audit-candidate-walk";
import {
  collectHarnessAuditEvidenceLines,
  harnessAuditLineIsFenced,
  harnessAuditPackageScriptPaths,
  type HarnessAuditDocument,
} from "./harness-audit-line-evidence";
import { packageEvidenceChecks, scopedPackageManifestPaths } from "./harness-audit-package-evidence";
import {
  inspectManifestStack,
  type HarnessAuditManifestStack,
} from "./harness-audit-manifest-stack";
import { containedPathStatus, pathChecks } from "./harness-audit-path-check";
import {
  insideAwsResourceIdentifier,
  insideBareModuleSpecifier,
  insideGitReference,
  insideHomeDirectoryPath,
  insideRelativeModuleSpecifier,
  illustrativeFencedPathLine,
  isProspectiveCreationTarget,
  repositoryPathSearchText,
} from "./harness-audit-path-context";
import { hookTemplateFiles } from "./render";
import {
  openContainedRepository,
  readContainedDirectory,
  readContainedFile,
  type ContainedRepository,
} from "./repository-paths";
import type {
  HarnessAuditCheck,
  HarnessAuditLayer,
  HarnessAuditLine,
} from "./harness-audit-types";

const maxEntries = 3_000;
const maxFileBytes = 192_000;
const maxSkillFiles = 64;
const taskPathWords = new Set([
  "add", "build", "check", "clear", "create", "format", "lint", "read", "rm", "send", "set", "set-delivery",
  "set-many", "stop", "submit", "test", "tests", "typecheck", "update", "wait",
]);
const ignoredDirectories = new Set([
  ".build", ".git", ".cache", ".eve", ".farrier-staging", ".next", ".pytest_cache", ".venv", ".workflow-data", "_archive",
  "build", "coverage", "deps", "dist", "fixtures", "node_modules", "target", "tmp", "vendor", "__pycache__",
]);
const priorityPaths = [
  "AGENTS.md", "CLAUDE.md", ".farrier.json", "package.json", "tsconfig.json", "pyproject.toml", "Gemfile",
  "template.yaml", "samconfig.toml", "justfile", "Makefile",
  "Taskfile.yml", "Taskfile.yaml", ".pre-commit-config.yaml", "scripts/lint.sh",
  ".github/copilot-instructions.md", ".claude/settings.json", ".codex/config.toml",
];
const skillRoots = ["skills", ".agents/skills", ".claude/skills"];

function boundedSkillPaths(paths: string[], skipped: HarnessAuditCorpus["skipped"]): string[] {
  if (paths.length <= maxSkillFiles) return paths;
  skipped.push({ path: skillRoots.join(", "), reason: `${paths.length - maxSkillFiles} files omitted by skill-file-limit` });
  return Array.from({ length: maxSkillFiles }, (_, index) =>
    paths[Math.floor(index * (paths.length - 1) / (maxSkillFiles - 1))]!);
}

export type { HarnessAuditDocument } from "./harness-audit-line-evidence";

export type HarnessAuditCorpus = {
  root: string;
  documents: HarnessAuditDocument[];
  lines: HarnessAuditLine[];
  checks: HarnessAuditCheck[];
  skipped: Array<{ path: string; reason: string }>;
  manifestStack?: HarnessAuditManifestStack;
};

function shortDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function lineKind(path: string): HarnessAuditLine["kind"] | undefined {
  if (path === ".farrier.json") return "hook";
  if (/(^|\/)(?:AGENTS|CLAUDE)\.md$/.test(path) || path === ".github/copilot-instructions.md") return "guidance";
  if (/^(?:skills|\.agents\/skills|\.claude\/skills)\/.+\/SKILL\.md$/.test(path)) return "skill";
  if (/^(?:\.claude|\.codex)\/(?:settings[^/]*\.json|config\.toml)$/.test(path)) return "hook";
  if (/^(?:\.claude|\.agents)\/hooks\/[^/]+$/.test(path)) return "hook";
  if ([
    ".pre-commit-config.yaml", "tsconfig.json", "pyproject.toml", "Gemfile", "template.yaml", "samconfig.toml", "justfile", "Makefile",
    "Taskfile.yml", "Taskfile.yaml", "scripts/lint.sh",
  ].includes(path) || /(?:^|\/)package\.json$/.test(path)) return "toolchain";
  return undefined;
}

function inactiveEvaluationSnapshot(path: string): boolean {
  return /(?:^|\/)(?:claude[_-]?evals?|agent[_-]?evals?|evals?|evaluations?)\/(?:variants?|fixtures?|cases?)(?:\/[^/]+)+\/(?:AGENTS|CLAUDE)\.md$/i
    .test(path);
}

async function installedSkillPaths(
  repository: ContainedRepository,
  skipped: HarnessAuditCorpus["skipped"],
): Promise<string[]> {
  const paths: string[] = [];
  const queue = [...skillRoots];
  let entries = 0;
  while (queue.length) {
    const directoryPath = queue.shift()!;
    const directory = await readContainedDirectory(repository, directoryPath);
    if (directory.status === "missing") continue;
    if (directory.status !== "read") {
      skipped.push({ path: directoryPath, reason: directory.status });
      continue;
    }
    for (const entry of directory.entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = `${directoryPath}/${entry.name}`;
      entries += 1;
      if (entries > maxEntries) {
        skipped.push({ path, reason: "skill-entry-limit" });
        return boundedSkillPaths(paths, skipped);
      }
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) queue.push(path);
      } else if (entry.isFile() && lineKind(path) === "skill") {
        paths.push(path);
      } else if (!entry.isFile() && lineKind(path) === "skill") {
        skipped.push({ path, reason: entry.isSymbolicLink() ? "symlink" : "special-file" });
      }
    }
  }
  return boundedSkillPaths(paths, skipped);
}

async function candidatePaths(
  repository: ContainedRepository,
  skipped: HarnessAuditCorpus["skipped"],
): Promise<string[]> {
  const result: string[] = [];
  for (const path of priorityPaths) {
    const read = await readContainedFile(repository, path, maxFileBytes);
    if (read.status === "read" || read.status === "oversized") result.push(path);
  }
  result.push(...await installedSkillPaths(repository, skipped));
  const walked = await walkHarnessAuditCandidates(repository, {
    maxEntries,
    ignoredDirectoryNames: ignoredDirectories,
    excludedDirectoryPaths: new Set(skillRoots),
    isCandidatePath: (path) => lineKind(path) !== undefined,
    includeCandidatePath: (path) => path === "package.json" || !path.endsWith("/package.json"),
    skipCandidatePath: (path) => inactiveEvaluationSnapshot(path)
      ? "inactive-evaluation-snapshot"
      : undefined,
  });
  result.push(...walked.paths);
  skipped.push(...walked.skipped);
  result.push(...await scopedPackageManifestPaths(repository, result.filter((path) => lineKind(path) === "guidance")));
  const priority = new Map(priorityPaths.map((path, index) => [path, index]));
  return Array.from(new Set(result)).sort((left, right) =>
    (priority.get(left) ?? priorityPaths.length) - (priority.get(right) ?? priorityPaths.length)
    || left.localeCompare(right));
}

async function readDocuments(
  repository: ContainedRepository,
  paths: string[],
  skipped: HarnessAuditCorpus["skipped"],
): Promise<HarnessAuditDocument[]> {
  const documents: HarnessAuditDocument[] = [];
  for (const path of paths) {
    const read = await readContainedFile(repository, path, maxFileBytes);
    if (read.status !== "read") {
      skipped.push({ path, reason: read.status });
      continue;
    }
    documents.push({ path, kind: lineKind(path)!, text: read.text });
  }
  return documents;
}

function targetChecks(documents: HarnessAuditDocument[]): HarnessAuditCheck[] {
  const checks: HarnessAuditCheck[] = [];
  const justfile = documents.find((item) => item.path === "justfile");
  if (justfile) {
    const targets = Array.from(justfile.text.matchAll(/^([A-Za-z0-9][A-Za-z0-9_-]*):(?:\s|$)/gm), (match) => match[1]!).sort();
    checks.push({
      id: "check:just-targets",
      layers: ["guidance", "verification", "toolchain"],
      description: "Listed justfile recipes.",
      result: targets.length ? targets.join(", ") : "no recipes found",
    });
  }
  const makefile = documents.find((item) => item.path === "Makefile");
  if (makefile) {
    const targets = Array.from(makefile.text.matchAll(/^([A-Za-z0-9][A-Za-z0-9_.-]*):(?:\s|$)/gm), (match) => match[1]!).sort();
    checks.push({
      id: "check:make-targets",
      layers: ["guidance", "verification", "toolchain"],
      description: "Listed Makefile targets.",
      result: targets.length ? targets.join(", ") : "no targets found",
    });
  }
  return checks;
}

function illustrativePathLine(line: HarnessAuditLine): boolean {
  const templatePlaceholder = /(?:^|\/)filename(?:\.[A-Za-z0-9_-]+)?(?:\b|\/)/i.test(line.text)
    || /(?:^|\/)(?:plugin|skill)-name(?:\b|\/)/i.test(line.text)
    || /\bcreate\b[^`\n]*`[^`\n]*\/new-(?:agent|command|hook|skill)\.[A-Za-z0-9_-]+`/i.test(line.text);
  return /(?:\be\.g\.|\bfor example\b|\bsuch as\b)/i.test(line.text)
    || /^\s*(?:[-*]\s*)?examples?\b/i.test(line.text)
    || /\b(?:files?|paths?|references?)\s+like\b/i.test(line.text)
    || templatePlaceholder
    || /^\s*(?:[-*]\s*)?(?:✅|❌)/u.test(line.text)
    || /\bonly\b.{0,320}\bif\b/i.test(line.text)
    || Boolean(harnessAuditLineIsFenced(line) && illustrativeFencedPathLine(line.text));
}

function explicitPathSyntax(line: HarnessAuditLine, raw: string, cleaned: string, start: number, end: number): boolean {
  const semanticSegments = cleaned.replace(/^(?:\.\.?\/)+/, "").split("/");
  if (semanticSegments.includes("...") || semanticSegments.includes(".venv") || cleaned.startsWith("path/to/")) return false;
  if (semanticSegments.length > 1 && semanticSegments.every((segment) => taskPathWords.has(segment))) return false;
  if (/^(?:\.claude|\.agents|\.github|\.codex|\.taskmaster)\//.test(cleaned) || raw.startsWith("./")) return true;
  const before = line.text.slice(0, start);
  const after = line.text.slice(end);
  const insideBackticks = (before.match(/`/g)?.length ?? 0) % 2 === 1 && after.includes("`");
  const quote = before.at(-1);
  const quoted = (quote === "\"" || quote === "'") && after.startsWith(quote);
  const finalSegment = cleaned.split("/").at(-1) ?? "";
  return insideBackticks || quoted || /\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/.test(finalSegment);
}

function insideExternalExecutionPayload(line: HarnessAuditLine, start: number): boolean {
  const before = line.text.slice(0, start);
  const quoteStart = Math.max(before.lastIndexOf('"'), before.lastIndexOf("'"));
  if (quoteStart < 0) return false;
  const wrapper = before.slice(0, quoteStart);
  return /\b(?:ssh|mosh)\b|\b(?:docker|podman|kubectl)\s+exec\b|\b(?:testbox|sandbox|guest|vm)\s+(?:run|exec)\b/i.test(wrapper);
}

function referencedPaths(line: HarnessAuditLine): string[] {
  const paths = [...harnessAuditPackageScriptPaths(line)];
  if (illustrativePathLine(line)) return paths;
  const pattern = /(?:^|[^A-Za-z0-9_./-])((?:(?:\.\.\/)+[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+|(?:\.\.?\/)?(?:\.claude|\.agents|\.github|\.codex|\.taskmaster|scripts|docs|tests?|rules|references|referencias|assets|sub-agents|modes|themes)\/[A-Za-z0-9_./-]+|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+){2,}))/g;
  for (const match of repositoryPathSearchText(line).matchAll(pattern)) {
    const raw = match[1]!;
    const start = (match.index ?? 0) + match[0]!.lastIndexOf(raw);
    const end = start + raw.length;
    if (/(?:https?|file):\/\/[^\s]*$/i.test(line.text.slice(0, start))) continue;
    if (line.kind === "skill" && insideExternalExecutionPayload(line, start)) continue;
    if (insideAwsResourceIdentifier(line, start)) continue;
    if (insideGitReference(line, start, end)) continue;
    if (insideHomeDirectoryPath(line, start)) continue;
    if (insideBareModuleSpecifier(line, start, end)) continue;
    if (isProspectiveCreationTarget(line, start)) continue;
    const placeholder = line.text.slice(0, start).match(/<([^>]+)>\/$/i)?.[1];
    if (placeholder && !/^skill(?:_dir)?$/i.test(placeholder)) continue;
    const suffix = line.text.slice(end, end + 2);
    if (suffix.startsWith("<") || suffix.startsWith("*")) continue;
    const explicitSkillRelative = line.kind === "skill" && raw.startsWith("./");
    const hookRelativeModule = line.kind === "hook" && insideRelativeModuleSpecifier(line, start, end);
    const cleaned = raw.replace(/^\.\//, "").replace(/[.,:;]+$/, "").replace(/\/+$/, "");
    if (!explicitPathSyntax(line, raw, cleaned, start, end)) continue;
    const rootRelative = /^(?:\.claude|\.agents|\.github|\.codex|\.taskmaster)\//.test(cleaned);
    const localSkillPath = /^(?:scripts|docs|tests?|rules|references|referencias|assets|sub-agents|modes|themes)\//.test(cleaned);
    const skillRoot = line.path.match(/^(skills|\.agents\/skills|\.claude\/skills)\/[^/]+\/SKILL\.md$/)?.[1];
    const providerPrefixedSkillPath = cleaned.startsWith("skills/") && skillRoot
      ? skillRoot === "skills" ? cleaned : `${dirname(skillRoot)}/${cleaned}`
      : undefined;
    const siblingSkillPath = /^[^/]+\/(?:scripts|docs|tests?|rules|references|referencias|assets|sub-agents|modes|themes)\//
      .test(cleaned);
    const scopedGuidance = line.kind === "guidance" && /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/.test(line.path)
      && (line.referenceRoot !== undefined || dirname(line.path) !== ".");
    const scopedToolchain = line.kind === "toolchain" && /(?:^|\/)package\.json$/.test(line.path)
      && (line.referenceRoot !== undefined || dirname(line.path) !== ".");
    const unresolved = line.kind === "skill" && !rootRelative
      ? explicitSkillRelative || cleaned.startsWith("../") || localSkillPath || !skillRoot
        ? `${line.referenceRoot ?? dirname(line.path)}/${cleaned}`
        : providerPrefixedSkillPath ?? (siblingSkillPath ? `${skillRoot}/${cleaned}` : cleaned)
      : hookRelativeModule && !rootRelative
        ? `${dirname(line.path)}/${cleaned}`
        : (scopedGuidance || scopedToolchain) && !rootRelative
        ? `${line.referenceRoot ?? dirname(line.path)}/${cleaned}`
        : cleaned;
    const resolved = posix.normalize(unresolved);
    if (resolved !== ".." && !resolved.startsWith("../") && !posix.isAbsolute(resolved)) paths.push(resolved);
  }
  return Array.from(new Set(paths));
}

async function skillChecks(
  repository: ContainedRepository,
  documents: HarnessAuditDocument[],
  lines: HarnessAuditLine[],
): Promise<HarnessAuditCheck[]> {
  const checks: HarnessAuditCheck[] = [];
  const supplied = new Set(lines.filter((item) => item.kind === "skill").map((item) => item.path));
  for (const document of documents.filter((item) => item.kind === "skill" && supplied.has(item.path))) {
    const cases = `${dirname(document.path)}/evals/cases.json`;
    checks.push({
      id: `check:skill-cases:${shortDigest(document.path)}`,
      layers: ["skill"],
      description: `Checked behavioral cases for ${document.path}.`,
      result: await containedPathStatus(repository, cases),
    });
  }
  return checks;
}

async function manifestHookChecks(
  repository: ContainedRepository,
  documents: HarnessAuditDocument[],
): Promise<HarnessAuditCheck[]> {
  const document = documents.find((item) => item.path === ".farrier.json");
  if (!document) return [];
  let raw: { agents?: unknown; hookIds?: unknown };
  try {
    raw = JSON.parse(document.text) as { agents?: unknown; hookIds?: unknown };
  } catch {
    return [];
  }
  const agents = Array.isArray(raw.agents)
    ? raw.agents.filter((agent): agent is "claude" | "codex" => agent === "claude" || agent === "codex")
    : ["claude" as const];
  const selected = Array.isArray(raw.hookIds)
    ? raw.hookIds.filter((id): id is HookId => typeof id === "string" && id in hookTemplateFiles)
    : [];
  if (!selected.length) return [];
  const checks: HarnessAuditCheck[] = [];
  for (const agent of agents) {
    const path = agent === "claude" ? ".claude/settings.json" : ".codex/hooks.json";
    checks.push({
      id: `check:manifest-hook-binding:${agent}`,
      layers: ["hook"],
      description: `Checked ${agent} binding for manifest-selected hooks at ${path}.`,
      result: await containedPathStatus(repository, path),
    });
  }
  for (const id of selected) {
    const path = `.claude/hooks/${id}.py`;
    checks.push({
      id: `check:manifest-hook-entry:${id}`,
      layers: ["hook"],
      description: `Checked manifest-selected hook ${id} entrypoint ${path}.`,
      result: await containedPathStatus(repository, path),
    });
  }
  return checks;
}

async function lockfileChecks(repository: ContainedRepository): Promise<HarnessAuditCheck[]> {
  const paths = ["bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "uv.lock", "poetry.lock"];
  const existing: string[] = [];
  for (const path of paths) {
    const status = await containedPathStatus(repository, path);
    if (status === "regular file exists") existing.push(path);
  }
  return [{
    id: "check:lockfiles",
    layers: ["toolchain"],
    description: "Checked repository lockfiles before assessing dependency pinning.",
    result: existing.length ? existing.join(", ") : "no known lockfile found",
  }];
}

async function mypyOverrideChecks(
  repository: ContainedRepository,
  documents: HarnessAuditDocument[],
): Promise<HarnessAuditCheck[]> {
  const pyproject = documents.find((document) => document.path === "pyproject.toml");
  if (!pyproject) return [];
  const overrides = Array.from(pyproject.text.matchAll(/^module\s*=\s*"([A-Za-z0-9_.*-]+)"/gm), (match) => match[1]!);
  const invocations = documents.flatMap((document) =>
    Array.from(document.text.matchAll(/(?:^\s*|entry:\s*)(?:uv\s+run\s+)?mypy\s+([A-Za-z0-9_./*-]+)/gm), (match) => match[1]!));
  const checks: HarnessAuditCheck[] = [];
  for (const selector of overrides) {
    const modulePath = selector.replace(/\.\*$/, "").replaceAll(".", "/");
    const topLevel = modulePath.split("/", 1)[0]!;
    const topLevelCandidates = [topLevel, `${topLevel}.py`, `src/${topLevel}`, `src/${topLevel}.py`];
    const topLevelStatuses = await Promise.all(topLevelCandidates.map(async (path) => ({
      path,
      status: await containedPathStatus(repository, path),
    })));
    if (topLevelStatuses.every((item) => item.status === "missing")) continue;
    const moduleCandidates = [modulePath, `${modulePath}.py`, `src/${modulePath}`, `src/${modulePath}.py`];
    const moduleStatuses = await Promise.all(moduleCandidates.map(async (path) => ({
      path,
      status: await containedPathStatus(repository, path),
    })));
    const existing = moduleStatuses.find((item) => item.status !== "missing");
    const resolved = existing ? `${existing.path}: ${existing.status}` : `${modulePath}: missing`;
    checks.push({
      id: `check:mypy-override:${shortDigest(selector)}`,
      layers: ["verification", "toolchain"],
      description: `Checked mypy override ${selector} against its repository module path and configured mypy invocations.`,
      result: `module target ${resolved}; invocation targets: ${invocations.length ? Array.from(new Set(invocations)).join(", ") : "none found"}`,
    });
  }
  return checks;
}

function guidanceVerificationScopeChecks(documents: HarnessAuditDocument[]): HarnessAuditCheck[] {
  const checks: HarnessAuditCheck[] = [];
  for (const document of documents.filter((item) => item.kind === "guidance")) {
    const requiresCiVerification = /\brun\b[^\n]{0,120}\bwhen you change:[\s\S]{0,900}\bCI workflows?\b/i.test(document.text);
    const exemptsGithub = /\b(?:skip|exempt|waive|do not run)\b[^\n]{0,240}(?:\.github|CI workflows?)/i.test(document.text);
    if (!requiresCiVerification || !exemptsGithub) continue;
    checks.push({
      id: `check:verification-scope:${shortDigest(document.path)}`,
      layers: ["guidance", "verification"],
      description: `Compared mandatory verification scopes with documented exemptions in ${document.path}.`,
      result: "CI workflow changes require verification while a .github or CI-workflow exemption is also documented",
    });
  }
  return checks;
}

export async function collectHarnessAuditCorpus(targetDir: string): Promise<HarnessAuditCorpus> {
  const repository = await openContainedRepository(targetDir);
  const skipped: HarnessAuditCorpus["skipped"] = [];
  const paths = await candidatePaths(repository, skipped);
  const documents = await readDocuments(repository, paths, skipped);
  const lines = collectHarnessAuditEvidenceLines(documents, skipped, new Set(priorityPaths));
  const manifestStack = await inspectManifestStack(repository, documents);
  const checks = [
    ...packageEvidenceChecks(documents),
    ...targetChecks(documents),
    ...await pathChecks(repository, lines, referencedPaths, documents),
    ...await skillChecks(repository, documents, lines),
    ...await manifestHookChecks(repository, documents),
    ...(manifestStack ? [manifestStack.check] : []),
    ...await lockfileChecks(repository),
    ...await mypyOverrideChecks(repository, documents),
    ...guidanceVerificationScopeChecks(documents),
    {
      id: "check:audit-coverage",
      layers: ["guidance", "verification", "skill", "hook", "toolchain"] as HarnessAuditLayer[],
      description: "Checked bounded audit corpus coverage.",
      result: skipped.length ? `${skipped.length} path or line limits recorded` : "all selected harness files read",
    },
  ];
  return {
    root: repository.root,
    documents,
    lines,
    checks,
    skipped,
    ...(manifestStack ? { manifestStack: manifestStack.comparison } : {}),
  };
}

export function referencedPathForLine(line: HarnessAuditLine): string[] {
  return referencedPaths(line);
}
