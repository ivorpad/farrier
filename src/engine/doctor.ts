import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createRenderPlan, type FarrierManifestInput, type RenderedFile } from "./render";
import { inventoryOwnership, readManifest } from "./update";
import { validateToolPolicyRuleProposal } from "./learn";
import { builtinCatalog, type PackCatalog, type RegistryPin } from "../registry/catalog";
import { normalizeAgents } from "./agent-selection";
import { inspectTrackedSkillHealth } from "./native-skill-health";

export type DoctorGroup =
  | "manifest"
  | "inventory"
  | "hooks"
  | "settings"
  | "codex"
  | "tool-policy"
  | "konsistent"
  | "learn"
  | "judge"
  | "quality"
  | "skills";

export type DoctorSeverity = "error" | "warning";

export type DoctorProblem = {
  group: DoctorGroup;
  severity: DoctorSeverity;
  path?: string;
  id?: string;
  message: string;
  remediation?: string;
};

export type DoctorReport = {
  targetDir: string;
  manifestPath: string;
  healthy: boolean;
  problems: DoctorProblem[];
  problemsByGroup: Record<DoctorGroup, DoctorProblem[]>;
  notes: string[];
};

const allGroups: DoctorGroup[] = [
  "manifest",
  "inventory",
  "hooks",
  "settings",
  "codex",
  "tool-policy",
  "konsistent",
  "learn",
  "judge",
  "quality",
  "skills"
];

const rulesRelativePath = ".claude/hooks/tool-policy-rules.json";

function emptyProblemsByGroup(): Record<DoctorGroup, DoctorProblem[]> {
  return Object.fromEntries(allGroups.map((group) => [group, [] as DoctorProblem[]])) as unknown as Record<
    DoctorGroup,
    DoctorProblem[]
  >;
}

function groupedProblems(problems: DoctorProblem[]): Record<DoctorGroup, DoctorProblem[]> {
  const grouped = emptyProblemsByGroup();

  for (const problem of problems) {
    grouped[problem.group].push(problem);
  }

  return grouped;
}

function reportFor(input: {
  targetDir: string;
  manifestPath: string;
  problems: DoctorProblem[];
  notes?: string[];
}): DoctorReport {
  const healthy = !input.problems.some((problem) => problem.severity === "error");

  return {
    targetDir: input.targetDir,
    manifestPath: input.manifestPath,
    healthy,
    problems: input.problems,
    problemsByGroup: groupedProblems(input.problems),
    notes: input.notes ?? []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function absoluteProjectPath(targetDir: string, path: string): string {
  return isAbsolute(path) ? path : join(targetDir, path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() || info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      message: string;
    }
> {
  let text: string;

  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(text)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message
    };
  }
}

function manifestInputFrom(manifest: Awaited<ReturnType<typeof readManifest>>): FarrierManifestInput {
  return {
    farrierVersion: manifest.farrierVersion ?? undefined,
    agents: [...manifest.agents],
    packIds: [...manifest.packIds],
    hookIds: [...manifest.hookIds],
    skills: [...manifest.skills],
    secondaryAcknowledged: [...manifest.secondaryAcknowledged],
    learn: {
      enabled: manifest.learn.enabled
    },
    judge: manifest.judge,
    quality: manifest.quality,
    versions: {
      farrierManifest: manifest.versions.farrierManifest ?? undefined,
      hooks: { ...manifest.versions.hooks },
      prompts: manifest.versions.prompts
    },
    registry: {
      items: { ...manifest.registry.items }
    }
  };
}

function registryPinsForManifest(
  manifest: Awaited<ReturnType<typeof readManifest>>,
  catalog: PackCatalog
): Record<string, RegistryPin> {
  const currentPins = catalog.registryPins();
  return Object.fromEntries(
    Object.keys(manifest.registry.items)
      .map((id) => [id, currentPins[id]])
      .filter((entry): entry is [string, RegistryPin] => entry[1] !== undefined)
  );
}

function addManifestShapeProblems(raw: unknown, problems: DoctorProblem[], targetDir: string): void {
  if (!isRecord(raw)) {
    problems.push({
      group: "manifest",
      severity: "error",
      path: ".farrier.json",
      message: ".farrier.json root must be an object",
      remediation: "Re-render or repair the harness with farrier update --yes."
    });
    return;
  }

  const learn = raw.learn;
  if (!isRecord(learn) || typeof learn.enabled !== "boolean") {
    problems.push({
      group: "learn",
      severity: "error",
      path: ".farrier.json",
      message: "learn.enabled must be a boolean",
      remediation: "Run farrier update --yes to restore generated manifest defaults."
    });
  }

  try {
    normalizeAgents(raw.agents);
  } catch (error) {
    problems.push({
      group: "manifest",
      severity: "error",
      path: ".farrier.json",
      message: error instanceof Error ? error.message : String(error),
      remediation: "Set agents to a non-empty selection of claude, codex, or both."
    });
  }

  const judge = raw.judge;
  if (judge !== undefined && !isRecord(judge)) {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: "judge must be an object when present",
      remediation: "Run farrier update --yes or fix the judge configuration."
    });
    return;
  }

  if (isRecord(judge)) {
    validateJudgeTier("perEdit", judge.perEdit, problems, targetDir);
    validateJudgeTier("stop", judge.stop, problems, targetDir);
  }

  const quality = raw.quality;
  if (quality !== undefined && !isRecord(quality)) {
    problems.push({
      group: "quality",
      severity: "error",
      path: ".farrier.json",
      message: "quality must be an object when present",
      remediation: "Run farrier update --yes or fix the quality configuration."
    });
    return;
  }

  if (isRecord(quality) && !isPositiveNumber(quality.maxFileLines)) {
    problems.push({
      group: "quality",
      severity: "error",
      path: ".farrier.json",
      message: "quality.maxFileLines must be a positive number",
      remediation: "Set quality.maxFileLines to a positive number."
    });
  }
}

function validateJudgeTier(
  tier: "perEdit" | "stop",
  value: unknown,
  problems: DoctorProblem[],
  targetDir: string
): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: `judge.${tier} must be an object when present`,
      remediation: "Run farrier update --yes or fix the judge configuration."
    });
    return;
  }

  if (typeof value.enabled !== "boolean") {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: `judge.${tier}.enabled must be a boolean`,
      remediation: `Set judge.${tier}.enabled to true or false.`
    });
  }

  if (value.backend !== undefined && value.backend !== "claude" && value.backend !== "codex") {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: `judge.${tier}.backend must be "claude" or "codex"`,
      remediation: `Set judge.${tier}.backend to "claude" or "codex".`
    });
  }

  if (value.model !== undefined && !isNonEmptyString(value.model)) {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: `judge.${tier}.model must be a non-empty string`,
      remediation: `Set judge.${tier}.model to the backend model name.`
    });
  }

  if (value.timeoutMs !== undefined && !isPositiveNumber(value.timeoutMs)) {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: `judge.${tier}.timeoutMs must be a positive number`,
      remediation: `Set judge.${tier}.timeoutMs to a positive millisecond timeout.`
    });
  }

  if (value.prompt !== undefined) {
    if (!isNonEmptyString(value.prompt)) {
      problems.push({
        group: "judge",
        severity: "error",
        path: ".farrier.json",
        message: `judge.${tier}.prompt must be a non-empty string`,
        remediation: `Set judge.${tier}.prompt to an existing prompt file path.`
      });
    }
  }

  if (tier === "stop") {
    if (value.maxDiffBytes !== undefined && !isPositiveNumber(value.maxDiffBytes)) {
      problems.push({
        group: "judge",
        severity: "error",
        path: ".farrier.json",
        message: "judge.stop.maxDiffBytes must be a positive number",
        remediation: "Set judge.stop.maxDiffBytes to a positive byte limit."
      });
    }

    if (value.maxUntrackedFiles !== undefined && !isPositiveNumber(value.maxUntrackedFiles)) {
      problems.push({
        group: "judge",
        severity: "error",
        path: ".farrier.json",
        message: "judge.stop.maxUntrackedFiles must be a positive number",
        remediation: "Set judge.stop.maxUntrackedFiles to a positive file count."
      });
    }
  }

}

const judgeTierHooks = {
  perEdit: "quality-judge",
  stop: "stop-judge"
} as const;

async function addJudgePromptProblems(
  raw: unknown,
  problems: DoctorProblem[],
  targetDir: string,
  selectedHookIds: readonly string[]
): Promise<void> {
  if (!isRecord(raw) || !isRecord(raw.judge)) {
    return;
  }

  for (const tier of ["perEdit", "stop"] as const) {
    const tierConfig = raw.judge[tier];

    if (!isRecord(tierConfig) || !isNonEmptyString(tierConfig.prompt)) {
      continue;
    }

    // The judge config block is rendered for every pack, but the prompt file only
    // exists when the corresponding hook is selected — absent hook means inert config.
    if (!selectedHookIds.includes(judgeTierHooks[tier])) {
      continue;
    }

    const promptPath = absoluteProjectPath(targetDir, tierConfig.prompt);
    if (!(await fileExists(promptPath))) {
      problems.push({
        group: "judge",
        severity: "error",
        path: tierConfig.prompt,
        message: `judge.${tier}.prompt points to a missing file`,
        remediation: "Restore the generated prompt file or update the manifest prompt path."
      });
    }
  }
}

async function addInventoryProblems(
  targetDir: string,
  expectedFiles: RenderedFile[],
  problems: DoctorProblem[]
): Promise<void> {
  for (const file of expectedFiles) {
    if (file.path === ".farrier.json") {
      continue;
    }

    const absolutePath = join(targetDir, file.path);

    if (!(await fileExists(absolutePath))) {
      problems.push({
        group: "inventory",
        severity: "error",
        path: file.path,
        message: "Expected generated harness file is missing",
        remediation: "Run farrier update --yes to restore missing harness files."
      });
      continue;
    }

    if (inventoryOwnership(file.path) === "farrier-owned") {
      const current = await readText(absolutePath);
      if (current !== file.content) {
        problems.push({
          group: "inventory",
          severity: "error",
          path: file.path,
          message: "Farrier-owned generated file differs from the expected template",
          remediation: "Run farrier update --yes to refresh Farrier-owned generated files."
        });
      }
    }
  }
}

async function addHookModeProblems(
  targetDir: string,
  expectedFiles: RenderedFile[],
  problems: DoctorProblem[]
): Promise<void> {
  for (const file of expectedFiles) {
    if (file.mode === undefined) {
      continue;
    }

    const absolutePath = join(targetDir, file.path);

    if (!(await fileExists(absolutePath))) {
      continue;
    }

    if (!(await isExecutable(absolutePath))) {
      problems.push({
        group: "hooks",
        severity: "error",
        path: file.path,
        message: "Hook script is not executable",
        remediation: `Run chmod +x ${file.path} or farrier update --yes.`
      });
    }
  }
}

function collectHookCommands(settings: unknown): { commands: string[]; shapeError?: string } {
  if (!isRecord(settings)) {
    return {
      commands: [],
      shapeError: "settings root must be an object"
    };
  }

  const hooks = settings.hooks;
  if (!isRecord(hooks)) {
    return {
      commands: [],
      shapeError: "settings.hooks must be an object"
    };
  }

  const commands: string[] = [];

  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) {
      return {
        commands,
        shapeError: "settings.hooks entries must be arrays"
      };
    }

    for (const entry of entries) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
        return {
          commands,
          shapeError: "settings hook entry must contain a hooks array"
        };
      }

      for (const hook of entry.hooks) {
        if (isRecord(hook) && typeof hook.command === "string") {
          commands.push(hook.command);
        }
      }
    }
  }

  return { commands };
}

function referencedHookPath(command: string, targetDir: string): { relativePath: string; absolutePath: string } | undefined {
  const expanded = command.replaceAll("$CLAUDE_PROJECT_DIR", targetDir);
  const match = expanded.match(/(?:^|["'\s])(?<path>(?:[^"'\s]*\/)?\.claude\/hooks\/[^"'\s]+)(?:$|["'\s])/);

  if (!match?.groups?.path) {
    return undefined;
  }

  const rawPath = match.groups.path;
  const projectPrefix = `${targetDir.replaceAll("\\", "/")}/`;
  const normalizedRawPath = rawPath.replaceAll("\\", "/");
  const relativePath = normalizedRawPath.startsWith(projectPrefix)
    ? normalizedRawPath.slice(projectPrefix.length)
    : normalizedRawPath.replace(/^\.\/+/, "");

  return {
    relativePath,
    absolutePath: absoluteProjectPath(targetDir, relativePath)
  };
}

async function addSettingsProblems(
  targetDir: string,
  expectedSettingsFile: RenderedFile | undefined,
  problems: DoctorProblem[]
): Promise<void> {
  const settingsPath = join(targetDir, ".claude/settings.json");
  const actual = await readJsonFile(settingsPath);

  if (!actual.ok) {
    problems.push({
      group: "settings",
      severity: "error",
      path: ".claude/settings.json",
      message: `Unable to parse Claude settings JSON: ${actual.message}`,
      remediation: "Run farrier update --yes or restore .claude/settings.json."
    });
    return;
  }

  const actualCommands = collectHookCommands(actual.value);
  if (actualCommands.shapeError) {
    problems.push({
      group: "settings",
      severity: "error",
      path: ".claude/settings.json",
      message: actualCommands.shapeError,
      remediation: "Restore the generated Claude settings hook structure."
    });
  }

  if (expectedSettingsFile) {
    try {
      const expected = JSON.parse(expectedSettingsFile.content) as unknown;
      const expectedCommands = collectHookCommands(expected).commands;
      const actualCommandSet = new Set(actualCommands.commands);

      for (const command of expectedCommands) {
        if (!actualCommandSet.has(command)) {
          problems.push({
            group: "settings",
            severity: "error",
            path: ".claude/settings.json",
            message: `Expected generated hook command is missing: ${command}`,
            remediation: "Run farrier update --yes or restore the missing hook command."
          });
        }
      }
    } catch {
      // Expected settings are generated by Farrier; ignore impossible local parse failure.
    }
  }

  for (const command of actualCommands.commands) {
    const reference = referencedHookPath(command, targetDir);

    if (!reference) {
      continue;
    }

    if (!(await fileExists(reference.absolutePath))) {
      problems.push({
        group: "settings",
        severity: "error",
        path: ".claude/settings.json",
        message: `Hook command references a missing file: ${reference.relativePath}`,
        remediation: "Restore the referenced hook file or remove the dangling settings command."
      });
      continue;
    }

    if (!(await isExecutable(reference.absolutePath))) {
      problems.push({
        group: "settings",
        severity: "error",
        path: reference.relativePath,
        message: "Hook command references a non-executable hook file",
        remediation: `Run chmod +x ${reference.relativePath} or farrier update --yes.`
      });
    }
  }
}

type CodexHookBinding = {
  event: string;
  matcher?: string;
  type?: string;
  command?: string;
};

function collectCodexHookBindings(value: unknown): { bindings: CodexHookBinding[]; shapeError?: string } {
  if (!isRecord(value)) return { bindings: [], shapeError: "hooks.json root must be an object" };
  if (!isRecord(value.hooks)) return { bindings: [], shapeError: "hooks.json hooks must be an object" };

  const bindings: CodexHookBinding[] = [];
  for (const [event, entries] of Object.entries(value.hooks)) {
    if (!Array.isArray(entries)) return { bindings, shapeError: `hooks.${event} must be an array` };
    for (const entry of entries) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
        return { bindings, shapeError: `hooks.${event} entries must contain a hooks array` };
      }
      if (entry.hooks.length === 0) {
        return { bindings, shapeError: `hooks.${event} hooks arrays must not be empty` };
      }
      if (entry.matcher !== undefined && typeof entry.matcher !== "string") {
        return { bindings, shapeError: `hooks.${event} matcher must be a string when present` };
      }
      for (const hook of entry.hooks) {
        if (!isRecord(hook)) return { bindings, shapeError: `hooks.${event} handlers must be objects` };
        if (hook.type !== "command" || !isNonEmptyString(hook.command)) {
          return {
            bindings,
            shapeError: `hooks.${event} handlers must use type command with a non-empty command`
          };
        }
        bindings.push({
          event,
          ...(typeof entry.matcher === "string" ? { matcher: entry.matcher } : {}),
          type: hook.type,
          command: hook.command
        });
      }
    }
  }
  return { bindings };
}

function sameCodexBinding(actual: CodexHookBinding, expected: CodexHookBinding): boolean {
  return actual.event === expected.event
    && actual.matcher === expected.matcher
    && actual.type === expected.type
    && actual.command === expected.command;
}

function codexHookTarget(command: string, targetDir: string): { relativePath: string; absolutePath: string } | undefined {
  const match = command.match(/\/\.claude\/hooks\/(?<file>[^"'\s]+)["']?\s*$/);
  if (!match?.groups?.file) return undefined;
  const relativePath = `.claude/hooks/${match.groups.file}`;
  return { relativePath, absolutePath: join(targetDir, relativePath) };
}

async function addCodexHooksProblems(
  targetDir: string,
  expectedFile: RenderedFile,
  problems: DoctorProblem[]
): Promise<void> {
  const relativePath = ".codex/hooks.json";
  const actual = await readJsonFile(join(targetDir, relativePath));
  if (!actual.ok) {
    problems.push({
      group: "codex",
      severity: "error",
      path: relativePath,
      message: `Unable to parse Codex hooks JSON: ${actual.message}`,
      remediation: "Run farrier update --yes if the file is missing, or restore the selected Codex binding."
    });
    return;
  }

  const actualBindings = collectCodexHookBindings(actual.value);
  if (actualBindings.shapeError) {
    problems.push({
      group: "codex",
      severity: "error",
      path: relativePath,
      message: actualBindings.shapeError,
      remediation: "Restore a valid Codex hooks.json event, matcher-group, and command-handler structure."
    });
  }

  const expectedBindings = collectCodexHookBindings(JSON.parse(expectedFile.content)).bindings;
  for (const expected of expectedBindings) {
    if (!actualBindings.bindings.some((actualBinding) => sameCodexBinding(actualBinding, expected))) {
      problems.push({
        group: "codex",
        severity: "error",
        path: relativePath,
        message: `Expected Farrier ${expected.event}${expected.matcher ? ` (${expected.matcher})` : ""} command hook is missing: ${expected.command}`,
        remediation: "Restore the missing Farrier command entry without removing unrelated user-authored hooks."
      });
      continue;
    }

    if (!expected.command) continue;
    const target = codexHookTarget(expected.command, targetDir);
    if (!target || !(await fileExists(target.absolutePath))) {
      problems.push({
        group: "codex",
        severity: "error",
        path: relativePath,
        message: `Farrier command references a missing shared hook target: ${target?.relativePath ?? expected.command}`,
        remediation: "Run farrier update --yes to restore the shared policy script."
      });
    } else if (!(await isExecutable(target.absolutePath))) {
      problems.push({
        group: "codex",
        severity: "error",
        path: target.relativePath,
        message: "Codex binding references a non-executable shared hook target",
        remediation: `Run chmod +x ${target.relativePath} or farrier update --yes.`
      });
    }
  }
}

async function addToolPolicyProblems(
  targetDir: string,
  shouldExist: boolean,
  problems: DoctorProblem[]
): Promise<void> {
  const rulesPath = join(targetDir, rulesRelativePath);

  if (!(await fileExists(rulesPath))) {
    if (shouldExist) {
      problems.push({
        group: "tool-policy",
        severity: "error",
        path: rulesRelativePath,
        message: "tool-policy hook is selected but rules file is missing",
        remediation: "Run farrier update --yes to restore the rules file."
      });
    }
    return;
  }

  const parsed = await readJsonFile(rulesPath);
  if (!parsed.ok) {
    problems.push({
      group: "tool-policy",
      severity: "error",
      path: rulesRelativePath,
      message: `Unable to parse tool-policy rules JSON: ${parsed.message}`,
      remediation: "Fix the JSON or re-render the rules file."
    });
    return;
  }

  if (!isRecord(parsed.value)) {
    problems.push({
      group: "tool-policy",
      severity: "error",
      path: rulesRelativePath,
      message: "tool-policy rules root must be an object",
      remediation: "Use { version: 1, rules: [...] }."
    });
    return;
  }

  if (parsed.value.version !== 1) {
    problems.push({
      group: "tool-policy",
      severity: "error",
      path: rulesRelativePath,
      message: "tool-policy rules version must be 1",
      remediation: "Use the Farrier tool-policy rules schema version 1."
    });
  }

  if (!Array.isArray(parsed.value.rules)) {
    problems.push({
      group: "tool-policy",
      severity: "error",
      path: rulesRelativePath,
      message: "tool-policy rules must be an array",
      remediation: "Use { version: 1, rules: [...] }."
    });
    return;
  }

  const proposedIds = new Set<string>();

  for (const rule of parsed.value.rules) {
    const result = validateToolPolicyRuleProposal(rule, {
      existingIds: new Set(),
      proposedIds
    });

    if (result.ok) {
      proposedIds.add(result.rule.id);
      continue;
    }

    problems.push({
      group: "tool-policy",
      severity: "error",
      path: rulesRelativePath,
      id: result.id,
      message: result.reason,
      remediation: "Fix or remove the invalid declarative ToolPolicyRule."
    });
  }
}

async function addKonsistentProblems(
  targetDir: string,
  configFile: string | undefined,
  problems: DoctorProblem[]
): Promise<void> {
  if (!configFile) {
    return;
  }

  const path = join(targetDir, configFile);

  if (!(await fileExists(path))) {
    problems.push({
      group: "konsistent",
      severity: "error",
      path: configFile,
      message: `Expected ${configFile} is missing`,
      remediation: `Run farrier update --yes to restore ${configFile}.`
    });
    return;
  }

  const parsed = await readJsonFile(path);
  if (!parsed.ok) {
    problems.push({
      group: "konsistent",
      severity: "error",
      path: configFile,
      message: `Unable to parse ${configFile}: ${parsed.message}`,
      remediation: `Fix the JSON or restore the generated ${configFile}.`
    });
    return;
  }

  if (!isRecord(parsed.value)) {
    problems.push({
      group: "konsistent",
      severity: "error",
      path: configFile,
      message: `${configFile} root must be an object`,
      remediation: "Restore the generated structure-check v1 shape."
    });
    return;
  }

  if (parsed.value.version !== "v1") {
    problems.push({
      group: "konsistent",
      severity: "error",
      path: configFile,
      message: `${configFile} version must be "v1"`,
      remediation: "Restore the generated structure-check v1 shape."
    });
  }

  if (!Array.isArray(parsed.value.conventions)) {
    problems.push({
      group: "konsistent",
      severity: "error",
      path: configFile,
      message: `${configFile} conventions must be an array`,
      remediation: "Restore the generated structure-check v1 shape."
    });
  }
}

export async function createDoctorReport(input: { targetDir: string; catalog?: PackCatalog }): Promise<DoctorReport> {
  const targetDir = resolve(input.targetDir);
  const catalog = input.catalog ?? builtinCatalog();
  const manifestPath = join(targetDir, ".farrier.json");
  const problems: DoctorProblem[] = [];
  const notes: string[] = [
    "Doctor is static: it validates generated harness shape and file health without running project commands."
  ];

  let manifest: Awaited<ReturnType<typeof readManifest>>;
  try {
    manifest = await readManifest({ targetDir, catalog });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return reportFor({
      targetDir,
      manifestPath,
      problems: [
        {
          group: "manifest",
          severity: "error",
          path: ".farrier.json",
          message,
          remediation: "Run farrier first, or repair .farrier.json before running doctor."
        }
      ],
      notes
    });
  }

  const rawManifest = await readJsonFile(manifestPath);
  if (rawManifest.ok) {
    addManifestShapeProblems(rawManifest.value, problems, targetDir);
    await addJudgePromptProblems(rawManifest.value, problems, targetDir, manifest.hookIds);
  } else {
    problems.push({
      group: "manifest",
      severity: "error",
      path: ".farrier.json",
      message: `Unable to parse .farrier.json: ${rawManifest.message}`,
      remediation: "Repair .farrier.json before running doctor."
    });
  }

  const basePack = catalog.resolvePack(manifest.currentPackId);
  const renderPack = {
    ...basePack,
    hooks: [...manifest.hookIds]
  };

  const expectedPlan = await createRenderPlan({
    targetDir,
    pack: renderPack,
    skills: manifest.skills,
    learnEnabled: manifest.learn.enabled,
    secondaryAcknowledged: manifest.secondaryAcknowledged,
    existingManifest: manifestInputFrom(manifest),
    agents: manifest.agents,
    registryPins: registryPinsForManifest(manifest, catalog)
  });

  await addInventoryProblems(targetDir, expectedPlan.files, problems);
  await addHookModeProblems(targetDir, expectedPlan.files, problems);

  if (manifest.agents.includes("claude")) {
    await addSettingsProblems(
      targetDir,
      expectedPlan.files.find((file) => file.path === ".claude/settings.json"),
      problems
    );
  }

  if (manifest.agents.includes("codex")) {
    const codexFile = expectedPlan.files.find((file) => file.path === ".codex/hooks.json");
    if (codexFile) await addCodexHooksProblems(targetDir, codexFile, problems);
    notes.push("Codex runtime trust, exact hook approval, hooks enablement, administrative policy, and complete unified_exec interception cannot be proven statically; inspect /hooks in Codex.");
  }

  await addToolPolicyProblems(targetDir, manifest.hookIds.includes("tool-policy"), problems);
  const skillHealth = await inspectTrackedSkillHealth(targetDir, manifest.skills);
  for (const item of skillHealth.native) {
    if (item.status === "healthy-tree" || item.status === "healthy-shared-link") continue;
    problems.push({
      group: "skills",
      severity: "error",
      path: item.path,
      id: item.ref,
      message: item.message,
      remediation: "Restore the authored native tree/link manually or remove the stale manifest ref; doctor will not overwrite authored content."
    });
  }
  for (const ref of skillHealth.duplicateRefs) {
    problems.push({ group: "skills", severity: "warning", id: ref, message: "Manifest contains this skill ref more than once." });
  }
  for (const ref of skillHealth.legacyRefs) {
    problems.push({
      group: "skills",
      severity: "warning",
      id: ref,
      message: "Legacy ./skills ref is preserved; its intended provider-native layout cannot be inferred safely.",
      remediation: "Create the intended native/shared copy explicitly, verify it, then remove the legacy ref and tree manually."
    });
  }
  const konsistentConfigFile = `${basePack.konsistentTool ?? "konsistent"}.json`;
  await addKonsistentProblems(
    targetDir,
    expectedPlan.files.some((file) => file.path === konsistentConfigFile) ? konsistentConfigFile : undefined,
    problems
  );

  return reportFor({
    targetDir,
    manifestPath,
    problems,
    notes
  });
}

function renderProblem(problem: DoctorProblem): string {
  const parts = [`[${problem.severity}]`];

  if (problem.path) {
    parts.push(problem.path);
  }

  if (problem.id) {
    parts.push(`(${problem.id})`);
  }

  parts.push(problem.message);

  const line = parts.join(" ");
  return problem.remediation ? `${line}\n    Remediation: ${problem.remediation}` : line;
}

function renderList(values: string[], empty: string): string[] {
  if (values.length === 0) {
    return [`  ${empty}`];
  }

  return values.map((value) => `  - ${value}`);
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [
    `Farrier doctor report for ${report.targetDir}`,
    "",
    `Manifest: ${report.manifestPath}`,
    `Health: ${report.healthy ? "healthy" : "unhealthy"}`
  ];

  if (report.problems.length === 0) {
    lines.push("", "No problems found.");
  } else {
    for (const group of allGroups) {
      const problems = report.problemsByGroup[group];

      if (problems.length === 0) {
        continue;
      }

      lines.push("", `${group}:`);
      for (const problem of problems) {
        lines.push(`  - ${renderProblem(problem).replaceAll("\n", "\n    ")}`);
      }
    }
  }

  if (report.notes.length > 0) {
    lines.push("", "Notes:", ...renderList(report.notes, "none"));
  }

  return `${lines.join("\n")}\n`;
}

export function doctorExitCode(report: DoctorReport): number {
  return report.healthy ? 0 : 1;
}
