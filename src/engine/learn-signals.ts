import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { claudeToolActionsFromRecord, type SessionActivityEvent } from "./session-activity";
import {
  failureSignalKey,
  firstUsefulLine,
  gitCommandPattern,
  historyRewritePattern,
  killTargets,
  pushCommandPattern,
  pushRejectionPattern,
  sizeRejectionPattern,
  workLoopClusterKey
} from "./learn-signal-commands";
import {
  isRecord,
  skillInvocationsFromRecord,
  skillNamesFromCommand,
  toolResultsFromRecord,
  toolUseFromRecord,
  userTextFromRecord,
  type SkillInvocationEvent,
  type ToolResult,
  type ToolUse
} from "./learn-transcript-records";

// The two halves this module composes stay importable from here: callers ask
// learn-signals for transcript parsing and command classification alike.
export * from "./learn-transcript-records";
export * from "./learn-signal-commands";

/**
 * Deterministic failure-signal mining over agent session transcripts.
 *
 * Every signal is countable without an LLM: a regex over commands or tool
 * results, aggregated with counts, dates, and session references so a
 * proposal can cite its evidence ("happened 3x, these sessions"). Free-form
 * correction classification is deliberately out of scope (consensus
 * 2026-07-22: unsolved, its own eval-gated question).
 */

export type FailureSignalClass =
  | "oversized-commit"
  | "rejected-push"
  | "leftover-process"
  | "repeated-failure"
  /**
   * Failing exploration/verification/build commands, clustered by command
   * prefix. Only collected in evidence mode (keepAllFailures): for learn's
   * zero-LLM proposals these are the normal work loop and stay excluded, but
   * the session evidence set must receive the full clustered record (a 239-run
   * build storm is exactly the evidence a playbook gate comes from).
   */
  | "work-loop-failure";

export type FailureSignal = {
  class: FailureSignalClass;
  /** Dedupe key within the class (e.g. the process target or command prefix). */
  key: string;
  count: number;
  sessionCount: number;
  /** Unique YYYY-MM-DD dates, sorted ascending. Empty when records carry no timestamps. */
  dates: string[];
  /** Transcript session ids (file names without .jsonl), sorted. */
  sessionRefs: string[];
  /** Bounded command/result excerpts backing the signal. */
  samples: string[];
};

export type FailureSignalScan = {
  signals: FailureSignal[];
  notes: string[];
};

export const signalScanMaxFiles = 200; // per-source file cap; the codex source mirrors it
const maxSamplesPerSignal = 3;
const maxSampleChars = 200;
const maxRefsPerSignal = 20;

type SignalAccumulator = {
  class: FailureSignalClass;
  key: string;
  count: number;
  dates: Set<string>;
  sessionRefs: Set<string>;
  samples: string[];
};

export type RecordContext = {
  sessionRef: string;
  date: string | undefined;
};

function boundedSample(value: string): string {
  const flattened = value.replace(/\s+/g, " ").trim();
  return flattened.length > maxSampleChars ? `${flattened.slice(0, maxSampleChars - 3)}...` : flattened;
}

function recordDate(record: Record<string, unknown>): string | undefined {
  const timestamp = record.timestamp;
  if (typeof timestamp !== "string") return undefined;
  const match = timestamp.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

export type SignalCollectorOptions = {
  /**
   * Evidence mode (export): additionally cluster the work-loop failures that
   * `failureSignalKey` excludes, and report every accumulated signal
   * without proposal thresholds. The deterministic layer prepares and
   * clusters evidence; it never vetoes it — thresholds decide what learn
   * proposes FIRST, never what exists.
   */
  keepAllFailures?: boolean;
};

export class SignalCollector {
  readonly keepAllFailures: boolean;
  private readonly accumulators = new Map<string, SignalAccumulator>();

  constructor(options: SignalCollectorOptions = {}) {
    this.keepAllFailures = options.keepAllFailures ?? false;
  }

  add(signalClass: FailureSignalClass, key: string, context: RecordContext, sample: string): void {
    const id = `${signalClass}\u0000${key}`;
    const current = this.accumulators.get(id) ?? {
      class: signalClass,
      key,
      count: 0,
      dates: new Set<string>(),
      sessionRefs: new Set<string>(),
      samples: []
    };
    current.count += 1;
    if (context.date) current.dates.add(context.date);
    current.sessionRefs.add(context.sessionRef);
    if (current.samples.length < maxSamplesPerSignal) {
      const bounded = boundedSample(sample);
      if (bounded && !current.samples.includes(bounded)) current.samples.push(bounded);
    }
    this.accumulators.set(id, current);
  }

  signals(): FailureSignal[] {
    return Array.from(this.accumulators.values())
      .filter((entry) => this.keepAllFailures || meetsThreshold(entry))
      .map((entry) => ({
        class: entry.class,
        key: entry.key,
        count: entry.count,
        sessionCount: entry.sessionRefs.size,
        dates: Array.from(entry.dates).sort(),
        sessionRefs: Array.from(entry.sessionRefs).sort().slice(0, maxRefsPerSignal),
        samples: entry.samples
      }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  }
}

/**
 * A history rewrite is direct evidence of one incident that already cost a
 * recovery; everything else must repeat before it becomes a proposal input.
 */
function meetsThreshold(entry: SignalAccumulator): boolean {
  if (entry.class === "oversized-commit") return entry.count >= 1;
  if (entry.class === "repeated-failure") return entry.sessionRefs.size >= 2;
  return entry.count >= 2;
}

/** Per-session command bookkeeping so results can find the command they belong to. */
export type SessionScanState = {
  commandByToolUseId: Map<string, string>;
  lastCommand: string | undefined;
};

/** One failed or denied command, before any signal classification. */
export type FailureObservation = {
  command: string;
  text: string;
  isDenied: boolean;
};

export type ScanToolEventsOptions = {
  /**
   * Tap for every failed/denied command, whatever it later classifies as.
   * Learn's tool-policy half consumes these; the signal classes above are the
   * proposal half and deliberately drop the work loop.
   */
  onFailure?: (observation: FailureObservation) => void;
};

/** Runs all four detectors on already-extracted tool events (any source). */
export function scanToolEvents(
  uses: ToolUse[],
  results: ToolResult[],
  context: RecordContext,
  collector: SignalCollector,
  state: SessionScanState,
  options: ScanToolEventsOptions = {}
): void {
  for (const use of uses) {
    state.lastCommand = use.command;
    if (use.id) state.commandByToolUseId.set(use.id, use.command);

    if (historyRewritePattern.test(use.command)) {
      collector.add("oversized-commit", "history-rewrite", context, use.command);
    }
    for (const target of killTargets(use.command)) {
      collector.add("leftover-process", target, context, use.command);
    }
  }

  const directCommand = uses[0]?.command ?? state.lastCommand;
  // One transcript record is one incident: toolResultsFromRecord may surface
  // the same failure as both a content item and a whole-record fallback.
  const countedThisRecord = new Set<string>();
  const addOnce = (signalClass: FailureSignalClass, key: string, sample: string): void => {
    const id = `${signalClass} ${key}`;
    if (countedThisRecord.has(id)) return;
    countedThisRecord.add(id);
    collector.add(signalClass, key, context, sample);
  };
  for (const result of results) {
    const command = result.toolUseId
      ? state.commandByToolUseId.get(result.toolUseId) ?? directCommand
      : directCommand;
    if (!command) continue;
    if (result.isDenied || result.isError) {
      options.onFailure?.({ command, text: result.text, isDenied: result.isDenied });
    }

    // Both git-rejection patterns are gated on the command actually being a
    // git invocation: the whole-record text fallback means any transcript that
    // merely quotes the rejection wording (a source file, a pasted log) would
    // otherwise register as an incident that never happened.
    if (gitCommandPattern.test(command) && sizeRejectionPattern.test(result.text)) {
      addOnce("oversized-commit", "size-rejection", result.text);
      continue;
    }
    if (pushCommandPattern.test(command) && pushRejectionPattern.test(result.text)) {
      addOnce("rejected-push", "rejected-push", result.text);
      continue;
    }
    if (result.isDenied || result.isError) {
      const key = failureSignalKey(command);
      if (key) {
        addOnce("repeated-failure", key, command);
      } else if (collector.keepAllFailures) {
        const cluster = workLoopClusterKey(command);
        const reason = firstUsefulLine(result.text);
        if (cluster) addOnce("work-loop-failure", cluster, reason ? `${command} — ${reason}` : command);
      }
    }
  }
}

export type SourceScan = { notes: string[]; filesScanned: number };

/** A human user message from a Claude transcript. sessionRef is the bare transcript stem. */
export type ClaudeUserMessageEvent = {
  text: string;
  sessionRef: string;
  date: string | undefined;
  /**
   * Raw one-line summary of the assistant action this steer immediately
   * followed (e.g. "Edit src/foo.ts" or a shell command); undefined when no
   * action preceded it. The caller redacts and bounds it.
   */
  context?: string;
};

export type ClaudeTranscriptScanOptions = {
  /**
   * Tap for user steers (session evidence). Called with the raw message text;
   * the caller owns noise filtering, redaction, and bounding. Stays local.
   */
  onUserMessage?: (event: ClaudeUserMessageEvent) => void;
  /** Tap for skill invocations (Skill tool, slash commands, skill-tree reads). */
  onSkillInvocation?: (event: SkillInvocationEvent) => void;
  /** Tap for classified per-session activity (edits and commands). */
  onActivity?: (event: SessionActivityEvent) => void;
  /**
   * Restrict the scan to these transcript stems (file name without .jsonl):
   * the user-selected sessions. Absent = every transcript in the directory.
   */
  includeStems?: ReadonlySet<string>;
  /** Per-scan file cap; defaults to learn's counting cap. */
  maxFiles?: number;
};

/** Scans Claude transcript JSONL files into a shared collector (merged-source mining). */
export async function scanClaudeTranscripts(
  transcriptsDir: string,
  collector: SignalCollector,
  options: ClaudeTranscriptScanOptions = {}
): Promise<SourceScan> {
  const notes: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(transcriptsDir);
  } catch {
    return { notes: [`Transcript directory not found or unreadable: ${transcriptsDir}`], filesScanned: 0 };
  }

  const maxFiles = options.maxFiles ?? signalScanMaxFiles;
  const files = entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .filter((entry) => options.includeStems === undefined || options.includeStems.has(entry.replace(/\.jsonl$/, "")))
    .sort();
  if (files.length > maxFiles) {
    notes.push(`Scanned the first ${maxFiles} of ${files.length} transcript files.`);
  }

  let filesScanned = 0;
  let malformedLines = 0;
  for (const file of files.slice(0, maxFiles)) {
    const sessionRef = file.replace(/\.jsonl$/, "");
    let text: string;
    try {
      text = await readFile(join(transcriptsDir, file), "utf8");
    } catch {
      continue;
    }
    filesScanned += 1;

    const state: SessionScanState = { commandByToolUseId: new Map(), lastCommand: undefined };
    // The last assistant action seen in this session, paired with the next steer.
    let lastAction: string | undefined;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        malformedLines += 1;
        continue;
      }
      if (!isRecord(parsed)) continue;
      const context = { sessionRef, date: recordDate(parsed) };
      if (options.onUserMessage) {
        const text = userTextFromRecord(parsed);
        if (text) options.onUserMessage({ text, sessionRef, date: context.date, ...(lastAction ? { context: lastAction } : {}) });
      }
      const uses = toolUseFromRecord(parsed);
      if (options.onSkillInvocation) {
        const names = new Set([
          ...skillInvocationsFromRecord(parsed),
          ...uses.flatMap((use) => skillNamesFromCommand(use.command))
        ]);
        for (const skill of names) options.onSkillInvocation({ skill, sessionRef, date: context.date });
      }
      // Track the preceding action for the next steer and count classified
      // activity; both are local and only computed when a tap wants them.
      if (options.onUserMessage || options.onActivity) {
        const actions = claudeToolActionsFromRecord(parsed);
        if (actions.summary) lastAction = actions.summary;
        if (options.onActivity) {
          for (const activity of actions.activities) {
            options.onActivity({ sessionRef, kind: activity.kind, dirs: activity.dirs });
          }
        }
      }
      scanToolEvents(uses, toolResultsFromRecord(parsed), context, collector, state);
    }
  }

  if (malformedLines > 0) {
    notes.push(`Skipped ${malformedLines} malformed transcript line(s).`);
  }

  return { notes, filesScanned };
}

export async function mineFailureSignals(transcriptsDir: string): Promise<FailureSignalScan> {
  const collector = new SignalCollector();
  const scan = await scanClaudeTranscripts(transcriptsDir, collector);
  return { signals: collector.signals(), notes: scan.notes };
}
