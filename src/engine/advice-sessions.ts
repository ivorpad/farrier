import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { defaultTranscriptDir, extractCandidateEvents } from "./learn";
import { createCodexAppServerClient, type CodexAppServerClient, type CodexAppServerFactory } from "./codex-app-server";
import { addSessionSignal as addSignal, redactSessionText, selectFairSignals, sourceFunnel } from "./advice-patterns";
import type {
  AdviceEvidence,
  AdviceSessionCountInventory,
  AdviceSessionEvidence,
  AdviceSessionLookback,
  AdviceSessionSourceSummary,
  AdviceVendor
} from "./advice-types";

type UnknownRecord = Record<string, unknown>;
const maxClaudeFiles = 500;
const maxSessionBytes = 2_000_000;
const dayMs = 24 * 60 * 60 * 1_000;
const internalAdvisorMarker = "farrier's read-only project advisor";

type DatedSession = { source: AdviceVendor; id: string; updatedAt: number };
type ClaudeSession = DatedSession & { file: string; records: UnknownRecord[] };

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1_000_000_000_000 ? value * 1_000 : value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function recordTimestamp(record: UnknownRecord): number | undefined {
  return timestampMs(record.updatedAt) ?? timestampMs(record.timestamp) ?? timestampMs(record.createdAt);
}

function cutoffMs(lookback: AdviceSessionLookback, now: number): number | undefined {
  if (lookback === "all") return undefined;
  return now - (lookback === "7d" ? 7 : 14) * dayMs;
}

function withinLookback(updatedAt: number, lookback: AdviceSessionLookback, now: number): boolean {
  const cutoff = cutoffMs(lookback, now);
  return cutoff === undefined || updatedAt >= cutoff;
}

function countInventory(sessions: DatedSession[], targets: AdviceVendor[], now: number): AdviceSessionCountInventory {
  const counts = (lookback: AdviceSessionLookback): AdviceSessionSourceSummary[] => targets.map((source) => ({
    source,
    count: sessions.filter((session) => session.source === source && withinLookback(session.updatedAt, lookback, now)).length
  }));
  return { "7d": counts("7d"), "14d": counts("14d"), all: counts("all") };
}

export { redactSessionText } from "./advice-patterns";

function visibleTextBlocks(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (item.type === "text" && typeof item.text === "string") return [item.text];
    if (item.type === "input_text" && typeof item.text === "string") return [item.text];
    return [];
  });
}

function isInternalAdvisorText(value: unknown): boolean {
  return visibleTextBlocks(value).some((text) => text.toLowerCase().includes(internalAdvisorMarker));
}

function isCorrection(text: string): boolean {
  return /\b(?:actually|instead|no[, ]|please (?:do|use|keep|stop)|should (?:be|use)|must (?:not|use)|don['’]t)\b/i.test(text);
}

function looksLikeManualWorkflow(text: string): boolean {
  return /\b(?:create|deploy|fix|generate|publish|release|review|run|triage|update|verify)\b/i.test(text);
}

function looksLikeOutcome(text: string): boolean {
  return /\b(?:blocked|completed|failed|fixed|implemented|passed|resolved|succeeded|unable|verified)\b/i.test(text);
}

function isVerificationCommand(command: string): boolean {
  return /(?:^|\s)(?:test|pytest|ruff|eslint|tsc|check|lint|spec|just check|cargo test|go test)(?:\s|$)/i.test(command);
}

function isAgentGuidancePath(path: string): boolean {
  return /(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|\.farrier\.json|settings\.json|skills-lock\.json)$/i.test(path);
}

function claudeToolUses(record: UnknownRecord): UnknownRecord[] {
  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];
  return content.filter((item): item is UnknownRecord => isRecord(item) && item.type === "tool_use");
}

function signalsFromClaudeRecord(record: UnknownRecord, sessionId: string, signals: AdviceEvidence[]): void {
  if (record.type === "user") {
    const message = isRecord(record.message) ? record.message : undefined;
    for (const text of visibleTextBlocks(message?.content ?? record.content)) {
      if (isCorrection(text)) addSignal(signals, { source: "claude", kind: "correction", summary: text, sessionId });
      else if (looksLikeManualWorkflow(text)) addSignal(signals, { source: "claude", kind: "manual-workflow", summary: text, sessionId });
    }
  } else if (record.type === "assistant") {
    const message = isRecord(record.message) ? record.message : undefined;
    for (const text of visibleTextBlocks(message?.content ?? record.content)) {
      if (looksLikeOutcome(text)) addSignal(signals, { source: "claude", kind: "outcome", summary: text, sessionId });
    }
  }

  for (const use of claudeToolUses(record)) {
    const name = typeof use.name === "string" ? use.name : "";
    const input = isRecord(use.input) ? use.input : {};
    if ((name === "WebSearch" || name === "WebFetch") && typeof (input.query ?? input.url) === "string") {
      addSignal(signals, { source: "claude", kind: "external-lookup", summary: `${name}: ${String(input.query ?? input.url)}`, sessionId });
    }
    if ((name === "Task" || name === "Agent") && typeof (input.description ?? input.prompt) === "string") {
      addSignal(signals, { source: "claude", kind: "delegation", summary: String(input.description ?? input.prompt), sessionId });
    }
    if (name === "Bash" && typeof input.command === "string" && isVerificationCommand(input.command)) {
      addSignal(signals, { source: "claude", kind: "verification", summary: input.command, sessionId });
    }
    const path = input.file_path ?? input.path;
    if ((name === "Edit" || name === "Write" || name === "MultiEdit") && typeof path === "string" && isAgentGuidancePath(path)) {
      addSignal(signals, { source: "claude", kind: "guidance-edit", summary: `Updated agent guidance/configuration: ${path}`, sessionId });
    }
  }
}

async function indexClaudeSessions(targetDir: string, transcriptsDir?: string): Promise<{
  directory: string;
  sessions: ClaudeSession[];
  malformed: number;
  discovered: number;
}> {
  const directory = transcriptsDir ? resolve(transcriptsDir) : defaultTranscriptDir(targetDir);
  let files: Array<{ name: string; mtimeMs: number }>;
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
    files = (await Promise.all(names.map(async (name) => ({ name, mtimeMs: (await stat(join(directory, name))).mtimeMs }))))
      .sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name))
      .slice(0, maxClaudeFiles);
  } catch {
    return { directory, sessions: [], malformed: 0, discovered: 0 };
  }

  let malformed = 0;
  const sessions: ClaudeSession[] = [];
  const exactDirectory = resolve(directory) === resolve(defaultTranscriptDir(targetDir));
  for (const file of files) {
    const sessionId = basename(file.name, ".jsonl");
    const text = (await readFile(join(directory, file.name), "utf8")).slice(0, maxSessionBytes);
    const records: UnknownRecord[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (isRecord(parsed)) records.push(parsed);
      } catch {
        malformed += 1;
      }
    }
    const matchingRecords = records.filter((record) =>
      typeof record.cwd === "string" ? resolve(record.cwd) === targetDir : exactDirectory
    );
    if (matchingRecords.length === 0) continue;
    if (matchingRecords.some((record) => {
      if (record.type !== "user") return false;
      const message = isRecord(record.message) ? record.message : undefined;
      return isInternalAdvisorText(message?.content ?? record.content);
    })) continue;
    const timestamps = matchingRecords.map(recordTimestamp).filter((value): value is number => value !== undefined);
    sessions.push({
      source: "claude",
      id: sessionId,
      file: file.name,
      records: matchingRecords,
      updatedAt: timestamps.length > 0 ? Math.max(...timestamps) : file.mtimeMs
    });
  }
  return { directory, sessions, malformed, discovered: files.length };
}

async function collectClaude(
  targetDir: string,
  transcriptsDir: string | undefined,
  lookback: AdviceSessionLookback,
  now: number
): Promise<AdviceSessionEvidence> {
  const indexed = await indexClaudeSessions(targetDir, transcriptsDir);
  const eligible = indexed.sessions.filter((session) => withinLookback(session.updatedAt, lookback, now));
  const signals: AdviceEvidence[] = [];
  for (const session of eligible) {
    for (const record of session.records) signalsFromClaudeRecord(record, session.id, signals);
  }

  if (eligible.length > 0) {
    const exactDirectory = resolve(indexed.directory) === resolve(defaultTranscriptDir(targetDir));
    const eligibleFiles = new Set(eligible.map((session) => session.file));
    const failures = await extractCandidateEvents(indexed.directory, {
      fileFilter: (fileName) => eligibleFiles.has(fileName),
      recordFilter: (record) => typeof record.cwd === "string" ? resolve(record.cwd) === targetDir : exactDirectory
    });
    for (const event of failures.events) {
      addSignal(signals, {
        source: "claude",
        kind: "failed-command",
        summary: `${event.command}: ${event.reason}`,
        sessionId: "aggregate",
        occurrences: event.count
      });
    }
  }

  const notes = indexed.malformed > 0 ? [`Skipped ${indexed.malformed} malformed Claude session record(s).`] : [];
  const funnel = sourceFunnel("claude", eligible.length, signals, indexed.malformed);
  const source = funnel.sources[0]!;
  source.discovered = indexed.discovered;
  source.eligible = eligible.length;
  source.read = eligible.length;
  source.parsed = eligible.length;
  source.discarded.filtering = Math.max(indexed.discovered - eligible.length, 0);
  return {
    sources: [{ source: "claude", count: eligible.length }], signals, notes,
    funnel
  };
}

function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function resultRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function codexThreadTimestamp(summary: UnknownRecord): number {
  return timestampMs(summary.updatedAt) ?? timestampMs(summary.createdAt) ?? 0;
}

async function listCodexThreadSummaries(
  client: CodexAppServerClient,
  targetDir: string,
  lookback: AdviceSessionLookback,
  now: number
): Promise<{ threads: UnknownRecord[]; discovered: number; filtered: number }> {
  const threads: UnknownRecord[] = [];
  let discovered = 0;
  let filtered = 0;
  let cursor: string | undefined;
  let scanned = 0;
  const seenCursors = new Set<string>();
  const cutoff = cutoffMs(lookback, now);
  do {
    const result = resultRecord(await client.request("thread/list", {
      cwd: targetDir,
      cursor: cursor ?? null,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"]
    }));
    const page = recordArray(result.data);
    discovered += page.length;
    scanned += page.length;
    for (const summary of page) {
      if (typeof summary.id !== "string") { filtered += 1; continue; }
      if (typeof summary.cwd === "string" && resolve(summary.cwd) !== targetDir) { filtered += 1; continue; }
      if (typeof summary.preview === "string" && summary.preview.toLowerCase().includes(internalAdvisorMarker)) { filtered += 1; continue; }
      if (withinLookback(codexThreadTimestamp(summary), lookback, now)) threads.push(summary);
      else filtered += 1;
    }
    const oldest = page.length > 0 ? codexThreadTimestamp(page[page.length - 1]!) : undefined;
    if (cutoff !== undefined && oldest !== undefined && oldest > 0 && oldest < cutoff) break;
    const next = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
    if (!next || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  } while (scanned < 500);
  return { threads, discovered, filtered };
}

async function readCodexThreads(client: CodexAppServerClient, summaries: UnknownRecord[], targetDir: string): Promise<UnknownRecord[]> {
  const exact: UnknownRecord[] = [];
  for (const summary of summaries) {
    const read = resultRecord(await client.request("thread/read", { threadId: summary.id, includeTurns: true }));
    const thread = resultRecord(read.thread);
    const cwd = typeof thread.cwd === "string" ? resolve(thread.cwd) : typeof summary.cwd === "string" ? resolve(summary.cwd) : undefined;
    if (cwd !== targetDir) continue;
    const internal = recordArray(thread.turns).some((turn) => recordArray(turn.items).some((item) =>
      item.type === "userMessage" && isInternalAdvisorText(item.content)
    ));
    if (internal) continue;
    exact.push(thread);
  }
  return exact;
}

function signalsFromCodexThread(thread: UnknownRecord, signals: AdviceEvidence[]): void {
  const sessionId = typeof thread.id === "string" ? thread.id : "unknown";
  for (const turn of recordArray(thread.turns)) {
    for (const item of recordArray(turn.items)) {
      const type = typeof item.type === "string" ? item.type : "";
      if (type === "reasoning") continue;
      if (type === "userMessage") {
        for (const text of visibleTextBlocks(item.content)) {
          if (isCorrection(text)) addSignal(signals, { source: "codex", kind: "correction", summary: text, sessionId });
          else if (looksLikeManualWorkflow(text)) addSignal(signals, { source: "codex", kind: "manual-workflow", summary: text, sessionId });
        }
      } else if (type === "agentMessage" && typeof item.text === "string" && looksLikeOutcome(item.text)) {
        addSignal(signals, { source: "codex", kind: "outcome", summary: item.text, sessionId });
      } else if (type === "commandExecution" && typeof item.command === "string") {
        const failed = item.status === "failed" || (typeof item.exitCode === "number" && item.exitCode !== 0);
        if (failed) {
          addSignal(signals, { source: "codex", kind: "failed-command", summary: `${item.command}: ${String(item.aggregatedOutput ?? item.status ?? "failed")}`, sessionId });
        } else if (isVerificationCommand(item.command)) {
          addSignal(signals, { source: "codex", kind: "verification", summary: item.command, sessionId });
        }
      } else if (type === "webSearch") {
        addSignal(signals, { source: "codex", kind: "external-lookup", summary: String(item.query ?? "web search"), sessionId });
      } else if (type === "mcpToolCall") {
        addSignal(signals, { source: "codex", kind: "external-lookup", summary: `${String(item.server ?? "MCP")}/${String(item.tool ?? "tool")}`, sessionId });
      } else if (type === "collabToolCall") {
        addSignal(signals, { source: "codex", kind: "delegation", summary: String(item.prompt ?? item.tool ?? "specialist delegation"), sessionId });
      } else if (type === "fileChange") {
        const paths = recordArray(item.changes).map((change) => String(change.path ?? change.file ?? "")).filter(isAgentGuidancePath);
        for (const path of paths) addSignal(signals, { source: "codex", kind: "guidance-edit", summary: `Updated agent guidance/configuration: ${path}`, sessionId });
      }
    }
  }
}

async function collectCodex(
  targetDir: string,
  clientFactory: CodexAppServerFactory,
  lookback: AdviceSessionLookback,
  now: number
): Promise<AdviceSessionEvidence> {
  if (!Bun.which("codex") && clientFactory === createCodexAppServerClient) {
    return { sources: [{ source: "codex", count: 0 }], signals: [], notes: ["Codex is unavailable; Codex sessions were not read."], funnel: sourceFunnel("codex", 0, []) };
  }
  let client: CodexAppServerClient | undefined;
  try {
    client = await clientFactory();
    const listed = await listCodexThreadSummaries(client, targetDir, lookback, now);
    const threads = await readCodexThreads(client, listed.threads, targetDir);
    const signals: AdviceEvidence[] = [];
    for (const thread of threads) signalsFromCodexThread(thread, signals);
    const funnel = sourceFunnel("codex", threads.length, signals);
    const source = funnel.sources[0]!;
    source.discovered = listed.discovered;
    source.eligible = listed.threads.length;
    source.read = listed.threads.length;
    source.parsed = threads.length;
    source.discarded.filtering = listed.filtered + Math.max(listed.threads.length - threads.length, 0);
    return { sources: [{ source: "codex", count: threads.length }], signals, notes: [], funnel };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sources: [{ source: "codex", count: 0 }], signals: [], notes: [`Codex sessions unavailable: ${message}`], funnel: sourceFunnel("codex", 0, []) };
  } finally {
    await client?.close();
  }
}

export async function discoverProjectSessionCounts(input: {
  targetDir: string;
  targets?: AdviceVendor[];
  codexClientFactory?: CodexAppServerFactory;
  claudeTranscriptsDir?: string;
  now?: number;
}): Promise<AdviceSessionCountInventory> {
  const targetDir = resolve(input.targetDir);
  const targets = input.targets ?? ["claude", "codex"];
  const now = input.now ?? Date.now();
  const sessions: DatedSession[] = [];
  if (targets.includes("claude")) {
    const claude = await indexClaudeSessions(targetDir, input.claudeTranscriptsDir);
    sessions.push(...claude.sessions);
  }
  if (targets.includes("codex")) {
    const clientFactory = input.codexClientFactory ?? createCodexAppServerClient;
    if (Bun.which("codex") || clientFactory !== createCodexAppServerClient) {
      let client: CodexAppServerClient | undefined;
      try {
        client = await clientFactory();
        const summaries = await listCodexThreadSummaries(client, targetDir, "all", now);
        sessions.push(...summaries.threads.map((summary) => ({
          source: "codex" as const,
          id: String(summary.id),
          updatedAt: codexThreadTimestamp(summary)
        })));
      } catch {
        // Discovery is advisory; the analysis run will report detailed session errors.
      } finally {
        await client?.close();
      }
    }
  }
  return countInventory(sessions, targets, now);
}

export async function collectProjectSessionEvidence(input: {
  targetDir: string;
  targets?: AdviceVendor[];
  codexClientFactory?: CodexAppServerFactory;
  claudeTranscriptsDir?: string;
  lookback?: AdviceSessionLookback;
  now?: number;
}): Promise<AdviceSessionEvidence> {
  const targetDir = resolve(input.targetDir);
  const targets = input.targets ?? ["claude", "codex"];
  const lookback = input.lookback ?? "7d";
  const now = input.now ?? Date.now();
  const results = await Promise.all([
    targets.includes("claude") ? collectClaude(targetDir, input.claudeTranscriptsDir, lookback, now) : Promise.resolve(undefined),
    targets.includes("codex") ? collectCodex(targetDir, input.codexClientFactory ?? createCodexAppServerClient, lookback, now) : Promise.resolve(undefined)
  ]);
  const included = results.filter((result): result is AdviceSessionEvidence => result !== undefined);
  const signals = selectFairSignals(included);
  const sourceFunnels = included.flatMap((result) => result.funnel?.sources ?? []);
  for (const source of sourceFunnels) {
    const retained = signals.filter((signal) => signal.source === source.source).length;
    source.discarded.limits = Math.max(source.retainedPatterns - retained, 0);
    source.retainedPatterns = retained;
  }
  return {
    sources: included.flatMap((result) => result.sources),
    signals,
    notes: included.flatMap((result) => result.notes),
    funnel: {
      sources: sourceFunnels,
      visibleEvents: sourceFunnels.reduce((sum, source) => sum + source.visibleEvents, 0),
      recurringPatterns: signals.filter((signal) => (signal.distinctSessions ?? 0) >= 2 || (signal.occurrences ?? 1) >= 2).length
    }
  };
}
