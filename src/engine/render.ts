import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { CapabilityHookEvent, HookId, PackHookRef, ResolvedPack, ResolvedVerbs, SkillRef, ToolPolicyRule } from "../packs/types";
import { hookCapabilities, packCapabilityProjection } from "../packs/index";
import type { RegistryPin } from "../registry/catalog";
import { normalizeAgents, type EnforcementAgent } from "./agent-selection";
import { evaluatePackRules, type EvaluatedPackRules } from "./detect";
import { resolveToolchain, type ToolchainResolution } from "./toolchain";
import { hasGate, resolveVerbs, type VerbResolution } from "./verbs";
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
  /** Per-verb evidence verdicts: which recipes rendered, and which were omitted and why. */
  verbs?: VerbResolution;
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

type ClaudeHookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop";

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
    "process-teardown-audit": 2,
    "taste-guard": 1,
    "taste-context": 1
};

export const hookTemplateFiles: Record<HookId, string[]> = {
  "secret-shield": ["secret-shield.py", "test_secret_shield.py", "test_hook_contract.py"],
  "tool-policy": ["tool-policy.py", "test_tool_policy.py"],
  "write-guard": ["write-guard.py", "test_write_guard.py"],
  "verb-runner": ["verb-runner.py", "test_verb_runner.py"],
  "quality-judge": ["quality-judge.py", "test_quality_judge.py"],
  "stop-judge": ["stop-judge.py", "test_stop_judge.py"],
  "large-file-commit-guard": ["large-file-commit-guard.py", "test_large_file_commit_guard.py"],
  "process-teardown-audit": ["process-teardown-audit.py", "test_process_teardown_audit.py"],
  "taste-guard": ["taste-guard.py", "test_taste_guard.py"],
  "taste-context": ["taste-context.py", "test_taste_context.py"]
};

/** Hooks parameterized by the user-owned `guards` record in .farrier.json. */
export const guardHookIds: readonly HookId[] = ["large-file-commit-guard", "process-teardown-audit", "taste-guard"];

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
  packRules?: readonly string[],
  verbs?: ResolvedVerbs
): string[] {
  const selectedAgents = normalizeAgents(agents);
  const hookNames = selectedAgents.map((agent) => agent === "claude" ? "Claude" : "Codex").join(" or ");
  const rules = packRules ?? [
    ...pack.agentsRules,
    ...pack.ruleBlocks.flatMap((block) => block.agentsRules ?? [])
  ];
  return [
    "Do not read real `.env*` files or private key material; tracked examples such as `.env.example` are allowed.",
    ...rules,
    "Do not directly edit protected generated/owned files: lockfiles, `.git/`, `skills-lock.json`, or `.farrier.json`.",
    // Both rules describe the verb-runner binding. With no gate that hook is
    // never installed, so promising automatic verification would be a lie the
    // agent acts on.
    ...(verbs === undefined || verbs.check !== undefined || verbs.checkFast !== undefined
      ? [
          "Verification is automatic: hooks run `just check-fast` after each code edit and `just check-full` when you stop. Run these manually only to debug a failure the hooks reported.",
          "If the Stop check fails for reasons that predate your changes, name each pre-existing failing test explicitly in your final summary and stop again; do not re-run the full check yourself — an identical known failure does not re-block."
        ]
      : ["This repository has no generated verification gate yet: no linter, test runner, or formatter evidence was found. Verify your changes the way the project already does, and say what you ran."]),
    "Keep files under `quality.maxFileLines` from `.farrier.json` unless there is a deliberate architectural reason.",
    "Follow the project quality preferences in `quality.rules` of `.farrier.json`; reuse existing helpers and types before writing new ones.",
    "Keep generated hook scripts and their tests together.",
    `Do not bypass ${hookNames} hooks; every agent must also follow these rules from AGENTS.md and the justfile.`
  ];
}

function renderAgentsMd(
  pack: ResolvedPack,
  verbs: ResolvedVerbs,
  agents: readonly EnforcementAgent[],
  packRules: readonly string[]
): string {
  // Only commands the repository can actually run are listed. A project with
  // no evidence for any tool gets a Commands section that says so rather than
  // four recipes that do not exist.
  const commandLines = [
    ...(verbs.checkFast !== undefined || verbs.test !== undefined
      ? ["- Fast check (after edits): `just check-fast [test files...]`"]
      : []),
    ...(verbs.check !== undefined
      ? [`- Full check (before finishing): \`just check-full\` (${verbs.check})`]
      : []),
    ...(verbs.test !== undefined ? [`- Test: \`${verbs.test}\``] : []),
    ...(verbs.fmt !== undefined ? [`- Format: \`${verbs.fmt}\``] : [])
  ];

  if (commandLines.length === 0) {
    commandLines.push(
      "- No verification commands are generated yet: this repository shows no evidence of a linter, test runner, or formatter. Add one and run `farrier update --yes`."
    );
  }

  const selectedAgents = normalizeAgents(agents);
  const capability = packCapabilityProjection(pack);
  const hardRules = agentsHardRules(pack, selectedAgents, packRules, verbs);
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

  return `# Project Agent Instructions

AGENTS.md is the source of truth for agent behavior in this repository.

## Commands

${commandLines.join("\n")}

## Enforcement Targets

${targetLines.join("\n")}

## Hard Rules

${bulletList(hardRules)}
`;
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
  const userPromptSubmit: ClaudeHookEntry[] = [];
  const stop: ClaudeHookEntry[] = [];
  const eventTarget = (event: CapabilityHookEvent): ClaudeHookEntry[] =>
    event === "PreToolUse" ? preToolUse : event === "PostToolUse" ? postToolUse : event === "UserPromptSubmit" ? userPromptSubmit : stop;

  for (const hookId of pack.hooks.filter(isBuiltinHookId)) {
    for (const binding of hookCapabilities[hookId].agents.claude ?? []) {
      eventTarget(binding.event).push(hookEntry({
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

  if (userPromptSubmit.length > 0) {
    hooks.UserPromptSubmit = userPromptSubmit;
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

/**
 * Narrow a builtin hook binding's event to the three Codex supports, failing
 * loud on anything else (e.g. UserPromptSubmit, which is Claude-only today).
 * Greenfield: a future Codex binding on an unsupported event must throw here,
 * not silently file under Stop.
 */
export function codexHookEvent(event: CapabilityHookEvent, hookId: string): "PreToolUse" | "PostToolUse" | "Stop" {
  if (event === "PreToolUse" || event === "PostToolUse" || event === "Stop") return event;
  throw new Error(`Codex hook binding for "${hookId}" uses unsupported event "${event}"; Codex hooks support PreToolUse, PostToolUse, and Stop only.`);
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
      const event = codexHookEvent(binding.event, hookId);
      const target = event === "PreToolUse" ? preToolUse : event === "PostToolUse" ? postToolUse : stop;
      add(target, binding.matcher, binding.fileName);
    }
  }

  const hooks: ClaudeSettingsHooks = {};
  if (preToolUse.length > 0) hooks.PreToolUse = preToolUse;
  if (postToolUse.length > 0) hooks.PostToolUse = postToolUse;
  if (stop.length > 0) hooks.Stop = stop;
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}

export function renderJustfile(verbs: ResolvedVerbs): string {
  // Hook self-tests are deliberately NOT part of the project gate; they are
  // farrier's own tests and run under `farrier doctor`. Each recipe appears
  // only when the repository proved the tool behind it.
  const fastLines = [
    ...(verbs.checkFast !== undefined ? [`  ${verbs.checkFast}`] : []),
    ...(verbs.test !== undefined ? [`  [ -z "{{tests}}" ] || ${verbs.test} {{tests}}`] : [])
  ];
  const recipes = [
    ...(fastLines.length > 0 ? [`check-fast *tests:\n${fastLines.join("\n")}`] : []),
    ...(verbs.check !== undefined ? [`check-full:\n  ${verbs.check}`] : []),
    ...(verbs.check !== undefined ? ["check: check-full"] : []),
    ...(verbs.test !== undefined ? [`test:\n  ${verbs.test}`] : []),
    ...(verbs.fmt !== undefined ? [`fmt:\n  ${verbs.fmt}`] : [])
  ];

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
      : {}),
    ...(hookIds.includes("taste-guard")
      ? { tasteGuard: { rules: [] } }
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
  // Verbs follow repository evidence twice over: the toolchain resolution
  // picks the package manager and test runner from lockfiles, then each verb
  // is gated on proof that its tool exists at all. A verb with no evidence is
  // dropped, because a gate naming an absent tool can never pass.
  const verbResolution = await resolveVerbs(options.targetDir, toolchain.verbs);
  const verbs = verbResolution.verbs;
  // With no gate there is nothing for verb-runner to run, so it is not bound
  // at all rather than bound to recipes that do not exist. It comes back on
  // the next update once the repository grows a linter or a test runner.
  const pack: ResolvedPack = {
    ...options.pack,
    verbs: toolchain.verbs,
    hooks: hasGate(verbs) ? options.pack.hooks : options.pack.hooks.filter((hook) => hook !== "verb-runner")
  };

  const files: RenderedFile[] = [
    {
      path: "AGENTS.md",
      content: spliceRepoMapSection(renderAgentsMd(pack, verbs, agents, rules.agentsRules), repoMapSection)
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

  // A justfile with no recipes is worse than no justfile: it looks like a
  // configured project whose verbs someone deleted.
  const justfile = renderJustfile(verbs);
  if (justfile.trim().length > 0) {
    files.push({
      path: "justfile",
      content: justfile
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
    toolchain,
    verbs: verbResolution
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
