import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { HookId, KonsistentTemplate, PackHookRef, ResolvedPack, SkillRef, ToolPolicyRule } from "../packs/types";
import { hookCapabilities, packCapabilityProjection } from "../packs/index";
import { PYTHON_KONSISTENT_PATH } from "../packs/python-uv";
import type { RegistryPin } from "../registry/catalog";
import { normalizeAgents, type EnforcementAgent } from "./agent-selection";
import { evaluatePackRules, type EvaluatedPackRules } from "./detect";
import { resolveToolchain, type ToolchainResolution } from "./toolchain";
import { generateRepoMapSection, spliceRepoMapSection } from "./repo-map";
import { playbookFiles } from "./render-playbook";

/** Provider-neutral home for generated hook implementations and their tests. */
export const hooksDirectory = ".farrier/hooks";

export type ExecutableProvenance = {
  registryRef: string;
  version: string;
  sourceIdentity: string | null;
  itemSha256: string;
  contentSha256: string;
};

export type RenderedFile = {
  path: string;
  content: string;
  mode?: number;
  executableProvenance?: ExecutableProvenance;
};

export type RenderPlan = {
  targetDir: string;
  files: RenderedFile[];
  reviewedDigest?: string;
  /** Rule evaluation behind the generated policy, for evidence previews. */
  rules?: EvaluatedPackRules;
  /** Toolchain evidence behind the generated verbs, for previews and warnings. */
  toolchain?: ToolchainResolution;
};

function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

export function renderPlanDigest(files: readonly RenderedFile[]): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const file of files) {
    hasher.update(JSON.stringify([file.path, file.mode ?? null, file.content]));
    hasher.update("\n");
  }
  return hasher.digest("hex");
}

export interface NativeGenerator {
  maybeGenerate(input: { targetDir: string; pack: ResolvedPack }): Promise<void>;
}

export type RenderOptions = {
  targetDir: string;
  pack: ResolvedPack;
  dryRun?: boolean;
  generator?: NativeGenerator;
  skills?: SkillRef[];
  learnEnabled?: boolean;
  advisors?: boolean;
  secondaryAcknowledged?: string[];
  existingManifest?: FarrierManifestInput;
  registryPins?: Record<string, RegistryPin>;
  agents?: EnforcementAgent[];
};

export type CreateRenderPlanOptions = {
  targetDir: string;
  pack: ResolvedPack;
  skills?: SkillRef[];
  learnEnabled?: boolean;
  advisors?: boolean;
  secondaryAcknowledged?: string[];
  existingManifest?: FarrierManifestInput;
  registryPins?: Record<string, RegistryPin>;
  agents?: EnforcementAgent[];
  /**
   * Precomputed repository-map section for AGENTS.md. Omit to generate from
   * the target repository; pass null to skip generation (callers that never
   * compare AGENTS.md content, such as doctor).
   */
  repoMapSection?: string | null;
};

export type FarrierManifestVersions = {
  farrierManifest: number;
  hooks: Record<string, number>;
  prompts?: {
    qualityJudge: string;
    stopJudge: string;
  };
};

export type FarrierManifest = {
  farrierVersion: string;
  agents: EnforcementAgent[];
  packIds: string[];
  hookIds: PackHookRef[];
  skills: SkillRef[];
  advisors: boolean;
  secondaryAcknowledged: string[];
  learn: {
    enabled: boolean;
  };
  judge?: Record<string, unknown>;
  guards?: Record<string, unknown>;
  quality: Record<string, unknown>;
  versions: FarrierManifestVersions;
  registry?: {
    items: Record<string, RegistryPin>;
  };
};

export type FarrierManifestInput = Partial<Omit<FarrierManifest, "judge" | "guards" | "quality" | "versions">> & {
  judge?: unknown;
  guards?: unknown;
  quality?: unknown;
  versions?: unknown;
};

type ClaudeHookEvent = "PreToolUse" | "PostToolUse" | "Stop";

type ClaudeCommandHook = {
  type: "command";
  command: string;
};

type ClaudeHookEntry = {
  matcher?: string;
  hooks: ClaudeCommandHook[];
};

type ClaudeSettingsHooks = Partial<Record<ClaudeHookEvent, ClaudeHookEntry[]>>;

export const farrierManifestVersion = 3;

export const hookCatalogVersions: Record<HookId, number> = {
    "secret-shield": 7,
    "tool-policy": 4,
    "write-guard": 4,
    "verb-runner": 7,
    "quality-judge": 7,
    "stop-judge": 6,
    "large-file-commit-guard": 3,
    "process-teardown-audit": 2
};

export const hookTemplateFiles: Record<HookId, string[]> = {
  "secret-shield": ["secret-shield.py", "test_secret_shield.py", "test_hook_contract.py"],
  "tool-policy": ["tool-policy.py", "test_tool_policy.py"],
  "write-guard": ["write-guard.py", "test_write_guard.py"],
  "verb-runner": ["verb-runner.py", "test_verb_runner.py"],
  "quality-judge": ["quality-judge.py", "test_quality_judge.py"],
  "stop-judge": ["stop-judge.py", "test_stop_judge.py"],
  "large-file-commit-guard": ["large-file-commit-guard.py", "test_large_file_commit_guard.py"],
  "process-teardown-audit": ["process-teardown-audit.py", "test_process_teardown_audit.py"]
};

/** Hooks parameterized by the user-owned `guards` record in .farrier.json. */
export const guardHookIds: readonly HookId[] = ["large-file-commit-guard", "process-teardown-audit"];

export function hasGuardHooks(hookIds: readonly PackHookRef[]): boolean {
  return guardHookIds.some((hookId) => hookIds.includes(hookId));
}

function isBuiltinHookId(value: PackHookRef): value is HookId {
  return value in hookTemplateFiles;
}

// .farrier-staging/ holds failed skill-authoring runs kept for inspection;
// .farrier/runtime/ holds hook event logs and verification state; the hooks
// write __pycache__ bytecode when they run (2026-07-22 eval: litter showed up
// as untracked files on repos whose .gitignore lacks __pycache__). None of it
// should be committed.
const requiredGitignoreLines = [".env", ".env.*", "!.env.example", ".farrier-staging/", ".farrier/runtime/", ".farrier/hooks/__pycache__/"];

function posixPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function snakeCasePackageName(targetDir: string): string {
  const raw = basename(targetDir) || "app";
  const snake = raw
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  const safe = snake.length > 0 ? snake : "app";
  return /^[0-9]/.test(safe) ? `app_${safe}` : safe;
}

function replacePlaceholders(value: unknown, replacements: Record<string, string>): unknown {
  if (typeof value === "string") {
    return Object.entries(replacements).reduce(
      (text, [key, replacement]) => text.replaceAll(`{${key}}`, replacement),
      value
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, replacements));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, replacements)])
    );
  }

  return value;
}

function renderKonsistent(template: KonsistentTemplate, targetDir: string): string {
  const pkg = snakeCasePackageName(targetDir);
  const rendered = replacePlaceholders(template, { pkg });
  return `${JSON.stringify(rendered, null, 2)}\n`;
}

/**
 * The structure-linting tool a pack scaffolds. Python packs use "konpy"; TS
 * packs use the npm "konsistent" package. Drives the config filename, justfile
 * recipe name, and AGENTS.md label so the generated harness speaks one name.
 */
function konsistentToolName(pack: ResolvedPack): string {
  return pack.konsistentTool ?? "konsistent";
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function bulletList(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

/**
 * The AGENTS.md "Hard Rules" list. Exported so the wizard can honestly count
 * the rules it is about to write ("N rules") without duplicating the list.
 * `packRules` are the evidence-evaluated pack rules; when omitted (previews
 * that have not scanned the repository yet), all pack rules are counted.
 */
export function agentsHardRules(
  pack: ResolvedPack,
  agents: readonly EnforcementAgent[] = ["claude"],
  packRules?: readonly string[]
): string[] {
  const selectedAgents = normalizeAgents(agents);
  const hookNames = selectedAgents.map((agent) => agent === "claude" ? "Claude" : "Codex").join(" or ");
  const rules = packRules ?? [
    ...pack.agentsRules,
    ...pack.ruleBlocks.flatMap((block) => block.agentsRules ?? [])
  ];
  const stopChecks = pack.verbs.konsistent
    ? `\`just check-full\` and \`just ${konsistentToolName(pack)}\``
    : "`just check-full`";
  return [
    "Do not read real `.env*` files or private key material; tracked examples such as `.env.example` are allowed.",
    ...rules,
    "Do not directly edit protected generated/owned files: lockfiles, `.git/`, `skills-lock.json`, or `.farrier.json`.",
    `Verification is automatic: hooks run \`just check-fast\` after each code edit and ${stopChecks} when you stop. Run these manually only to debug a failure the hooks reported.`,
    "If the Stop check fails for reasons that predate your changes, name each pre-existing failing test explicitly in your final summary and stop again; do not re-run the full check yourself — an identical known failure does not re-block.",
    "Keep files under `quality.maxFileLines` from `.farrier.json` unless there is a deliberate architectural reason.",
    "Follow the project quality preferences in `quality.rules` of `.farrier.json`; reuse existing helpers and types before writing new ones.",
    "Keep generated hook scripts and their tests together.",
    `Do not bypass ${hookNames} hooks; every agent must also follow these rules from AGENTS.md and the justfile.`
  ];
}

function renderAgentsMd(pack: ResolvedPack, agents: readonly EnforcementAgent[], packRules: readonly string[]): string {
  const commandLines = [
    "- Fast check (after edits): `just check-fast [test files...]`",
    `- Full check (before finishing): \`just check-full\` (${pack.verbs.check})`,
    `- Test: \`${pack.verbs.test}\``,
    `- Format: \`${pack.verbs.fmt}\``
  ];

  if (pack.verbs.konsistent) {
    commandLines.push(`- ${capitalize(konsistentToolName(pack))}: \`${pack.verbs.konsistent}\``);
  }

  const selectedAgents = normalizeAgents(agents);
  const capability = packCapabilityProjection(pack);
  const hardRules = agentsHardRules(pack, selectedAgents, packRules);
  const targetLines = [
    `- Selected enforcement targets: ${selectedAgents.join(", ")}.`,
    ...(selectedAgents.includes("claude")
      ? ["- Claude reads the native `.claude/settings.json` binding."]
      : []),
    ...(selectedAgents.includes("codex")
      ? [
          "- Codex reads the native `.codex/hooks.json` binding; project and hook definitions require trust, and `/hooks` shows runtime status.",
          "- Codex enforcement covers mapped simple Bash calls, mapped `apply_patch` edits, and Stop checks.",
          "- Codex `unified_exec` interception remains incomplete; native reads, search, WebSearch, and other non-shell/non-MCP paths are not all intercepted.",
          "- Codex PostToolUse feedback cannot undo an applied patch or another completed effect.",
          "- Remote hooks without explicit Codex event and payload compatibility remain unbound.",
          "- AGENTS.md instructions and project verification commands remain mandatory regardless of hook coverage."
        ]
      : []),
    ...capability.limitations.map((limitation) => `- ${limitation}`)
  ];

  const acceptedRisks = pack.packIds.includes("python-uv") && pack.verbs.konsistent
    ? [
        `Python ${konsistentToolName(pack)} currently uses a local path dependency:`,
        `  \`${PYTHON_KONSISTENT_PATH}\``,
        "Upgrade path: git dependency, then PyPI package.",
        "Until that upgrade, generated Python projects are portable only on machines with that path."
      ]
    : [];

  const acceptedRisksSection =
    acceptedRisks.length > 0
      ? `\n## Accepted Risks\n\n${bulletList(acceptedRisks)}\n`
      : "";

  return `# Project Agent Instructions

AGENTS.md is the source of truth for agent behavior in this repository.

## Commands

${commandLines.join("\n")}

## Enforcement Targets

${targetLines.join("\n")}

## Hard Rules

${bulletList(hardRules)}
${acceptedRisksSection}`;
}

export function renderClaudeMd(): string {
  // `@AGENTS.md` is Claude Code's documented import syntax -- it loads AGENTS.md's
  // full content into context every session, the same way Codex reads AGENTS.md
  // directly. A plain pointer sentence here would only be advisory: Claude would
  // have to decide to go read the file, not load it automatically.
  return "<!-- Source of truth is AGENTS.md; this import keeps Claude Code and Codex reading the same instructions. -->\n@AGENTS.md\n";
}

function commandHook(command: string): ClaudeCommandHook {
  return {
    type: "command",
    command
  };
}

function hookEntry(input: { matcher?: string; command: string }): ClaudeHookEntry {
  return {
    ...(input.matcher ? { matcher: input.matcher } : {}),
    hooks: [commandHook(input.command)]
  };
}

export function renderClaudeSettingsJson(pack: ResolvedPack): string {
  const preToolUse: ClaudeHookEntry[] = [];
  const postToolUse: ClaudeHookEntry[] = [];
  const stop: ClaudeHookEntry[] = [];

  for (const hookId of pack.hooks.filter(isBuiltinHookId)) {
    for (const binding of hookCapabilities[hookId].agents.claude ?? []) {
      const target = binding.event === "PreToolUse" ? preToolUse : binding.event === "PostToolUse" ? postToolUse : stop;
      target.push(hookEntry({
        matcher: binding.matcher,
        command: `python3 "$CLAUDE_PROJECT_DIR/${hooksDirectory}/${binding.fileName}"`
      }));
    }
  }

  for (const remoteHook of pack.remoteHooks) {
    const entryPath = posixPath(join(hooksDirectory, remoteHook.id, remoteHook.entry));
    const command = `${remoteHook.runner} "$CLAUDE_PROJECT_DIR/${entryPath}"`;

    for (const event of remoteHook.events) {
      const target = event.event === "PreToolUse" ? preToolUse : event.event === "PostToolUse" ? postToolUse : stop;
      target.push(
        hookEntry({
          matcher: event.matcher,
          command
        })
      );
    }
  }

  const hooks: ClaudeSettingsHooks = {};

  if (preToolUse.length > 0) {
    hooks.PreToolUse = preToolUse;
  }

  if (postToolUse.length > 0) {
    hooks.PostToolUse = postToolUse;
  }

  if (stop.length > 0) {
    hooks.Stop = stop;
  }

  const settings = { hooks };

  return `${JSON.stringify(settings, null, 2)}\n`;
}

function codexCommand(fileName: string): string {
  return `python3 "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/${hooksDirectory}/${fileName}"`;
}

export function renderCodexHooksJson(pack: ResolvedPack): string {
  const preToolUse: ClaudeHookEntry[] = [];
  const postToolUse: ClaudeHookEntry[] = [];
  const stop: ClaudeHookEntry[] = [];

  const add = (entries: ClaudeHookEntry[], matcher: string | undefined, fileName: string): void => {
    entries.push(hookEntry({ matcher, command: codexCommand(fileName) }));
  };

  for (const hookId of pack.hooks.filter(isBuiltinHookId)) {
    for (const binding of hookCapabilities[hookId].agents.codex ?? []) {
      const target = binding.event === "PreToolUse" ? preToolUse : binding.event === "PostToolUse" ? postToolUse : stop;
      add(target, binding.matcher, binding.fileName);
    }
  }

  const hooks: ClaudeSettingsHooks = {};
  if (preToolUse.length > 0) hooks.PreToolUse = preToolUse;
  if (postToolUse.length > 0) hooks.PostToolUse = postToolUse;
  if (stop.length > 0) hooks.Stop = stop;
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}

export function renderJustfile(pack: ResolvedPack): string {
  // Hook self-tests are deliberately NOT part of the project gate; they are
  // farrier's own tests and run under `farrier doctor`.
  const recipes = [
    `check-fast *tests:
  ${pack.verbs.checkFast}
  [ -z "{{tests}}" ] || ${pack.verbs.test} {{tests}}`,
    `check-full:
  ${pack.verbs.check}`,
    `check: check-full`,
    `test:
  ${pack.verbs.test}`,
    `fmt:
  ${pack.verbs.fmt}`
  ];

  if (pack.verbs.konsistent) {
    const comment = pack.packIds.includes("python-uv")
      ? "  # Temporary local path dependency; upgrade path: git dependency, then PyPI.\n"
      : "";

    recipes.push(`${konsistentToolName(pack)}:
${comment}  ${pack.verbs.konsistent}`);
  }

  return `${recipes.join("\n\n")}\n`;
}

function defaultJudgeConfig(): Record<string, unknown> {
  return {
    perEdit: {
      enabled: false,
      backend: "claude",
      model: "haiku",
      timeoutMs: 30000,
      includeRepoMap: true,
      prompt: `${hooksDirectory}/prompts/quality-judge-v1.txt`
    },
    stop: {
      enabled: false,
      backend: "claude",
      model: "sonnet",
      timeoutMs: 90000,
      includeRepoMap: true,
      prompt: `${hooksDirectory}/prompts/stop-judge-v1.txt`,
      maxDiffBytes: 120000,
      maxUntrackedFiles: 50
    }
  };
}

// Guard parameters are project preferences like `quality`: seeded once per
// selected guard hook, then owned by the user (updates never overwrite the
// guards record). processTeardown ships with no patterns — inert until
// evidence (farrier learn) or the user supplies them.
function defaultGuardsConfig(hookIds: readonly PackHookRef[]): Record<string, unknown> {
  return {
    ...(hookIds.includes("large-file-commit-guard")
      ? { largeFileCommit: { maxBytes: 5 * 1024 * 1024 } }
      : {}),
    ...(hookIds.includes("process-teardown-audit")
      ? { processTeardown: { patterns: [] } }
      : {})
  };
}

// Every entry here is a project preference, not a farrier rule: seeded once at
// generate time, then owned by the user (updates never overwrite the quality
// record). maxFileLines: null disables the length check.
function defaultQualityConfig(): Record<string, unknown> {
  return {
    maxFileLines: 500,
    rules: [
      "Reuse existing helpers, types, and utilities instead of recreating them; when a module in this repository or an installed dependency already provides one, import it.",
      "Do not introduce security risks: no secrets or credentials in source, no shell or SQL built from unsanitized input, no disabled certificate or auth checks."
    ]
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  if (!value.every((item) => typeof item === "string")) {
    return undefined;
  }

  return [...value];
}

function manifestRecord(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  return isPlainRecord(value) ? value : fallback;
}

export async function getFarrierVersion(): Promise<string> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = join(currentDir, "..", "..", "package.json");
  const text = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(text) as { version?: unknown };

  if (typeof parsed.version !== "string" || parsed.version.trim().length === 0) {
    throw new Error("package.json is missing a valid version");
  }

  return parsed.version;
}

export function hasJudgeHooks(hookIds: readonly PackHookRef[]): boolean {
  return hookIds.includes("quality-judge") || hookIds.includes("stop-judge");
}

async function renderManifest(
  pack: ResolvedPack,
  options: {
    skills: SkillRef[];
    learnEnabled: boolean;
    advisors: boolean;
    secondaryAcknowledged: string[];
    existingManifest?: FarrierManifestInput;
    registryPins?: Record<string, RegistryPin>;
    agents: EnforcementAgent[];
  }
): Promise<string> {
  const remoteHookVersions = Object.fromEntries(
    pack.remoteHooks.map((hook) => [hook.id, hook.hookVersion])
  );
  const registryPins = options.registryPins ?? {};
  const judgeSelected = hasJudgeHooks(pack.hooks);
  const guardsSelected = hasGuardHooks(pack.hooks);
  const manifest: FarrierManifest = {
    farrierVersion: await getFarrierVersion(),
    agents: [...options.agents],
    packIds: [...pack.packIds],
    hookIds: [...pack.hooks],
    skills: [...options.skills],
    advisors: options.advisors,
    secondaryAcknowledged: [...options.secondaryAcknowledged],
    learn: {
      enabled: options.learnEnabled
    },
    ...(judgeSelected
      ? { judge: manifestRecord(options.existingManifest?.judge, defaultJudgeConfig()) }
      : {}),
    ...(guardsSelected
      ? { guards: manifestRecord(options.existingManifest?.guards, defaultGuardsConfig(pack.hooks)) }
      : {}),
    quality: manifestRecord(options.existingManifest?.quality, defaultQualityConfig()),
    versions: {
      farrierManifest: farrierManifestVersion,
      hooks: {
        ...Object.fromEntries(pack.hooks.filter(isBuiltinHookId).map((hook) => [hook, hookCatalogVersions[hook]])),
        ...remoteHookVersions
      },
      ...(judgeSelected
        ? {
            prompts: {
              qualityJudge: "v2",
              stopJudge: "v2"
            }
          }
        : {})
    }
  };

  if (Object.keys(registryPins).length > 0) {
    manifest.registry = {
      items: registryPins
    };
  }

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function renderToolPolicyRulesJson(toolPolicyRules: readonly ToolPolicyRule[]): string {
  const rules = {
    version: 1,
    rules: toolPolicyRules
  };

  return `${JSON.stringify(rules, null, 2)}\n`;
}

async function renderGitignore(targetDir: string): Promise<string> {
  const path = join(targetDir, ".gitignore");

  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch {
    existing = "";
  }

  const lines = existing.split(/\r?\n/);
  const present = new Set(lines.map((line) => line.trim()));
  const missing = requiredGitignoreLines.filter((line) => !present.has(line));

  if (existing.length === 0) {
    return `# farrier: local secrets
${requiredGitignoreLines.join("\n")}
`;
  }

  if (missing.length === 0) {
    return existing.endsWith("\n") ? existing : `${existing}\n`;
  }

  const separator = existing.endsWith("\n") ? "" : "\n";
  return `${existing}${separator}
# farrier: local secrets
${missing.join("\n")}
`;
}

async function readTemplate(...segments: string[]): Promise<string> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const templatePath = join(currentDir, "..", "templates", ...segments);
  return readFile(templatePath, "utf8");
}

async function readHookTemplate(fileName: string): Promise<string> {
  return readTemplate("hooks", fileName);
}

const claudeAutomationReferenceFiles = [
  "UPSTREAM.md",
  "upstream/SKILL.md",
  "upstream/LICENSE.txt",
  "upstream/references/hooks-patterns.md",
  "upstream/references/mcp-servers.md",
  "upstream/references/plugins-reference.md",
  "upstream/references/skills-reference.md",
  "upstream/references/subagent-templates.md"
];

const codexAutomationReferenceFiles = [
  "references/skills-reference.md",
  "references/plugins-reference.md",
  "references/hooks-patterns.md",
  "references/mcp-servers.md",
  "references/subagent-templates.md"
];

/**
 * The opt-in advisor skill trees for one agent. Exported so update can
 * content-match stale advisor files before pruning them.
 */
export async function advisorSkillFiles(agent: EnforcementAgent): Promise<RenderedFile[]> {
  if (agent === "claude") {
    const files: RenderedFile[] = [
      {
        path: ".claude/skills/harness-advisor/SKILL.md",
        content: await readTemplate("skills", "harness-advisor", "SKILL.md")
      },
      {
        path: ".claude/skills/harness-advisor/evals/cases.json",
        content: await readTemplate("skills", "harness-advisor", "evals", "cases.json")
      },
      {
        path: ".claude/skills/claude-automation-recommender/SKILL.md",
        content: await readTemplate("skills", "claude-automation-recommender", "SKILL.md")
      },
      {
        path: ".claude/skills/claude-automation-recommender/evals/cases.json",
        content: await readTemplate("skills", "claude-automation-recommender", "evals", "cases.json")
      }
    ];

    for (const relativePath of claudeAutomationReferenceFiles) {
      files.push({
        path: posixPath(join(".claude", "skills", "claude-automation-recommender", relativePath)),
        content: await readTemplate("skills", "claude-automation-recommender", relativePath)
      });
    }

    return files;
  }

  const files: RenderedFile[] = [
    {
      path: ".agents/skills/farrier-project-advisor/SKILL.md",
      content: await readTemplate("skills", "farrier-project-advisor", "SKILL.md")
    },
    {
      path: ".agents/skills/farrier-project-advisor/evals/cases.json",
      content: await readTemplate("skills", "farrier-project-advisor", "evals", "cases.json")
    },
    {
      path: ".agents/skills/codex-automation-recommender/SKILL.md",
      content: await readTemplate("skills", "codex-automation-recommender", "SKILL.md")
    },
    {
      path: ".agents/skills/codex-automation-recommender/evals/cases.json",
      content: await readTemplate("skills", "codex-automation-recommender", "evals", "cases.json")
    }
  ];

  for (const relativePath of codexAutomationReferenceFiles) {
    files.push({
      path: posixPath(join(".agents", "skills", "codex-automation-recommender", relativePath)),
      content: await readTemplate("skills", "codex-automation-recommender", relativePath)
    });
  }

  return files;
}

export async function createRenderPlan(options: CreateRenderPlanOptions): Promise<RenderPlan> {
  const agents = normalizeAgents(options.agents ?? options.existingManifest?.agents);
  const existingSkills = stringArray(options.existingManifest?.skills);
  const selectedSkills = options.skills ?? existingSkills ?? options.pack.skills;
  const existingLearnEnabled =
    typeof options.existingManifest?.learn?.enabled === "boolean"
      ? options.existingManifest.learn.enabled
      : undefined;
  const learnEnabled = options.learnEnabled ?? existingLearnEnabled ?? false;
  const existingAdvisors =
    typeof options.existingManifest?.advisors === "boolean" ? options.existingManifest.advisors : undefined;
  const advisors = options.advisors ?? existingAdvisors ?? false;
  const existingSecondaryAcknowledged = stringArray(options.existingManifest?.secondaryAcknowledged);
  const secondaryAcknowledged = options.secondaryAcknowledged ?? existingSecondaryAcknowledged ?? [];
  const [rules, toolchain, repoMapSection] = await Promise.all([
    evaluatePackRules(options.targetDir, options.pack),
    resolveToolchain(options.targetDir, options.pack),
    options.repoMapSection !== undefined
      ? Promise.resolve(options.repoMapSection)
      : generateRepoMapSection(options.targetDir)
  ]);
  // Verbs follow repository evidence (lockfile, test runner) so generated
  // commands run with the project's own toolchain; without evidence the
  // pack's defaults stand.
  const pack: ResolvedPack = { ...options.pack, verbs: toolchain.verbs };

  const files: RenderedFile[] = [
    {
      path: "AGENTS.md",
      content: spliceRepoMapSection(renderAgentsMd(pack, agents, rules.agentsRules), repoMapSection)
    }
  ];

  if (agents.includes("claude")) {
    files.push(
      {
        path: "CLAUDE.md",
        content: renderClaudeMd()
      },
      {
        path: ".claude/settings.json",
        content: renderClaudeSettingsJson(pack)
      }
    );
  }

  if (agents.includes("codex")) {
    files.push({
      path: ".codex/hooks.json",
      content: renderCodexHooksJson(pack)
    });
  }

  if (advisors) {
    for (const agent of agents) {
      files.push(...(await advisorSkillFiles(agent)));
    }
  }

  // Playbook bundles and review subagents render inline from pack content
  // (unlike pack.skills, which are registry refs installed separately).
  if (pack.playbook || pack.subagents.length > 0) {
    files.push(...(await playbookFiles({ playbook: pack.playbook, subagents: pack.subagents, agents })));
  }

  // Every builtin hook imports the shared runtime (bounded subprocess/file
  // helpers and the JSONL event log). conftest.py keeps the self-tests
  // importable when the host project's pytest config (e.g.
  // --import-mode=importlib) would keep the hooks directory off sys.path.
  if (pack.hooks.some(isBuiltinHookId)) {
    for (const fileName of ["_hook_runtime.py", "conftest.py"]) {
      files.push({
        path: posixPath(join(hooksDirectory, fileName)),
        content: await readHookTemplate(fileName)
      });
    }
  }

  for (const hookId of pack.hooks.filter(isBuiltinHookId)) {
    for (const fileName of hookTemplateFiles[hookId]) {
      files.push({
        path: posixPath(join(hooksDirectory, fileName)),
        content: await readHookTemplate(fileName),
        mode: fileName.endsWith(".py") && !fileName.startsWith("test_") ? 0o755 : undefined
      });
    }
  }

  for (const remoteHook of pack.remoteHooks) {
    for (const file of remoteHook.files) {
      files.push({
        path: posixPath(join(hooksDirectory, remoteHook.id, file.path)),
        content: file.content,
        mode: file.executable === true || file.path === remoteHook.entry ? 0o755 : undefined,
        executableProvenance: {
          registryRef: remoteHook.registryRef ?? remoteHook.id,
          version: remoteHook.version,
          sourceIdentity: remoteHook.sourceIdentity ?? null,
          itemSha256: remoteHook.sha256,
          contentSha256: sha256(file.content)
        }
      });
    }
  }

  if (pack.hooks.includes("tool-policy")) {
    files.push({
      path: posixPath(join(hooksDirectory, "tool-policy-rules.json")),
      content: renderToolPolicyRulesJson(rules.toolPolicyRules)
    });
  }

  if (pack.hooks.includes("quality-judge")) {
    files.push({
      path: posixPath(join(hooksDirectory, "prompts", "quality-judge-v1.txt")),
      content: await readHookTemplate("prompts/quality-judge-v1.txt")
    });
  }

  if (pack.hooks.includes("stop-judge")) {
    files.push({
      path: posixPath(join(hooksDirectory, "prompts", "stop-judge-v1.txt")),
      content: await readHookTemplate("prompts/stop-judge-v1.txt")
    });
  }

  files.push({
    path: "justfile",
    content: renderJustfile(pack)
  });

  if (pack.konsistentTemplate) {
    files.push({
      path: `${konsistentToolName(pack)}.json`,
      content: renderKonsistent(pack.konsistentTemplate, options.targetDir)
    });
  }

  files.push(
    {
      path: ".farrier.json",
      content: await renderManifest(pack, {
        skills: selectedSkills,
        learnEnabled,
        advisors,
        secondaryAcknowledged,
        existingManifest: options.existingManifest,
        registryPins: options.registryPins,
        agents
      })
    },
    {
      path: ".gitignore",
      content: await renderGitignore(options.targetDir)
    }
  );

  return {
    targetDir: options.targetDir,
    files,
    reviewedDigest: renderPlanDigest(files),
    rules,
    toolchain
  };
}

export async function writeRenderPlan(plan: RenderPlan): Promise<void> {
  if (plan.reviewedDigest && renderPlanDigest(plan.files) !== plan.reviewedDigest) {
    throw new Error("Refusing to write: rendered bytes changed after review; rerun preview and review the new executable payload");
  }
  for (const file of plan.files) {
    const absolutePath = join(plan.targetDir, file.path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.content, "utf8");

    if (file.mode !== undefined) {
      await chmod(absolutePath, file.mode);
    }
  }
}

export async function renderHarness(options: RenderOptions): Promise<RenderPlan> {
  if (!options.dryRun) {
    await options.generator?.maybeGenerate({
      targetDir: options.targetDir,
      pack: options.pack
    });
  }

  const plan = await createRenderPlan({
    targetDir: options.targetDir,
    pack: options.pack,
    skills: options.skills,
    learnEnabled: options.learnEnabled,
    advisors: options.advisors,
    secondaryAcknowledged: options.secondaryAcknowledged,
    existingManifest: options.existingManifest,
    registryPins: options.registryPins,
    agents: options.agents
  });

  if (!options.dryRun) {
    await writeRenderPlan(plan);
  }

  return plan;
}
