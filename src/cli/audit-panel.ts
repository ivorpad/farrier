import { lstat, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  buildHarnessAuditPanelPacket,
  type HarnessAuditPanelPacketInput,
} from "../engine/harness-audit-panel-packet";

type AuditPanelCliOptions = {
  manifest?: string;
  output?: string;
  json: boolean;
  help: boolean;
};

function usage(): string {
  return `farrier audit-panel prepare - build an unapproved five-review packet without provider calls

Usage:
  farrier audit-panel prepare --manifest <panel.json> --output <new-directory> [--json]

Options:
  --manifest <path>  Bounded JSON manifest with five reviewers and three committed sources.
  --output <path>    New packet directory. Existing directories are never replaced.
  --json             Print a source-blind machine-readable summary.
  --help             Show this help.

The command creates 15 physical repository copies and 30 baseline/deep plans. It never
resolves or calls a model. The packet remains unusable for paid runs until a separate
external budget approval is recorded.`;
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(args: string[]): AuditPanelCliOptions {
  const options: AuditPanelCliOptions = { json: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--manifest") {
      options.manifest = requiredValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--manifest=")) options.manifest = arg.slice("--manifest=".length);
    else if (arg === "--output") {
      options.output = requiredValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else throw new Error(`Unknown audit-panel argument: ${arg}`);
  }
  return options;
}

async function readManifest(path: string): Promise<HarnessAuditPanelPacketInput> {
  const absolute = resolve(path);
  if (basename(absolute).startsWith(".env")) throw new Error("Panel manifest cannot be an environment file.");
  const stats = await lstat(absolute).catch(() => undefined);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.size > 512_000) {
    throw new Error("Panel manifest must be a physical JSON file no larger than 512000 bytes.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absolute, "utf8"));
  } catch {
    throw new Error("Panel manifest is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || !Array.isArray((parsed as Record<string, unknown>).reviewers)
    || !Array.isArray((parsed as Record<string, unknown>).sources)) {
    throw new Error("Panel manifest must contain reviewer and source arrays.");
  }
  return parsed as HarnessAuditPanelPacketInput;
}

export async function runAuditPanel(args: string[]): Promise<number> {
  if (args[0] !== "prepare") {
    if (args[0] === "--help" || args[0] === "-h" || args.length === 0) {
      console.log(usage());
      return 0;
    }
    throw new Error("audit-panel supports only the prepare subcommand");
  }
  const options = parseArgs(args.slice(1));
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.manifest || !options.output) throw new Error("audit-panel prepare requires --manifest and --output");
  const packet = await buildHarnessAuditPanelPacket(
    await readManifest(options.manifest),
    options.output,
  );
  const summary = {
    schemaVersion: packet.schemaVersion,
    status: packet.status,
    outputDir: packet.outputDir,
    reviewers: packet.reviewers.length,
    aliases: packet.reviewers.reduce((sum, reviewer) => sum + reviewer.aliases.length, 0),
    plans: packet.reviewers.reduce((sum, reviewer) =>
      sum + reviewer.aliases.reduce((count, alias) => count + alias.plans.length, 0), 0),
    budgetProposal: packet.budgetProposal,
    providerCallsMade: packet.providerCallsMade,
    externalApprovalReference: packet.externalApprovalReference,
  };
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log("Farrier blinded panel packet prepared");
    console.log(`Output: ${summary.outputDir}`);
    console.log(`Reviewers: ${summary.reviewers}; aliases: ${summary.aliases}; plans: ${summary.plans}`);
    console.log(`Proposed ceiling: ${summary.budgetProposal.maxProviderCalls} calls, ${summary.budgetProposal.maxEstimatedInputTokens} local input tokens, ${summary.budgetProposal.maxProviderCostUsd} USD`);
    console.log("Provider calls made: 0");
    console.log("Paid runs authorized: no");
  }
  return 0;
}
