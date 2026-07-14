import { readFile, rm, rmdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { ReasoningEffort, ResolvedModelSettings } from "../config/farrier-config";
import { applyHarnessChangePlan, inspectHarnessChangePlan, type ApplyHarnessChangePlanResult, type HarnessChangePlan } from "./create-plan";
import { defaultBackendRunner, invokeBackend, type BackendCommandRunner } from "./backend";
import type { AdviceEvidence, AdviceRecommendation, AdviceReport, AdviceVendor } from "./advice-types";
import { normalizeSkillCreationRequest, type SkillCreationRequest } from "./create-skill";
import { authorSkillCreationPlan } from "./skill-creation-plan";
import {
  applyMutationPlan,
  inspectMutationPlan,
  type MutationInspection,
  type MutationOperation
} from "./mutation-transaction";
import { sharedSkillLinkTarget } from "./skill-paths";
import type { RenderPlan, RenderedFile } from "./render";

type UnknownRecord = Record<string, unknown>;

export type AdviceCreationFile = RenderedFile & { purpose: string };

export type AdviceCreationPlan = {
  recommendationId: string;
  summary: string;
  files: AdviceCreationFile[];
  trees?: Array<{ path: string; sourcePath: string }>;
  links?: Array<{ path: string; target: string; resolvesTo: string }>;
  cleanupPaths?: string[];
};

export type AdviceCreationInspection = HarnessChangePlan & {
  mutation?: MutationInspection;
  operations?: MutationOperation[];
};

export type AdviceCreationSupport =
  | { kind: "files"; description: string }
  | { kind: "skill"; description: string }
  | { kind: "unsupported"; description: string };

type PathPolicy = {
  description: string;
  existingPaths: string[];
  accepts: (path: string) => boolean;
};

const exact = (paths: string[]) => (path: string): boolean => paths.includes(path);
const skillPath = (root: string) => (path: string): boolean => new RegExp(`^${root.replaceAll(".", "\\.")}/[a-z0-9]+(?:-[a-z0-9]+)*/(?:SKILL\\.md|references/[^/]+\\.md|assets/[^/]+)$`).test(path);

function pathPolicy(recommendation: AdviceRecommendation): PathPolicy | undefined {
  switch (recommendation.implementationRoute.id) {
    case "guidance:agents-md":
      return { description: "AGENTS.md only", existingPaths: ["AGENTS.md"], accepts: exact(["AGENTS.md"]) };
    case "guidance:claude-md":
      return { description: "CLAUDE.md only", existingPaths: ["CLAUDE.md"], accepts: exact(["CLAUDE.md"]) };
    case "guidance:codex-config":
      return { description: ".codex/config.toml only", existingPaths: [".codex/config.toml"], accepts: exact([".codex/config.toml"]) };
    case "hooks:codex-hooks-json":
      return { description: ".codex/hooks.json only", existingPaths: [".codex/hooks.json"], accepts: exact([".codex/hooks.json"]) };
    case "hooks:claude-settings":
      return { description: ".claude/settings.json only", existingPaths: [".claude/settings.json"], accepts: exact([".claude/settings.json"]) };
    case "hooks:shared-policy": {
      const paths = [".claude/settings.json", ".codex/hooks.json"];
      return { description: "Claude/Codex declarative config only; no scripts", existingPaths: paths, accepts: exact(paths) };
    }
    case "skills:agents-shared":
      return { description: "one shared skill directory", existingPaths: [], accepts: skillPath(".agents/skills") };
    case "skills:claude-local":
      return { description: "one Claude skill directory", existingPaths: [], accepts: skillPath(".claude/skills") };
    case "skills:codex-local":
      return { description: "one Codex skill directory", existingPaths: [], accepts: skillPath(".agents/skills") };
    case "subagents:claude-agent":
      return { description: "one Claude agent markdown file", existingPaths: [], accepts: (path) => /^\.claude\/agents\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path) };
    case "subagents:codex-agent":
      return { description: ".codex/config.toml only", existingPaths: [".codex/config.toml"], accepts: exact([".codex/config.toml"]) };
    case "subagents:cross-vendor":
      return {
        description: "Claude agent markdown and/or Codex project config",
        existingPaths: [".codex/config.toml"],
        accepts: (path) => path === ".codex/config.toml" || /^\.claude\/agents\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path)
      };
    case "mcp:claude-project":
      return { description: ".mcp.json only", existingPaths: [".mcp.json"], accepts: exact([".mcp.json"]) };
    case "mcp:codex-project":
      return { description: ".codex/config.toml only", existingPaths: [".codex/config.toml"], accepts: exact([".codex/config.toml"]) };
    case "mcp:shared-project": {
      const paths = [".mcp.json", ".codex/config.toml"];
      return { description: "Claude/Codex project MCP config only", existingPaths: paths, accepts: exact(paths) };
    }
    default:
      return undefined;
  }
}

export function adviceCreationSupport(recommendation: AdviceRecommendation): AdviceCreationSupport {
  if (recommendation.category === "plugins") {
    return { kind: "unsupported", description: "Plugin installation needs a verified marketplace command and is not file-plan safe yet." };
  }
  if (recommendation.category === "skills") {
    return pathPolicy(recommendation)
      ? { kind: "skill", description: "Author with the existing skill-creator workflow, then include its exact files in the batch review." }
      : { kind: "unsupported", description: "This skill route has no constrained, reviewable project destination." };
  }
  const policy = pathPolicy(recommendation);
  return policy
    ? { kind: "files", description: policy.description }
    : { kind: "unsupported", description: "This implementation route has no constrained creator." };
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function secretLike(value: string): boolean {
  return /\bsk-[A-Za-z0-9_-]{12,}\b|\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s,"']{8,}/i.test(value);
}

async function existingFileContext(targetDir: string, policy: PathPolicy): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  for (const path of policy.existingPaths) {
    try {
      const content = (await readFile(resolve(targetDir, path), "utf8")).slice(0, 40_000);
      if (secretLike(content)) throw new Error(`Refusing to send secret-like values from ${path} to the planning backend.`);
      files.push({ path, content });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return files;
}

function evidenceFor(report: AdviceReport, recommendation: AdviceRecommendation): AdviceEvidence[] {
  const byId = new Map([...report.profile.evidence, ...report.sessions.evidence].map((item) => [item.id, item]));
  return recommendation.evidence.flatMap((id) => byId.get(id) ?? []);
}

function planningPrompt(input: {
  recommendation: AdviceRecommendation;
  evidence: AdviceEvidence[];
  policy: PathPolicy;
  existing: Array<{ path: string; content: string }>;
}): string {
  return `Create a reviewed file plan for one Farrier recommendation. Return JSON only:
{"summary":"one sentence","files":[{"path":"relative/path","purpose":"short explanation","content":"complete final file content"}]}

Rules:
- Implement only the selected recommendation and stay within this path policy: ${input.policy.description}.
- Return complete final content, not a patch. Preserve unrelated existing settings exactly.
- Do not include commands to run, markdown fences, commentary, secrets, placeholders for secrets, or generated executable files.
- Hook plans may edit declarative JSON/TOML configuration only and may reference existing project commands; never create hook scripts or inline script bodies.
- JSON files must parse as JSON objects. Skill files must remain inside one skill directory.
- Return 1–8 files, each at most 50,000 characters.

Recommendation:
${JSON.stringify(input.recommendation)}

Validated evidence:
${JSON.stringify(input.evidence)}

Existing editable files (empty means they do not exist):
${JSON.stringify(input.existing)}
`;
}

function safeRelativePath(path: string): boolean {
  return Boolean(path) && !isAbsolute(path) && !path.includes("\0") && !path.split(/[\\/]/).includes("..");
}

function validateJsonFile(path: string, content: string): void {
  if (!path.endsWith(".json")) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Creation plan file '${path}' is not valid JSON.`);
  }
  if (!isRecord(parsed)) throw new Error(`Creation plan file '${path}' must contain a JSON object.`);
}

function assertExistingJsonPreserved(
  existing: Array<{ path: string; content: string }>,
  files: AdviceCreationFile[],
  recommendation: AdviceRecommendation
): void {
  const mutableKeys = recommendation.category === "hooks" ? new Set(["hooks"]) : recommendation.category === "mcp" ? new Set(["mcpServers"]) : new Set<string>();
  for (const current of existing.filter((item) => item.path.endsWith(".json"))) {
    const planned = files.find((file) => file.path === current.path);
    if (!planned) continue;
    const before = JSON.parse(current.content) as UnknownRecord;
    const after = JSON.parse(planned.content) as UnknownRecord;
    for (const [key, value] of Object.entries(before)) {
      if (!mutableKeys.has(key) && JSON.stringify(after[key]) !== JSON.stringify(value)) {
        throw new Error(`Creation plan for '${current.path}' changed unrelated top-level key '${key}'.`);
      }
    }
  }
}

function validateRawPlan(
  raw: unknown,
  recommendation: AdviceRecommendation,
  policy: PathPolicy,
  existing: Array<{ path: string; content: string }>
): AdviceCreationPlan {
  if (!isRecord(raw) || typeof raw.summary !== "string" || !raw.summary.trim() || raw.summary.length > 240 || !Array.isArray(raw.files)) {
    throw new Error("creation backend JSON must contain a concise summary and files array");
  }
  if (raw.files.length < 1 || raw.files.length > 8) throw new Error("creation plan must contain 1–8 files");
  const seen = new Set<string>();
  const files = raw.files.map((value): AdviceCreationFile => {
    if (!isRecord(value) || typeof value.path !== "string" || typeof value.content !== "string" || typeof value.purpose !== "string") {
      throw new Error("every creation plan file needs path, purpose, and content strings");
    }
    const path = value.path.replaceAll("\\", "/");
    if (!safeRelativePath(path) || !policy.accepts(path)) throw new Error(`Creation plan path '${path}' is outside the selected route policy.`);
    if (seen.has(path)) throw new Error(`Creation plan repeats path '${path}'.`);
    if (!value.content || value.content.length > 50_000 || value.content.includes("\0")) throw new Error(`Creation plan content for '${path}' is empty or too large.`);
    if (!value.purpose.trim() || value.purpose.length > 180) throw new Error(`Creation plan purpose for '${path}' is invalid.`);
    if (secretLike(value.content)) throw new Error(`Creation plan content for '${path}' contains a secret-like value.`);
    if (recommendation.category === "hooks" && (/^#!|```/m.test(value.content) || !new Set([".claude/settings.json", ".codex/hooks.json"]).has(path))) {
      throw new Error("Hook creation plans may contain declarative configuration only; executable content was rejected.");
    }
    validateJsonFile(path, value.content);
    seen.add(path);
    return { path, content: value.content, purpose: value.purpose.trim() };
  });
  assertExistingJsonPreserved(existing, files, recommendation);
  return { recommendationId: recommendation.id, summary: raw.summary.trim(), files };
}

export async function planAdviceRecommendation(input: {
  report: AdviceReport;
  recommendation: AdviceRecommendation;
  author?: AdviceVendor;
  /** @deprecated */
  backend?: AdviceVendor;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
}): Promise<AdviceCreationPlan> {
  const author = input.author ?? input.backend ?? input.report.author ?? input.report.backend;
  if ((input.author && input.author !== author) || (input.backend && input.backend !== author) ||
      (input.report.author && input.report.author !== author) || input.report.backend !== author) {
    throw new Error("Advice planning author must match the report author.");
  }
  const policy = pathPolicy(input.recommendation);
  if (!policy) throw new Error(adviceCreationSupport(input.recommendation).description);
  const existing = await existingFileContext(input.report.targetDir, policy);
  const raw = await invokeBackend({
    backend: author,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    prompt: planningPrompt({ recommendation: input.recommendation, evidence: evidenceFor(input.report, input.recommendation), policy, existing }),
    targetDir: input.report.targetDir,
    runner: input.runner ?? defaultBackendRunner,
    signal: input.signal,
    ephemeral: true
  });
  return validateRawPlan(raw, input.recommendation, policy, existing);
}

export async function planAdviceSkillRecommendation(input: {
  report: AdviceReport;
  recommendation: AdviceRecommendation;
  request: SkillCreationRequest;
  modelSettings: ResolvedModelSettings;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
  creatorReady?: boolean;
}): Promise<AdviceCreationPlan> {
  const author = input.report.author ?? input.report.backend;
  const request = normalizeSkillCreationRequest(input.request);
  if (request.authors.length !== 1 || request.authors[0] !== author) {
    throw new Error(`Skill author must come from the ${author} advice report.`);
  }
  const expectedLayout = input.recommendation.implementationRoute.id === "skills:agents-shared" ? "shared" : "native";
  if (request.layout !== expectedLayout) throw new Error(`Skill layout must match route '${input.recommendation.implementationRoute.id}'.`);
  const policy = pathPolicy(input.recommendation);
  if (input.recommendation.category !== "skills" || !policy) {
    throw new Error(adviceCreationSupport(input.recommendation).description);
  }
  const outputRoot = input.recommendation.implementationRoute.id === "skills:claude-local"
    ? ".claude/skills"
    : ".agents/skills";
  const authored = await authorSkillCreationPlan({
    request: input.request,
    targetDir: input.report.targetDir,
    outputRoot,
    retainStaging: true,
    creatorReady: input.creatorReady,
    deps: {
      backendRunner: input.runner,
      signal: input.signal,
      modelSettings: { [author]: input.modelSettings }
    }
  });
  if (!authored.stagedTree) throw new Error("Skill authoring did not retain its reviewed staged tree.");
  try {
    const files = authored.files.map((file): AdviceCreationFile => {
      if (!policy.accepts(file.path)) throw new Error(`Authored skill path '${file.path}' is outside the selected route policy.`);
      if (secretLike(file.content)) throw new Error(`Authored skill file '${file.path}' contains a secret-like value.`);
      return { ...file, purpose: `Skill-creator output for ${authored.name}.` };
    });
    return {
      recommendationId: input.recommendation.id,
      summary: `Author ${authored.name} with ${author} for reviewed project placement.`,
      files,
      trees: [{ path: `${outputRoot}/${authored.name}`, sourcePath: authored.stagedTree.sourcePath }],
      ...(request.layout === "shared" ? {
        links: [{
          path: `.claude/skills/${authored.name}`,
          target: sharedSkillLinkTarget(authored.name),
          resolvesTo: `.agents/skills/${authored.name}`
        }]
      } : {}),
      cleanupPaths: [authored.stagedTree.stagingRoot]
    };
  } catch (error) {
    await cleanupAdviceCreationPlan(input.report.targetDir, { recommendationId: input.recommendation.id, summary: "", files: [], cleanupPaths: [authored.stagedTree.stagingRoot] });
    throw error;
  }
}

function renderPlan(targetDir: string, plan: AdviceCreationPlan): RenderPlan {
  return { targetDir, files: plan.files.map(({ path, content }) => ({ path, content })) };
}

function mutationOperations(plan: AdviceCreationPlan): MutationOperation[] {
  const treeRoots = (plan.trees ?? []).map((tree) => `${tree.path}/`);
  const ordinaryFiles = plan.files.filter((file) => !treeRoots.some((root) => file.path.startsWith(root)));
  return [
    ...ordinaryFiles.map((file): MutationOperation => ({ type: "replace-file", path: file.path, content: file.content, mode: file.mode })),
    ...(plan.trees ?? []).map((tree): MutationOperation => ({ type: "replace-tree", path: tree.path, sourcePath: tree.sourcePath })),
    ...(plan.links ?? []).map((link): MutationOperation => ({ type: "link", path: link.path, target: link.target }))
  ];
}

function mutationHarnessInspection(
  targetDir: string,
  plan: AdviceCreationPlan,
  operations: MutationOperation[],
  mutation: MutationInspection
): AdviceCreationInspection {
  const purposes = new Map(plan.files.map((file) => [file.path, file.purpose]));
  const files = mutation.operations.map((item) => {
    const exists = item.destination.type !== "missing";
    return {
      path: item.operation.path,
      action: exists ? "replace" as const : "create" as const,
      purpose: purposes.get(item.operation.path) ?? (item.operation.type === "link" ? "Provider-native shared skill link." : "Reviewed authored skill tree."),
      reason: exists ? "reviewed destination exists" : "destination is missing",
      requiresForce: exists && item.operation.type !== "remove",
      exists
    };
  });
  const counts = { create: 0, unchanged: 0, merge: 0, update: 0, replace: 0, blocked: 0 };
  for (const file of files) counts[file.action] += 1;
  const replacements = files.filter((file) => file.action === "replace").map((file) => file.path);
  return {
    targetDir,
    existingHarness: false,
    files,
    counts,
    replacementPaths: replacements,
    replacements,
    blockers: [],
    mutation,
    operations
  };
}

export async function inspectAdviceCreationPlan(targetDir: string, plan: AdviceCreationPlan): Promise<AdviceCreationInspection> {
  if (!(plan.trees?.length || plan.links?.length)) return inspectHarnessChangePlan(renderPlan(targetDir, plan));
  const operations = mutationOperations(plan);
  const mutation = await inspectMutationPlan(targetDir, operations, { reviewOnly: true });
  return mutationHarnessInspection(targetDir, plan, operations, mutation);
}

export async function cleanupAdviceCreationPlan(targetDir: string, plan: AdviceCreationPlan): Promise<void> {
  await Promise.all((plan.cleanupPaths ?? []).map((path) => rm(join(targetDir, path), { recursive: true, force: true })));
  await rmdir(join(targetDir, ".farrier-staging", "authoring")).catch(() => undefined);
  await rmdir(join(targetDir, ".farrier-staging")).catch(() => undefined);
}

export async function applyAdviceCreationPlan(
  targetDir: string,
  plan: AdviceCreationPlan,
  force: boolean
): Promise<ApplyHarnessChangePlanResult> {
  if (!(plan.trees?.length || plan.links?.length)) {
    return applyHarnessChangePlan(renderPlan(targetDir, plan), { force, allowExistingHarness: true });
  }
  const operations = mutationOperations(plan);
  const inspection = await inspectMutationPlan(targetDir, operations, { force });
  const result = await applyMutationPlan(inspection);
  await cleanupAdviceCreationPlan(targetDir, plan);
  return {
    written: result.paths,
    unchanged: [],
    writtenFiles: result.paths,
    unchangedFiles: [],
    backupDir: result.backupDir
  };
}
