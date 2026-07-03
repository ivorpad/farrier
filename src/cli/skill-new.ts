import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadFarrierConfig, resolveModelSettings, type ModelsConfig } from "../config/farrier-config";
import { probeAgents } from "../engine/backend";
import {
  canonicalSkillRoot,
  createSkills,
  installLocalSkill,
  recordSkillInManifest,
  scaffoldSkillDraft,
  type AuthoringMode,
  type CollisionDecision,
  type CreateAgent,
  type SkillCreationOutcome
} from "../engine/create-skill";
import { detectPacks } from "../engine/detect";
import { evaluatePerAgentSkill, perAgentEvalCandidates, type SkillEvalVerdict } from "../engine/eval-skill";
import { applyRefinements, generateRefineQuestions, type RefineAnswer, type RefineQuestion } from "../engine/refine-skill";
import { writeRenderPlan } from "../engine/render";

export type SkillNewCliOptions = {
  description?: string;
  dir: string;
  name?: string;
  agents?: CreateAgent[];
  mode?: AuthoringMode;
  model?: string;
  noLlm: boolean;
  refine: boolean;
  force: boolean;
  noInstall: boolean;
  dryRun: boolean;
  yes: boolean;
  eval: boolean;
  json: boolean;
  help: boolean;
};

function skillNewUsage(): string {
  return `farrier skill new — create a new agent skill with each vendor's own skill-creator

Usage:
  farrier skill new "<description>" [--dir <target>] [--agents claude,codex] [--mode <mode>] --yes

Authoring is delegated to the vendor's recommended creator: claude uses the pinned
anthropics/skills skill-creator (installed into the target on first use), codex uses its
built-in $skill-creator. Farrier validates the result and installs it via the skills CLI.

Options:
  --dir <path>       Target directory. Defaults to current working directory.
  --agents <list>    Comma-separated targets: claude, codex, or both. Defaults to the agents
                     whose CLIs answer --version on PATH.
  --mode <mode>      Required when more than one agent is selected:
                       author-claude  claude authors one canonical skills/<name>/, installed to all agents
                       author-codex   codex authors the canonical copy, installed to all agents
                       per-agent      each agent authors its own copy in its native skill dir
  --name <kebab>     Ask the creator for this exact skill name.
  --model <name>     Backend model override for the authoring run (overrides the models config).
  --no-llm           Skip agent authoring; write a deterministic SKILL.md scaffold instead.
  --refine           Ask clarifying questions first (interactive; requires a terminal): the backend
                     proposes the open implementation decisions, your answers join the brief.
  --force            Replace an existing skill directory on collision (scaffold and authored).
  --no-install       Skip the 'skills add ./skills' install step after authoring.
  --dry-run          Preview the scaffold without writing (only valid with --no-llm).
  --yes, -y          Required for writes.
  --eval             After a per-agent creation with both copies, run the read-only blind
                     eval and include the verdict (never deletes; apply a winner with
                     farrier skill eval --apply-winner ... --delete-loser-and-link).
  --json             Emit { name, mode, agents, files, installed, notes, error, eval? }.
  --help             Show this help.

Exits 0 on success; exits 1 on refusal, authoring failure, or install failure (authored files
are kept on disk with a retry command).`;
}

function parseAgentsList(value: string): CreateAgent[] {
  const agents = value
    .split(",")
    .map((agent) => agent.trim())
    .filter((agent) => agent.length > 0);

  for (const agent of agents) {
    if (agent !== "claude" && agent !== "codex") {
      throw new Error("--agents accepts a comma-separated list of: claude, codex");
    }
  }

  if (agents.length === 0) {
    throw new Error("--agents requires at least one of: claude, codex");
  }

  return Array.from(new Set(agents)) as CreateAgent[];
}

function parseMode(value: string): AuthoringMode {
  if (value === "author-claude" || value === "author-codex" || value === "per-agent") {
    return value;
  }

  throw new Error("--mode must be author-claude, author-codex, or per-agent");
}

export function parseSkillNewArgs(args: string[]): SkillNewCliOptions {
  const options: SkillNewCliOptions = {
    dir: process.cwd(),
    noLlm: false,
    refine: false,
    force: false,
    noInstall: false,
    dryRun: false,
    yes: false,
    eval: false,
    json: false,
    help: false
  };

  const takesValue: Array<{ flag: string; set: (value: string) => void }> = [
    { flag: "--dir", set: (value) => (options.dir = value) },
    { flag: "--name", set: (value) => (options.name = value) },
    { flag: "--agents", set: (value) => (options.agents = parseAgentsList(value)) },
    { flag: "--mode", set: (value) => (options.mode = parseMode(value)) },
    { flag: "--model", set: (value) => (options.model = value) }
  ];

  const booleans: Record<string, () => void> = {
    "--help": () => (options.help = true),
    "-h": () => (options.help = true),
    "--no-llm": () => (options.noLlm = true),
    "--refine": () => (options.refine = true),
    "--force": () => (options.force = true),
    "--no-install": () => (options.noInstall = true),
    "--dry-run": () => (options.dryRun = true),
    "--yes": () => (options.yes = true),
    "-y": () => (options.yes = true),
    "--eval": () => (options.eval = true),
    "--json": () => (options.json = true)
  };

  outer: for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const setBoolean = booleans[arg];

    if (setBoolean) {
      setBoolean();
      continue;
    }

    for (const { flag, set } of takesValue) {
      if (arg === flag) {
        const value = args[i + 1];
        if (!value || value.startsWith("--")) {
          throw new Error(`${flag} requires a value`);
        }
        set(value);
        i += 1;
        continue outer;
      }

      if (arg.startsWith(`${flag}=`)) {
        set(arg.slice(flag.length + 1));
        continue outer;
      }
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown skill new argument: ${arg}`);
    }

    if (options.description !== undefined) {
      throw new Error("skill new takes a single description. Quote it: farrier skill new \"...\"");
    }

    options.description = arg;
  }

  return options;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Best-effort model config load; a broken/absent config falls back to no overrides. */
async function loadModelsConfig(targetDir: string): Promise<ModelsConfig> {
  try {
    return (await loadFarrierConfig({ projectDir: targetDir })).config.models;
  } catch {
    return {};
  }
}

function emit(options: SkillNewCliOptions, result: Record<string, unknown>, lines: string[]): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const line of lines) {
    console.log(line);
  }
}

async function runScaffold(options: SkillNewCliOptions, targetDir: string): Promise<number> {
  const draft = scaffoldSkillDraft({ description: options.description!, nameOverride: options.name });
  const skillDir = join(targetDir, canonicalSkillRoot, draft.name);

  if (!options.force && existsSync(skillDir)) {
    console.error(
      `farrier skill new: ${canonicalSkillRoot}/${draft.name} already exists. Use --force to overwrite or --name to choose another name.`
    );
    return 1;
  }

  if (options.dryRun) {
    emit(options, { name: draft.name, mode: "scaffold", files: draft.files.map((file) => file.path), installed: false, notes: draft.notes, dryRun: true }, [
      `Would write ${draft.files.map((file) => file.path).join(", ")} (nothing written):`,
      "",
      draft.files[0]!.content
    ]);
    return 0;
  }

  if (!options.yes) {
    console.error("farrier skill new: refusing to write without --yes. Use --dry-run to preview.");
    return 1;
  }

  await writeRenderPlan({ targetDir, files: draft.files });
  const notes = [...draft.notes];
  let installed = false;

  if (options.noInstall) {
    notes.push(`Skipped install; run: skills add ./${canonicalSkillRoot} -s ${draft.name} -a claude-code codex -y`);
  } else {
    const install = await installLocalSkill(draft.name, targetDir, options.agents ?? ["claude", "codex"]);

    if (!install.ok) {
      console.error(
        `farrier skill new: scaffold written to ${canonicalSkillRoot}/${draft.name}/ but install failed: ${install.error ?? install.stderr}`
      );
      return 1;
    }

    installed = true;

    if (await recordSkillInManifest(targetDir, `./${canonicalSkillRoot}@${draft.name}`)) {
      notes.push("Recorded in .farrier.json skills.");
    }
  }

  emit(
    options,
    { name: draft.name, mode: "scaffold", files: draft.files.map((file) => file.path), installed, notes },
    [
      `✓ Scaffolded ${canonicalSkillRoot}/${draft.name}/SKILL.md${installed ? " and installed it" : ""}.`,
      "  Edit the TODO sections before relying on it.",
      ...notes.map((note) => `  - ${note}`)
    ]
  );
  return 0;
}

/** Maps a typed reply to an answer: blank = creator decides, a number picks that option, anything else is literal. */
export function resolveRefineAnswer(line: string, options: string[]): string {
  const trimmed = line.trim();

  if (trimmed.length === 0) {
    return "";
  }

  const pick = Number(trimmed);

  if (Number.isInteger(pick) && pick >= 1 && pick <= options.length) {
    return options[pick - 1]!;
  }

  return trimmed;
}

async function askRefineQuestions(
  questions: RefineQuestion[],
  readLine: () => Promise<string>
): Promise<RefineAnswer[]> {
  const answers: RefineAnswer[] = [];

  for (const [index, question] of questions.entries()) {
    console.log(`\n[${index + 1}/${questions.length}] ${question.question}`);
    question.options.forEach((option, optionIndex) => {
      console.log(`  ${optionIndex + 1}) ${option}${optionIndex === 0 ? "   (recommended)" : ""}`);
    });
    console.log("  number picks an option · free text is used verbatim · empty = let the creator decide");
    process.stdout.write("> ");

    answers.push({ question: question.question, answer: resolveRefineAnswer(await readLine(), question.options) });
  }

  return answers;
}

async function refineDescription(
  options: SkillNewCliOptions,
  targetDir: string,
  backend: CreateAgent,
  models: ModelsConfig
): Promise<string> {
  const packId = (await detectPacks(targetDir).catch(() => [] as string[]))[0];
  console.log(`Asking ${backend} what the brief leaves open…`);

  const refineSettings = resolveModelSettings({ models, backend, role: "refine", explicitModel: options.model });
  const questions = await generateRefineQuestions({
    description: options.description!,
    backend,
    targetDir,
    packId,
    model: refineSettings.model,
    reasoningEffort: refineSettings.reasoningEffort
  });

  if (questions.length === 0) {
    console.log("No open decisions — the brief is specific enough.");
    return options.description!;
  }

  const stdinLines = (console as unknown as AsyncIterable<string>)[Symbol.asyncIterator]();
  const readLine = async (): Promise<string> => String((await stdinLines.next()).value ?? "");
  const answers = await askRefineQuestions(questions, readLine);

  return applyRefinements(options.description!, answers);
}

function outcomeLines(outcome: SkillCreationOutcome): string[] {
  if (outcome.error) {
    return [`✗ ${outcome.error}`, ...outcome.notes.map((note) => `  - ${note}`)];
  }

  return [
    `✓ Created ${outcome.name}${outcome.installed ? " (installed)" : ""}:`,
    ...outcome.files.map((file) => `    ${file}`),
    ...outcome.notes.map((note) => `  - ${note}`)
  ];
}

export async function runSkillNew(args: string[]): Promise<number> {
  let options: SkillNewCliOptions;

  try {
    options = parseSkillNewArgs(args);
  } catch (error) {
    console.error(`farrier skill new: ${errorMessage(error)}`);
    return 1;
  }

  if (options.help) {
    console.log(skillNewUsage());
    return 0;
  }

  if (!options.description || options.description.trim().length === 0) {
    // Bare `farrier skill new` (optionally with --dir) on a terminal opens the
    // standalone create TUI, mirroring how bare `farrier` opens the wizard.
    // Headless-intent flags keep the hard error instead of surprising a script.
    const headlessIntent = options.json || options.yes || options.noLlm || options.dryRun || options.noInstall;

    if (process.stdout.isTTY === true && !headlessIntent) {
      const { runCreateWizard } = await import("../tui/create-app");
      return runCreateWizard(resolve(options.dir));
    }

    console.error('farrier skill new: a description is required. Usage: farrier skill new "<description>" [--help]');
    return 1;
  }

  const targetDir = resolve(options.dir);

  try {
    if (options.eval && (options.noLlm || (options.mode && options.mode !== "per-agent"))) {
      console.error("farrier skill new: --eval compares per-agent copies; it requires --mode per-agent (not --no-llm).");
      return 1;
    }

    if (options.noLlm) {
      return await runScaffold(options, targetDir);
    }

    if (options.dryRun) {
      console.error("farrier skill new: --dry-run only supports --no-llm scaffolds; delegated authoring cannot dry-run.");
      return 1;
    }

    const availability = await probeAgents();
    const agents = options.agents ?? (["claude", "codex"] as CreateAgent[]).filter((agent) => availability[agent]);

    if (agents.length === 0) {
      console.error(
        "farrier skill new: no agent CLI answered --version. Install claude or codex, pass --agents, or use --no-llm."
      );
      return 1;
    }

    const mode: AuthoringMode | undefined =
      agents.length === 1 ? (agents[0] === "claude" ? "author-claude" : "author-codex") : options.mode;

    if (!mode) {
      console.error(
        "farrier skill new: --mode is required when more than one agent is selected (author-claude, author-codex, or per-agent)."
      );
      return 1;
    }

    const authoringAgents: CreateAgent[] =
      mode === "per-agent" ? agents : [mode === "author-claude" ? "claude" : "codex"];

    for (const agent of authoringAgents) {
      if (!availability[agent]) {
        console.error(`farrier skill new: mode '${mode}' needs the ${agent} CLI, but ${agent} --version failed.`);
        return 1;
      }
    }

    if (!options.yes) {
      console.error("farrier skill new: authoring writes into the target. Refusing without --yes.");
      return 1;
    }

    const models = await loadModelsConfig(targetDir);

    let description = options.description;

    if (options.refine) {
      if (process.stdin.isTTY !== true) {
        console.error("farrier skill new: --refine is interactive and requires a terminal.");
        return 1;
      }

      description = await refineDescription(options, targetDir, authoringAgents[0]!, models);
    }

    // Explicit --model stays on the request (it wins everywhere); config-derived
    // skillCreation settings fill in per backend when no --model was given.
    const outcomes = await createSkills(
      [{ description, agents, mode, nameOverride: options.name, model: options.model }],
      targetDir,
      {
        install: !options.noInstall,
        onCollision: options.force ? async (): Promise<CollisionDecision> => "replace" : undefined,
        modelSettings: {
          claude: resolveModelSettings({ models, backend: "claude", role: "skillCreation" }),
          codex: resolveModelSettings({ models, backend: "codex", role: "skillCreation" })
        }
      }
    );
    const outcome = outcomes[0]!;
    let verdict: SkillEvalVerdict | undefined;
    const evalLines: string[] = [];

    if (options.eval && !outcome.error) {
      const candidate = perAgentEvalCandidates(outcomes)[0];

      if (!candidate) {
        console.error("farrier skill new: --eval needs a per-agent creation with both copies in place.");
        return 1;
      }

      const evalSettings = resolveModelSettings({
        models,
        backend: authoringAgents[0]!,
        role: "eval",
        explicitModel: options.model
      });
      verdict = await evaluatePerAgentSkill({
        targetDir,
        ...candidate,
        backend: authoringAgents[0]!,
        model: evalSettings.model,
        reasoningEffort: evalSettings.reasoningEffort
      });

      const scores = `claude ${verdict.copies.claude.score}/10 · codex ${verdict.copies.codex.score}/10`;
      evalLines.push(
        `Eval recommendation: ${verdict.recommendedWinner} (${scores}) — nothing deleted.`,
        ...(verdict.reportPaths ? [`  Reports: ${verdict.reportPaths.claude} · ${verdict.reportPaths.codex}`] : []),
        `  Apply one with: farrier skill eval ${candidate.skillName} --apply-winner claude|codex|recommended --delete-loser-and-link`
      );
    }

    emit(
      options,
      {
        name: outcome.name,
        mode,
        agents,
        files: outcome.files,
        installed: outcome.installed,
        notes: outcome.notes,
        error: outcome.error,
        eval: verdict
      },
      [...outcomeLines(outcome), ...evalLines]
    );

    return outcome.error ? 1 : 0;
  } catch (error) {
    console.error(`farrier skill new: ${errorMessage(error)}`);
    return 1;
  }
}
