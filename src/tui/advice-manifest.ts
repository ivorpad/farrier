import type { HarnessChangePlan } from "../engine/create-plan";
import type { AdviceBatchItem, AdviceBatchItemStatus, AdviceBatchState } from "../engine/advice-batch";
import type { AdviceCategory, AdviceVendor } from "../engine/advice-types";
import { isExecutionTimeout } from "../engine/execution-isolation";

/**
 * Plain-words presentation for the "create" surfaces (Create all batch + the
 * single-recommendation apply flow). Everything here is outcome-first: it says
 * what the user gets, never how the machinery works. No "manifest",
 * "transaction", "planned", or route jargon leaks to the screen.
 */

/** Roster status word. Deliberately not the internal state name ("planned"). */
export const batchStatusWord: Record<AdviceBatchItemStatus, string> = {
  queued: "Queued",
  running: "Working",
  planned: "Ready",
  created: "Created",
  skipped: "Skipped",
  failed: "Failed",
  cancelled: "Stopped",
};

const categoryGoalNoun: Record<AdviceCategory, string> = {
  guidance: "a project rule",
  hooks: "a safety check",
  skills: "a skill",
  subagents: "a helper agent",
  plugins: "a plugin",
  mcp: "a tool connection",
};

function vendorPhrase(vendors: readonly AdviceVendor[]): string {
  const claude = vendors.includes("claude");
  const codex = vendors.includes("codex");
  if (claude && codex) return "Claude & Codex";
  if (codex) return "Codex";
  if (claude) return "Claude";
  return "your agents";
}

/**
 * The stable goal of a roster row: what it will produce and for whom. This text
 * stays fixed while the row moves queued → working → ready → created, so the
 * roster reads as one settled list, not a feed the user has to reconstruct.
 */
export function adviceBatchGoal(recommendation: AdviceBatchItem["recommendation"]): string {
  return `${categoryGoalNoun[recommendation.category]} for ${vendorPhrase(recommendation.targetVendors)}`;
}

/**
 * Why an item can't be created automatically, phrased as a next step. Kept to
 * one line's worth: the "Skipped" status word already carries the "can't do it
 * for you" part, so this states only what the user would do instead.
 */
export function adviceBatchSkipReason(item: AdviceBatchItem): string {
  if (item.route === "inspect") {
    return "Already in the verified registry; inspect it from the report.";
  }
  if (item.recommendation.category === "plugins") {
    return "Installing a plugin needs a verified marketplace step, so do it by hand.";
  }
  if (item.recommendation.category === "skills") {
    return "No safe place to create this skill automatically, so add it by hand.";
  }
  return "Farrier can't create this kind automatically, so set it up by hand.";
}

export type BatchFailureKind = "timeout" | "unknown";

/**
 * Classify a raw failure message into a kind we can phrase for humans. Batch
 * items carry only the error message string, so detection goes through the
 * engine's isExecutionTimeout, which accepts messages as well as Errors.
 */
export function classifyBatchFailure(detail: string): BatchFailureKind {
  return isExecutionTimeout(detail) ? "timeout" : "unknown";
}

function formatApproxDuration(ms: number): string {
  if (ms >= 60_000) {
    const minutes = ms / 60_000;
    const rounded = Number.isInteger(minutes) ? minutes : Math.round(minutes * 10) / 10;
    return `${rounded} ${rounded === 1 ? "minute" : "minutes"}`;
  }
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

/**
 * Turn a raw failure message into something a non-engineer can read. Timeouts
 * lose the milliseconds ("Codex ran out of time (10 minutes)"); the minutes are
 * derived from the message, not hardcoded, so a 600000ms authoring cap and a
 * 900000ms eval cap read correctly. Anything we don't recognise falls through
 * unchanged so no detail is ever hidden.
 */
export function humanizeFailureDetail(detail: string, backendLabel: string): string {
  if (classifyBatchFailure(detail) === "timeout") {
    const ms = Number(detail.match(/(\d+)\s*ms/i)?.[1] ?? 0);
    return ms > 0
      ? `${backendLabel} ran out of time (${formatApproxDuration(ms)}).`
      : `${backendLabel} ran out of time.`;
  }
  return detail;
}

export type AdviceBatchRow = {
  /** Plain status word for the roster (Queued / Working / Ready / …). */
  statusWord: string;
  /** The primary, outcome-first line. */
  text: string;
  /** A dimmed technical line (the humanized failure), shown only when it helps. */
  detail?: string;
};

/**
 * One roster row's plain-words content. Create-path rows keep a stable goal;
 * skips explain the manual next step; failures lead with a plain sentence and
 * keep the humanized backend message behind it, dimmed. During a retry run the
 * items being re-run read "Retrying" so it's clear only failures re-run.
 */
export function adviceBatchRow(
  item: AdviceBatchItem,
  options: { backendLabel?: string; retry?: boolean } = {},
): AdviceBatchRow {
  const backendLabel = options.backendLabel ?? "The agent";
  const statusWord = options.retry && item.status === "running"
    ? "Retrying"
    : options.retry && item.status === "queued"
      ? "Retry"
      : batchStatusWord[item.status];
  if (item.status === "skipped") {
    return { statusWord, text: adviceBatchSkipReason(item) };
  }
  if (item.status === "failed") {
    return {
      statusWord,
      text: `Couldn't create ${adviceBatchGoal(item.recommendation)}`,
      detail: humanizeFailureDetail(item.detail, backendLabel),
    };
  }
  const goal = adviceBatchGoal(item.recommendation);
  const files = item.plan?.files.length ?? 0;
  if ((item.status === "planned" || item.status === "created") && files > 0) {
    return { statusWord, text: `${goal} · ${files} ${files === 1 ? "file" : "files"}` };
  }
  return { statusWord, text: goal };
}

/**
 * How many items didn't finish, phrased for the inline retry nudge, or
 * undefined when there's nothing to retry. e.g. "2 failed", "1 failed and 1
 * stopped".
 */
export function retryableSummary(state: AdviceBatchState): string | undefined {
  const failed = state.items.filter((item) => item.status === "failed").length;
  const stopped = state.items.filter((item) => item.status === "cancelled").length;
  if (failed + stopped === 0) return undefined;
  const parts: string[] = [];
  if (failed) parts.push(`${failed} failed`);
  if (stopped) parts.push(`${stopped} stopped`);
  return parts.join(" and ");
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/**
 * Outcome-first summary of a reviewed change plan: "Will create 1 new file.
 * Nothing is overwritten.": counts framed as results, never as a manifest.
 */
export function manifestOutcomeSummary(inspection: HarnessChangePlan): string {
  const counts = inspection.counts;
  const replace = inspection.replacementPaths.length;
  const blocked = inspection.blockers.length;
  const parts: string[] = [];
  if (counts.create) parts.push(`create ${counts.create} new ${counts.create === 1 ? "file" : "files"}`);
  if (counts.merge) parts.push(`add lines to ${counts.merge} ${counts.merge === 1 ? "file" : "files"}`);
  if (counts.update) parts.push(`fix permissions on ${counts.update} ${counts.update === 1 ? "file" : "files"}`);
  if (replace) parts.push(`overwrite ${replace} existing ${replace === 1 ? "file" : "files"}`);

  const lead = parts.length
    ? `Will ${joinList(parts)}.`
    : counts.unchanged
      ? "Everything already matches, so there is nothing to write."
      : "No files to write.";
  const overwriteNote = parts.length && !replace ? " Nothing is overwritten." : "";
  const blockedNote = blocked
    ? ` ${blocked} ${blocked === 1 ? "file" : "files"} can't be written and must be resolved first.`
    : "";
  return `${lead}${overwriteNote}${blockedNote}`;
}

export type ApplyConfirmLine = { text: string; tone: "gold" | "warn" };

/** The apply prompt, naming the concrete outcome rather than "apply the manifest". */
export function applyConfirmLine(input: {
  inspection: HarnessChangePlan;
  replacementArmed: boolean;
}): ApplyConfirmLine {
  const { inspection, replacementArmed } = input;
  const blocked = inspection.blockers.length;
  if (blocked > 0) {
    return {
      text: `Can't save yet: ${blocked} ${blocked === 1 ? "file is" : "files are"} blocked and must be resolved first.`,
      tone: "warn",
    };
  }
  const replace = inspection.replacementPaths.length;
  if (replace > 0) {
    return replacementArmed
      ? {
          text: `This overwrites ${replace} existing ${replace === 1 ? "file" : "files"} (a backup is kept first). Press y to save, n or Esc to step back.`,
          tone: "warn",
        }
      : {
          text: `This overwrites ${replace} existing ${replace === 1 ? "file" : "files"}. Press Enter to see exactly what changes, then confirm.`,
          tone: "gold",
        };
  }
  const writes = inspection.files.filter((file) => file.action !== "unchanged").length;
  if (writes === 0) return { text: "Nothing to save. Press Enter to finish.", tone: "gold" };
  return {
    text: `Press Enter to save ${writes} ${writes === 1 ? "change" : "changes"} to your project.`,
    tone: "gold",
  };
}
