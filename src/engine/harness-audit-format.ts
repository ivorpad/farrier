import type { HarnessAuditPlan } from "./harness-audit";
import { harnessAuditLayers, type HarnessAuditReport } from "./harness-audit-types";

export function formatHarnessAuditPlan(plan: HarnessAuditPlan): string {
  const lines = [
    "Farrier harness audit plan - zero model calls made",
    `Project: ${plan.targetDir}`,
    `Mode: ${plan.mode}`,
    `Deterministic findings: ${plan.deterministicFindings}`,
    `Planned model calls: ${plan.plannedModelCalls}`,
    `Maximum concurrency: ${plan.maxConcurrency}`,
    `Local prompts: ${plan.promptBytes} UTF-8 bytes, about ${plan.estimatedInputTokens} input tokens`,
    `Corpus: ${plan.corpus.filesRead} files, ${plan.corpus.linesSupplied} non-empty lines, ${plan.corpus.checksPerformed} counterchecks`,
    `Corpus digest: ${plan.corpus.digest}`,
    "",
    "Planned scopes",
  ];
  if (!plan.scopes.length) {
    lines.push(plan.mode === "quick"
      ? "  None. This mode is deterministic."
      : "  None. No evidence-eligible model scope was selected.");
  }
  for (const scope of plan.scopes) {
    lines.push(`  ${scope.scope}: ${scope.promptBytes} bytes, about ${scope.estimatedInputTokens} input tokens, ${scope.linesSupplied} lines, ${scope.checksSupplied} counterchecks`);
  }
  if (plan.skippedScopes.length) {
    lines.push("", "Skipped scopes");
    for (const scope of plan.skippedScopes) lines.push(`  ${scope.scope}: ${scope.reason}`);
  }
  lines.push("", `Estimate limit: ${plan.estimateNote}`);
  return `${lines.join("\n")}\n`;
}

export function formatHarnessAuditReport(report: HarnessAuditReport): string {
  const lines = [
    "Farrier harness audit — report only",
    `Project: ${report.targetDir}`,
    `Mode: ${report.mode}`,
    ...(report.backend ? [`Backend: ${report.backend}${report.model ? ` (${report.model})` : ""}`] : []),
    ...(report.executionBudget ? [
      `Execution budget: ${report.executionBudget.maxModelCalls ?? "not set"} calls, ${report.executionBudget.maxEstimatedInputTokens ?? "not set"} estimated local input tokens, ${report.executionBudget.maxProviderCostUsdPerCall ?? "not set"} USD per Claude call`,
    ] : []),
    `Calls: ${report.metrics.modelCalls} model (${report.metrics.successfulModelCalls} succeeded, ${report.metrics.failedModelCalls} failed)`,
    `Tokens: ${report.metrics.inputTokens} input, ${report.metrics.outputTokens} output (${report.metrics.tokenAccounting})`,
    `Latency: ${report.metrics.latencyMs} ms wall, ${report.metrics.cumulativeModelTimeMs} ms cumulative model time`,
    `Corpus: ${report.corpus.filesRead} files, ${report.corpus.linesSupplied} non-empty lines, ${report.corpus.checksPerformed} counterchecks`,
    `Corpus digest: ${report.corpus.digest}`,
    "",
    "Recommendations",
  ];
  if (!report.recommendations.length) lines.push("  No evidence-bound harness defects found.");
  for (const recommendation of report.recommendations) {
    lines.push("", `${recommendation.severity.toUpperCase()} ${recommendation.id} [${recommendation.layer}; ${recommendation.source}]`);
    lines.push(`  ${recommendation.title}`);
    lines.push(`  Defect: ${recommendation.defect}`);
    lines.push("  Evidence:");
    for (const citation of recommendation.citations) {
      lines.push(`    ${citation.path}:${citation.line} — ${citation.excerpt}`);
    }
    lines.push("  Counterchecks performed:");
    for (const check of recommendation.counterchecks) {
      lines.push(`    ${check.description} ${check.result}`);
    }
    lines.push(`  Proposed artifact: ${recommendation.proposal.artifact}`);
    lines.push(`  Proposed change: ${recommendation.proposal.change}`);
    lines.push(`  Risk: ${recommendation.risk}`);
    lines.push(`  Remaining uncertainty: ${recommendation.uncertainty}`);
  }
  lines.push("", "Coverage");
  for (const layer of harnessAuditLayers) {
    const item = report.coverage.find((entry) => entry.layer === layer)!;
    lines.push(`  ${item.layer}: ${item.status} — ${item.reason}`);
  }
  if (report.corpus.skipped.length) {
    lines.push("", "Corpus limits");
    for (const item of report.corpus.skipped.slice(0, 30)) lines.push(`  ${item.path}: ${item.reason}`);
    if (report.corpus.skipped.length > 30) lines.push(`  ${report.corpus.skipped.length - 30} more omitted.`);
  }
  if (report.notes.length) {
    lines.push("", "Notes");
    for (const note of report.notes) lines.push(`  - ${note}`);
  }
  return `${lines.join("\n")}\n`;
}
