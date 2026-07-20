import { formatAdviceReport } from "../cli/advise";
import type {
  SessionIndexEntry,
  SessionMetadataInventory,
} from "../engine/advice-sessions";
import type {
  AdviceRecommendation,
  AdviceReport,
  AdviceSessionCountInventory,
  AdviceSessionLookback,
  AdviceSessionSourceSummary,
} from "../engine/advice-types";
import type { AgentAvailability, AgentBackend } from "../engine/backend";
import { palette } from "./chrome";
import { binding, defineBindings, resolveIntent } from "./keymap";

export function backendName(backend: AgentBackend): "Claude" | "Codex" {
  return backend === "claude" ? "Claude" : "Codex";
}

export function adviceBackendControlLabel(
  backend: AgentBackend,
  availability: AgentAvailability,
): string {
  const availabilityLabel = availability.claude && availability.codex
    ? "Claude and Codex available"
    : `${availability.claude ? "Codex" : "Claude"} unavailable`;
  return `Reasoning backend: ‹ ${backendName(backend)} › · ${availabilityLabel}`;
}

const adviceCancelBindings = defineBindings(
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit"),
);

export function isAdviceCancelKey(key: { name: string; ctrl?: boolean }): boolean {
  return resolveIntent(adviceCancelBindings, key) !== undefined;
}

export function adjacentAdviceRecommendationIndex(
  current: number,
  total: number,
  direction: -1 | 1,
): number {
  return Math.min(Math.max(current + direction, 0), Math.max(total - 1, 0));
}

export function sessionEntriesForLookback(
  entries: readonly SessionIndexEntry[],
  lookback: AdviceSessionLookback,
  now = Date.now(),
): SessionIndexEntry[] {
  if (lookback === "all") return [...entries];
  const cutoff = now - (lookback === "7d" ? 7 : 14) * 86_400_000;
  return entries.filter((entry) => Date.parse(entry.updatedAt) >= cutoff);
}

export function adviceSessionCountsFromMetadata(
  inventory: SessionMetadataInventory,
  now = Date.now(),
): AdviceSessionCountInventory {
  const counts = (lookback: AdviceSessionLookback): AdviceSessionSourceSummary[] =>
    (["claude", "codex"] as const).map((source) => ({
      source,
      count: sessionEntriesForLookback(inventory.entries, lookback, now)
        .filter((entry) => entry.provider === source).length,
    }));
  return { "7d": counts("7d"), "14d": counts("14d"), all: counts("all") };
}

export function formatAdviceTuiReportLines(report: AdviceReport): string[] {
  return formatAdviceReport(report).trimEnd().split("\n");
}

export function reportLineColor(line: string): string {
  if (line === "Farrier project advice — report only") return palette.accent;
  if (
    ["Codebase profile", "Recommendations", "Weak leads", "Coverage", "Evidence diagnostics", "Notes"].includes(line)
    || /^[A-Z]+$/.test(line)
  ) return palette.gold;
  if (line.startsWith("  - ")) return palette.muted;
  return palette.text;
}

export function adviceNoRecommendationSummary(report: AdviceReport): string {
  const weakLeadCount = report.weakLeads?.length ?? 0;
  if (weakLeadCount) {
    return `No medium/high-confidence recommendation passed. The full report contains ${weakLeadCount} weak lead${weakLeadCount === 1 ? "" : "s"}.`;
  }
  const funnel = report.sessions.funnel?.recommendation;
  if (funnel?.returned && funnel.rejected === funnel.returned) {
    const firstReason = funnel.rejectionReasons[0];
    return `${backendName(report.backend)} returned ${funnel.returned} candidate${funnel.returned === 1 ? "" : "s"}; Farrier rejected all of them.${firstReason ? ` First rejection: ${firstReason}` : ""}`;
  }
  if (funnel?.returned === 0) {
    return `${backendName(report.backend)} returned no candidates. The Coverage section records its reason for each category.`;
  }
  return "No supported recommendation passed. Review Coverage and Notes below; there is nothing available to create.";
}

export type AdviceDecisionSummary = {
  why: string;
  benefit: string;
  evidence: string;
  creates: string;
};

export function adviceDecisionSummary(
  report: AdviceReport,
  recommendation: AdviceRecommendation,
): AdviceDecisionSummary {
  const allEvidence = [...report.profile.evidence, ...report.sessions.evidence];
  const evidenceById = new Map(allEvidence.map((item) => [item.id, item]));
  const matched = recommendation.evidence.flatMap((id) => evidenceById.get(id) ?? []);
  const primary = matched[0];
  const signalCount = matched.length || recommendation.evidence.length;
  const more = signalCount > 1 ? ` · +${signalCount - 1} more` : "";
  const evidence = primary
    ? `${primary.source}${primary.path ? ` · ${primary.path}` : ""}: ${primary.summary}${more}`
    : recommendation.evidence.join(", ");
  return {
    why: recommendation.reason,
    benefit: recommendation.benefit,
    evidence,
    creates: recommendation.implementationRoute.description,
  };
}
