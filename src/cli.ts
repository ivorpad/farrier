#!/usr/bin/env bun

import { resolve } from "node:path";
import { runAdvise } from "./cli/advise";
import { parseCreateArgs, runCreate } from "./cli/create";
import { runDoctor } from "./cli/doctor";
import { runRegistry } from "./cli/registry";
import { runSkillEval } from "./cli/skill-eval";
import { runSkillNew } from "./cli/skill-new";
import { runUpdate } from "./cli/update";
import { loadFarrierConfig, resolveModelSettings } from "./config/farrier-config";
import { applyLearn, createLearnReport, formatLearnApplyResult, formatLearnReport, type LearnBackend } from "./engine/learn";
import { supportedPackIds } from "./packs/index";

type LearnCliOptions = {
  dir: string;
  transcripts?: string;
  yes: boolean;
  json: boolean;
  noLlm: boolean;
  backend: LearnBackend;
  model?: string;
  help: boolean;
};

function usage(): string {
  return `farrier CLI

Usage:
  farrier
  farrier --stack python-fastapi --agents claude|codex|claude,codex --yes --dir <target>
  farrier --stack python-fastapi --agents claude|codex|claude,codex --dry-run --dir <target>
  farrier --detect --agents claude|codex|claude,codex --yes --dir <target>
  farrier --detect --agents claude|codex|claude,codex --dry-run --dir <target>
  farrier update --dir <target> [--yes] [--json]
  farrier registry list [--dir <target>] [--json]
  farrier learn --dir <target> [--transcripts <dir>] [--yes] [--no-llm] [--backend claude|codex] [--model <name>] [--json]
  farrier doctor --dir <target> [--json]
  farrier advise --dir <target> --author claude|codex [--sessions auto|none] [--since 7d|14d|all] [--only guidance,hooks,skills,subagents,plugins,mcp] [--model <name>] [--json]
  farrier advise skills [--dir <target>] [--context <path|text>] --author claude|codex [--json]
  farrier skill new "<description>" --yes [--dir <target>] --author claude [--author codex] [--shared] [--name <kebab>] [--no-llm] [--json]
  farrier skill eval <skill-name> [--dir <target>] --author claude|codex [--json]

Options:
  --stack <id>        Stack pack to render. Supported: ${supportedPackIds().join(", ")}
  --detect            Detect stack from target directory. Mutually exclusive with --stack.
  --dir <path>        Target directory. Defaults to current working directory.
  --context <path|text> Project context for the harness wizard or legacy skill-only advice.
  --agents <vendors>   Enforcement targets: claude, codex, or claude,codex. Defaults to claude.
  --yes               Required for render writes. Applies repairs for update. Appends accepted learned rules for learn.
  --dry-run           Explain the creation plan and file actions; write nothing.
  --force             With --yes, replace reviewed conflicting files and keep backups. Never bypasses path blockers.
  --no-skills         Do not install the selected pack skills after writing (useful offline).
  --json              Emit a machine-readable report, including creation previews and results.
  --transcripts <dir> Claude JSONL transcript directory for learn. Defaults to ~/.claude/projects/<target-slug>.
  --no-llm            Use deterministic learn proposals without calling claude or codex.
  --sessions <mode>   Advice session evidence: auto or none. Exact project directories only.
  --since <window>    Advice session lookback: 7d (default), 14d, or all.
  --author <name>     Artifact author for advice/eval; repeat for independent skill copies.
  --only <categories> Limit advice to guidance,hooks,skills,subagents,plugins,mcp.
  --backend <name>    Learn proposal backend. Deprecated advice/eval alias for --author in 0.4.x.
  --model <name>      Learn/advise proposal backend model. Defaults to backend-specific low-cost model.
  --help              Show this help.

Note:
  Bare farrier (optionally with only --context/--dir) launches the TUI wizard only when stdout is a TTY.
  The generic pack is explicit-only; use --stack generic when detection finds no match.
  Creation refuses existing Farrier projects; use update for an existing .farrier.json.
  --yes approves a conflict-free plan. Replacing existing differing files additionally requires --force.
  farrier registry list shows configured private registries without executing payloads.
  farrier learn is report-only unless --yes is provided; it appends new declarative ToolPolicyRule data only.
  farrier doctor exits 0 when healthy and 1 when static harness health errors are found.
  Headless farrier advise is report-only. The interactive report can create a selected recommendation only after review and confirmation.
  Advice/eval --backend and --targets, and skill-new --agents/--mode/--no-install, are deprecated in 0.4.x and removed in 0.5.0.`;
}

function parseBackend(value: string): LearnBackend {
  if (value === "claude" || value === "codex") {
    return value;
  }

  throw new Error("--backend must be claude or codex");
}

function parseLearnArgs(args: string[]): LearnCliOptions {
  const options: LearnCliOptions = {
    dir: process.cwd(),
    yes: false,
    json: false,
    noLlm: false,
    backend: "claude",
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--no-llm") {
      options.noLlm = true;
      continue;
    }

    if (arg === "--dir") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--dir requires a value");
      }
      options.dir = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--dir=")) {
      options.dir = arg.slice("--dir=".length);
      continue;
    }

    if (arg === "--transcripts") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--transcripts requires a value");
      }
      options.transcripts = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--transcripts=")) {
      options.transcripts = arg.slice("--transcripts=".length);
      continue;
    }

    if (arg === "--backend") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--backend requires a value");
      }
      options.backend = parseBackend(value);
      i += 1;
      continue;
    }

    if (arg.startsWith("--backend=")) {
      options.backend = parseBackend(arg.slice("--backend=".length));
      continue;
    }

    if (arg === "--model") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--model requires a value");
      }
      options.model = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--model=")) {
      options.model = arg.slice("--model=".length);
      continue;
    }

    throw new Error(`Unknown learn argument: ${arg}`);
  }

  return options;
}

async function runLearn(args: string[]): Promise<number> {
  const options = parseLearnArgs(args);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const targetDir = resolve(options.dir);
  const transcriptsDir = options.transcripts ? resolve(options.transcripts) : undefined;

  const models = await loadFarrierConfig({ projectDir: targetDir })
    .then((loaded) => loaded.config.models)
    .catch(() => ({}));
  const learnSettings = resolveModelSettings({
    models,
    backend: options.backend ?? "claude",
    role: "learn",
    explicitModel: options.model,
  });

  if (options.yes) {
    const result = await applyLearn({
      targetDir,
      transcriptsDir,
      yes: true,
      json: options.json,
      noLlm: options.noLlm,
      backend: options.backend,
      model: learnSettings.model,
      reasoningEffort: learnSettings.reasoningEffort,
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ...result.report,
            applied: {
              appendedRules: result.appendedRules,
              skippedExistingIds: result.skippedExistingIds,
              rulesPath: result.rulesPath,
            },
          },
          null,
          2,
        ),
      );
      return 0;
    }

    console.log(formatLearnApplyResult(result).trimEnd());
    return 0;
  }

  const report = await createLearnReport({
    targetDir,
    transcriptsDir,
    yes: false,
    json: options.json,
    noLlm: options.noLlm,
    backend: options.backend,
    model: learnSettings.model,
    reasoningEffort: learnSettings.reasoningEffort,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(formatLearnReport(report).trimEnd());
  return 0;
}

export async function main(args: string[] = Bun.argv.slice(2)): Promise<number> {
  try {
    if (args[0] === "update") {
      return await runUpdate(args.slice(1), usage);
    }

    if (args[0] === "registry") {
      return await runRegistry(args.slice(1), usage);
    }

    if (args[0] === "learn") {
      return await runLearn(args.slice(1));
    }

    if (args[0] === "doctor") {
      return await runDoctor(args.slice(1), usage);
    }

    if (args[0] === "advise") {
      return await runAdvise(args.slice(1));
    }

    if (args[0] === "skill") {
      if (args[1] === "new") {
        return await runSkillNew(args.slice(2));
      }

      if (args[1] === "eval") {
        return await runSkillEval(args.slice(2));
      }

      console.error('farrier: unknown skill subcommand. Usage: farrier skill new "<description>" [--help] or farrier skill eval <name> [--help]');
      return 1;
    }

    if (process.stdout.isTTY === true && !args.includes("--json")) {
      const renderOptions = parseCreateArgs(args);

      if (
        !renderOptions.help &&
        !renderOptions.stack &&
        !renderOptions.detect &&
        !renderOptions.yes &&
        !renderOptions.dryRun &&
        !renderOptions.force &&
        !renderOptions.json &&
        renderOptions.installSkills
      ) {
        const { runLauncher } = await import("./tui/launcher");
        let choice = await runLauncher();

        while (choice === "advise") {
          const { runAdviceWizard } = await import("./tui/advise-app");
          const outcome = await runAdviceWizard(resolve(renderOptions.dir));

          if (typeof outcome === "object" && outcome.kind === "create-skill") {
            const { runCreateWizard } = await import("./tui/create-app");
            return await runCreateWizard(resolve(renderOptions.dir), [outcome.request]);
          }

          if (outcome === "done") {
            return 0;
          }

          if (outcome === "cancel") {
            console.error("farrier: cancelled.");
            return 1;
          }

          choice = await runLauncher();
        }

        if (choice === "create") {
          const { runCreateWizard } = await import("./tui/create-app");
          return await runCreateWizard(resolve(renderOptions.dir));
        }

        if (choice === "harness") {
          const { runWizard } = await import("./tui/app");
          return await runWizard(resolve(renderOptions.dir), {
            context: renderOptions.context,
          });
        }

        console.error("farrier: cancelled.");
        return 1;
      }
    }

    if (args.length === 0) {
      console.error("Bare TUI wizard mode requires a TTY. Use --stack <id> --yes --dir <target> for headless render.");
      console.error("");
      console.error(usage());
      return 1;
    }

    return await runCreate(args, usage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`farrier: ${message}`);
    return 1;
  }
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
