import { resolve } from "node:path";
import type { ExportBackend } from "../engine/export-harness";

/**
 * Headless `farrier export`: report-only by default (like advise). The LLM
 * classification runs only with explicit --send-session-evidence consent;
 * installing the playbook requires --yes plus --install-dir after reviewing
 * the report. The TUI (farrier → Export harness) is the review surface.
 */

type ExportCliOptions = {
  dir: string;
  codexSessions?: string;
  transcripts?: string;
  name?: string;
  installDir?: string;
  agents: ("claude" | "codex")[];
  sendSessionEvidence: boolean;
  noLlm: boolean;
  yes: boolean;
  force: boolean;
  json: boolean;
  backend?: ExportBackend;
  model?: string;
  help: boolean;
};

function parseBackend(value: string): ExportBackend {
  if (value === "claude" || value === "codex") return value;
  throw new Error("--backend must be claude or codex");
}

function parseAgents(value: string): ("claude" | "codex")[] {
  const agents = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (agents.length === 0 || !agents.every((agent) => agent === "claude" || agent === "codex")) {
    throw new Error("--agents must be claude, codex, or claude,codex");
  }
  return agents as ("claude" | "codex")[];
}

function valueArg(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function parseExportArgs(args: string[]): ExportCliOptions {
  const options: ExportCliOptions = {
    dir: process.cwd(),
    agents: ["claude", "codex"],
    sendSessionEvidence: false,
    noLlm: false,
    yes: false,
    force: false,
    json: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--no-llm") options.noLlm = true;
    else if (arg === "--send-session-evidence") options.sendSessionEvidence = true;
    else if (arg === "--dir") { options.dir = valueArg(args, index, arg); index += 1; }
    else if (arg.startsWith("--dir=")) options.dir = arg.slice("--dir=".length);
    else if (arg === "--codex-sessions") { options.codexSessions = valueArg(args, index, arg); index += 1; }
    else if (arg.startsWith("--codex-sessions=")) options.codexSessions = arg.slice("--codex-sessions=".length);
    else if (arg === "--transcripts") { options.transcripts = valueArg(args, index, arg); index += 1; }
    else if (arg.startsWith("--transcripts=")) options.transcripts = arg.slice("--transcripts=".length);
    else if (arg === "--name") { options.name = valueArg(args, index, arg); index += 1; }
    else if (arg.startsWith("--name=")) options.name = arg.slice("--name=".length);
    else if (arg === "--install-dir") { options.installDir = valueArg(args, index, arg); index += 1; }
    else if (arg.startsWith("--install-dir=")) options.installDir = arg.slice("--install-dir=".length);
    else if (arg === "--agents") { options.agents = parseAgents(valueArg(args, index, arg)); index += 1; }
    else if (arg.startsWith("--agents=")) options.agents = parseAgents(arg.slice("--agents=".length));
    else if (arg === "--backend") { options.backend = parseBackend(valueArg(args, index, arg)); index += 1; }
    else if (arg.startsWith("--backend=")) options.backend = parseBackend(arg.slice("--backend=".length));
    else if (arg === "--model") { options.model = valueArg(args, index, arg); index += 1; }
    else if (arg.startsWith("--model=")) options.model = arg.slice("--model=".length);
    else throw new Error(`Unknown export argument: ${arg}`);
  }

  return options;
}

export async function runExport(args: string[], usage: () => string): Promise<number> {
  const options = parseExportArgs(args);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const targetDir = resolve(options.dir);
  const { loadFarrierConfig, resolveModelSettings } = await import("../config/farrier-config");
  const { buildExportProposal, createExportReport, formatExportReport } = await import("../engine/export-harness");

  const backend = options.backend ?? "claude";
  const models = await loadFarrierConfig({ projectDir: targetDir })
    .then((loaded) => loaded.config.models)
    .catch(() => ({}));
  const settings = resolveModelSettings({ models, backend, role: "advise", explicitModel: options.model });

  const report = await createExportReport({
    targetDir,
    codexSessionsDir: options.codexSessions ? resolve(options.codexSessions) : undefined,
    transcriptsDir: options.transcripts ? resolve(options.transcripts) : undefined,
    playbookName: options.name,
    sendSessionEvidence: options.sendSessionEvidence,
    noLlm: options.noLlm,
    backend,
    model: settings.model,
    reasoningEffort: settings.reasoningEffort
  });

  if (!options.yes) {
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatExportReport(report).trimEnd());
    }
    return report.errors.length > 0 ? 1 : 0;
  }

  if (!options.installDir) {
    throw new Error("--yes requires --install-dir <target>: export installs a portable artifact into a workspace you name.");
  }

  const installDir = resolve(options.installDir);
  const proposal = await buildExportProposal(report, { agents: options.agents });
  if (proposal.files.length === 0) {
    console.error("farrier: no portable lessons selected; nothing to install.");
    return 1;
  }

  const { applyHarnessChangePlan, inspectHarnessChangePlan } = await import("../engine/create-plan");
  const inspection = await inspectHarnessChangePlan({ targetDir: installDir, files: proposal.files });
  if (inspection.blockers.length > 0) {
    console.error(`farrier: refusing to install: ${inspection.blockers.map((blocker) => blocker.reason).join("; ")}`);
    return 1;
  }

  const result = await applyHarnessChangePlan(
    { targetDir: installDir, files: proposal.files },
    { force: options.force, allowExistingHarness: true }
  );

  if (options.json) {
    console.log(JSON.stringify({ ...report, applied: { installDir, summary: proposal.summary, written: result.writtenFiles, unchanged: result.unchangedFiles, backupDir: result.backupDir } }, null, 2));
    return 0;
  }

  console.log(formatExportReport(report).trimEnd());
  console.log("");
  console.log(proposal.summary);
  console.log(`Installed into ${installDir}:`);
  for (const file of result.writtenFiles) console.log(`  - ${file}`);
  if (result.unchangedFiles.length > 0) console.log(`Unchanged: ${result.unchangedFiles.join(", ")}`);
  return 0;
}
