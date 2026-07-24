import { readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  SignalCollector,
  looksDenied,
  looksErrored,
  normalizeCommand,
  scanClaudeTranscripts,
  scanToolEvents,
  signalScanMaxFiles,
  type FailureSignalScan,
  type SessionScanState,
  type ToolResult,
  type ToolUse
} from "./learn-signals";

/**
 * Codex session source for deterministic failure-signal mining.
 *
 * Codex CLI writes raw JSONL rollouts to ~/.codex/sessions/YYYY/MM/DD/
 * rollout-*.jsonl. Observed record shapes (2026-07-22, codex_cli_rs 0.115/0.116):
 *
 *   {"timestamp":"...","type":"session_meta","payload":{"id":"...","cwd":"/Users/...","originator":"codex_cli_rs",...}}
 *   {"timestamp":"...","type":"turn_context","payload":{"turn_id":"...","cwd":"/Users/...","approval_policy":"never",...}}
 *   {"timestamp":"...","type":"response_item","payload":{"type":"function_call","name":"exec_command",
 *     "arguments":"{\"cmd\":\"pwd && rg ...\",\"workdir\":\"/Users/...\"}","call_id":"call_..."}}
 *   {"timestamp":"...","type":"response_item","payload":{"type":"function_call_output","call_id":"call_...",
 *     "output":"Command: /bin/zsh -lc '...'\n...\nProcess exited with code 1\n...\nOutput:\n..."}}
 *
 * Older/protocol variants wrap argv arrays ("shell" tool with
 * {"command":["bash","-lc","<cmd>"]}, or a local_shell_call payload with
 * action.command) and may serialize outputs as JSON strings carrying
 * {"output":"...","metadata":{"exit_code":N}}. All are handled below.
 *
 * Codex Desktop 0.145 (unified custom "exec" tool) records shell work as:
 *
 *   {"type":"response_item","payload":{"type":"custom_tool_call","name":"exec","call_id":"call_...",
 *     "input":"const r = await tools.exec_command({\n  cmd: \"sed -n '1,240p' ...\",\n  workdir: \"...\"});\ntext(r.output);\n"}}
 *   {"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"call_...",
 *     "output":[{"type":"input_text","text":"Script completed\nWall time 0.1 seconds\nOutput:\n"},...]}}
 *
 * The input is JavaScript source that may call tools.exec_command several
 * times; the output is an array of text parts with no "Process exited with
 * code" line. Failures surface only as a "Script failed"/"Script error:"
 * wrapper or as printed "exit_code":N fragments, so this reader counts those
 * markers alone and ignores word heuristics for this shape (outputs echo file
 * contents, which would false-positive on words like "failed").
 *
 * This reader is counting-only and local: no prose leaves the machine, so it
 * does not go through the App Server consent path (see advice-session-codex.ts
 * for the consented episode reader).
 */

const rolloutFilePattern = /^rollout-.*\.jsonl$/;
const shellToolNames = new Set(["exec_command", "shell", "local_shell", "container.exec"]);
const customExecToolNames = new Set(["exec"]);
const shellWrapperHeadPattern = /^(?:ba|z|da)?sh$/;
const shellWrapperFlagPattern = /^-l?c$/;
const exitCodeTextPattern = /Process exited with code (-?\d+)\b/i;
const scriptFailurePattern = /^Script failed\b|Script error:/m;
const scriptExitCodePattern = /"exit_code"\s*:\s*(-?\d+)/g;

type CodexSourceScan = {
  notes: string[];
  /** Files parsed after the byte pre-filter (they mention the project path). */
  filesScanned: number;
  /** Files whose recorded cwd actually resolved to the project root. */
  filesMatched: number;
  sessionsDirFound: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function recordDate(record: Record<string, unknown>): string | undefined {
  const timestamp = record.timestamp;
  if (typeof timestamp !== "string") return undefined;
  return timestamp.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
}

export function defaultCodexSessionsDir(): string {
  return join(process.env.HOME || homedir(), ".codex", "sessions");
}

/** Walks the fixed sessions/YYYY/MM/DD layout; a missing directory is the normal Claude-only case. */
async function listRolloutFiles(sessionsDir: string): Promise<{ files: string[]; found: boolean }> {
  const years = await readdir(sessionsDir).catch(() => undefined);
  if (!years) return { files: [], found: false };

  const files: string[] = [];
  for (const year of years) {
    const months = await readdir(join(sessionsDir, year)).catch(() => [] as string[]);
    for (const month of months) {
      const days = await readdir(join(sessionsDir, year, month)).catch(() => [] as string[]);
      for (const day of days) {
        const entries = await readdir(join(sessionsDir, year, month, day)).catch(() => [] as string[]);
        for (const entry of entries) {
          if (rolloutFilePattern.test(entry)) files.push(join(sessionsDir, year, month, day, entry));
        }
      }
    }
  }
  // Newest first: rollout filenames embed the session timestamp, so the file
  // cap keeps the most recent evidence when a machine has years of sessions.
  files.sort((left, right) => basename(right).localeCompare(basename(left)));
  return { files, found: true };
}

async function resolveForMatch(path: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(path);
  if (cached) return cached;
  const resolved = await realpath(resolve(path)).catch(() => resolve(path));
  cache.set(path, resolved);
  return resolved;
}

/** Unwraps ["bash","-lc","<cmd>"]-style argv wrappers to the command text. */
function commandFromArgv(argv: unknown[]): string | undefined {
  const words = argv.filter((item): item is string => typeof item === "string");
  if (words.length === 0) return undefined;
  const head = words[0]!.split("/").pop() ?? "";
  if (words.length >= 3 && shellWrapperHeadPattern.test(head) && shellWrapperFlagPattern.test(words[1]!)) {
    return words.slice(2).join(" ");
  }
  return words.join(" ");
}

function commandFromValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (Array.isArray(value)) return commandFromArgv(value);
  return undefined;
}

/** Reads a JS string literal ("", '', or ``) starting at `start`, with minimal unescaping. */
function readJsStringLiteral(source: string, start: number): string | undefined {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\") {
      const next = source[index + 1];
      if (next === "n") value += "\n";
      else if (next === "t") value += "\t";
      else if (next !== undefined) value += next;
      index += 1;
      continue;
    }
    if (char === quote) return value;
    value += char;
  }
  return undefined;
}

/**
 * Extracts every tools.exec_command({cmd: "..."}) command from the JS source
 * carried by a 0.145 custom "exec" tool call. Each cmd is searched only up to
 * the next exec_command call so a script without a cmd never steals the
 * following call's command.
 */
function execCommandsFromScript(script: string): string[] {
  const starts: number[] = [];
  const callPattern = /tools\.exec_command\s*\(/g;
  for (let match = callPattern.exec(script); match; match = callPattern.exec(script)) {
    starts.push(match.index + match[0].length);
  }

  const commands: string[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const window = script.slice(starts[index]!, starts[index + 1] ?? script.length);
    const cmd = /\bcmd\s*:\s*/.exec(window);
    if (!cmd) continue;
    const literal = readJsStringLiteral(window, cmd.index + cmd[0].length);
    if (literal && literal.trim().length > 0) commands.push(literal);
  }
  return commands;
}

function toolUseFromPayload(payload: Record<string, unknown>): ToolUse | undefined {
  let command: string | undefined;

  if (payload.type === "function_call" && typeof payload.name === "string" && shellToolNames.has(payload.name)) {
    const parsed = typeof payload.arguments === "string" ? parseJson(payload.arguments) : payload.arguments;
    if (isRecord(parsed)) command = commandFromValue(parsed.cmd) ?? commandFromValue(parsed.command);
  } else if (payload.type === "local_shell_call" && isRecord(payload.action)) {
    command = commandFromValue(payload.action.command);
  }

  if (!command) return undefined;
  const id = typeof payload.call_id === "string" ? payload.call_id : undefined;
  return { ...(id ? { id } : {}), command: normalizeCommand(command) };
}

/** All shell commands in one payload; a 0.145 exec script can carry several. */
function toolUsesFromPayload(payload: Record<string, unknown>): ToolUse[] {
  if (payload.type === "custom_tool_call" && typeof payload.name === "string" && customExecToolNames.has(payload.name)) {
    const script = typeof payload.input === "string" ? payload.input : "";
    const id = typeof payload.call_id === "string" ? payload.call_id : undefined;
    // Commands share the call_id; the result lookup resolves to the last one.
    return execCommandsFromScript(script).map((command) => ({ ...(id ? { id } : {}), command: normalizeCommand(command) }));
  }
  const single = toolUseFromPayload(payload);
  return single ? [single] : [];
}

function toolResultFromPayload(payload: Record<string, unknown>): ToolResult | undefined {
  if (payload.type === "custom_tool_call_output") {
    const raw = payload.output;
    const text = Array.isArray(raw)
      ? raw.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : "")).join("")
      : typeof raw === "string"
        ? raw
        : JSON.stringify(raw ?? "");
    // Only the script wrapper's own failure markers count for this shape;
    // word heuristics false-positive on echoed file contents (see header).
    const exitCodes = Array.from(text.matchAll(scriptExitCodePattern), (match) => Number(match[1]));
    const failed = scriptFailurePattern.test(text) || exitCodes.some((code) => code !== 0);
    if (!failed) return undefined;
    const toolUseId = typeof payload.call_id === "string" ? payload.call_id : undefined;
    return { ...(toolUseId ? { toolUseId } : {}), text, isError: true, isDenied: looksDenied(text) };
  }

  if (payload.type !== "function_call_output" && payload.type !== "local_shell_call_output") return undefined;
  const raw = payload.output;
  let text = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  let exitCode: number | undefined;

  // Some rollouts serialize the output as JSON: {"output":"...","metadata":{"exit_code":N}}.
  if (text.startsWith("{")) {
    const structured = parseJson(text);
    if (isRecord(structured)) {
      if (typeof structured.output === "string") text = structured.output;
      const metadata = isRecord(structured.metadata) ? structured.metadata : undefined;
      if (typeof metadata?.exit_code === "number") exitCode = metadata.exit_code;
    }
  }
  if (exitCode === undefined) {
    const match = text.match(exitCodeTextPattern);
    if (match) exitCode = Number(match[1]);
  }

  // The wrapper text always contains "exited with code", which looksErrored
  // would flag on every success; a structured exit code overrides the heuristic.
  if (exitCode === 0) return undefined;
  const isDenied = looksDenied(text);
  const isError = exitCode !== undefined ? true : looksErrored(text);
  if (!isDenied && !isError) return undefined;

  const toolUseId = typeof payload.call_id === "string" ? payload.call_id : undefined;
  return { ...(toolUseId ? { toolUseId } : {}), text, isError, isDenied };
}

/**
 * Scans codex rollouts belonging to the target project into a shared collector.
 * Sessions are filtered by the cwd carried in session_meta/turn_context records
 * (realpath-resolved); a byte-level pre-filter skips files that never mention
 * the project path before any line is JSON-parsed.
 */
/** A raw event_msg user_message from a session whose cwd matched the project. */
export type CodexUserMessageEvent = {
  text: string;
  sessionRef: string;
  date: string | undefined;
};

export async function scanCodexSessions(input: {
  projectDir: string;
  collector: SignalCollector;
  sessionsDir?: string;
  maxFiles?: number;
  /**
   * Tap for user steers (distill evidence). Called with the raw message text;
   * the caller owns noise filtering, redaction, and bounding. Stays local.
   */
  onUserMessage?: (event: CodexUserMessageEvent) => void;
}): Promise<CodexSourceScan> {
  const notes: string[] = [];
  const maxFiles = input.maxFiles ?? signalScanMaxFiles;
  const sessionsDir = input.sessionsDir ?? defaultCodexSessionsDir();
  const { files, found } = await listRolloutFiles(sessionsDir);
  if (!found || files.length === 0) return { notes, filesScanned: 0, filesMatched: 0, sessionsDirFound: found };

  const resolveCache = new Map<string, string>();
  const projectRoot = await resolveForMatch(input.projectDir, resolveCache);
  const needles = Array.from(new Set([resolve(input.projectDir), projectRoot]));

  let filesScanned = 0;
  let filesMatched = 0;
  let truncated = false;
  let malformedLines = 0;
  let toolEvents = 0;
  for (const file of files) {
    if (filesScanned >= maxFiles) {
      truncated = true;
      break;
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch {
      continue;
    }
    if (!needles.some((needle) => bytes.includes(needle))) continue;
    filesScanned += 1;

    const sessionRef = `codex:${basename(file).replace(/\.jsonl$/, "")}`;
    const state: SessionScanState = { commandByToolUseId: new Map(), lastCommand: undefined };
    let cwdMatchesProject = false;
    let cwdEverMatched = false;
    for (const line of bytes.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        malformedLines += 1;
        continue;
      }
      if (!isRecord(parsed) || !isRecord(parsed.payload)) continue;
      const payload = parsed.payload;

      if (parsed.type === "session_meta" || parsed.type === "turn_context") {
        if (typeof payload.cwd === "string") {
          cwdMatchesProject = (await resolveForMatch(payload.cwd, resolveCache)) === projectRoot;
          cwdEverMatched ||= cwdMatchesProject;
        }
        continue;
      }
      // Gate every tool event on the session/turn cwd so a rollout from a
      // different project never contributes evidence, even when its bytes
      // mention the project path (e.g. in command output).
      if (!cwdMatchesProject) continue;
      if (
        parsed.type === "event_msg" &&
        payload.type === "user_message" &&
        typeof payload.message === "string" &&
        input.onUserMessage
      ) {
        input.onUserMessage({ text: payload.message, sessionRef, date: recordDate(parsed) });
        continue;
      }
      if (parsed.type !== "response_item") continue;

      const uses = toolUsesFromPayload(payload);
      let result = toolResultFromPayload(payload);
      // Codex sessions carry outputs for many tools (MCP, apply_patch, ...);
      // only outputs of known shell calls may back a failure signal, so a
      // web-search error is never misattributed to the last shell command.
      if (result && !(result.toolUseId && state.commandByToolUseId.has(result.toolUseId))) {
        result = undefined;
      }
      if (uses.length === 0 && !result) continue;
      toolEvents += uses.length + (result ? 1 : 0);
      const context = { sessionRef, date: recordDate(parsed) };
      scanToolEvents(uses, result ? [result] : [], context, input.collector, state);
    }
    if (cwdEverMatched) filesMatched += 1;
  }

  if (truncated) {
    notes.push(`Scanned the newest ${maxFiles} codex session files mentioning the project path; older codex sessions were skipped.`);
  }
  if (malformedLines > 0) {
    notes.push(`Skipped ${malformedLines} malformed codex session line(s).`);
  }
  // Format-drift tripwire: sessions belong to this project but yielded zero
  // shell tool events, which is how the Codex Desktop 0.145 shape went
  // unnoticed (silent "nothing to propose"). Surface it instead.
  if (filesMatched > 0 && toolEvents === 0) {
    notes.push(
      `No shell tool events could be extracted from ${filesMatched} matched codex session file(s); ` +
        `the rollout format may have drifted beyond this reader (verified shapes: codex 0.116 function_call, ` +
        `Codex Desktop 0.145 custom_tool_call "exec").`
    );
  }

  return { notes, filesScanned, filesMatched, sessionsDirFound: true };
}

export type FailureSignalSources = {
  claudeTranscriptsDir: string;
  /** Target project root; codex sessions are filtered to it by recorded cwd. */
  codexProjectDir: string;
  /** Override for tests; defaults to ~/.codex/sessions. */
  codexSessionsDir?: string;
};

/** Mines failure signals from both sources into one merged accumulation, so a
 * failure seen once in a Claude session and once in a codex session counts as
 * two sessions. */
export async function mineFailureSignalsFromSources(sources: FailureSignalSources): Promise<FailureSignalScan> {
  const collector = new SignalCollector();
  const claude = await scanClaudeTranscripts(sources.claudeTranscriptsDir, collector);
  const codex = await scanCodexSessions({
    projectDir: sources.codexProjectDir,
    sessionsDir: sources.codexSessionsDir,
    collector
  });

  const notes = [...claude.notes, ...codex.notes];
  const codexClause = codex.sessionsDirFound
    ? ` and ${codex.filesMatched} codex session file(s) belonging to this project (of ${codex.filesScanned} scanned)`
    : "";
  notes.push(`Failure signals were mined from ${claude.filesScanned} Claude transcript file(s)${codexClause}.`);

  return { signals: collector.signals(), notes };
}
