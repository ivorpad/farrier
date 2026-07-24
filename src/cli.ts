#!/usr/bin/env bun

import { resolve } from "node:path";
import { supportedPackIds } from "./packs/index";
import type { LearnBackend } from "./engine/learn";

type LearnCliOptions = {
  dir: string;
  transcripts?: string;
  codexSessions?: string;
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
  farrier map --dir <target> [--json]
  farrier registry list [--dir <target>] [--json]
  farrier learn --dir <target> [--transcripts <dir>] [--codex-sessions <dir>] [--yes] [--no-llm] [--backend claude|codex] [--model <name>] [--json]
  farrier export --dir <source> [--codex-sessions <dir>] [--name <kebab>] [--send-session-evidence] [--include-skills] [--no-llm] [--backend claude|codex] [--model <name>] [--json]
  farrier export --dir <source> --yes --install-dir <target> [--agents claude,codex] [--include-skills] [--force]
  farrier doctor --dir <target> [--json] [--static] [--live]
  farrier ab-gate --result <result.json> [--json]
  farrier audit-panel prepare --manifest <panel.json> --output <new-directory> [--json]
  farrier advise --dir <target> [--sessions auto|none] [--since 7d|14d|all] [--targets claude|codex] [--only guidance,hooks,skills,subagents,plugins,mcp] [--backend claude|codex] [--model <name>] [--json]
  farrier advise --dir <target> --mode quick|baseline|deep [--plan] [--max-model-calls <n>] [--max-estimated-input-tokens <n>] [--max-provider-cost-usd-per-call <amount>] [--backend claude|codex] [--model <name>] [--json]
  farrier advise skills [--dir <target>] [--context <path|text>] [--backend claude|codex] [--json]
  farrier skill new "<description>" --yes [--dir <target>] [--agents claude,codex] [--mode author-claude|author-codex|per-agent] [--name <kebab>] [--no-llm] [--json]
  farrier skill eval <skill-name> [--dir <target>] [--backend claude|codex] [--json]

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
  --with-advisors     Also generate the opt-in advisor skill trees for the selected agents.
  --json              Emit a machine-readable report, including creation previews and results.
  --transcripts <dir> Claude JSONL transcript directory for learn. Defaults to ~/.claude/projects/<target-slug>.
  --codex-sessions <dir> Codex rollout directory for learn. Defaults to ~/.codex/sessions.
  --no-llm            Use deterministic learn proposals without calling claude or codex.
  --sessions <mode>   Advice session evidence: auto or none. Exact project directories only.
  --since <window>    Advice session lookback: 7d (default), 14d, or all.
  --targets <vendor>  Advice target provider: claude or codex; it must match --backend.
  --only <categories> Limit advice to guidance,hooks,skills,subagents,plugins,mcp.
  --mode <name>       Read-only harness audit: quick, baseline, or deep.
  --plan              Preview harness audit calls and local prompt sizes without resolving a backend.
  --max-model-calls <n> Reject an audit whose planned model calls exceed n.
  --max-estimated-input-tokens <n> Reject an audit whose local input estimate exceeds n.
  --max-provider-cost-usd-per-call <amount> Required for Claude audits that plan model calls.
  --backend <name>    Learn/advise proposal backend: claude or codex. Defaults to claude for learn, auto-detected for advise.
  --model <name>      Learn/advise proposal backend model. Defaults to backend-specific low-cost model.
  --help              Show this help.

Note:
  Bare farrier (optionally with only --context/--dir) launches the TUI wizard only when stdout is a TTY.
  The generic pack is explicit-only; use --stack generic when detection finds no match.
  Creation refuses existing Farrier projects; use update for an existing .farrier.json.
  --yes approves a conflict-free plan. Replacing existing differing files additionally requires --force.
  farrier registry list shows configured private registries without executing payloads.
  farrier learn is report-only unless --yes is provided; it appends new declarative ToolPolicyRule data only.
  farrier export mines a finished project's sessions into a portable playbook (orchestrator skill, gate catalog, review subagents). Report-only by default; evidence stays local unless --send-session-evidence consents to the LLM classification, and installing requires --yes --install-dir after review.
  farrier map regenerates the repository-map section of AGENTS.md (layout, test conventions, git co-change coupling) in place, preserving all other AGENTS.md content. update --yes also refreshes it.
  farrier ab-gate enforces the harness release thresholds against a recorded paired evaluation; it exits 1 listing violated thresholds.
  farrier doctor runs static checks plus runtime hook probes (fixture payloads through the installed bindings). --static skips probes; --live adds one real Codex session that must get blocked. Exits 0 only when every executed layer is healthy.
  Headless farrier advise is report-only. The interactive report can create a selected recommendation only after review and confirmation.`;
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

    if (arg === "--codex-sessions") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--codex-sessions requires a value");
      }
      options.codexSessions = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--codex-sessions=")) {
      options.codexSessions = arg.slice("--codex-sessions=".length);
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
  const codexSessionsDir = options.codexSessions ? resolve(options.codexSessions) : undefined;

  const { loadFarrierConfig, resolveModelSettings } = await import("./config/farrier-config");
  const { applyLearn, createLearnReport, formatLearnApplyResult, formatLearnReport } = await import("./engine/learn");

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
      codexSessionsDir,
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
    codexSessionsDir,
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
      const { runUpdate } = await import("./cli/update");
      return await runUpdate(args.slice(1), usage);
    }

    if (args[0] === "map") {
      const { runMap } = await import("./cli/map");
      return await runMap(args.slice(1), usage);
    }

    if (args[0] === "registry") {
      const { runRegistry } = await import("./cli/registry");
      return await runRegistry(args.slice(1), usage);
    }

    if (args[0] === "learn") {
      return await runLearn(args.slice(1));
    }

    if (args[0] === "export") {
      const { runExport } = await import("./cli/export");
      return await runExport(args.slice(1), usage);
    }

    if (args[0] === "doctor") {
      const { runDoctor } = await import("./cli/doctor");
      return await runDoctor(args.slice(1), usage);
    }

    if (args[0] === "audit-panel") {
      const { runAuditPanel } = await import("./cli/audit-panel");
      return await runAuditPanel(args.slice(1));
    }

    if (args[0] === "ab-gate") {
      const { runAbGate } = await import("./cli/ab-gate");
      return await runAbGate(args.slice(1), usage);
    }

    if (args[0] === "advise") {
      const { runAdvise } = await import("./cli/advise");
      return await runAdvise(args.slice(1));
    }

    if (args[0] === "skill") {
      if (args[1] === "new") {
        const { runSkillNew } = await import("./cli/skill-new");
        return await runSkillNew(args.slice(2));
      }

      if (args[1] === "eval") {
        const { runSkillEval } = await import("./cli/skill-eval");
        return await runSkillEval(args.slice(2));
      }

      console.error('farrier: unknown skill subcommand. Usage: farrier skill new "<description>" [--help] or farrier skill eval <name> [--help]');
      return 1;
    }

    if (process.stdout.isTTY === true && !args.includes("--json")) {
      const { parseCreateArgs } = await import("./cli/create");
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
        const { runStartup } = await import("./tui/startup");
        const { launcherSessionView } = await import("./tui/session-context");
        const targetDir = resolve(renderOptions.dir);

        // The startup screen always runs before the launcher: farrier never
        // silently assumes a working agent. The confirmed pick (agents +
        // backend + models) threads explicitly into every workflow below.
        const session = await runStartup(targetDir);
        if (session === "cancel") {
          console.error("farrier: cancelled.");
          return 1;
        }
        const launcherContext = launcherSessionView(session);
        const noInstalledBackend = !session.detection.claude.installed && !session.detection.codex.installed;

        // Advise is Improve's deeper tier; Skills is reachable directly or
        // from an Improve skill suggestion. Each flow returns an exit code to
        // bubble up, or undefined to fall back to the launcher.
        const adviseFlow = async (): Promise<number | undefined> => {
          const { runAdviceWizard } = await import("./tui/advise-app");
          const outcome = await runAdviceWizard(targetDir, {
            initialBackend: session.backend,
            // "Both" is the only startup choice that leaves the analysis
            // backend genuinely undecided; a single-agent pick already
            // answered "Analyze with", so the wizard hides that row.
            backendLocked: session.backend !== undefined && session.choice !== "both",
            modelOverrides: session.models,
            effortOverrides: session.efforts,
            probeAvailability: async () => ({
              claude: session.detection.claude.installed,
              codex: session.detection.codex.installed,
            }),
          });

          if (typeof outcome === "object" && outcome.kind === "create-skill") {
            const { runCreateWizard } = await import("./tui/create-app");
            const code = await runCreateWizard(targetDir, [outcome.request], session, { backToLauncher: true });
            return code === "back" ? undefined : code;
          }

          if (outcome === "done") {
            return 0;
          }

          if (outcome === "cancel") {
            console.error("farrier: cancelled.");
            return 1;
          }

          // "back" returns to the launcher.
          return undefined;
        };

        const skillsFlow = async (initialQuery?: string): Promise<number | undefined> => {
          const { runSkillsFlow } = await import("./cli/skills-flow");
          return await runSkillsFlow(targetDir, session, initialQuery);
        };

        for (;;) {
          const choice = await runLauncher(launcherContext);

          if (choice === "improve") {
            // Deliberate divergence from a literal "sessions follow the agent
            // pick": the local tier keeps mining BOTH Claude transcripts and
            // Codex rollouts regardless of the startup choice. Mining is local
            // counting only, more evidence is strictly better, and the mined
            // source note in the report states both counts. The pick governs
            // which CLI farrier runs and which defaults it seeds, not which
            // local evidence it may read.
            const { runImproveApp } = await import("./tui/learn-app");
            const outcome = await runImproveApp(targetDir, {
              llmAnalysisAvailable: !noInstalledBackend,
              llmBackendLabel:
                session.backend === "claude" ? "Claude Code" : session.backend === "codex" ? "Codex" : undefined,
              session,
            });

            if (typeof outcome === "object") {
              const code = outcome.kind === "advise" ? await adviseFlow() : await skillsFlow(outcome.query);
              if (code !== undefined) {
                return code;
              }
            }
            continue;
          }

          if (choice === "skills") {
            const code = await skillsFlow();
            if (code !== undefined) {
              return code;
            }
            continue;
          }

          if (choice === "export") {
            // Mining is local; the LLM classification inside the app runs
            // only after its own consent screen, on the startup-picked backend.
            const { runExportApp } = await import("./tui/export-app");
            await runExportApp(targetDir, { session });
            continue;
          }

          if (choice === "doctor") {
            const { runDoctorApp } = await import("./tui/doctor-app");
            await runDoctorApp(targetDir);
            continue;
          }

          if (choice === "harness") {
            const { runWizard } = await import("./tui/app");
            const result = await runWizard(targetDir, {
              context: renderOptions.context,
              session,
            });
            if (result === "back") {
              continue;
            }
            return result;
          }

          console.error("farrier: cancelled.");
          return 1;
        }
      }
    }

    if (args.length === 0) {
      console.error("Bare TUI wizard mode requires a TTY. Use --stack <id> --yes --dir <target> for headless render.");
      console.error("");
      console.error(usage());
      return 1;
    }

    return await (async () => {
      const { runCreate } = await import("./cli/create");
      return runCreate(args, usage);
    })();
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
