#!/usr/bin/env bun

import { resolve } from "node:path";
import { runAdvise } from "./cli/advise";
import { runDoctor } from "./cli/doctor";
import { runSkillEval } from "./cli/skill-eval";
import { runSkillNew } from "./cli/skill-new";
import { runUpdate } from "./cli/update";
import { loadConfiguredCatalog } from "./cli/registry";
import { loadFarrierConfig } from "./config/farrier-config";
import { detectPacks } from "./engine/detect";
import {
  applyLearn,
  createLearnReport,
  formatLearnApplyResult,
  formatLearnReport,
  type LearnBackend
} from "./engine/learn";
import { createRenderPlan, writeRenderPlan } from "./engine/render";
import { supportedPackIds } from "./packs/index";
import { loadPackCatalog, type PackCatalog } from "./registry/catalog";
import { parseItemRef } from "./registry/ref";

type RenderCliOptions = {
  stack?: string;
  detect: boolean;
  dir: string;
  context?: string;
  yes: boolean;
  dryRun: boolean;
  help: boolean;
};

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

type RegistryListOptions = {
  dir: string;
  json: boolean;
  help: boolean;
};

function usage(): string {
  return `farrier CLI

Usage:
  farrier
  farrier --stack python-fastapi --yes --dir <target>
  farrier --stack python-fastapi --dry-run --dir <target>
  farrier --detect --yes --dir <target>
  farrier --detect --dry-run --dir <target>
  farrier update --dir <target> [--yes] [--json]
  farrier registry list [--dir <target>] [--json]
  farrier learn --dir <target> [--transcripts <dir>] [--yes] [--no-llm] [--backend claude|codex] [--model <name>] [--json]
  farrier doctor --dir <target> [--json]
  farrier advise --dir <target> [--context <path|text>] [--backend claude|codex] [--model <name>] [--json]
  farrier skill new "<description>" --yes [--dir <target>] [--agents claude,codex] [--mode author-claude|author-codex|per-agent] [--name <kebab>] [--no-llm] [--json]
  farrier skill eval <skill-name> [--dir <target>] [--backend claude|codex] [--json]

Options:
  --stack <id>        Stack pack to render. Supported: ${supportedPackIds().join(", ")}
  --detect            Detect stack from target directory. Mutually exclusive with --stack.
  --dir <path>        Target directory. Defaults to current working directory.
  --context <path|text> Project context for the wizard's advise option or farrier advise: a file path or literal text.
  --yes               Required for render writes. Applies repairs for update. Appends accepted learned rules for learn.
  --dry-run           Print render inventory only; write nothing.
  --json              Emit machine-readable report. update, registry list, learn, doctor, and advise only.
  --transcripts <dir> Claude JSONL transcript directory for learn. Defaults to ~/.claude/projects/<target-slug>.
  --no-llm            Use deterministic learn proposals without calling claude or codex.
  --backend <name>    Learn/advise proposal backend: claude or codex. Defaults to claude for learn, auto-detected for advise.
  --model <name>      Learn/advise proposal backend model. Defaults to backend-specific low-cost model.
  --help              Show this help.

Note:
  Bare farrier (optionally with only --context/--dir) launches the TUI wizard only when stdout is a TTY.
  The generic pack is explicit-only; use --stack generic when detection finds no match.
  farrier registry list shows configured private registries without executing payloads.
  farrier learn is report-only unless --yes is provided; it appends new declarative ToolPolicyRule data only.
  farrier doctor exits 0 when healthy and 1 when static harness health errors are found.
  farrier advise is disabled by default; it never blocks the wizard on failure.`;
}

function parseRenderArgs(args: string[]): RenderCliOptions {
  const options: RenderCliOptions = {
    dir: process.cwd(),
    yes: false,
    dryRun: false,
    detect: false,
    help: false
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

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--detect") {
      options.detect = true;
      continue;
    }

    if (arg === "--stack") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--stack requires a value");
      }
      options.stack = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--stack=")) {
      options.stack = arg.slice("--stack=".length);
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

    if (arg === "--context") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--context requires a value");
      }
      options.context = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--context=")) {
      options.context = arg.slice("--context=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.detect && options.stack) {
    throw new Error("--detect and --stack are mutually exclusive");
  }

  return options;
}

function parseBackend(value: string): LearnBackend {
  if (value === "claude" || value === "codex") {
    return value;
  }

  throw new Error("--backend must be claude or codex");
}

function parseRegistryListArgs(args: string[]): RegistryListOptions {
  const options: RegistryListOptions = {
    dir: process.cwd(),
    json: false,
    help: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
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

    throw new Error(`Unknown registry list argument: ${arg}`);
  }

  return options;
}

function parseLearnArgs(args: string[]): LearnCliOptions {
  const options: LearnCliOptions = {
    dir: process.cwd(),
    yes: false,
    json: false,
    noLlm: false,
    backend: "claude",
    help: false
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

function requiredRefsForStack(stack: string | undefined): Map<string, string> {
  const refs = new Map<string, string>();
  if (!stack) {
    return refs;
  }

  const parsed = parseItemRef(stack);
  if (parsed) {
    refs.set(parsed.namespace, parsed.id);
  }

  return refs;
}

function printCatalogWarnings(catalog: PackCatalog): void {
  for (const warning of catalog.warnings) {
    console.error(`farrier: registry warning ${warning.namespace}: ${warning.message}`);
  }
}

function generatorCommand(pack: { generator?: { command: string; args: string[] } }): string | undefined {
  if (!pack.generator) {
    return undefined;
  }

  return [pack.generator.command, ...pack.generator.args].join(" ");
}

async function resolveRenderStack(options: RenderCliOptions, targetDir: string, catalog: PackCatalog): Promise<string> {
  if (options.detect) {
    const detected = await detectPacks(targetDir, catalog);

    if (detected.length === 0) {
      throw new Error(`No stack detected in ${targetDir}. Use --stack generic to render the generic harness.`);
    }

    return detected[0]!;
  }

  if (!options.stack) {
    throw new Error(`Missing --stack. Supported stacks: ${catalog.packIds().join(", ")}`);
  }

  return options.stack;
}

async function runRender(args: string[]): Promise<number> {
  const options = parseRenderArgs(args);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  if (!options.dryRun && !options.yes) {
    throw new Error("Refusing to write without --yes. Use --dry-run to preview inventory.");
  }

  const targetDir = resolve(options.dir);
  const catalog = await loadConfiguredCatalog({
    targetDir,
    requireRefs: requiredRefsForStack(options.stack)
  });
  printCatalogWarnings(catalog);
  const stack = await resolveRenderStack(options, targetDir, catalog);
  const pack = catalog.resolvePack(stack);
  const plan = await createRenderPlan({
    targetDir,
    pack,
    registryPins: catalog.registryPins()
  });

  if (options.dryRun) {
    console.log(`Dry run: would write ${plan.files.length} files to ${plan.targetDir}`);
    if (pack.packIds.some((packId) => packId.startsWith("@"))) {
      const command = generatorCommand(pack);
      if (command) {
        const source = [...pack.packIds].reverse().find((packId) => packId.startsWith("@")) ?? pack.id;
        console.log(`Generator will run: ${command} (from ${source})`);
      }
    }
    for (const file of plan.files) {
      console.log(file.path);
    }
    return 0;
  }

  await writeRenderPlan(plan);
  console.log(`Wrote ${plan.files.length} farrier harness files to ${plan.targetDir}`);
  for (const file of plan.files) {
    console.log(file.path);
  }

  return 0;
}

async function runLearn(args: string[]): Promise<number> {
  const options = parseLearnArgs(args);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const targetDir = resolve(options.dir);
  const transcriptsDir = options.transcripts ? resolve(options.transcripts) : undefined;

  if (options.yes) {
    const result = await applyLearn({
      targetDir,
      transcriptsDir,
      yes: true,
      json: options.json,
      noLlm: options.noLlm,
      backend: options.backend,
      model: options.model
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ...result.report,
            applied: {
              appendedRules: result.appendedRules,
              skippedExistingIds: result.skippedExistingIds,
              rulesPath: result.rulesPath
            }
          },
          null,
          2
        )
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
    model: options.model
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(formatLearnReport(report).trimEnd());
  return 0;
}

function registryRows(
  namespaces: string[],
  catalog: PackCatalog
): Array<{ namespace: string; itemCount: number; cached: boolean }> {
  const pins = catalog.registryPins();
  return namespaces.map((namespace) => {
    const itemIds = Object.keys(pins).filter((id) => parseItemRef(id)?.namespace === namespace);
    return {
      namespace,
      itemCount: itemIds.length,
      cached: catalog.warnings.some((warning) => warning.namespace === namespace && warning.message.includes("cache"))
    };
  });
}

async function runRegistryList(args: string[], usageText: () => string): Promise<number> {
  const options = parseRegistryListArgs(args);

  if (options.help) {
    console.log(usageText());
    return 0;
  }

  const targetDir = resolve(options.dir);
  const loaded = await loadFarrierConfig({ projectDir: targetDir });
  const catalog = await loadPackCatalog({ config: loaded.config });
  const namespaces = Object.keys(loaded.config.registries);
  const registries = registryRows(namespaces, catalog);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          registries,
          warnings: catalog.warnings
        },
        null,
        2
      )
    );
    return 0;
  }

  console.log("Registries:");
  if (registries.length === 0) {
    console.log("  none configured");
  } else {
    for (const registry of registries) {
      console.log(`  ${registry.namespace}: ${registry.itemCount} items${registry.cached ? " (cached)" : ""}`);
    }
  }

  if (catalog.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of catalog.warnings) {
      console.log(`  - ${warning.namespace}: ${warning.message}`);
    }
  }

  return 0;
}

export async function main(args: string[] = Bun.argv.slice(2)): Promise<number> {
  try {
    if (args[0] === "update") {
      return await runUpdate(args.slice(1), usage);
    }

    if (args[0] === "registry") {
      if (args[1] === "list") {
        return await runRegistryList(args.slice(2), usage);
      }

      console.error("farrier: unknown registry subcommand. Usage: farrier registry list [--help]");
      return 1;
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

    if (process.stdout.isTTY === true) {
      const renderOptions = parseRenderArgs(args);

      if (!renderOptions.help && !renderOptions.stack && !renderOptions.detect && !renderOptions.yes && !renderOptions.dryRun) {
        const { runLauncher } = await import("./tui/launcher");
        const choice = await runLauncher();

        if (choice === "create") {
          const { runCreateWizard } = await import("./tui/create-app");
          return await runCreateWizard(resolve(renderOptions.dir));
        }

        if (choice === "forge") {
          const { runWizard } = await import("./tui/app");
          return await runWizard(resolve(renderOptions.dir), { context: renderOptions.context });
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

    return await runRender(args);
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
