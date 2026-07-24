import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

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

/**
 * History rewrites are the recovery from an oversized commit; one is evidence
 * enough. Only invocation position counts — `command -v git-filter-repo` is a
 * tool probe, not a rewrite.
 */
const historyRewritePattern = /(?:^|[;&|(]\s*)(?:git\s+filter-(?:repo|branch)\b|git-filter-repo\b|bfg\s|git\s+lfs\s+migrate\b)/i;
const sizeRejectionPattern = /exceeds git(?:hub|lab)?'?s? file size limit|remote:\s*error:\s*file .{0,200}? (?:is|exceeds) \d|larger than .{0,40}(?:recommended )?maximum file size|\bGH001\b/i;
const pushCommandPattern = /(^|[;&|]\s*)git\b[^;&|]*\bpush\b/;
const pushRejectionPattern = /!\s*\[(?:remote )?rejected\]|failed to push some refs|\[remote rejected\]/i;

const lsofKillPattern = /lsof\s+(?:-\S+\s+)*-t?i(?::|\s*:?\s*)(?:tcp:|udp:)?(\d{2,5})[^|]*\|\s*(?:xargs\s+)?kill\b/i;
const shellWordPattern = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;

/**
 * Heads of read-only exploration / plumbing commands. Their failures are the
 * normal work loop (a grep with no matches exits 1), never a harness gap.
 */
const explorationHeads = new Set([
  "grep", "rg", "sed", "awk", "cat", "ls", "find", "head", "tail", "wc", "echo", "printf",
  "mkdir", "cd", "pushd", "popd", "pgrep", "ps", "lsof", "kill", "pkill", "killall",
  "which", "type", "stat", "file", "tree", "du", "df", "env", "printenv", "sleep",
  "true", "false", "test", "touch", "cp", "mv", "rm", "ln", "chmod", "curl", "wget",
  "git", "python", "python3", "node", "open", "date", "diff", "xargs", "tee", "jq"
]);

/** Verification verbs: failing checks/tests are iteration, not rediscovery. */
const verificationTokens = new Set([
  "pytest", "vitest", "jest", "tsc", "eslint", "ruff", "prettier", "konsistent",
  "rspec", "mocha", "playwright", "cypress"
]);
const verificationTokenPattern = /^(?:test|tests|check|lint|typecheck|build|fmt|format|spec)(?:[:.][\w:.-]*)?$/i;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

// --- Transcript tool_use / tool_result extraction (shared with learn.ts) ---

export type ToolUse = {
  id?: string;
  command: string;
};

export type ToolResult = {
  toolUseId?: string;
  text: string;
  isError: boolean;
  isDenied: boolean;
};

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStrings(item));
  }

  if (isRecord(value)) {
    return Object.values(value).flatMap((item) => flattenStrings(item));
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  return [];
}

function textFrom(value: unknown): string {
  return flattenStrings(value).join("\n");
}

function booleanField(record: Record<string, unknown>, names: string[]): boolean {
  return names.some((name) => record[name] === true);
}

export function looksDenied(text: string): boolean {
  const lower = text.toLowerCase();

  return (
    (lower.includes("permissiondecision") && lower.includes("deny")) ||
    lower.includes("permission decision") && lower.includes("deny") ||
    lower.includes("permission denied") ||
    lower.includes("denied") ||
    lower.includes("blocked by hook") ||
    lower.includes("hook blocked") ||
    lower.includes("blocked")
  );
}

export function looksErrored(text: string): boolean {
  const lower = text.toLowerCase();

  return (
    lower.includes("exit code") ||
    lower.includes("exited with code") ||
    lower.includes("not found") ||
    lower.includes("permission denied") ||
    lower.includes("failed") ||
    lower.includes("traceback") ||
    lower.includes("error")
  );
}

function dedupeToolUses(uses: ToolUse[]): ToolUse[] {
  const seen = new Set<string>();
  const deduped: ToolUse[] = [];

  for (const use of uses) {
    const key = `${use.id ?? ""}\u0000${use.command}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(use);
  }

  return deduped;
}

export function toolUseFromRecord(record: Record<string, unknown>): ToolUse[] {
  const uses: ToolUse[] = [];

  function addUse(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }

    const name = optionalString(value.name) ?? optionalString(value.tool_name);
    const input = isRecord(value.input) ? value.input : isRecord(value.tool_input) ? value.tool_input : undefined;
    const command = input ? optionalString(input.command) : undefined;

    if (name === "Bash" && command) {
      uses.push({
        id: optionalString(value.id),
        command: normalizeCommand(command)
      });
    }
  }

  addUse(record);

  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];

  for (const item of content) {
    if (isRecord(item) && item.type === "tool_use") {
      addUse(item);
    }
  }

  return dedupeToolUses(uses);
}

/** One observed skill invocation; sessionRef is the scanner's session id. */
export type SkillInvocationEvent = {
  skill: string;
  sessionRef: string;
  date: string | undefined;
};

/**
 * Skill directory names referenced by one shell command. Reading
 * skills/<name>/SKILL.md (or anything under the skill's directory) is the
 * observable invocation signal shared by both backends: Codex loads skills
 * through shell reads, and Claude Bash commands that reach into a skill tree
 * count the same way. Bare roots ("ls .agents/skills") name no skill.
 */
export function skillNamesFromCommand(command: string): string[] {
  const names = new Set<string>();
  const pattern = /(?:\.agents\/|\.claude\/|(?<![\w.-]))skills\/([A-Za-z0-9][\w.-]*)/g;
  for (const match of command.matchAll(pattern)) {
    const name = match[1]!;
    // A trailing "-" is a glob prefix (skills/hig-*/SKILL.md), not a name.
    if (name !== "SKILL.md" && !name.endsWith("-")) names.add(name);
  }
  return Array.from(names);
}

/**
 * Skill names invoked by one Claude transcript record: the Skill tool
 * (input.skill) and slash-command expansions (<command-name>/x</command-name>,
 * which live in isMeta records the steer extraction deliberately skips).
 */
export function skillInvocationsFromRecord(record: Record<string, unknown>): string[] {
  const names = new Set<string>();

  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    if (!isRecord(item) || item.type !== "tool_use" || item.name !== "Skill") continue;
    const input = isRecord(item.input) ? item.input : undefined;
    const skill = input ? optionalString(input.skill) : undefined;
    if (skill) names.add(skill);
  }

  for (const match of textFrom(record).matchAll(/<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/g)) {
    names.add(match[1]!);
  }

  return Array.from(names);
}

/**
 * Human-authored text from one Claude transcript record. Tool results, meta
 * records (command wrappers, caveats), and sidechain (subagent) prompts all
 * arrive as type:"user" but are not the human steering the agent.
 */
export function userTextFromRecord(record: Record<string, unknown>): string | undefined {
  if (record.type !== "user" || record.isMeta === true || record.isSidechain === true) {
    return undefined;
  }

  const message = isRecord(record.message) ? record.message : undefined;
  if (!message) {
    return undefined;
  }

  const content = message.content;
  if (typeof content === "string") {
    return content.trim().length > 0 ? content : undefined;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  if (content.some((item) => isRecord(item) && item.type === "tool_result")) {
    return undefined;
  }

  const texts = content
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "text")
    .map((item) => optionalString(item.text) ?? "")
    .filter((text) => text.trim().length > 0);

  return texts.length > 0 ? texts.join("\n") : undefined;
}

export function toolResultsFromRecord(record: Record<string, unknown>): ToolResult[] {
  const results: ToolResult[] = [];

  function addResult(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }

    const text = textFrom(value);
    const isDenied = looksDenied(text);
    const isError = booleanField(value, ["is_error", "isError", "error"]) || looksErrored(text);

    if (!isDenied && !isError) {
      return;
    }

    results.push({
      toolUseId: optionalString(value.tool_use_id) ?? optionalString(value.toolUseId),
      text,
      isError,
      isDenied
    });
  }

  if (record.type === "tool_result") {
    addResult(record);
  }

  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];

  for (const item of content) {
    if (isRecord(item) && item.type === "tool_result") {
      addResult(item);
    }
  }

  for (const key of ["tool_response", "tool_result", "result", "response"]) {
    addResult(record[key]);
  }

  const fullText = textFrom(record);
  if (looksDenied(fullText) || looksErrored(fullText)) {
    results.push({
      toolUseId: optionalString(record.tool_use_id) ?? optionalString(record.toolUseId),
      text: fullText,
      isError: looksErrored(fullText),
      isDenied: looksDenied(fullText)
    });
  }

  return results;
}

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

function unquote(token: string): string {
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1);
  }
  return token;
}

function killTargets(command: string): string[] {
  const targets: string[] = [];
  // The lsof|xargs kill idiom spans a pipe; match it on the whole command.
  const lsof = command.match(lsofKillPattern);
  if (lsof?.[1]) targets.push(`port:${lsof[1]}`);

  for (const segment of command.split(/\|\||&&|;|\|/)) {
    const tokens = segment.match(shellWordPattern) ?? [];
    const head = tokens.findIndex((token) => token === "pkill" || token === "killall");
    if (head < 0) continue;
    // First non-flag argument is the name/pattern (with -f it is the
    // full-command-line pattern; either way it is what to audit for).
    const argument = tokens.slice(head + 1).find((token) => !token.startsWith("-"));
    if (!argument) continue;
    const target = unquote(argument);
    if (target.length >= 3 && !/^\d+$/.test(target)) targets.push(target);
  }
  return targets;
}

/**
 * The exact command is the repeated-failure key only when it is the kind of
 * command an agent would rediscover: a plain project-verb invocation. Ad-hoc
 * compositions (pipes, chains, redirects, heredocs), exploration commands,
 * and verification runs are the normal work loop and never signal.
 */
function eligibleFailureCommand(command: string): string | undefined {
  if (command.length > 120 || /[|;&<>]|\$\(/.test(command)) return undefined;
  const tokens = command.match(shellWordPattern) ?? [];
  const meaningful = tokens.filter((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  const headToken = meaningful[0];
  if (!headToken || meaningful.length < 2) return undefined;
  const head = headToken.split("/").pop() ?? headToken;
  if (explorationHeads.has(head.toLowerCase())) return undefined;
  if (meaningful.some((token) => verificationTokens.has(token.toLowerCase()) || verificationTokenPattern.test(token))) {
    return undefined;
  }
  return command;
}

/**
 * Coarse cluster key for work-loop failures: the first one or two meaningful
 * tokens (head basename + subcommand/flag). A day of 239 xcodebuild variants
 * clusters to a handful of keys instead of 239 exact commands.
 */
export function workLoopClusterKey(command: string): string | undefined {
  const tokens = command.match(shellWordPattern) ?? [];
  const meaningful = tokens.filter((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  const headToken = meaningful[0];
  if (!headToken) return undefined;
  const head = (headToken.split("/").pop() ?? headToken).toLowerCase();
  const second = meaningful[1];
  return second && second.length <= 40 ? `${head} ${second}` : head;
}

/**
 * The most informative line of a failed tool result, for work-loop failure
 * samples: prefer the first error-looking line (codex exec output opens with
 * a "Command: ..." wrapper line that says nothing), else the first non-empty
 * line.
 */
function firstUsefulLine(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.find((line) => /\b(?:error|failed|failure|denied|traceback|exception|fatal)\b/i.test(line)) ?? lines[0];
}

export type SignalCollectorOptions = {
  /**
   * Evidence mode (export): additionally cluster the work-loop failures that
   * `eligibleFailureCommand` excludes, and report every accumulated signal
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

/** Runs all four detectors on already-extracted tool events (any source). */
export function scanToolEvents(
  uses: ToolUse[],
  results: ToolResult[],
  context: RecordContext,
  collector: SignalCollector,
  state: SessionScanState
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

    if (sizeRejectionPattern.test(result.text)) {
      addOnce("oversized-commit", "size-rejection", result.text);
      continue;
    }
    if (pushCommandPattern.test(command) && pushRejectionPattern.test(result.text)) {
      addOnce("rejected-push", "rejected-push", result.text);
      continue;
    }
    if (result.isDenied || result.isError) {
      const eligible = eligibleFailureCommand(command);
      if (eligible) {
        addOnce("repeated-failure", eligible, command);
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
};

export type ClaudeTranscriptScanOptions = {
  /**
   * Tap for user steers (session evidence). Called with the raw message text;
   * the caller owns noise filtering, redaction, and bounding. Stays local.
   */
  onUserMessage?: (event: ClaudeUserMessageEvent) => void;
  /** Tap for skill invocations (Skill tool, slash commands, skill-tree reads). */
  onSkillInvocation?: (event: SkillInvocationEvent) => void;
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
        if (text) options.onUserMessage({ text, sessionRef, date: context.date });
      }
      const uses = toolUseFromRecord(parsed);
      if (options.onSkillInvocation) {
        const names = new Set([
          ...skillInvocationsFromRecord(parsed),
          ...uses.flatMap((use) => skillNamesFromCommand(use.command))
        ]);
        for (const skill of names) options.onSkillInvocation({ skill, sessionRef, date: context.date });
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
