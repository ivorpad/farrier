import type { HookId, PackHookRef } from "../packs/types";
import type { FailureSignal } from "./learn-signals";

/**
 * The failure→primitive router: for each mined failure signal, choose the
 * cheapest primitive that makes the failure unrepeatable and emit it as a
 * reviewable proposal. Nothing here writes files or hook code — a guard
 * instance is parameters + a teaching message for an engine-owned template,
 * a rules line is one declarative sentence, a skill suggestion is a search
 * query. The surface (TUI) applies proposals only after explicit
 * confirmation.
 */

export type PrimitiveProposal =
  | {
      kind: "guard-instance";
      id: string;
      title: string;
      hookId: HookId;
      /** Subtree to merge into the manifest `guards` record. */
      guardsPatch: Record<string, unknown>;
      message: string;
      evidence: FailureSignal[];
    }
  | {
      kind: "rules-line";
      id: string;
      title: string;
      /** One declarative sentence for AGENTS.md Hard Rules / quality.rules. */
      line: string;
      message: string;
      evidence: FailureSignal[];
    }
  | {
      kind: "skill-suggestion";
      id: string;
      title: string;
      /** Query for the existing skill-registry search / `skill new` flow. */
      query: string;
      message: string;
      evidence: FailureSignal[];
    };

export type RouteInput = {
  signals: FailureSignal[];
  installedHookIds: readonly PackHookRef[];
  /** The manifest `guards` record, when present. */
  guards?: unknown;
};

const skillSuggestionMinCount = 4;
const skillSuggestionMinSessions = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slug(value: string): string {
  const slugged = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slugged.length > 0 ? slugged : "signal";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function citeEvidence(signals: readonly FailureSignal[]): string {
  const count = signals.reduce((total, signal) => total + signal.count, 0);
  const sessions = new Set(signals.flatMap((signal) => signal.sessionRefs)).size;
  const dates = Array.from(new Set(signals.flatMap((signal) => signal.dates))).sort();
  const when = dates.length > 0 ? ` (${dates[0]}${dates.length > 1 ? ` to ${dates[dates.length - 1]}` : ""})` : "";
  return `Seen ${count}× across ${sessions} session(s)${when}`;
}

function existingTeardownPatterns(guards: unknown): RegExp[] {
  if (!isRecord(guards) || !isRecord(guards.processTeardown)) return [];
  const patterns = guards.processTeardown.patterns;
  if (!Array.isArray(patterns)) return [];
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    try {
      compiled.push(new RegExp(pattern));
    } catch {
      // Doctor flags invalid patterns; the router just cannot dedupe on them.
    }
  }
  return compiled;
}

function routeOversizedCommit(signals: FailureSignal[], input: RouteInput): PrimitiveProposal | undefined {
  const relevant = signals.filter((signal) => signal.class === "oversized-commit");
  if (relevant.length === 0) return undefined;
  if (input.installedHookIds.includes("large-file-commit-guard")) return undefined;

  const citation = citeEvidence(relevant);
  const teachingMessage = `${citation}: oversized files reached git history and cost a rewrite to remove.`;
  return {
    kind: "guard-instance",
    id: "guard-large-file-commit",
    title: "Deny committing oversized files (large-file-commit-guard)",
    hookId: "large-file-commit-guard",
    guardsPatch: {
      largeFileCommit: {
        maxBytes: 5 * 1024 * 1024,
        message: teachingMessage
      }
    },
    message: `${citation}. A PreToolUse guard on git add/commit makes this unrepeatable at the moment of error; the threshold is yours to tune in guards.largeFileCommit.maxBytes.`,
    evidence: relevant
  };
}

function routeLeftoverProcesses(signals: FailureSignal[], input: RouteInput): PrimitiveProposal | undefined {
  const relevant = signals.filter((signal) => signal.class === "leftover-process");
  if (relevant.length === 0) return undefined;

  // ps command lines cannot be matched by port; those stay evidence-only.
  const namedTargets = relevant.filter((signal) => !signal.key.startsWith("port:"));
  if (namedTargets.length === 0) return undefined;

  const existing = existingTeardownPatterns(input.guards);
  const newTargets = namedTargets.filter(
    (signal) => !existing.some((pattern) => pattern.test(signal.key))
  );
  const installed = input.installedHookIds.includes("process-teardown-audit");
  if (installed && newTargets.length === 0) return undefined;
  const proposedTargets = installed ? newTargets : namedTargets;

  const citation = citeEvidence(proposedTargets);
  const patterns = proposedTargets.map((signal) => escapeRegExp(signal.key)).sort();
  return {
    kind: "guard-instance",
    id: "guard-process-teardown",
    title: installed
      ? `Audit ${patterns.length} more leftover process pattern(s) at Stop`
      : "Audit leftover test/automation processes at Stop (process-teardown-audit)",
    hookId: "process-teardown-audit",
    guardsPatch: {
      processTeardown: {
        patterns,
        message: `${citation}: sessions repeatedly had to hunt down and kill these leftovers.`
      }
    },
    message: `${citation}. A Stop-time advisory lists matching leftovers once so the agent tears them down before finishing; it never blocks a retried Stop.`,
    evidence: proposedTargets
  };
}

function routeRejectedPushes(signals: FailureSignal[]): PrimitiveProposal | undefined {
  const relevant = signals.filter((signal) => signal.class === "rejected-push");
  if (relevant.length === 0) return undefined;

  const citation = citeEvidence(relevant);
  return {
    kind: "rules-line",
    id: "rule-rejected-push",
    title: "Teach the push discipline that failed before",
    line: "Before `git push`, fetch and rebase onto the remote branch; never force-push shared branches.",
    message: `${citation}: pushes were rejected and retried. One declarative line is the cheapest primitive for knowledge agents already act on once told.`,
    evidence: relevant
  };
}

function routeRepeatedFailures(signals: FailureSignal[]): PrimitiveProposal[] {
  const proposals: PrimitiveProposal[] = [];
  for (const signal of signals) {
    if (signal.class !== "repeated-failure") continue;
    const citation = citeEvidence([signal]);
    const identifier = slug(signal.key);

    if (signal.count >= skillSuggestionMinCount && signal.sessionCount >= skillSuggestionMinSessions) {
      // A failure this stubborn across sessions is a missing procedure, not a
      // missing fact — route to the skill flow instead of one more rule line.
      proposals.push({
        kind: "skill-suggestion",
        id: `skill-${identifier}`,
        title: `Capture the working procedure around \`${signal.key}\``,
        query: signal.key,
        message: `${citation}: \`${signal.key}\` kept failing across sessions despite retries. Search the skill registry or author a skill documenting the working procedure.`,
        evidence: [signal]
      });
      continue;
    }

    proposals.push({
      kind: "rules-line",
      id: `rule-fix-${identifier}`,
      title: `Document the working alternative to \`${signal.key}\``,
      line: `\`${signal.key}\` fails in this project; use the project-approved command documented in AGENTS.md Commands instead.`,
      message: `${citation}: agents re-ran a failing command in multiple sessions. Name the working alternative in AGENTS.md (edit the proposed line), or ban it outright via the tool-policy proposals below.`,
      evidence: [signal]
    });
  }
  return proposals;
}

export function routeFailureSignals(input: RouteInput): PrimitiveProposal[] {
  const proposals: PrimitiveProposal[] = [];
  const oversized = routeOversizedCommit(input.signals, input);
  if (oversized) proposals.push(oversized);
  const teardown = routeLeftoverProcesses(input.signals, input);
  if (teardown) proposals.push(teardown);
  const push = routeRejectedPushes(input.signals);
  if (push) proposals.push(push);
  proposals.push(...routeRepeatedFailures(input.signals));
  return proposals;
}
