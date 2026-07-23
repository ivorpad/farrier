import {
  boundSessionText,
  episodeId,
  extractUserRequest,
} from "./advice-patterns";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AdviceSessionAction,
  AdviceSessionEpisode,
  AdviceSessionLookback,
} from "./advice-types";
import type { CodexAppServerClient } from "./codex-app-server";
import {
  filterEpisodeByConsent,
  type SessionConsentCategory,
  type SessionConsentSelection,
} from "./advice-session-consent";
import {
  cutoffMs,
  type IndexedSession,
  isRecord,
  type ProviderSessionIndex,
  recordArray,
  resultRecord,
  sessionPreviewLabel,
  sessionProjectRoot,
  sha256,
  sourceFingerprint,
  timestampMs,
  type UnknownRecord,
  withinLookback,
} from "./advice-session-index";

const maxCodexThreads = 500;
const metadataPageSize = 20;
const listResponseBytes = 1_000_000;
const internalAdvisorMarker = "farrier's read-only project advisor";
const rootSessionSourceKinds = ["cli", "vscode", "exec", "appServer", "unknown"];

export type CodexSessionLocator = {
  threadId: string;
  summary: UnknownRecord;
};

export type CodexSelectionRead = {
  episodes: AdviceSessionEpisode[];
  parsedTurns: number;
  truncated: boolean;
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
    id: episodeId("codex", sessionId, turnId, bounded.text),
    provider: "codex",
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

function codexEpisodes(
  sessionId: string,
  turns: UnknownRecord[],
): AdviceSessionEpisode[] {
  const episodes: AdviceSessionEpisode[] = [];
  let previous: AdviceSessionEpisode | undefined;
  for (const [turnIndex, turn] of turns.entries()) {
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
          } else {
            current = newEpisode(
              sessionId,
              String(turn.id ?? `${turnIndex}:${itemIndex}`),
              request,
            );
            if (current) {
              episodes.push(current);
              previous = current;
            }
          }
        }
      } else if (type === "agentMessage" && typeof item.text === "string") {
        setOutcome(current, item.text);
      } else if (type === "commandExecution" && typeof item.command === "string") {
        const failed = item.status === "failed"
          || (typeof item.exitCode === "number" && item.exitCode !== 0);
        addAction(current, action(
          !failed && isVerificationCommand(item.command) ? "verification" : "command",
          item.command,
          failed ? "failed" : item.status === "completed" ? "completed" : "unknown",
        ));
        if (failed) setOutcome(current, `Command failed: ${item.command}`);
      } else if (type === "webSearch") {
        addAction(current, action("web", String(item.query ?? "web search")));
      } else if (type === "mcpToolCall") {
        addAction(current, action("mcp", `${String(item.server ?? "MCP")}/${String(item.tool ?? "tool")}`));
      } else if (type === "collabToolCall") {
        addAction(current, action("delegation", String(item.prompt ?? item.tool ?? "specialist delegation")));
      } else if (type === "fileChange") {
        for (const change of recordArray(item.changes).slice(0, 12)) {
          addAction(current, action("file-change", String(change.path ?? change.file ?? "file change")));
        }
      }
    }
  }
  return episodes;
}

function codexThreadTimestamp(summary: UnknownRecord): number {
  return timestampMs(summary.updatedAt) ?? timestampMs(summary.createdAt) ?? 0;
}

function summaryFingerprint(summary: UnknownRecord, projectRoot: string): string {
  return sourceFingerprint("codex", {
    id: summary.id,
    cwd: typeof summary.cwd === "string" ? summary.cwd : projectRoot,
    createdAt: summary.createdAt ?? null,
    updatedAt: summary.updatedAt ?? null,
    source: summary.source ?? summary.sourceKind ?? null,
    threadSource: summary.threadSource ?? null,
    parentThreadId: summary.parentThreadId ?? null,
    forkedFromId: summary.forkedFromId ?? null,
    status: summary.status ?? null,
    turnCount: summary.turnCount ?? null,
  });
}

function isDerivedThread(summary: UnknownRecord): boolean {
  if (typeof summary.parentThreadId === "string" && summary.parentThreadId) return true;
  if (typeof summary.forkedFromId === "string" && summary.forkedFromId) return true;
  return [summary.source, summary.sourceKind, summary.threadSource]
    .some((value) => typeof value === "string" && value.toLowerCase().startsWith("subagent"));
}

export async function listCodexSessions(input: {
  client: CodexAppServerClient;
  targetDir: string;
  lookback: AdviceSessionLookback;
  now: number;
  signal?: AbortSignal;
}): Promise<ProviderSessionIndex<CodexSessionLocator>> {
  const project = await sessionProjectRoot(input.targetDir);
  const sessions: Array<IndexedSession<CodexSessionLocator>> = [];
  let discovered = 0;
  let filtered = 0;
  let omitted = 0;
  let cursor: string | undefined;
  let scanned = 0;
  const seen = new Set<string>();
  const cutoff = cutoffMs(input.lookback, input.now);

  do {
    abortIfNeeded(input.signal);
    const remaining = maxCodexThreads - scanned;
    const result = resultRecord(await input.client.request("thread/list", {
      cwd: project.root,
      cursor: cursor ?? null,
      limit: Math.min(metadataPageSize, remaining),
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: rootSessionSourceKinds,
      // Codex ≥0.145 defaults thread/list to threads recorded under the
      // *currently configured* model_provider, hiding every session created
      // under another provider id (e.g. after switching providers with
      // cc-switch). An empty list means all providers; servers that predate
      // the field ignore it.
      modelProviders: [],
    }, { maxResponseBytes: listResponseBytes, signal: input.signal }));
    abortIfNeeded(input.signal);
    const page = recordArray(result.data).slice(0, remaining);
    discovered += page.length;
    scanned += page.length;
    for (const summary of page) {
      const updatedAt = codexThreadTimestamp(summary);
      if (
        typeof summary.id !== "string"
        || (typeof summary.cwd === "string" && await resolveCwd(summary.cwd) !== project.root)
        || isDerivedThread(summary)
        || (typeof summary.preview === "string"
          && summary.preview.toLowerCase().includes(internalAdvisorMarker))
        || !withinLookback(updatedAt, input.lookback, input.now)
      ) {
        filtered += 1;
        continue;
      }
      const approximateTurns = typeof summary.turnCount === "number"
        && Number.isSafeInteger(summary.turnCount)
        && summary.turnCount >= 0
        ? summary.turnCount
        : undefined;
      const label = sessionPreviewLabel(
        typeof summary.name === "string" && summary.name.trim() ? summary.name : summary.preview);
      sessions.push({
        updatedAt,
        entry: {
          opaqueId: sha256("codex-session-v1", project.digest, summary.id),
          provider: "codex",
          updatedAt: new Date(updatedAt).toISOString(),
          projectMatch: "provider-index",
          ...(approximateTurns === undefined ? {} : { approximateTurns }),
          sourceFingerprint: summaryFingerprint(summary, project.root),
          ...(label ? { label } : {}),
        },
        locator: { threadId: summary.id, summary },
      });
    }

    const oldest = page.length ? codexThreadTimestamp(page.at(-1)!) : undefined;
    if (cutoff !== undefined && oldest !== undefined && oldest > 0 && oldest < cutoff) break;
    const next = typeof result.nextCursor === "string" && result.nextCursor
      ? result.nextCursor
      : undefined;
    if (next && scanned >= maxCodexThreads) {
      omitted = 1;
      break;
    }
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  } while (scanned < maxCodexThreads);

  return {
    provider: "codex",
    sessions,
    discovered,
    invalid: 0,
    omitted,
    filtered,
    notes: omitted ? ["Additional Codex session metadata was omitted at the 500-entry limit."] : [],
  };
}

async function resolveCwd(value: string): Promise<string> {
  return realpath(resolve(value)).catch(() => resolve(value));
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Session evidence collection was cancelled.");
}

function changedSummary(thread: UnknownRecord, summary: UnknownRecord): boolean {
  if (typeof thread.id === "string" && thread.id !== summary.id) return true;
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (thread[field] !== undefined && summary[field] !== undefined && thread[field] !== summary[field]) {
      return true;
    }
  }
  return false;
}

export async function readCodexSelection(input: {
  client: CodexAppServerClient;
  indexed: IndexedSession<CodexSessionLocator>;
  selection: SessionConsentSelection;
  categories: readonly SessionConsentCategory[];
  targetDir: string;
  signal?: AbortSignal;
}): Promise<CodexSelectionRead> {
  abortIfNeeded(input.signal);
  const project = await sessionProjectRoot(input.targetDir);
  const read = resultRecord(await input.client.request("thread/read", {
    threadId: input.indexed.locator.threadId,
    includeTurns: true,
  }, { maxResponseBytes: input.selection.maxBytes, signal: input.signal }));
  abortIfNeeded(input.signal);
  const thread = resultRecord(read.thread);
  const cwd = typeof thread.cwd === "string"
    ? await resolveCwd(thread.cwd)
    : typeof input.indexed.locator.summary.cwd === "string"
      ? await resolveCwd(input.indexed.locator.summary.cwd)
      : undefined;
  if (cwd !== project.root) {
    throw new Error(`Consented Codex session does not belong to the selected project: ${input.selection.opaqueId}.`);
  }
  if (changedSummary(thread, input.indexed.locator.summary)) {
    throw new Error(`Consented Codex session changed while reading: ${input.selection.opaqueId}.`);
  }
  const allTurns = recordArray(thread.turns);
  if (allTurns.some((turn) =>
    recordArray(turn.items).some((item) =>
      item.type === "userMessage" && isInternalAdvisorText(item.content))
  )) {
    throw new Error(`Consented Codex session is an internal Farrier session: ${input.selection.opaqueId}.`);
  }
  const turns = allTurns.slice(-input.selection.maxTurns);
  const episodes = codexEpisodes(input.selection.opaqueId, turns)
    .flatMap((episode) => filterEpisodeByConsent(episode, input.categories) ?? []);
  return {
    episodes,
    parsedTurns: turns.length,
    truncated: allTurns.length > turns.length,
  };
}
