import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ReasoningEffort, ResolvedModelSettings } from "../config/farrier-config";
import { applyHarnessChangePlan, inspectHarnessChangePlan, type ApplyHarnessChangePlanResult, type HarnessChangePlan } from "./create-plan";
import { defaultBackendRunner, invokeBackend, type BackendCommandRunner } from "./backend";
import type { AdviceEvidence, AdviceRecommendation, AdviceReport, AdviceVendor } from "./advice-types";
import type { SkillCreationRequest } from "./create-skill";
import { authorSkillCreationPlan } from "./skill-creation-plan";
import type { RenderPlan, RenderedFile } from "./render";
import { compareEvidence, createEvidenceSet, redactEvidence, type BoundedEvidenceSet, type EvidenceComparison } from "./behavior-evidence";

type UnknownRecord = Record<string, unknown>;

export type AdviceCreationFile = RenderedFile & { purpose: string };

export type AdviceCreationPlan = {
  recommendationId: string;
  summary: string;
  files: AdviceCreationFile[];
  evidence?: EvidenceComparison;
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
const skillPath = (root: string) => (path: string): boolean => new RegExp(`^${root.replaceAll(".", "\\.")}/[a-z0-9]+(?:-[a-z0-9]+)*/(?:SKILL\\.md|evals/cases\\.json|references/[^/]+\\.md|assets/[^/]+)$`).test(path);

function pathPolicy(recommendation: AdviceRecommendation): PathPolicy | undefined {
  switch (recommendation.implementationRoute.id) {
    case "guidance:agents-md":
      return { description: "AGENTS.md only", existingPaths: ["AGENTS.md"], accepts: exact(["AGENTS.md"]) };
    case "guidance:claude-md":
      return { description: "CLAUDE.md only", existingPaths: ["CLAUDE.md"], accepts: exact(["CLAUDE.md"]) };
    case "guidance:codex-config":
    case "hooks:codex-config":
      return { description: ".codex/config.toml only", existingPaths: [".codex/config.toml"], accepts: exact([".codex/config.toml"]) };
    case "hooks:claude-settings":
      return { description: ".claude/settings.json only", existingPaths: [".claude/settings.json"], accepts: exact([".claude/settings.json"]) };
    case "hooks:shared-policy": {
      const paths = [".claude/settings.json", ".codex/config.toml"];
      return { description: "Claude/Codex declarative config only; no scripts", existingPaths: paths, accepts: exact(paths) };
    }
    case "skills:agents-shared":
      return { description: "one shared skill directory", existingPaths: [], accepts: skillPath(".agents/skills") };
    case "skills:claude-local":
      return { description: "one Claude skill directory", existingPaths: [], accepts: skillPath(".claude/skills") };
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
  dataset: BoundedEvidenceSet<unknown>;
  policy: PathPolicy;
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

Bounded redacted planning dataset (reuse this digest for any comparison):
${JSON.stringify({ digest: input.dataset.digest, items: input.dataset.items, truncated: input.dataset.truncated })}
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
    if (recommendation.category === "hooks" && (/^#!|```/m.test(value.content) || !new Set([".claude/settings.json", ".codex/config.toml"]).has(path))) {
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
  backend: AdviceVendor;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
}): Promise<AdviceCreationPlan> {
  const policy = pathPolicy(input.recommendation);
  if (!policy) throw new Error(adviceCreationSupport(input.recommendation).description);
  const existing = await existingFileContext(input.report.targetDir, policy);
  const dataset = createEvidenceSet({
    workflow: "advice",
    items: [
      { kind: "recommendation", value: input.recommendation },
      { kind: "evidence", value: evidenceFor(input.report, input.recommendation) },
      { kind: "existing", value: existing }
    ],
    maxItemBytes: 16_000,
    maxTotalBytes: 32_000
  });
  const raw = await invokeBackend({
    backend: input.backend,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    prompt: planningPrompt({ dataset, policy }),
    targetDir: input.report.targetDir,
    runner: input.runner ?? defaultBackendRunner,
    signal: input.signal,
    ephemeral: true
  });
  const plan = validateRawPlan(raw, input.recommendation, policy, existing);
  const cases = [{ id: input.recommendation.id, outcome: "inconclusive" as const }];
  return { ...plan, evidence: compareEvidence({ beforeSet: dataset, afterSet: dataset, before: cases, after: cases }) };
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
  const expectedMode = input.report.backend === "claude" ? "author-claude" : "author-codex";
  if (input.request.mode !== expectedMode) {
    throw new Error(`Skill authoring mode must come from the ${input.report.backend} report backend.`);
  }
  const policy = pathPolicy(input.recommendation);
  if (input.recommendation.category !== "skills" || !policy) {
    throw new Error(adviceCreationSupport(input.recommendation).description);
  }
  const outputRoot = input.recommendation.implementationRoute.id === "skills:agents-shared"
    ? ".agents/skills"
    : ".claude/skills";
  const authored = await authorSkillCreationPlan({
    request: { ...input.request, description: redactEvidence(input.request.description) },
    targetDir: input.report.targetDir,
    outputRoot,
    creatorReady: input.creatorReady,
    deps: {
      backendRunner: input.runner,
      signal: input.signal,
      modelSettings: { [input.report.backend]: input.modelSettings }
    }
  });
  const files = authored.files.map((file): AdviceCreationFile => {
    if (!policy.accepts(file.path)) throw new Error(`Authored skill path '${file.path}' is outside the selected route policy.`);
    if (secretLike(file.content)) throw new Error(`Authored skill file '${file.path}' contains a secret-like value.`);
    return { ...file, purpose: `Skill-creator output for ${authored.name}.` };
  });
  const dataset = createEvidenceSet({ workflow: "advice", items: [{ recommendation: input.recommendation, request: redactEvidence(input.request) }] });
  const cases = [{ id: input.recommendation.id, outcome: "inconclusive" as const }];
  return {
    recommendationId: input.recommendation.id,
    summary: `Author ${authored.name} with ${input.report.backend} for reviewed project installation.`,
    files,
    evidence: compareEvidence({ beforeSet: dataset, afterSet: dataset, before: cases, after: cases })
  };
}

function renderPlan(targetDir: string, plan: AdviceCreationPlan): RenderPlan {
  return { targetDir, files: plan.files.map(({ path, content }) => ({ path, content })) };
}

export function inspectAdviceCreationPlan(targetDir: string, plan: AdviceCreationPlan): Promise<HarnessChangePlan> {
  return inspectHarnessChangePlan(renderPlan(targetDir, plan));
}

export function applyAdviceCreationPlan(targetDir: string, plan: AdviceCreationPlan, force: boolean): Promise<ApplyHarnessChangePlanResult> {
  return applyHarnessChangePlan(renderPlan(targetDir, plan), { force, allowExistingHarness: true });
}
