import { resolve } from "node:path";
import { loadFarrierConfig, resolveModelSettings } from "../config/farrier-config";
import { adviseSkills, detectAgentBackend, resolveContext, type AdviseBackend } from "../engine/advise";
import {
  adviceCategories,
  adviceSessionLookbackLabel,
  isAdviceCategory,
  isAdviceSessionLookback,
  type AdviceCategory,
  type AdviceReport,
  type AdviceSessionLookback,
  type AdviceVendor
} from "../engine/advice-types";
import { profileProject, projectProfileSummary } from "../engine/project-profile";
import { adviseProject } from "../engine/project-advice";
import { createRecentSessionConsent, listProjectSessions, type SessionConsent } from "../engine/advice-sessions";
import {
  assertHarnessAuditBudget,
  auditHarness,
  harnessAuditFailed,
  planHarnessAudit,
} from "../engine/harness-audit";
import { isHarnessAuditMode, type HarnessAuditMode } from "../engine/harness-audit-types";
import { formatHarnessAuditPlan, formatHarnessAuditReport } from "../engine/harness-audit-format";

export type AdviseCliOptions = {
  dir: string;
  context?: string;
  backend?: AdviseBackend;
  model?: string;
  mode?: HarnessAuditMode;
  sessions: "auto" | "none";
  since: AdviceSessionLookback;
  targets?: AdviceVendor[];
  only?: AdviceCategory[];
  concurrency?: number;
  legacySkills: boolean;
  plan: boolean;
  maxModelCalls?: number;
  maxEstimatedInputTokens?: number;
  maxProviderCostUsdPerCall?: number;
  json: boolean;
  help: boolean;
};

function adviseUsage(): string {
  return `farrier advise — inspect a project and recommend agent configuration improvements

Usage:
  farrier advise --dir <target> [--sessions auto|none] [--since 7d|14d|all] [--targets claude|codex]
                 [--only guidance,hooks,skills,subagents,plugins,mcp]
                 [--backend claude|codex] [--model <name>] [--json]
  farrier advise --dir <target> --mode quick|baseline|deep [--plan]
                 [--max-model-calls <n>] [--max-estimated-input-tokens <n>]
                 [--max-provider-cost-usd-per-call <amount>]
                 [--backend claude|codex] [--model <name>] [--json]
  farrier advise skills [--dir <target>] [--context <path|text>] [--backend claude|codex] [--json]

Options:
  --dir <path>          Project directory. Defaults to the current working directory.
  --sessions <mode>     Use code only (none, default), or explicitly include up to 20 recent matching sessions (auto).
  --since <window>      Session lookback: 7d (default), 14d, or all.
  --targets <vendor>    Recommendation target; must match --backend. Defaults to the selected backend.
  --only <categories>   Limit the provider-native project report to selected categories.
  --concurrency <n>     Concurrent recommendation workers for the provider-native report (default 3).
  --context <path|text> Optional context for the legacy skill-only advisor.
  --backend <name>      Reasoning backend: claude or codex. Defaults to Claude when both are found.
  --model <name>        Backend model override.
  --mode <name>         Harness audit: quick (0 calls), baseline (up to 1 call), or deep (up to 3 evidence-gated calls).
  --plan                Show exact local prompt sizes and planned calls without resolving or calling a backend.
  --max-model-calls <n> Stop before backend discovery when the planned call count exceeds n.
  --max-estimated-input-tokens <n>
                        Stop before backend discovery when the local input estimate exceeds n.
  --max-provider-cost-usd-per-call <amount>
                        Required for paid Claude audits. Passes Claude's native spend cap to every model call.
  --json                Emit the same report object as machine-readable JSON.
  --help                Show this help.

Controlled comparison:
  Save baseline and deep --plan --json records before paid runs, then use the same explicit backend and model.
  Provider overhead, output tokens, and retries are not capped by --max-estimated-input-tokens.
  Claude model calls fail closed unless --max-provider-cost-usd-per-call is present.
  Report-only prevents writes, not provider calls. Quick and --plan are the zero-call paths.
  Baseline also skips its call when no artifact line can satisfy the exact citation contract.`;
}

function parseBackend(value: string): AdviseBackend {
  if (value === "claude" || value === "codex") return value;
  throw new Error("--backend must be claude or codex");
}

function commaValues(value: string, flag: string): string[] {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) throw new Error(`${flag} requires at least one value`);
  return Array.from(new Set(values));
}

function parseTargets(value: string): AdviceVendor[] {
  if (value !== "claude" && value !== "codex") throw new Error("--targets must be exactly one provider: claude or codex");
  return [value];
}

function parseOnly(value: string): AdviceCategory[] {
  const values = commaValues(value, "--only");
  if (values.some((item) => !isAdviceCategory(item))) throw new Error(`--only must contain only ${adviceCategories.join(",")}`);
  return values as AdviceCategory[];
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function nonNegativeInteger(value: string, flag: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${flag} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a safe integer`);
  return parsed;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = nonNegativeInteger(value, flag);
  if (parsed < 1) throw new Error(`${flag} must be at least 1`);
  return parsed;
}

function positiveFiniteNumber(value: string, flag: string): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error(`${flag} must be a positive decimal number`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive decimal number`);
  }
  return parsed;
}

export function parseAdviseArgs(args: string[]): AdviseCliOptions {
  const options: AdviseCliOptions = {
    dir: process.cwd(),
    sessions: "none",
    since: "7d",
    legacySkills: args[0] === "skills",
    plan: false,
    json: false,
    help: false
  };
  const start = options.legacySkills ? 1 : 0;

  for (let index = start; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--plan") options.plan = true;
    else if (arg === "--max-model-calls") {
      options.maxModelCalls = nonNegativeInteger(requiredValue(args, index, arg), arg);
      index += 1;
    }
    else if (arg.startsWith("--max-model-calls=")) {
      options.maxModelCalls = nonNegativeInteger(arg.slice(18), "--max-model-calls");
    }
    else if (arg === "--max-estimated-input-tokens") {
      options.maxEstimatedInputTokens = nonNegativeInteger(requiredValue(args, index, arg), arg);
      index += 1;
    }
    else if (arg.startsWith("--max-estimated-input-tokens=")) {
      options.maxEstimatedInputTokens = nonNegativeInteger(arg.slice(29), "--max-estimated-input-tokens");
    }
    else if (arg === "--max-provider-cost-usd-per-call") {
      options.maxProviderCostUsdPerCall = positiveFiniteNumber(requiredValue(args, index, arg), arg);
      index += 1;
    }
    else if (arg.startsWith("--max-provider-cost-usd-per-call=")) {
      options.maxProviderCostUsdPerCall = positiveFiniteNumber(
        arg.slice("--max-provider-cost-usd-per-call=".length),
        "--max-provider-cost-usd-per-call",
      );
    }
    else if (arg === "--dir") { options.dir = requiredValue(args, index, arg); index += 1; }
    else if (arg.startsWith("--dir=")) options.dir = arg.slice(6);
    else if (arg === "--context") { options.context = requiredValue(args, index, arg); index += 1; }
    else if (arg.startsWith("--context=")) options.context = arg.slice(10);
    else if (arg === "--backend") { options.backend = parseBackend(requiredValue(args, index, arg)); index += 1; }
    else if (arg.startsWith("--backend=")) options.backend = parseBackend(arg.slice(10));
    else if (arg === "--model") { options.model = requiredValue(args, index, arg); index += 1; }
    else if (arg.startsWith("--model=")) options.model = arg.slice(8);
    else if (arg === "--mode") {
      const value = requiredValue(args, index, arg);
      if (!isHarnessAuditMode(value)) throw new Error("--mode must be quick, baseline, or deep");
      options.mode = value;
      index += 1;
    } else if (arg.startsWith("--mode=")) {
      const value = arg.slice(7);
      if (!isHarnessAuditMode(value)) throw new Error("--mode must be quick, baseline, or deep");
      options.mode = value;
    }
    else if (arg === "--sessions") {
      const value = requiredValue(args, index, arg);
      if (value !== "auto" && value !== "none") throw new Error("--sessions must be auto or none");
      options.sessions = value;
      index += 1;
    } else if (arg.startsWith("--sessions=")) {
      const value = arg.slice(11);
      if (value !== "auto" && value !== "none") throw new Error("--sessions must be auto or none");
      options.sessions = value;
    } else if (arg === "--since") {
      const value = requiredValue(args, index, arg);
      if (!isAdviceSessionLookback(value)) throw new Error("--since must be 7d, 14d, or all");
      options.since = value;
      index += 1;
    } else if (arg.startsWith("--since=")) {
      const value = arg.slice(8);
      if (!isAdviceSessionLookback(value)) throw new Error("--since must be 7d, 14d, or all");
      options.since = value;
    } else if (arg === "--targets") { options.targets = parseTargets(requiredValue(args, index, arg)); index += 1; }
    else if (arg.startsWith("--targets=")) options.targets = parseTargets(arg.slice(10));
    else if (arg === "--only") { options.only = parseOnly(requiredValue(args, index, arg)); index += 1; }
    else if (arg.startsWith("--only=")) options.only = parseOnly(arg.slice(7));
    else if (arg === "--concurrency") {
      options.concurrency = positiveInteger(requiredValue(args, index, arg), arg);
      index += 1;
    }
    else if (arg.startsWith("--concurrency=")) options.concurrency = positiveInteger(arg.slice(14), "--concurrency");
    else throw new Error(`Unknown advise argument: ${arg}`);
  }

  return options;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSources(report: AdviceReport): string {
  return report.sessions.sources.map((source) => `${source.source} ${source.count}`).join(", ") || "none";
}

export function formatAdviceReport(report: AdviceReport): string {
  const sessionCount = report.sessions.sources.reduce((sum, source) => sum + source.count, 0);
  const funnel = report.sessions.funnel ?? { sources: [], visibleEvents: report.sessions.evidence.length, recurringPatterns: 0 };
  const episodeCount = report.sessions.episodes?.length ?? funnel.retainedEpisodes ?? report.sessions.evidence.length;
  const lines = [
    "Farrier project advice — report only",
    `Project: ${report.targetDir}`,
    `Backend: ${report.backend}${report.model ? ` (${report.model})` : ""}`,
    ...(report.policy ? [`Policy: ${report.policy.id}`] : []),
    ...(report.analysis ? [
      `Analysis: ${report.analysis.mode} (${report.analysis.status}; concurrency ${report.analysis.concurrency})`,
      `Calls: ${report.analysis.workerCalls} worker, ${report.analysis.coordinatorCalls} coordinator, ${report.analysis.recoveryCalls} repair`,
      ...(report.analysis.status === "partial"
        ? [`PARTIAL REPORT: failed categories: ${report.analysis.categories.filter((item) => item.status === "failed").map((item) => item.category).join(", ")}`]
        : []),
    ] : []),
    `Sessions: ${report.sessions.included ? "included" : "not included"} (${adviceSessionLookbackLabel(report.sessions.lookback)}; ${formatSources(report)})`,
    `Evidence funnel: ${sessionCount} sessions → ${episodeCount} retained episodes → ${report.recommendations.length} supported recommendations`,
    ...(report.evidence ? [`Comparable evidence: ${report.evidence.result} (digest ${report.evidence.inputDigest})`] : []),
    "",
    "Codebase profile",
    `  Stacks: ${report.profile.stacks.join(", ") || "generic"}`,
    `  Languages: ${report.profile.languages.join(", ") || "unknown"}`,
    `  Package managers: ${(report.profile.packageManagers ?? []).join(", ") || "unknown"}`,
    `  Dependencies: ${(report.profile.dependencies ?? []).map((item) => item.name).join(", ") || "none detected"}`,
    `  Capabilities: ${(report.profile.capabilities ?? []).map((item) => `${item.group}:${item.name}`).join(", ") || "none detected"}`,
    `  Workflows: ${(report.profile.workflows ?? []).map((item) => `${item.kind}:${item.name}`).join(", ") || "none detected"}`,
    `  Tests: ${report.profile.tests.join(", ") || "none detected"}`,
    `  CI: ${report.profile.ci.join(", ") || "none detected"}`,
    `  Repository facts: ${report.profile.repositoryFacts?.length ?? 0} (${report.profile.repositoryCoverage?.complete ? "complete bounded scan" : "incomplete bounded scan"})`,
    `  Installed skills: ${report.profile.skillInventory?.entries.map((item) => `${item.name} [${item.topologies.join("+") || "unknown"}; ${item.provenance}]`).join(", ") || "none detected"}`,
    `  Skill inventory coverage: ${report.profile.skillInventory?.complete ? "complete" : "incomplete"}`,
    "",
    "Registry searches"
  ];
  if (!report.registry?.queries.length) lines.push("  None for the selected categories.");
  for (const query of report.registry?.queries ?? []) {
    lines.push(`  ${query.query} ← ${query.evidence.join(", ")} → ${query.matches.join(", ") || "no verified matches"}`);
  }
  if (report.registry?.verifiedMatches.length) lines.push(`  Verified matches: ${report.registry.verifiedMatches.join(", ")}`);
  lines.push("", "Recommendations");
  const evidence = new Map([...report.profile.evidence, ...report.sessions.evidence].map((item) => [item.id, item]));
  if (report.recommendations.length === 0) lines.push("  No supported high-value recommendations.");
  for (const category of adviceCategories) {
    const recommendations = report.recommendations.filter((item) => item.category === category);
    if (recommendations.length === 0) continue;
    lines.push("", category.toUpperCase());
    for (const recommendation of recommendations) {
      lines.push(`  ${recommendation.id} [${recommendation.confidence}] → ${recommendation.targetVendors.join(", ")}`);
      if (recommendation.evidenceOrigin) lines.push(`    Origin: ${recommendation.evidenceOrigin}`);
      lines.push(`    Why: ${recommendation.reason}`);
      lines.push(`    Benefit: ${recommendation.benefit}`);
      lines.push(`    Route: ${recommendation.implementationRoute.description}`);
      if (recommendation.registryRef) lines.push(`    Registry: ${recommendation.registryRef}`);
      for (const evidenceId of recommendation.evidence) {
        const item = evidence.get(evidenceId);
        lines.push(`    Evidence: ${evidenceId}${item ? ` — ${item.summary}` : ""}`);
      }
    }
  }
  if ((report.omittedRecommendations ?? []).length > 0) {
    lines.push("", "Omitted by presentation bounds");
    for (const item of report.omittedRecommendations ?? []) {
      lines.push(`  ${item.recommendation.id} [${item.recommendation.category}]`);
      if (item.recommendation.evidenceOrigin) lines.push(`    Origin: ${item.recommendation.evidenceOrigin}`);
      lines.push(`    Why omitted: ${item.reason}`);
      lines.push(`    Opportunity: ${item.recommendation.reason}`);
    }
  }
  if ((report.weakLeads ?? []).length > 0) {
    lines.push("", "Weak leads");
    for (const recommendation of report.weakLeads ?? []) {
      lines.push(`  ${recommendation.id} [low] → ${recommendation.targetVendors.join(", ")}`);
      if (recommendation.evidenceOrigin) lines.push(`    Origin: ${recommendation.evidenceOrigin}`);
      lines.push(`    Why confidence is low: ${recommendation.reason}`);
      lines.push("    Would strengthen: a clearer reusable procedure or another independent codebase/session signal.");
      lines.push(`    Possible benefit: ${recommendation.benefit}`);
    }
  }
  if (report.coverage.length > 0) {
    lines.push("", "Coverage");
    for (const item of report.coverage) {
      lines.push(`  ${item.status === "accepted" ? "✓" : "–"} ${item.category} [${item.status}]: ${item.reason}`);
    }
  }
  lines.push("", "Evidence diagnostics");
  for (const source of funnel.sources) {
    const discarded = Object.entries(source.discarded).filter(([, count]) => count > 0).map(([reason, count]) => `${reason} ${count}`).join(", ") || "none";
    lines.push(`  ${source.source}: discovered ${source.discovered}, eligible ${source.eligible}, read ${source.read}, parsed ${source.parsed}, episodes ${source.retainedEpisodes ?? source.retainedPatterns}, omitted ${source.omittedEpisodes ?? 0}, truncated ${source.truncatedEpisodes ?? 0}, discarded ${discarded}`);
  }
  if (funnel.recommendation) {
    const item = funnel.recommendation;
    lines.push(`  backend: model calls ${item.modelCalls ?? 1} (${item.successfulModelCalls ?? item.modelCalls ?? 1} succeeded, ${item.failedModelCalls ?? 0} failed), retained episodes ${item.patternsSent}, returned ${item.returned}, validated ${item.accepted}, recovered locally ${item.localRecoveries ?? 0}, rejected ${item.rejected}, overlap omissions ${item.merged}, repair calls ${item.recoveryCalls}`);
  }
  if (report.notes.length > 0) {
    lines.push("", "Notes");
    for (const note of report.notes) lines.push(`  - ${note}`);
  }
  return `${lines.join("\n")}\n`;
}

async function resolveBackend(options: AdviseCliOptions): Promise<AdviseBackend | undefined> {
  if (options.backend) {
    if (!Bun.which(options.backend)) return undefined;
    return options.backend;
  }
  return detectAgentBackend();
}

async function runLegacySkills(options: AdviseCliOptions, backend: AdviseBackend, targetDir: string): Promise<number> {
  let context = await resolveContext({ targetDir, context: options.context });
  if (!context) {
    const profile = await profileProject(targetDir);
    context = { source: "deterministic-project-profile", text: projectProfileSummary(profile) };
  }
  const models = await loadFarrierConfig({ projectDir: targetDir }).then((loaded) => loaded.config.models).catch(() => ({}));
  const settings = resolveModelSettings({ models, backend, role: "advise", explicitModel: options.model });
  const profile = await profileProject(targetDir);
  const result = await adviseSkills({
    targetDir,
    packId: profile.stacks[0] ?? "generic",
    contextText: context.text,
    backend,
    model: settings.model,
    reasoningEffort: settings.reasoningEffort
  });
  const output = { backend: result.backend, contextSource: context.source, queries: result.queries, recommendations: result.recommendations, notes: [...result.notes, "Report only: no skills were installed."] };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log("Farrier skill advice — report only");
    console.log(`Backend: ${result.backend}`);
    console.log(`Context: ${context.source}`);
    console.log(`Queries: ${result.queries.join(", ") || "none"}`);
    console.log("");
    if (result.recommendations.length === 0) console.log("No skill recommendations.");
    else for (const recommendation of result.recommendations) console.log(`  ${recommendation.ref} — ${recommendation.reason} (${recommendation.installs} installs)`);
    console.log("\nReport only: Farrier did not install skills or change project configuration.");
    for (const note of result.notes) console.log(`  - ${note}`);
  }
  return 0;
}

export async function runAdvise(args: string[]): Promise<number> {
  const options = parseAdviseArgs(args);
  if (options.help) { console.log(adviseUsage()); return 0; }
  const targetDir = resolve(options.dir);
  if (options.plan && !options.mode) throw new Error("--plan requires --mode quick, baseline, or deep");
  if ((options.maxModelCalls !== undefined
    || options.maxEstimatedInputTokens !== undefined
    || options.maxProviderCostUsdPerCall !== undefined) && !options.mode) {
    throw new Error("audit budget limits require --mode quick, baseline, or deep");
  }
  if (options.mode) {
    if (options.sessions !== "none") throw new Error("--mode audits repository harness files only and cannot be combined with --sessions auto");
    if (options.only || options.targets) throw new Error("--mode cannot be combined with --only or --targets");
    if (options.maxProviderCostUsdPerCall !== undefined && options.plan) {
      throw new Error("--max-provider-cost-usd-per-call applies to an executed Claude audit, not --plan");
    }
    if (options.maxProviderCostUsdPerCall !== undefined && options.mode === "quick") {
      throw new Error("--max-provider-cost-usd-per-call applies only to baseline or deep audits");
    }
    if (options.maxProviderCostUsdPerCall !== undefined && options.backend === "codex") {
      throw new Error("--max-provider-cost-usd-per-call is supported only by --backend claude");
    }
    if (options.plan) {
      try {
        const plan = await planHarnessAudit({ targetDir, mode: options.mode });
        assertHarnessAuditBudget(plan, options);
        if (options.json) console.log(JSON.stringify(plan, null, 2));
        else console.log(formatHarnessAuditPlan(plan).trimEnd());
        return 0;
      } catch (error) {
        console.error(`farrier advise: ${errorMessage(error)}`);
        return 1;
      }
    }
    if (options.maxModelCalls !== undefined || options.maxEstimatedInputTokens !== undefined) {
      try {
        const plan = await planHarnessAudit({ targetDir, mode: options.mode });
        assertHarnessAuditBudget(plan, options);
      } catch (error) {
        console.error(`farrier advise: ${errorMessage(error)}`);
        return 1;
      }
    }
    const backend = options.mode === "quick" ? undefined : await resolveBackend(options);
    if (options.mode !== "quick" && !backend) {
      const detail = options.backend ? `requested backend '${options.backend}' was not found on PATH` : "no agent backend found; install claude or codex, or pass --backend";
      console.error(`farrier advise: ${detail}.`);
      return 1;
    }
    try {
      const settings = backend
        ? await loadFarrierConfig({ projectDir: targetDir })
          .then((loaded) => resolveModelSettings({ models: loaded.config.models, backend, role: "advise", explicitModel: options.model }))
          .catch(() => resolveModelSettings({ models: {}, backend, role: "advise", explicitModel: options.model }))
        : {};
      const report = await auditHarness({
        targetDir,
        mode: options.mode,
        backend,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        maxModelCalls: options.maxModelCalls,
        maxEstimatedInputTokens: options.maxEstimatedInputTokens,
        maxProviderCostUsdPerCall: options.maxProviderCostUsdPerCall,
        onProgress: ({ message }) => console.error(`farrier advise: ${message}`),
      });
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else console.log(formatHarnessAuditReport(report).trimEnd());
      return harnessAuditFailed(report) ? 1 : 0;
    } catch (error) {
      console.error(`farrier advise: ${errorMessage(error)}`);
      return 1;
    }
  }
  const backend = await resolveBackend(options);
  if (!backend) {
    const detail = options.backend ? `requested backend '${options.backend}' was not found on PATH` : "no agent backend found; install claude or codex, or pass --backend";
    console.error(`farrier advise: ${detail}.`);
    return 1;
  }

  try {
    if (options.legacySkills) return await runLegacySkills(options, backend, targetDir);
    const models = await loadFarrierConfig({ projectDir: targetDir }).then((loaded) => loaded.config.models).catch(() => ({}));
    const settings = resolveModelSettings({ models, backend, role: "advise", explicitModel: options.model });
    let sessionConsent: SessionConsent | undefined;
    let sessionMode = options.sessions;
    if (options.sessions === "auto") {
      console.error(`farrier advise: Listing ${backend} metadata for the selected project and ${adviceSessionLookbackLabel(options.since)}…`);
      const inventory = await listProjectSessions({
        targetDir,
        targets: [backend],
        lookback: options.since,
      });
      sessionConsent = createRecentSessionConsent({ inventory, provider: backend });
      if (sessionConsent) {
        console.error(`farrier advise: Explicit --sessions auto consented ${sessionConsent.selected.length} fingerprinted ${backend} session(s).`);
      } else {
        console.error(`farrier advise: No matching ${backend} sessions found; continuing with repository evidence only.`);
        sessionMode = "none";
      }
    }
    const report = await adviseProject({
      targetDir,
      backend,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      sessions: sessionMode,
      sessionConsent,
      lookback: options.since,
      targets: options.targets,
      only: options.only,
      concurrency: options.concurrency,
      onProgress: ({ message }) => console.error(`farrier advise: ${message}`)
    });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatAdviceReport(report).trimEnd());
    return report.analysis?.status === "partial" ? 1 : 0;
  } catch (error) {
    console.error(`farrier advise: ${errorMessage(error)}`);
    return 1;
  }
}
