import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { HookId, KonsistentTemplate, PackHookRef, ResolvedPack, SkillRef } from "../packs/types";
import { PYTHON_KONSISTENT_PATH } from "../packs/python-uv";
import type { RegistryPin } from "../registry/catalog";
import { normalizeAgents, type EnforcementAgent } from "./agent-selection";

export type RenderedFile = {
  path: string;
  content: string;
  mode?: number;
};

export type RenderPlan = {
  targetDir: string;
  files: RenderedFile[];
};

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
  secondaryAcknowledged?: string[];
  existingManifest?: FarrierManifestInput;
  registryPins?: Record<string, RegistryPin>;
  agents?: EnforcementAgent[];
};

export type FarrierManifestVersions = {
  farrierManifest: number;
  hooks: Record<string, number>;
  prompts: {
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
  secondaryAcknowledged: string[];
  learn: {
    enabled: boolean;
  };
  judge: Record<string, unknown>;
  quality: Record<string, unknown>;
  versions: FarrierManifestVersions;
  registry?: {
    items: Record<string, RegistryPin>;
  };
};

export type FarrierManifestInput = Partial<Omit<FarrierManifest, "judge" | "quality" | "versions">> & {
  judge?: unknown;
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

export const farrierManifestVersion = 2;

export const hookCatalogVersions: Record<HookId, number> = {
  "secret-shield": 2,
  "tool-policy": 1,
  "write-guard": 2,
  "verb-runner": 2,
  "quality-judge": 2,
  "stop-judge": 1
};

export const hookTemplateFiles: Record<HookId, string[]> = {
  "secret-shield": ["secret-shield.py", "test_secret_shield.py"],
  "tool-policy": ["tool-policy.py", "test_tool_policy.py"],
  "write-guard": ["write-guard.py", "test_write_guard.py"],
  "verb-runner": ["verb-runner.py", "test_verb_runner.py"],
  "quality-judge": ["quality-judge.py", "test_quality_judge.py"],
  "stop-judge": ["stop-judge.py", "test_stop_judge.py"]
};

function isBuiltinHookId(value: PackHookRef): value is HookId {
  return value in hookTemplateFiles;
}

// .farrier-staging/ holds failed skill-authoring runs kept for inspection;
// they should never be committed.
const requiredGitignoreLines = [".env", ".env.*", "!.env.example", ".farrier-staging/"];

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
 */
export function agentsHardRules(pack: ResolvedPack, agents: readonly EnforcementAgent[] = ["claude"]): string[] {
  const selectedAgents = normalizeAgents(agents);
  const hookNames = selectedAgents.map((agent) => agent === "claude" ? "Claude" : "Codex").join(" or ");
  return [
    "Do not read real `.env*` files or private key material; tracked examples such as `.env.example` are allowed.",
    ...pack.agentsRules,
    "Do not directly edit protected generated/owned files: lockfiles, `.git/`, `skills-lock.json`, or `.farrier.json`.",
    "Run `just check` after edits.",
    ...(pack.verbs.konsistent ? [`Run \`just ${konsistentToolName(pack)}\` before stopping.`] : []),
    "Keep files under `quality.maxFileLines` from `.farrier.json` unless there is a deliberate architectural reason.",
    "Keep generated hook scripts and their tests together.",
    "LLM semantic judge hooks are present but disabled by default in `.farrier.json`; deterministic checks still run where configured.",
    `Do not bypass ${hookNames} hooks; every agent must also follow these rules from AGENTS.md and the justfile.`
  ];
}

function renderAgentsMd(pack: ResolvedPack, agents: readonly EnforcementAgent[]): string {
  const commandLines = [
    `- Check: \`${pack.verbs.check}\``,
    `- Test: \`${pack.verbs.test}\``,
    `- Format: \`${pack.verbs.fmt}\``
  ];

  if (pack.verbs.konsistent) {
    commandLines.push(`- ${capitalize(konsistentToolName(pack))}: \`${pack.verbs.konsistent}\``);
  }

  const selectedAgents = normalizeAgents(agents);
  const hardRules = agentsHardRules(pack, selectedAgents);
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
      : [])
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

function renderClaudeMd(): string {
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

function renderClaudeSettingsJson(pack: ResolvedPack): string {
  const preToolUse: ClaudeHookEntry[] = [];
  const postToolUse: ClaudeHookEntry[] = [];
  const stop: ClaudeHookEntry[] = [];

  if (pack.hooks.includes("secret-shield")) {
    preToolUse.push(
      hookEntry({
        matcher: "Read|Bash|Grep",
        command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/secret-shield.py"'
      })
    );
  }

  if (pack.hooks.includes("tool-policy")) {
    preToolUse.push(
      hookEntry({
        matcher: "Bash",
        command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/tool-policy.py"'
      })
    );
  }

  if (pack.hooks.includes("write-guard")) {
    preToolUse.push(
      hookEntry({
        matcher: "Edit|Write|MultiEdit|NotebookEdit",
        command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/write-guard.py"'
      })
    );
  }

  if (pack.hooks.includes("verb-runner")) {
    postToolUse.push(
      hookEntry({
        matcher: "Edit|Write|MultiEdit|NotebookEdit",
        command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verb-runner.py"'
      })
    );
  }

  if (pack.hooks.includes("quality-judge")) {
    postToolUse.push(
      hookEntry({
        matcher: "Edit|Write|MultiEdit|NotebookEdit",
        command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/quality-judge.py"'
      })
    );
  }

  if (pack.hooks.includes("verb-runner")) {
    stop.push(
      hookEntry({
        command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verb-runner.py"'
      })
    );
  }

  if (pack.hooks.includes("stop-judge")) {
    stop.push(
      hookEntry({
        command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-judge.py"'
      })
    );
  }

  for (const remoteHook of pack.remoteHooks) {
    const entryPath = posixPath(join(".claude", "hooks", remoteHook.id, remoteHook.entry));
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
  return `python3 "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/hooks/${fileName}"`;
}

function renderCodexHooksJson(pack: ResolvedPack): string {
  const preToolUse: ClaudeHookEntry[] = [];
  const postToolUse: ClaudeHookEntry[] = [];
  const stop: ClaudeHookEntry[] = [];

  const add = (entries: ClaudeHookEntry[], matcher: string | undefined, fileName: string): void => {
    entries.push(hookEntry({ matcher, command: codexCommand(fileName) }));
  };

  if (pack.hooks.includes("secret-shield")) add(preToolUse, "^Bash$", "secret-shield.py");
  if (pack.hooks.includes("tool-policy")) add(preToolUse, "^Bash$", "tool-policy.py");
  if (pack.hooks.includes("write-guard")) add(preToolUse, "^apply_patch$", "write-guard.py");
  if (pack.hooks.includes("verb-runner")) add(postToolUse, "^apply_patch$", "verb-runner.py");
  if (pack.hooks.includes("quality-judge")) add(postToolUse, "^apply_patch$", "quality-judge.py");
  if (pack.hooks.includes("verb-runner")) add(stop, undefined, "verb-runner.py");
  if (pack.hooks.includes("stop-judge")) add(stop, undefined, "stop-judge.py");

  const hooks: ClaudeSettingsHooks = {};
  if (preToolUse.length > 0) hooks.PreToolUse = preToolUse;
  if (postToolUse.length > 0) hooks.PostToolUse = postToolUse;
  if (stop.length > 0) hooks.Stop = stop;
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}

function renderJustfile(pack: ResolvedPack): string {
  const recipes = [
    `check:
  ${pack.verbs.check}`,
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
      timeoutMs: 15000,
      prompt: ".claude/hooks/prompts/quality-judge-v1.txt"
    },
    stop: {
      enabled: false,
      backend: "claude",
      model: "sonnet",
      timeoutMs: 30000,
      prompt: ".claude/hooks/prompts/stop-judge-v1.txt",
      maxDiffBytes: 120000,
      maxUntrackedFiles: 50
    }
  };
}

function defaultQualityConfig(): Record<string, unknown> {
  return {
    maxFileLines: 500
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

async function renderManifest(
  pack: ResolvedPack,
  options: {
    skills: SkillRef[];
    learnEnabled: boolean;
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
  const manifest: FarrierManifest = {
    farrierVersion: await getFarrierVersion(),
    agents: [...options.agents],
    packIds: [...pack.packIds],
    hookIds: [...pack.hooks],
    skills: [...options.skills],
    secondaryAcknowledged: [...options.secondaryAcknowledged],
    learn: {
      enabled: options.learnEnabled
    },
    judge: manifestRecord(options.existingManifest?.judge, defaultJudgeConfig()),
    quality: manifestRecord(options.existingManifest?.quality, defaultQualityConfig()),
    versions: {
      farrierManifest: farrierManifestVersion,
      hooks: {
        ...Object.fromEntries(pack.hooks.filter(isBuiltinHookId).map((hook) => [hook, hookCatalogVersions[hook]])),
        ...remoteHookVersions
      },
      prompts: {
        qualityJudge: "v1",
        stopJudge: "v1"
      }
    }
  };

  if (Object.keys(registryPins).length > 0) {
    manifest.registry = {
      items: registryPins
    };
  }

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function renderToolPolicyRulesJson(pack: ResolvedPack): string {
  const rules = {
    version: 1,
    rules: pack.toolPolicyRules
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

export async function createRenderPlan(options: CreateRenderPlanOptions): Promise<RenderPlan> {
  const agents = normalizeAgents(options.agents ?? options.existingManifest?.agents);
  const existingSkills = stringArray(options.existingManifest?.skills);
  const selectedSkills = options.skills ?? existingSkills ?? options.pack.skills;
  const existingLearnEnabled =
    typeof options.existingManifest?.learn?.enabled === "boolean"
      ? options.existingManifest.learn.enabled
      : undefined;
  const learnEnabled = options.learnEnabled ?? existingLearnEnabled ?? false;
  const existingSecondaryAcknowledged = stringArray(options.existingManifest?.secondaryAcknowledged);
  const secondaryAcknowledged = options.secondaryAcknowledged ?? existingSecondaryAcknowledged ?? [];

  const files: RenderedFile[] = [
    {
      path: "AGENTS.md",
      content: renderAgentsMd(options.pack, agents)
    },
    {
      path: "CLAUDE.md",
      content: renderClaudeMd()
    }
  ];

  if (agents.includes("claude")) {
    files.push({
      path: ".claude/settings.json",
      content: renderClaudeSettingsJson(options.pack)
    });
  }

  if (agents.includes("codex")) {
    files.push({
      path: ".codex/hooks.json",
      content: renderCodexHooksJson(options.pack)
    });
  }

  files.push(
    {
      path: ".claude/skills/harness-advisor/SKILL.md",
      content: await readTemplate("skills", "harness-advisor", "SKILL.md")
    },
    {
      path: ".claude/skills/claude-automation-recommender/SKILL.md",
      content: await readTemplate("skills", "claude-automation-recommender", "SKILL.md")
    },
    {
      path: ".agents/skills/farrier-project-advisor/SKILL.md",
      content: await readTemplate("skills", "farrier-project-advisor", "SKILL.md")
    }
  );

  for (const relativePath of claudeAutomationReferenceFiles) {
    files.push({
      path: posixPath(join(".claude", "skills", "claude-automation-recommender", relativePath)),
      content: await readTemplate("skills", "claude-automation-recommender", relativePath)
    });
  }

  for (const hookId of options.pack.hooks.filter(isBuiltinHookId)) {
    for (const fileName of hookTemplateFiles[hookId]) {
      files.push({
        path: posixPath(join(".claude", "hooks", fileName)),
        content: await readHookTemplate(fileName),
        mode: fileName.endsWith(".py") && !fileName.startsWith("test_") ? 0o755 : undefined
      });
    }
  }

  for (const remoteHook of options.pack.remoteHooks) {
    for (const file of remoteHook.files) {
      files.push({
        path: posixPath(join(".claude", "hooks", remoteHook.id, file.path)),
        content: file.content,
        mode: file.executable === true || file.path === remoteHook.entry ? 0o755 : undefined
      });
    }
  }

  if (options.pack.hooks.includes("tool-policy")) {
    files.push({
      path: ".claude/hooks/tool-policy-rules.json",
      content: renderToolPolicyRulesJson(options.pack)
    });
  }

  if (options.pack.hooks.includes("quality-judge")) {
    files.push({
      path: ".claude/hooks/prompts/quality-judge-v1.txt",
      content: await readHookTemplate("prompts/quality-judge-v1.txt")
    });
  }

  if (options.pack.hooks.includes("stop-judge")) {
    files.push({
      path: ".claude/hooks/prompts/stop-judge-v1.txt",
      content: await readHookTemplate("prompts/stop-judge-v1.txt")
    });
  }

  files.push({
    path: "justfile",
    content: renderJustfile(options.pack)
  });

  if (options.pack.konsistentTemplate) {
    files.push({
      path: `${konsistentToolName(options.pack)}.json`,
      content: renderKonsistent(options.pack.konsistentTemplate, options.targetDir)
    });
  }

  files.push(
    {
      path: ".farrier.json",
      content: await renderManifest(options.pack, {
        skills: selectedSkills,
        learnEnabled,
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
    files
  };
}

export async function writeRenderPlan(plan: RenderPlan): Promise<void> {
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
