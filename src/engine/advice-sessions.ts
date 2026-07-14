import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { defaultTranscriptDir } from "./learn";
import { createCodexAppServerClient, type CodexAppServerClient, type CodexAppServerFactory } from "./codex-app-server";
import {
  annotateEpisodeOccurrences,
  boundSessionText,
  episodeEvidence,
  episodeId,
  episodePatternKey,
  extractUserRequest,
  redactSessionText,
  requestCategories,
  selectFairEpisodes
} from "./advice-patterns";
import type {
  AdviceEvidenceFunnel,
  AdviceSessionAction,
  AdviceSessionCountInventory,
  AdviceSessionEpisode,
  AdviceSessionEvidence,
  AdviceSessionLookback,
  AdviceSessionSourceSummary,
  AdviceSourceFunnel,
  AdviceVendor
} from "./advice-types";

type UnknownRecord = Record<string, unknown>;
const maxClaudeFiles = 500;
const maxSessionBytes = 2_000_000;
const dayMs = 86_400_000;
const internalAdvisorMarker = "farrier's read-only project advisor";

type DatedSession = { source: AdviceVendor; id: string; updatedAt: number };
type ClaudeSession = DatedSession & { file: string; records: UnknownRecord[]; truncated: boolean };

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function resultRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function visibleTextBlocks(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if ((item.type === "text" || item.type === "input_text") && typeof item.text === "string") return [item.text];
    return [];
  });
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
    source, count: sessions.filter((session) => session.source === source && withinLookback(session.updatedAt, lookback, now)).length
  }));
  return { "7d": counts("7d"), "14d": counts("14d"), all: counts("all") };
}

export { extractUserRequest, redactSessionText } from "./advice-patterns";

function isInternalAdvisorText(value: unknown): boolean {
  return visibleTextBlocks(value).some((text) => text.toLowerCase().includes(internalAdvisorMarker));
}

function isCorrection(text: string): boolean {
  return /\b(?:actually|instead|no|please (?:do|use|keep|stop)|should (?:be|use)|must (?:not|use)|don['’]t|also|one more requirement)\b/i.test(text);
}

function isVerificationCommand(command: string): boolean {
  return /(?:^|\s)(?:test|pytest|ruff|eslint|tsc|check|lint|spec|just check|cargo test|go test)(?:\s|$)/i.test(command);
}

function action(type: AdviceSessionAction["type"], summary: string, status?: AdviceSessionAction["status"]): AdviceSessionAction | undefined {
  const bounded = boundSessionText(summary, 600).text;
  return bounded ? { type, summary: bounded, ...(status ? { status } : {}) } : undefined;
}

function newEpisode(provider: AdviceVendor, sessionId: string, turnId: string, request: string): AdviceSessionEpisode | undefined {
  const extracted = extractUserRequest(request);
  if (!extracted || extracted.toLowerCase().includes(internalAdvisorMarker)) return undefined;
  const bounded = boundSessionText(extracted, 4_000);
  return {
    id: episodeId(provider, sessionId, turnId, bounded.text), provider, sessionId, turnId,
    request: bounded.text, corrections: [], actions: [], occurrences: 1, distinctSessions: 1,
    truncated: bounded.truncated, allowedCategories: requestCategories(bounded.text)
  };
}

function setOutcome(episode: AdviceSessionEpisode | undefined, text: string): void {
  if (!episode) return;
  const bounded = boundSessionText(text, 1_000).text;
  if (bounded) episode.outcome = bounded;
}

function addAction(episode: AdviceSessionEpisode | undefined, value: AdviceSessionAction | undefined): void {
  if (episode && value && episode.actions.length < 12) episode.actions.push(value);
}

function claudeToolUses(record: UnknownRecord): UnknownRecord[] {
  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];
  return content.filter((item): item is UnknownRecord => isRecord(item) && item.type === "tool_use");
}

function claudeEpisodes(session: ClaudeSession): AdviceSessionEpisode[] {
  const episodes: AdviceSessionEpisode[] = [];
  let current: AdviceSessionEpisode | undefined;
  for (const [index, record] of session.records.entries()) {
    const message = isRecord(record.message) ? record.message : undefined;
    if (record.type === "user") {
      for (const raw of visibleTextBlocks(message?.content ?? record.content)) {
        const request = extractUserRequest(raw);
        if (!request) continue;
        if (current && isCorrection(request)) {
          const correction = boundSessionText(request, 1_500);
          current.corrections.push(correction.text);
          current.truncated ||= correction.truncated;
          current.allowedCategories = Array.from(new Set([...current.allowedCategories, ...requestCategories(request)]));
        } else {
          current = newEpisode("claude", session.id, String(record.uuid ?? record.id ?? index), request);
          if (current) episodes.push(current);
        }
      }
    } else if (record.type === "assistant") {
      for (const text of visibleTextBlocks(message?.content ?? record.content)) setOutcome(current, text);
    }
    for (const use of claudeToolUses(record)) {
      const name = typeof use.name === "string" ? use.name : "tool";
      const input = isRecord(use.input) ? use.input : {};
      if (name === "Bash" && typeof input.command === "string") addAction(current, action(isVerificationCommand(input.command) ? "verification" : "command", input.command));
      else if ((name === "Edit" || name === "Write" || name === "MultiEdit") && typeof (input.file_path ?? input.path) === "string") addAction(current, action("file-change", String(input.file_path ?? input.path)));
      else if (name === "WebSearch" || name === "WebFetch") addAction(current, action("web", String(input.query ?? input.url ?? name)));
      else if (name === "Task" || name === "Agent") addAction(current, action("delegation", String(input.description ?? input.prompt ?? name)));
      else if (/mcp/i.test(name)) addAction(current, action("mcp", name));
    }
  }
  return episodes;
}

async function indexClaudeSessions(targetDir: string, transcriptsDir?: string): Promise<{
  directory: string; sessions: ClaudeSession[]; malformed: number; discovered: number;
}> {
  const directory = transcriptsDir ? resolve(transcriptsDir) : defaultTranscriptDir(targetDir);
  let files: Array<{ name: string; mtimeMs: number; size: number }>;
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
    files = (await Promise.all(names.map(async (name) => {
      const info = await stat(join(directory, name));
      return { name, mtimeMs: info.mtimeMs, size: info.size };
    }))).sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name)).slice(0, maxClaudeFiles);
  } catch { return { directory, sessions: [], malformed: 0, discovered: 0 }; }
  let malformed = 0;
  const sessions: ClaudeSession[] = [];
  const exactDirectory = resolve(directory) === resolve(defaultTranscriptDir(targetDir));
  for (const file of files) {
    const text = (await readFile(join(directory, file.name), "utf8")).slice(0, maxSessionBytes);
    const records: UnknownRecord[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { const parsed = JSON.parse(line); if (isRecord(parsed)) records.push(parsed); } catch { malformed += 1; }
    }
    const matching = records.filter((record) => typeof record.cwd === "string" ? resolve(record.cwd) === targetDir : exactDirectory);
    if (!matching.length || matching.some((record) => record.type === "user" && isInternalAdvisorText((isRecord(record.message) ? record.message : {}).content ?? record.content))) continue;
    const timestamps = matching.map(recordTimestamp).filter((value): value is number => value !== undefined);
    sessions.push({
      source: "claude", id: basename(file.name, ".jsonl"), file: file.name, records: matching,
      updatedAt: timestamps.length ? Math.max(...timestamps) : file.mtimeMs, truncated: file.size > maxSessionBytes
    });
  }
  return { directory, sessions, malformed, discovered: files.length };
}

function sourceFunnel(source: AdviceVendor, input: {
  discovered: number; eligible: number; read: number; parsed: number; episodes: AdviceSessionEpisode[];
  malformed?: number; filtering?: number; truncatedInputs?: number;
}): AdviceSourceFunnel {
  const visibleEvents = input.episodes.reduce((sum, item) => sum + 1 + item.corrections.length + item.actions.length + (item.outcome ? 1 : 0), 0);
  return {
    source, discovered: input.discovered, eligible: input.eligible, read: input.read, parsed: input.parsed, visibleEvents,
    discarded: { filtering: input.filtering ?? 0, redaction: 0, deduplication: 0, malformed: input.malformed ?? 0, limits: 0 },
    retainedPatterns: input.episodes.length, retainedEpisodes: input.episodes.length, omittedEpisodes: 0,
    truncatedEpisodes: input.episodes.filter((item) => item.truncated).length + (input.truncatedInputs ?? 0)
  };
}

async function collectClaude(targetDir: string, transcriptsDir: string | undefined, lookback: AdviceSessionLookback, now: number): Promise<AdviceSessionEvidence> {
  const indexed = await indexClaudeSessions(targetDir, transcriptsDir);
  const eligible = indexed.sessions.filter((session) => withinLookback(session.updatedAt, lookback, now));
  const episodes = eligible.flatMap(claudeEpisodes);
  const funnelSource = sourceFunnel("claude", {
    discovered: indexed.discovered, eligible: eligible.length, read: eligible.length, parsed: eligible.length, episodes,
    malformed: indexed.malformed, filtering: Math.max(indexed.discovered - eligible.length, 0), truncatedInputs: eligible.filter((item) => item.truncated).length
  });
  return {
    sources: [{ source: "claude", count: eligible.length }], episodes, signals: episodes.map(episodeEvidence),
    notes: indexed.malformed ? [`Skipped ${indexed.malformed} malformed Claude session record(s).`] : [],
    funnel: { sources: [funnelSource], visibleEvents: funnelSource.visibleEvents, recurringPatterns: 0, retainedEpisodes: episodes.length, omittedEpisodes: 0, truncatedEpisodes: funnelSource.truncatedEpisodes }
  };
}

function codexThreadTimestamp(summary: UnknownRecord): number {
  return timestampMs(summary.updatedAt) ?? timestampMs(summary.createdAt) ?? 0;
}

async function listCodexThreadSummaries(client: CodexAppServerClient, targetDir: string, lookback: AdviceSessionLookback, now: number): Promise<{ threads: UnknownRecord[]; discovered: number; filtered: number }> {
  const threads: UnknownRecord[] = [];
  let discovered = 0;
  let filtered = 0;
  let cursor: string | undefined;
  let scanned = 0;
  const seen = new Set<string>();
  const cutoff = cutoffMs(lookback, now);
  do {
    const result = resultRecord(await client.request("thread/list", {
      cwd: targetDir, cursor: cursor ?? null, limit: 100, sortKey: "updated_at", sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"]
    }));
    const page = recordArray(result.data);
    discovered += page.length;
    scanned += page.length;
    for (const summary of page) {
      if (typeof summary.id !== "string" || (typeof summary.cwd === "string" && resolve(summary.cwd) !== targetDir) ||
        (typeof summary.preview === "string" && summary.preview.toLowerCase().includes(internalAdvisorMarker)) ||
        !withinLookback(codexThreadTimestamp(summary), lookback, now)) filtered += 1;
      else threads.push(summary);
    }
    const oldest = page.length ? codexThreadTimestamp(page.at(-1)!) : undefined;
    if (cutoff !== undefined && oldest !== undefined && oldest > 0 && oldest < cutoff) break;
    const next = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
    if (!next || seen.has(next)) break;
    seen.add(next);
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
    const internal = recordArray(thread.turns).some((turn) => recordArray(turn.items).some((item) => item.type === "userMessage" && isInternalAdvisorText(item.content)));
    if (!internal) exact.push(thread);
  }
  return exact;
}

function codexEpisodes(thread: UnknownRecord): AdviceSessionEpisode[] {
  const sessionId = typeof thread.id === "string" ? thread.id : "unknown";
  const episodes: AdviceSessionEpisode[] = [];
  let previous: AdviceSessionEpisode | undefined;
  for (const [turnIndex, turn] of recordArray(thread.turns).entries()) {
    let current: AdviceSessionEpisode | undefined;
    for (const [itemIndex, item] of recordArray(turn.items).entries()) {
      const type = typeof item.type === "string" ? item.type : "";
      if (type === "reasoning") continue;
      if (type === "userMessage") {
        for (const raw of visibleTextBlocks(item.content)) {
          const request = extractUserRequest(raw);
          if (!request) continue;
          if ((current || previous) && isCorrection(request)) {
            current = current ?? previous;
            const correction = boundSessionText(request, 1_500);
            current!.corrections.push(correction.text);
            current!.truncated ||= correction.truncated;
            current!.allowedCategories = Array.from(new Set([...current!.allowedCategories, ...requestCategories(request)]));
          }
          else {
            current = newEpisode("codex", sessionId, String(turn.id ?? `${turnIndex}:${itemIndex}`), request);
            if (current) {
              episodes.push(current);
              previous = current;
            }
          }
        }
      } else if (type === "agentMessage" && typeof item.text === "string") setOutcome(current, item.text);
      else if (type === "commandExecution" && typeof item.command === "string") {
        const failed = item.status === "failed" || (typeof item.exitCode === "number" && item.exitCode !== 0);
        addAction(current, action(!failed && isVerificationCommand(item.command) ? "verification" : "command", item.command, failed ? "failed" : item.status === "completed" ? "completed" : "unknown"));
        if (failed) setOutcome(current, `Command failed: ${item.command}`);
      } else if (type === "webSearch") addAction(current, action("web", String(item.query ?? "web search")));
      else if (type === "mcpToolCall") addAction(current, action("mcp", `${String(item.server ?? "MCP")}/${String(item.tool ?? "tool")}`));
      else if (type === "collabToolCall") addAction(current, action("delegation", String(item.prompt ?? item.tool ?? "specialist delegation")));
      else if (type === "fileChange") {
        for (const change of recordArray(item.changes).slice(0, 12)) addAction(current, action("file-change", String(change.path ?? change.file ?? "file change")));
      }
    }
  }
  return episodes;
}

function emptySource(source: AdviceVendor): AdviceEvidenceFunnel {
  const item = sourceFunnel(source, { discovered: 0, eligible: 0, read: 0, parsed: 0, episodes: [] });
  return { sources: [item], visibleEvents: 0, recurringPatterns: 0, retainedEpisodes: 0, omittedEpisodes: 0, truncatedEpisodes: 0 };
}

async function collectCodex(targetDir: string, clientFactory: CodexAppServerFactory, lookback: AdviceSessionLookback, now: number): Promise<AdviceSessionEvidence> {
  if (!Bun.which("codex") && clientFactory === createCodexAppServerClient) return {
    sources: [{ source: "codex", count: 0 }], episodes: [], signals: [], notes: ["Codex is unavailable; Codex sessions were not read."], funnel: emptySource("codex")
  };
  let client: CodexAppServerClient | undefined;
  try {
    client = await clientFactory();
    const listed = await listCodexThreadSummaries(client, targetDir, lookback, now);
    const threads = await readCodexThreads(client, listed.threads, targetDir);
    const episodes = threads.flatMap(codexEpisodes);
    const item = sourceFunnel("codex", {
      discovered: listed.discovered, eligible: listed.threads.length, read: listed.threads.length, parsed: threads.length,
      episodes, filtering: listed.filtered + Math.max(listed.threads.length - threads.length, 0)
    });
    return {
      sources: [{ source: "codex", count: threads.length }], episodes, signals: episodes.map(episodeEvidence), notes: [],
      funnel: { sources: [item], visibleEvents: item.visibleEvents, recurringPatterns: 0, retainedEpisodes: episodes.length, omittedEpisodes: 0, truncatedEpisodes: item.truncatedEpisodes }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sources: [{ source: "codex", count: 0 }], episodes: [], signals: [], notes: [`Codex sessions unavailable: ${message}`], funnel: emptySource("codex") };
  } finally { await client?.close(); }
}

export async function discoverProjectSessionCounts(input: {
  targetDir: string; targets?: AdviceVendor[]; codexClientFactory?: CodexAppServerFactory; claudeTranscriptsDir?: string; now?: number;
}): Promise<AdviceSessionCountInventory> {
  const targetDir = resolve(input.targetDir);
  const targets = input.targets ?? ["claude", "codex"];
  const now = input.now ?? Date.now();
  const sessions: DatedSession[] = [];
  if (targets.includes("claude")) sessions.push(...(await indexClaudeSessions(targetDir, input.claudeTranscriptsDir)).sessions);
  if (targets.includes("codex")) {
    const factory = input.codexClientFactory ?? createCodexAppServerClient;
    if (Bun.which("codex") || factory !== createCodexAppServerClient) {
      let client: CodexAppServerClient | undefined;
      try {
        client = await factory();
        const listed = await listCodexThreadSummaries(client, targetDir, "all", now);
        sessions.push(...listed.threads.map((summary) => ({ source: "codex" as const, id: String(summary.id), updatedAt: codexThreadTimestamp(summary) })));
      } catch { /* discovery remains advisory */ } finally { await client?.close(); }
    }
  }
  return countInventory(sessions, targets, now);
}

export async function collectProjectSessionEvidence(input: {
  targetDir: string; targets?: AdviceVendor[]; codexClientFactory?: CodexAppServerFactory;
  claudeTranscriptsDir?: string; lookback?: AdviceSessionLookback; now?: number;
}): Promise<AdviceSessionEvidence> {
  const targetDir = resolve(input.targetDir);
  const targets = input.targets ?? ["claude", "codex"];
  const lookback = input.lookback ?? "7d";
  const now = input.now ?? Date.now();
  const results = (await Promise.all([
    targets.includes("claude") ? collectClaude(targetDir, input.claudeTranscriptsDir, lookback, now) : undefined,
    targets.includes("codex") ? collectCodex(targetDir, input.codexClientFactory ?? createCodexAppServerClient, lookback, now) : undefined
  ])).filter((item): item is AdviceSessionEvidence => item !== undefined);
  const allEpisodes = results.flatMap((result) => result.episodes ?? []);
  annotateEpisodeOccurrences(allEpisodes);
  const selected = selectFairEpisodes(allEpisodes);
  const sourceFunnels = results.flatMap((result) => result.funnel?.sources ?? []);
  for (const source of sourceFunnels) {
    const retained = selected.episodes.filter((episode) => episode.provider === source.source).length;
    const original = allEpisodes.filter((episode) => episode.provider === source.source).length;
    source.retainedPatterns = retained;
    source.retainedEpisodes = retained;
    source.omittedEpisodes = Math.max(original - retained, 0);
    source.discarded.limits = source.omittedEpisodes;
  }
  return {
    sources: results.flatMap((result) => result.sources), episodes: selected.episodes, signals: selected.episodes.map(episodeEvidence),
    notes: results.flatMap((result) => result.notes),
    funnel: {
      sources: sourceFunnels, visibleEvents: sourceFunnels.reduce((sum, source) => sum + source.visibleEvents, 0),
      recurringPatterns: new Set(selected.episodes.filter((episode) => episode.distinctSessions > 1).map(episodePatternKey)).size,
      retainedEpisodes: selected.episodes.length, omittedEpisodes: selected.omitted,
      truncatedEpisodes: selected.episodes.filter((episode) => episode.truncated).length
    }
  };
}
