import { resolve } from "node:path";
import { loadFarrierConfig, resolveModelSettings, type ModelsConfig } from "../config/farrier-config";
import { parseArtifactAuthor, resolveAvailableAuthor } from "../engine/agent-selection";
import { probeAgents } from "../engine/backend";
import {
  createSkills,
  normalizeSkillCreationRequest,
  type AuthoringMode,
  type CreateAgent,
  type SkillCreationOutcome
} from "../engine/create-skill";
import { detectPacks } from "../engine/detect";
import { evaluatePerAgentSkill, perAgentEvalCandidates, type SkillEvalVerdict } from "../engine/eval-skill";
import {
  applyRefinements,
  generateNextGrillQuestion,
  maxGrillQuestions,
  type RefineAnswer,
  type RefineQuestion
} from "../engine/refine-skill";
import { runSkillScaffold } from "./skill-scaffold";

export type SkillNewCliOptions = {
  description?: string;
  dir: string;
  name?: string;
  authors: CreateAgent[];
  shared: boolean;
  /** @deprecated */
  agents?: CreateAgent[];
  /** @deprecated */
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
  warnings: string[];
};

function skillNewUsage(): string {
  return `farrier skill new — create a new agent skill with each vendor's own skill-creator

Usage:
  farrier skill new "<description>" [--dir <target>] --author claude [--author codex] [--shared] --yes

Authoring is delegated to the vendor's recommended creator: claude uses the pinned
anthropics/skills skill-creator, while codex uses its built-in $skill-creator. Farrier
validates every result before placing it in provider-native project roots.

Options:
  --dir <path>       Target directory. Defaults to current working directory.
  --author <name>    Author provider. Repeat for independently authored Claude and Codex copies.
  --shared           With one author, place one real .agents tree and the exact Claude link.
  --agents, --mode   Deprecated compatibility aliases for --author/--shared.
  --name <kebab>     Ask the creator for this exact skill name.
  --model <name>     Backend model override for the authoring run (overrides the models config).
  --no-llm           Skip agent authoring; write a deterministic SKILL.md scaffold instead.
  --refine           Grill the brief first: clarifying questions one at a time (interactive; requires a terminal).
  --force            Replace an existing skill directory on collision (scaffold and authored).
  --no-install       Deprecated no-op; native placement is the installation.
  --dry-run          Preview the scaffold without writing (only valid with --no-llm).
  --yes, -y          Required for writes.
  --eval             After a two-author creation, run the read-only blind
                     eval and include the verdict (never deletes; apply a winner with
                     farrier skill eval --apply-winner ... --delete-loser-and-link).
  --json             Emit canonical authors/layout plus compatibility fields.
  --help             Show this help.

Exits 0 on success; exits 1 on refusal, authoring failure, or placement failure.`;
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
    authors: [],
    shared: false,
    noLlm: false,
    refine: false,
    force: false,
    noInstall: false,
    dryRun: false,
    yes: false,
    eval: false,
    json: false,
    help: false,
    warnings: []
  };

  const takesValue: Array<{ flag: string; set: (value: string) => void }> = [
    { flag: "--dir", set: (value) => (options.dir = value) },
    { flag: "--name", set: (value) => (options.name = value) },
    { flag: "--author", set: (value) => {
      const author = parseArtifactAuthor(value, "--author");
      if (options.authors.includes(author)) throw new Error(`duplicate --author ${author} is not allowed`);
      options.authors.push(author);
    } },
    { flag: "--agents", set: (value) => (options.agents = parseAgentsList(value)) },
    { flag: "--mode", set: (value) => (options.mode = parseMode(value)) },
    { flag: "--model", set: (value) => (options.model = value) }
  ];

  const booleans: Record<string, () => void> = {
    "--help": () => (options.help = true),
    "-h": () => (options.help = true),
    "--no-llm": () => (options.noLlm = true),
    "--shared": () => (options.shared = true),
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

  if (options.agents || options.mode) {
    if (options.agents) options.warnings.push("--agents is deprecated; use repeated --author flags.");
    if (options.mode) options.warnings.push("--mode is deprecated; use --shared or repeated --author flags.");
    const normalized = normalizeSkillCreationRequest({
      description: options.description ?? "compatibility selection",
      ...(options.authors.length ? { authors: options.authors, layout: options.shared ? "shared" : "native" as const } : {}),
      agents: options.agents,
      mode: options.mode
    });
    options.authors = normalized.authors;
    options.shared = normalized.layout === "shared";
  }
  if (options.noInstall) options.warnings.push("--no-install is deprecated and has no effect; native placement is the installation.");
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

/** A trimmed lowercase "q" ends the grill early — "that's enough, proceed". */
export function isGrillFinish(line: string): boolean {
  return line.trim().toLowerCase() === "q";
}

/**
 * Interactive grill loop: ask the backend for one adaptive question at a time,
 * fold each answer into the running transcript so the next question responds to
 * it. Any failure stops the interview and proceeds with the answers so far —
 * grilling never blocks creation.
 */
async function refineDescription(
  options: SkillNewCliOptions,
  targetDir: string,
  backend: CreateAgent,
  models: ModelsConfig
): Promise<string> {
  const packId = (await detectPacks(targetDir).catch(() => [] as string[]))[0];
  const refineSettings = resolveModelSettings({ models, backend, role: "refine", explicitModel: options.model });

  const stdinLines = (console as unknown as AsyncIterable<string>)[Symbol.asyncIterator]();
  const readLine = async (): Promise<string> => String((await stdinLines.next()).value ?? "");

  const answers: RefineAnswer[] = [];

  for (let questionNumber = 1; questionNumber <= maxGrillQuestions; questionNumber += 1) {
    console.log(
      questionNumber === 1 ? `Asking ${backend} for its first question…` : `${backend} is thinking about your answer…`
    );

    let question: RefineQuestion | null;

    try {
      question = await generateNextGrillQuestion({
        description: options.description!,
        backend,
        targetDir,
        packId,
        priorAnswers: answers,
        questionNumber,
        model: refineSettings.model,
        reasoningEffort: refineSettings.reasoningEffort
      });
    } catch (error) {
      console.log(`Grilling stopped (${errorMessage(error)}); proceeding with ${answers.length} answer(s).`);
      break;
    }

    if (question === null) {
      console.log(
        questionNumber === 1
          ? "No open decisions — the brief is specific enough."
          : "No more questions — the brief is pinned down."
      );
      break;
    }

    console.log(`\n[${questionNumber}/≤${maxGrillQuestions}] ${question.question}`);
    question.options.forEach((option, optionIndex) => {
      console.log(`  ${optionIndex + 1}) ${option}${optionIndex === 0 ? "   (recommended)" : ""}`);
    });
    console.log(
      "  number picks an option · free text is used verbatim · empty = let the creator decide · q = that's enough"
    );
    process.stdout.write("> ");

    const line = await readLine();

    if (isGrillFinish(line)) {
      break;
    }

    answers.push({ question: question.question, answer: resolveRefineAnswer(line, question.options) });
  }

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
    for (const warning of options.warnings) console.error(`farrier skill new: warning: ${warning}`);
    if (options.noLlm && options.authors.length === 0) {
      console.error("farrier skill new: --no-llm requires at least one explicit --author.");
      return 1;
    }

    let availability: Awaited<ReturnType<typeof probeAgents>> | undefined;
    if (!options.noLlm) {
      availability = await probeAgents();
      if (options.authors.length === 0) {
        options.authors = [resolveAvailableAuthor(undefined, availability, "farrier skill new")];
      }
      for (const author of options.authors) {
        if (!availability[author]) {
          console.error(`farrier skill new: requested author '${author}' did not answer --version.`);
          return 1;
        }
      }
    }

    if (options.shared && options.authors.length !== 1) {
      console.error("farrier skill new: --shared requires exactly one --author and cannot be combined with a second author.");
      return 1;
    }
    if (options.model && options.authors.length > 1) {
      console.error("farrier skill new: --model cannot be used with two authors; configure models.<provider>.skillCreation instead.");
      return 1;
    }
    if (options.eval && (options.noLlm || options.shared || options.authors.length !== 2)) {
      console.error("farrier skill new: --eval compares two independently authored copies; use --author claude --author codex without --shared or --no-llm.");
      return 1;
    }

    if (options.noLlm) {
      return await runSkillScaffold(options, targetDir);
    }

    if (options.dryRun) {
      console.error("farrier skill new: --dry-run only supports --no-llm scaffolds; delegated authoring cannot dry-run.");
      return 1;
    }

    const authors = options.authors;
    const layout = options.shared ? "shared" as const : "native" as const;

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

      description = await refineDescription(options, targetDir, authors[0]!, models);
    }

    // Explicit --model stays on the request (it wins everywhere); config-derived
    // skillCreation settings fill in per backend when no --model was given.
    const outcomes = await createSkills(
      [{ description, authors, layout, nameOverride: options.name, model: options.model }],
      targetDir,
      {
        force: options.force,
        modelSettings: {
          claude: resolveModelSettings({ models, backend: "claude", role: "skillCreation" }),
          codex: resolveModelSettings({ models, backend: "codex", role: "skillCreation" })
        }
      }
    );
    const outcome = outcomes[0]!;
    outcome.notes.unshift(...options.warnings);
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
        backend: authors[0]!,
        role: "eval",
        explicitModel: options.model
      });
      verdict = await evaluatePerAgentSkill({
        targetDir,
        ...candidate,
        backend: authors[0]!,
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
        authors,
        layout,
        mode: authors.length > 1 ? "per-agent" : authors[0] === "claude" ? "author-claude" : "author-codex",
        agents: authors,
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
