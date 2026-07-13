import { createHash } from "node:crypto";
import type { AdviceEvidence, AdviceEvidenceFunnel, AdviceSessionEvidence, AdviceVendor } from "./advice-types";

type SignalInput = Omit<AdviceEvidence, "id" | "source"> & { source: AdviceVendor };
const maxSignals = 40;
const signalSessions = new WeakMap<AdviceEvidence, Set<string>>();

export function sourceFunnel(source: AdviceVendor, sessions: number, signals: AdviceEvidence[], malformed = 0): AdviceEvidenceFunnel {
  const visibleEvents = signals.reduce((sum, signal) => sum + (signal.occurrences ?? 1), 0);
  return {
    sources: [{
      source, discovered: sessions, eligible: sessions, read: sessions, parsed: sessions, visibleEvents,
      discarded: { filtering: 0, redaction: 0, deduplication: Math.max(visibleEvents - signals.length, 0), malformed, limits: 0 },
      retainedPatterns: signals.length
    }],
    visibleEvents,
    recurringPatterns: signals.filter((signal) => (signal.distinctSessions ?? 0) >= 2 || (signal.occurrences ?? 1) >= 2).length
  };
}

function signalRank(signal: AdviceEvidence): number {
  const occurrences = Math.min(signal.occurrences ?? 1, 10);
  const sessions = Math.min(signal.distinctSessions ?? 0, 10);
  return sessions * 10 + occurrences * 2 + (signal.kind === "outcome" ? 0 : 3);
}

export function selectFairSignals(groups: AdviceSessionEvidence[]): AdviceEvidence[] {
  const queues = groups.map((group) => [...group.signals].sort((left, right) =>
    signalRank(right) - signalRank(left) || left.id.localeCompare(right.id)));
  const selected: AdviceEvidence[] = [];
  while (selected.length < maxSignals && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const signal = queue.shift();
      if (signal) selected.push(signal);
      if (selected.length >= maxSignals) break;
    }
  }
  return selected;
}

export function redactSessionText(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]")
    .replace(/\b(Bearer\s+)[^\s"']+/gi, "$1[REDACTED_TOKEN]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\s+/g, " ").trim().slice(0, 240);
}

function normalizeCommand(value: string): string {
  return value.toLowerCase()
    .replace(/(?:^|\s)(?:--no-color|--color(?:=\w+)?|--verbose|-v)(?=\s|$)/g, " ")
    .replace(/["']/g, "").replace(/\.\//g, "").replace(/\s+/g, " ").trim();
}

function normalizedSignalKey(kind: string, summary: string): string {
  if (kind === "verification" || kind === "failed-command") {
    const separator = summary.indexOf(": ");
    return normalizeCommand(separator >= 0 ? summary.slice(0, separator) : summary);
  }
  return summary.toLowerCase().replace(/\b\d+\b/g, "#")
    .replace(/[/\\][\w./\\-]+/g, "[path]")
    .replace(/[^a-z0-9[\] -]+/g, " ").replace(/\s+/g, " ").trim();
}

function allowedCategories(kind: string): AdviceEvidence["allowedCategories"] {
  if (kind === "verification" || kind === "failed-command") return ["hooks", "guidance", "skills"];
  if (kind === "correction" || kind === "guidance-edit") return ["guidance", "skills"];
  if (kind === "delegation") return ["subagents", "skills"];
  if (kind === "external-lookup") return ["mcp", "plugins", "skills"];
  if (kind === "manual-workflow" || kind === "outcome") return ["skills", "subagents", "hooks"];
  return ["skills"];
}

export function addSessionSignal(signals: AdviceEvidence[], input: SignalInput): void {
  const summary = redactSessionText(input.summary);
  if (!summary) return;
  const key = `${input.source}:${input.kind}:${normalizedSignalKey(input.kind, summary)}`;
  const id = `session:${input.source}:${input.kind}:${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
  const existing = signals.find((signal) => signal.id === id);
  if (existing) {
    existing.occurrences = (existing.occurrences ?? 1) + (input.occurrences ?? 1);
    const sessions = signalSessions.get(existing) ?? new Set<string>();
    if (input.sessionId) sessions.add(input.sessionId);
    signalSessions.set(existing, sessions);
    existing.distinctSessions = sessions.size;
    return;
  }
  const signal: AdviceEvidence = {
    ...input, summary, id, occurrences: input.occurrences ?? 1, distinctSessions: input.sessionId ? 1 : 0,
    allowedCategories: allowedCategories(input.kind), targetVendors: ["claude", "codex"]
  };
  signals.push(signal);
  signalSessions.set(signal, new Set(input.sessionId ? [input.sessionId] : []));
}
