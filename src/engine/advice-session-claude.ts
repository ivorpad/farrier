import { constants, type BigIntStats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { defaultTranscriptDir } from "./learn";
import {
  boundSessionText,
  episodeId,
  extractUserRequest,
} from "./advice-patterns";
import type {
  AdviceSessionAction,
  AdviceSessionEpisode,
  AdviceSessionLookback,
} from "./advice-types";
import {
  filterEpisodeByConsent,
  type SessionConsentCategory,
  type SessionConsentSelection,
} from "./advice-session-consent";
import {
  type IndexedSession,
  isRecord,
  type ProviderSessionIndex,
  sameSourceStat,
  sessionProjectRoot,
  sha256,
  sourceFingerprint,
  sourceStatFingerprint,
  type SourceStatFingerprint,
  type UnknownRecord,
  withinLookback,
} from "./advice-session-index";

const maxClaudeFiles = 500;
const internalAdvisorMarker = "farrier's read-only project advisor";

export type ClaudeSessionLocator = {
  directory: string;
  filename: string;
  stat: SourceStatFingerprint;
};

export type ClaudeSelectionRead = {
  episodes: AdviceSessionEpisode[];
  malformed: number;
  truncated: boolean;
  parsedRecords: number;
};

function visibleTextBlocks(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if ((item.type === "text" || item.type === "input_text") && typeof item.text === "string") {
      return [item.text];
    }
    return [];
  });
}

function isInternalAdvisorText(value: unknown): boolean {
  return visibleTextBlocks(value).some((text) =>
    text.toLowerCase().includes(internalAdvisorMarker));
}

function isCorrection(text: string): boolean {
  return /\b(?:actually|instead|no|please (?:do|use|keep|stop)|should (?:be|use)|must (?:not|use)|don['’]t|also|one more requirement)\b/i.test(text);
}

function isVerificationCommand(command: string): boolean {
  return /(?:^|\s)(?:test|pytest|ruff|eslint|tsc|check|lint|spec|just check|cargo test|go test)(?:\s|$)/i.test(command);
}

function action(
  type: AdviceSessionAction["type"],
  summary: string,
  status?: AdviceSessionAction["status"],
): AdviceSessionAction | undefined {
  const bounded = boundSessionText(summary, 600).text;
  return bounded ? { type, summary: bounded, ...(status ? { status } : {}) } : undefined;
}

function newEpisode(
  sessionId: string,
  turnId: string,
  request: string,
): AdviceSessionEpisode | undefined {
  const extracted = extractUserRequest(request);
  if (!extracted || extracted.toLowerCase().includes(internalAdvisorMarker)) return undefined;
  const bounded = boundSessionText(extracted, 4_000);
  return {
    id: episodeId("claude", sessionId, turnId, bounded.text),
    provider: "claude",
    sessionId,
    turnId,
    request: bounded.text,
    corrections: [],
    actions: [],
    occurrences: 1,
    distinctSessions: 1,
    truncated: bounded.truncated,
  };
}

function setOutcome(episode: AdviceSessionEpisode | undefined, text: string): void {
  if (!episode) return;
  const bounded = boundSessionText(text, 1_000).text;
  if (bounded) episode.outcome = bounded;
}

function addAction(
  episode: AdviceSessionEpisode | undefined,
  value: AdviceSessionAction | undefined,
): void {
  if (episode && value && episode.actions.length < 12) episode.actions.push(value);
}

function claudeToolUses(record: UnknownRecord): UnknownRecord[] {
  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content)
    ? message.content
    : Array.isArray(record.content) ? record.content : [];
  return content.filter((item): item is UnknownRecord =>
    isRecord(item) && item.type === "tool_use");
}

function claudeEpisodes(
  sessionId: string,
  records: UnknownRecord[],
): AdviceSessionEpisode[] {
  const episodes: AdviceSessionEpisode[] = [];
  let current: AdviceSessionEpisode | undefined;
  for (const [index, record] of records.entries()) {
    const message = isRecord(record.message) ? record.message : undefined;
    if (record.type === "user") {
      for (const raw of visibleTextBlocks(message?.content ?? record.content)) {
        const request = extractUserRequest(raw);
        if (!request) continue;
        if (current && isCorrection(request)) {
          const correction = boundSessionText(request, 1_500);
          current.corrections.push(correction.text);
          current.truncated ||= correction.truncated;
        } else {
          current = newEpisode(
            sessionId,
            String(record.uuid ?? record.id ?? index),
            request,
          );
          if (current) episodes.push(current);
        }
      }
    } else if (record.type === "assistant") {
      for (const text of visibleTextBlocks(message?.content ?? record.content)) {
        setOutcome(current, text);
      }
    }

    for (const use of claudeToolUses(record)) {
      const name = typeof use.name === "string" ? use.name : "tool";
      const toolInput = isRecord(use.input) ? use.input : {};
      if (name === "Bash" && typeof toolInput.command === "string") {
        addAction(current, action(
          isVerificationCommand(toolInput.command) ? "verification" : "command",
          toolInput.command,
        ));
      } else if (
        (name === "Edit" || name === "Write" || name === "MultiEdit")
        && typeof (toolInput.file_path ?? toolInput.path) === "string"
      ) {
        addAction(current, action("file-change", String(toolInput.file_path ?? toolInput.path)));
      } else if (name === "WebSearch" || name === "WebFetch") {
        addAction(current, action("web", String(toolInput.query ?? toolInput.url ?? name)));
      } else if (name === "Task" || name === "Agent") {
        addAction(current, action("delegation", String(toolInput.description ?? toolInput.prompt ?? name)));
      } else if (/mcp/i.test(name)) {
        addAction(current, action("mcp", name));
      }
    }
  }
  return episodes;
}

function recentClaudeTurns(records: UnknownRecord[], maxTurns: number): UnknownRecord[] {
  let remaining = maxTurns;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.type !== "user") continue;
    const message = isRecord(record.message) ? record.message : undefined;
    const startsTurn = visibleTextBlocks(message?.content ?? record.content)
      .some((text) => Boolean(extractUserRequest(text)));
    if (!startsTurn) continue;
    remaining -= 1;
    if (remaining === 0) return records.slice(index);
  }
  return records;
}

function fileFingerprint(stats: BigIntStats): string {
  const value = sourceStatFingerprint(stats);
  return sourceFingerprint("claude", value);
}

export async function listClaudeSessions(input: {
  targetDir: string;
  lookback: AdviceSessionLookback;
  transcriptsDir?: string;
  now: number;
  signal?: AbortSignal;
}): Promise<ProviderSessionIndex<ClaudeSessionLocator>> {
  const project = await sessionProjectRoot(input.targetDir);
  const requestedDirectory = input.transcriptsDir
    ? resolve(input.transcriptsDir)
    : defaultTranscriptDir(project.root);
  let directory: string;
  try {
    directory = await realpath(requestedDirectory);
  } catch {
    return {
      provider: "claude",
      sessions: [],
      discovered: 0,
      invalid: 0,
      omitted: 0,
      filtered: 0,
      notes: [],
    };
  }

  const exactDirectory = resolve(requestedDirectory) === resolve(defaultTranscriptDir(project.root));
  let directoryIdentity = "";
  const candidates: Array<IndexedSession<ClaudeSessionLocator>> = [];
  let discovered = 0;
  let invalid = 0;
  let valid = 0;
  try {
    const directoryStats = await lstat(directory, { bigint: true });
    if (!directoryStats.isDirectory()) throw new Error("not a directory");
    directoryIdentity = sha256(
      "claude-transcript-root-v1",
      directory,
      directoryStats.dev.toString(),
      directoryStats.ino.toString(),
    );
    const stream = await opendir(directory);
    for await (const directoryEntry of stream) {
      abortIfNeeded(input.signal);
      const filename = directoryEntry.name;
      if (!filename.endsWith(".jsonl")) continue;
      discovered += 1;
      try {
        const stats = await lstat(join(directory, filename), { bigint: true });
        if (stats.isSymbolicLink() || !stats.isFile()) {
          invalid += 1;
          continue;
        }
        valid += 1;
        const stat = sourceStatFingerprint(stats);
        const updatedAt = Number(stats.mtimeNs / 1_000_000n);
        candidates.push({
          updatedAt,
          entry: {
            opaqueId: sha256("claude-session-v1", directoryIdentity, filename),
            provider: "claude",
            updatedAt: new Date(updatedAt).toISOString(),
            projectMatch: exactDirectory ? "directory" : "unknown",
            sourceFingerprint: fileFingerprint(stats),
          },
          locator: { directory, filename, stat },
        });
        candidates.sort((left, right) =>
          right.updatedAt - left.updatedAt
          || left.locator.filename.localeCompare(right.locator.filename));
        if (candidates.length > maxClaudeFiles) candidates.pop();
      } catch {
        invalid += 1;
      }
    }
  } catch {
    return {
      provider: "claude",
      sessions: [],
      discovered,
      invalid: invalid + 1,
      omitted: 0,
      filtered: 0,
      notes: ["Claude session metadata directory is unavailable."],
    };
  }

  const sessions = candidates.filter((item) =>
    withinLookback(item.updatedAt, input.lookback, input.now));
  return {
    provider: "claude",
    sessions,
    discovered,
    invalid,
    omitted: Math.max(valid - candidates.length, 0),
    filtered: Math.max(candidates.length - sessions.length, 0),
    notes: invalid ? [`Ignored ${invalid} unsafe or unreadable Claude metadata entr${invalid === 1 ? "y" : "ies"}.`] : [],
  };
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Session evidence collection was cancelled.");
}

export async function readClaudeSelection(input: {
  indexed: IndexedSession<ClaudeSessionLocator>;
  selection: SessionConsentSelection;
  categories: readonly SessionConsentCategory[];
  targetDir: string;
  signal?: AbortSignal;
}): Promise<ClaudeSelectionRead> {
  abortIfNeeded(input.signal);
  const path = join(input.indexed.locator.directory, input.indexed.locator.filename);
  if (await realpath(input.indexed.locator.directory).catch(() => "") !== input.indexed.locator.directory) {
    throw new Error(`Consented Claude session directory changed: ${input.selection.opaqueId}.`);
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error(`Consented Claude session source disappeared or changed: ${input.selection.opaqueId}.`);
  }

  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameSourceStat(
      sourceStatFingerprint(before),
      input.indexed.locator.stat,
    )) {
      throw new Error(`Consented Claude session source changed: ${input.selection.opaqueId}.`);
    }
    const length = Math.min(Number(before.size), input.selection.maxBytes);
    const start = Number(before.size) - length;
    const buffer = Buffer.alloc(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      abortIfNeeded(input.signal);
      const result = await handle.read(
        buffer,
        bytesRead,
        Math.min(64 * 1024, length - bytesRead),
        start + bytesRead,
      );
      if (!result.bytesRead) break;
      bytesRead += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(path, { bigint: true }).catch(() => undefined);
    const canonicalPathAfter = await realpath(path).catch(() => "");
    const directoryAfter = await realpath(input.indexed.locator.directory).catch(() => "");
    if (directoryAfter !== input.indexed.locator.directory
      || canonicalPathAfter !== path
      || !pathAfter?.isFile()
      || pathAfter.isSymbolicLink()
      || !sameSourceStat(sourceStatFingerprint(pathAfter), sourceStatFingerprint(after))
      || bytesRead !== length || !sameSourceStat(
      sourceStatFingerprint(before),
      sourceStatFingerprint(after),
    )) {
      throw new Error(`Consented Claude session source changed while reading: ${input.selection.opaqueId}.`);
    }

    let text = buffer.toString("utf8", 0, bytesRead);
    if (start > 0) {
      const newline = text.indexOf("\n");
      text = newline < 0 ? "" : text.slice(newline + 1);
    }
    let malformed = 0;
    const parsed: UnknownRecord[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line);
        if (isRecord(value)) parsed.push(value);
        else malformed += 1;
      } catch {
        malformed += 1;
      }
    }

    const project = (await sessionProjectRoot(input.targetDir)).root;
    const recordsWithCwd = await Promise.all(parsed.map(async (record) => {
      if (typeof record.cwd !== "string") return { record, cwd: undefined };
      const cwd = await realpath(resolve(record.cwd)).catch(() => resolve(record.cwd as string));
      return { record, cwd };
    }));
    if (!recordsWithCwd.some((item) => item.cwd === project)) {
      throw new Error(`Consented Claude session does not belong to the selected project: ${input.selection.opaqueId}.`);
    }
    const projectRecords = recordsWithCwd
      .filter((item) => item.cwd === undefined || item.cwd === project)
      .map((item) => item.record);
    const records = recentClaudeTurns(projectRecords, input.selection.maxTurns);
    if (records.some((record) =>
      record.type === "user"
      && isInternalAdvisorText((isRecord(record.message) ? record.message : {}).content ?? record.content)
    )) {
      throw new Error(`Consented Claude session is an internal Farrier session: ${input.selection.opaqueId}.`);
    }
    const episodes = claudeEpisodes(input.selection.opaqueId, records)
      .flatMap((episode) => filterEpisodeByConsent(episode, input.categories) ?? []);
    return {
      episodes,
      malformed,
      parsedRecords: records.length,
      truncated: start > 0 || parsed.length > records.length,
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}
