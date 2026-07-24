import { createCodexAppServerClient, type CodexAppServerClient, type CodexAppServerFactory } from "./codex-app-server";
import {
  annotateEpisodeOccurrences,
  boundSessionText,
  collapseEpisodePatterns,
  episodeEvidence,
  episodePatternKey,
  selectFairEpisodes,
} from "./advice-patterns";
import {
  visibleSessionEvents,
} from "./advice-evidence-selection";
import type {
  AdviceEvidenceFunnel,
  AdviceSessionCountInventory,
  AdviceSessionEvidence,
  AdviceSessionLookback,
  AdviceSessionSourceSummary,
  AdviceSourceFunnel,
  AdviceVendor,
} from "./advice-types";
import {
  listClaudeSessions,
  readClaudeSelection,
  type ClaudeSelectionRead,
  type ClaudeSessionLocator,
} from "./advice-session-claude";
import {
  listCodexSessions,
  readCodexSelection,
  type CodexSelectionRead,
  type CodexSessionLocator,
} from "./advice-session-codex";
import {
  type IndexedSession,
  metadataInventory,
  type ProviderSessionIndex,
  sessionProjectRoot,
  withinLookback,
} from "./advice-session-index";
import {
  createRecentSessionConsent,
  createSessionConsent,
  recentSessionConsentDefaults,
  sessionConsentCategories,
  sessionConsentDigest,
  validateSessionConsent,
  type SessionConsent,
  type SessionConsentCategory,
  type SessionConsentSelection,
  type SessionIndexEntry,
  type SessionMetadataInventory,
} from "./advice-session-consent";

export { extractUserRequest, redactSessionText } from "./advice-patterns";
export {
  createRecentSessionConsent,
  createSessionConsent,
  recentSessionConsentDefaults,
  sessionConsentCategories,
  sessionConsentDigest,
  validateSessionConsent,
};
export type {
  SessionConsent,
  SessionConsentCategory,
  SessionConsentSelection,
  SessionIndexEntry,
  SessionMetadataInventory,
};
export { sessionProjectRootDigest } from "./advice-session-index";

function normalizedTargets(values: readonly AdviceVendor[] | undefined): AdviceVendor[] {
  const targets: AdviceVendor[] = Array.from(new Set<AdviceVendor>(values ?? ["claude", "codex"]));
  if (targets.some((target) => target !== "claude" && target !== "codex")) {
    throw new Error("Session metadata target must be claude or codex.");
  }
  return targets;
}

function countInventory(
  entries: SessionIndexEntry[],
  targets: AdviceVendor[],
  now: number,
): AdviceSessionCountInventory {
  const counts = (lookback: AdviceSessionLookback): AdviceSessionSourceSummary[] =>
    targets.map((source) => ({
      source,
      count: entries.filter((entry) =>
        entry.provider === source
        && withinLookback(Date.parse(entry.updatedAt), lookback, now)).length,
    }));
  return { "7d": counts("7d"), "14d": counts("14d"), all: counts("all") };
}

function emptyProviderIndex<Locator>(
  provider: AdviceVendor,
  note?: string,
): ProviderSessionIndex<Locator> {
  return {
    provider,
    sessions: [],
    discovered: 0,
    invalid: 0,
    omitted: 0,
    filtered: 0,
    notes: note ? [note] : [],
  };
}

/** Codex listing behind an availability guard: no codex, or a dead app server, becomes a note, never a throw. */
export async function listCodexSafely(input: {
  targetDir: string;
  lookback: AdviceSessionLookback;
  now: number;
  clientFactory: CodexAppServerFactory;
  signal?: AbortSignal;
}): Promise<ProviderSessionIndex<CodexSessionLocator>> {
  if (!Bun.which("codex") && input.clientFactory === createCodexAppServerClient) {
    return emptyProviderIndex("codex", "Codex is unavailable; only Codex session metadata was skipped.");
  }
  let client: CodexAppServerClient | undefined;
  let closeOnAbort: (() => void) | undefined;
  try {
    client = await input.clientFactory();
    closeOnAbort = () => { void client?.close(); };
    input.signal?.addEventListener("abort", closeOnAbort, { once: true });
    abortIfNeeded(input.signal);
    return await listCodexSessions({ client, ...input });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const note = boundSessionText(`Codex session metadata unavailable: ${message}`, 512).text;
    return emptyProviderIndex("codex", note);
  } finally {
    if (closeOnAbort) input.signal?.removeEventListener("abort", closeOnAbort);
    await client?.close();
  }
}

export async function listProjectSessions(input: {
  targetDir: string;
  targets?: AdviceVendor[];
  lookback?: AdviceSessionLookback;
  codexClientFactory?: CodexAppServerFactory;
  claudeTranscriptsDir?: string;
  now?: number;
  signal?: AbortSignal;
}): Promise<SessionMetadataInventory> {
  const project = await sessionProjectRoot(input.targetDir);
  const targets = normalizedTargets(input.targets);
  const lookback = input.lookback ?? "all";
  const now = input.now ?? Date.now();
  const indexes: ProviderSessionIndex<unknown>[] = [];

  if (targets.includes("claude")) {
    indexes.push(await listClaudeSessions({
      targetDir: project.root,
      lookback,
      transcriptsDir: input.claudeTranscriptsDir,
      now,
      signal: input.signal,
    }));
  }
  if (targets.includes("codex")) {
    indexes.push(await listCodexSafely({
      targetDir: project.root,
      lookback,
      now,
      clientFactory: input.codexClientFactory ?? createCodexAppServerClient,
      signal: input.signal,
    }));
  }
  return metadataInventory(project.digest, indexes);
}

export async function discoverProjectSessionCounts(input: {
  targetDir: string;
  targets?: AdviceVendor[];
  codexClientFactory?: CodexAppServerFactory;
  claudeTranscriptsDir?: string;
  now?: number;
  signal?: AbortSignal;
}): Promise<AdviceSessionCountInventory> {
  const targets = normalizedTargets(input.targets);
  const now = input.now ?? Date.now();
  const inventory = await listProjectSessions({ ...input, targets, lookback: "all", now });
  return countInventory(inventory.entries, targets, now);
}

function sourceFunnel(source: AdviceVendor, input: {
  discovered: number;
  eligible: number;
  read: number;
  parsed: number;
  visibleEvents: number;
  episodes: number;
  malformed: number;
  filtering: number;
  truncatedInputs: number;
}): AdviceSourceFunnel {
  return {
    source,
    discovered: input.discovered,
    eligible: input.eligible,
    read: input.read,
    parsed: input.parsed,
    visibleEvents: input.visibleEvents,
    discarded: {
      filtering: input.filtering,
      redaction: 0,
      deduplication: 0,
      malformed: input.malformed,
      limits: 0,
    },
    retainedPatterns: input.episodes,
    retainedEpisodes: input.episodes,
    omittedEpisodes: 0,
    truncatedEpisodes: input.truncatedInputs,
  };
}

function selectionKey(selection: Pick<SessionConsentSelection, "provider" | "opaqueId">): string {
  return `${selection.provider}\0${selection.opaqueId}`;
}

function indexedBySelection(
  indexes: Array<ProviderSessionIndex<ClaudeSessionLocator> | ProviderSessionIndex<CodexSessionLocator>>,
): Map<string, IndexedSession<ClaudeSessionLocator> | IndexedSession<CodexSessionLocator>> {
  return new Map(indexes.flatMap((index) =>
    index.sessions.map((session) => [selectionKey(session.entry), session] as const)));
}

function stableRelistedSelections(
  consent: SessionConsent,
  indexes: Array<ProviderSessionIndex<ClaudeSessionLocator> | ProviderSessionIndex<CodexSessionLocator>>,
): {
  indexed: Map<string, IndexedSession<ClaudeSessionLocator> | IndexedSession<CodexSessionLocator>>;
  changed: Record<AdviceVendor, number>;
  missing: Record<AdviceVendor, number>;
} {
  const indexed = indexedBySelection(indexes);
  const changed = { claude: 0, codex: 0 };
  const missing = { claude: 0, codex: 0 };
  for (const selection of consent.selected) {
    const key = selectionKey(selection);
    const match = indexed.get(key);
    if (!match) {
      missing[selection.provider] += 1;
      continue;
    }
    if (match.entry.sourceFingerprint !== selection.expectedFingerprint) {
      changed[selection.provider] += 1;
      indexed.delete(key);
    }
  }
  return { indexed, changed, missing };
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Session evidence collection was cancelled.");
}

function isCodexResponseLimitError(message: string): boolean {
  return message.includes("thread/read response exceeded")
    || message.includes("response exceeded the bounded response limit");
}

export async function collectProjectSessionEvidence(input: {
  targetDir: string;
  consent: SessionConsent;
  codexClientFactory?: CodexAppServerFactory;
  claudeTranscriptsDir?: string;
  now?: number;
  signal?: AbortSignal;
}): Promise<AdviceSessionEvidence> {
  abortIfNeeded(input.signal);
  const project = await sessionProjectRoot(input.targetDir);
  const consent = validateSessionConsent(input.consent, project.digest);
  const now = input.now ?? Date.now();
  const providers = Array.from(new Set(consent.selected.map((selection) => selection.provider)));
  const indexes: Array<
    ProviderSessionIndex<ClaudeSessionLocator> | ProviderSessionIndex<CodexSessionLocator>
  > = [];
  let codexClient: CodexAppServerClient | undefined;
  let closeCodexOnAbort: (() => void) | undefined;
  const codexClientFactory = input.codexClientFactory ?? createCodexAppServerClient;

  try {
    if (providers.includes("claude")) {
      indexes.push(await listClaudeSessions({
        targetDir: project.root,
        lookback: "all",
        transcriptsDir: input.claudeTranscriptsDir,
        now,
        signal: input.signal,
      }));
    }
    if (providers.includes("codex")) {
      if (!Bun.which("codex") && codexClientFactory === createCodexAppServerClient) {
        throw new Error("Consented Codex sessions cannot be read because Codex is unavailable.");
      }
      codexClient = await codexClientFactory();
      closeCodexOnAbort = () => { void codexClient?.close(); };
      input.signal?.addEventListener("abort", closeCodexOnAbort, { once: true });
      abortIfNeeded(input.signal);
      indexes.push(await listCodexSessions({
        client: codexClient,
        targetDir: project.root,
        lookback: "all",
        now,
        signal: input.signal,
      }));
    }

    abortIfNeeded(input.signal);
    const relisted = stableRelistedSelections(consent, indexes);
    const claudeReads: ClaudeSelectionRead[] = [];
    const codexReads: Array<CodexSelectionRead & { sessionId: string }> = [];
    const changedCodexSessionIds = new Set<string>();
    let internalClaudeReads = 0;
    let internalCodexReads = 0;
    let changedClaudeReads = 0;
    let oversizedCodexReads = 0;
    for (const selection of consent.selected) {
      abortIfNeeded(input.signal);
      const indexed = relisted.indexed.get(selectionKey(selection));
      if (!indexed) continue;
      if (selection.provider === "claude") {
        try {
          claudeReads.push(await readClaudeSelection({
            indexed: indexed as IndexedSession<ClaudeSessionLocator>,
            selection,
            categories: consent.categories,
            targetDir: project.root,
            signal: input.signal,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("is an internal Farrier session")) internalClaudeReads += 1;
          else if (message.includes("source changed") || message.includes("source disappeared")) changedClaudeReads += 1;
          else throw error;
        }
      } else {
        if (!codexClient) throw new Error("Codex App Server client is unavailable.");
        try {
          const read = await readCodexSelection({
            client: codexClient,
            indexed: indexed as IndexedSession<CodexSessionLocator>,
            selection,
            categories: consent.categories,
            targetDir: project.root,
            signal: input.signal,
          });
          codexReads.push({ ...read, sessionId: selection.opaqueId });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("is an internal Farrier session")) internalCodexReads += 1;
          else if (message.includes("source changed") || message.includes("source disappeared")) {
            changedCodexSessionIds.add(selection.opaqueId);
          }
          else if (isCodexResponseLimitError(message)) {
            oversizedCodexReads += 1;
            await codexClient.close().catch(() => undefined);
            codexClient = await codexClientFactory();
            abortIfNeeded(input.signal);
          }
          else throw error;
        }
      }
    }

    abortIfNeeded(input.signal);
    if (codexClient && consent.selected.some((selection) => selection.provider === "codex")) {
      const refreshed = await listCodexSessions({
        client: codexClient,
        targetDir: project.root,
        lookback: "all",
        now,
        signal: input.signal,
      });
      const refreshedEntries = new Map(
        refreshed.sessions.map((session) => [session.entry.opaqueId, session.entry]),
      );
      for (const selection of consent.selected.filter((item) =>
        item.provider === "codex" && relisted.indexed.has(selectionKey(item)))) {
        const entry = refreshedEntries.get(selection.opaqueId);
        if (!entry || entry.sourceFingerprint !== selection.expectedFingerprint) {
          changedCodexSessionIds.add(selection.opaqueId);
        }
      }
    }
    abortIfNeeded(input.signal);
    const stableCodexReads = codexReads.filter((read) =>
      !changedCodexSessionIds.has(read.sessionId));
    const allEpisodes = [
      ...claudeReads.flatMap((read) => read.episodes),
      ...stableCodexReads.flatMap((read) => read.episodes),
    ];
    annotateEpisodeOccurrences(allEpisodes);
    const collapsedEpisodes = collapseEpisodePatterns(allEpisodes);
    const selected = selectFairEpisodes(collapsedEpisodes);
    const sourceFunnels = providers.map((provider) => {
      const index = indexes.find((item) => item.provider === provider)
        ?? emptyProviderIndex(provider);
      const providerEpisodes = selected.episodes.filter((episode) => episode.provider === provider);
      const originalEpisodes = collapsedEpisodes.filter((episode) => episode.provider === provider);
      const rawEpisodes = allEpisodes.filter((episode) => episode.provider === provider);
      const providerSelections = consent.selected.filter((selection) => selection.provider === provider);
      const malformed = provider === "claude"
        ? claudeReads.reduce((sum, read) => sum + read.malformed, 0)
        : 0;
      const parsed = provider === "claude"
        ? claudeReads.reduce((sum, read) => sum + read.parsedRecords, 0)
        : stableCodexReads.reduce((sum, read) => sum + read.parsedTurns, 0);
      const truncatedInputs = provider === "claude"
        ? claudeReads.filter((read) => read.truncated).length
        : stableCodexReads.filter((read) => read.truncated).length;
      const funnel = sourceFunnel(provider, {
        discovered: index.discovered,
        eligible: index.sessions.length,
        read: provider === "claude" ? claudeReads.length : stableCodexReads.length,
        parsed,
        visibleEvents: visibleSessionEvents(providerEpisodes),
        episodes: providerEpisodes.length,
        malformed,
        filtering: index.filtered
          + Math.max(index.sessions.length - providerSelections.length, 0)
          + relisted.changed[provider]
          + relisted.missing[provider],
        truncatedInputs,
      });
      const limited = Math.max(originalEpisodes.length - providerEpisodes.length, 0);
      const deduplicated = Math.max(rawEpisodes.length - originalEpisodes.length, 0);
      funnel.omittedEpisodes = limited + deduplicated;
      funnel.discarded.limits = limited;
      funnel.discarded.deduplication = deduplicated;
      return funnel;
    });
    const malformed = claudeReads.reduce((sum, read) => sum + read.malformed, 0);
    const notes = indexes.flatMap((index) => index.notes);
    if (malformed) notes.push(`Skipped ${malformed} malformed Claude session record(s).`);
    if (internalClaudeReads) {
      notes.push(`Skipped ${internalClaudeReads} internal Farrier Claude session(s).`);
    }
    if (internalCodexReads) {
      notes.push(`Skipped ${internalCodexReads} internal Farrier Codex session(s).`);
    }
    const changedClaude = relisted.changed.claude + changedClaudeReads;
    const changedCodex = relisted.changed.codex + changedCodexSessionIds.size;
    if (changedClaude) {
      notes.push(`Skipped ${changedClaude} Claude session(s) that changed before or during local extraction.`);
    }
    if (changedCodex) {
      notes.push(`Skipped ${changedCodex} Codex session(s) that changed before or during local extraction.`);
    }
    for (const provider of providers) {
      if (relisted.missing[provider]) {
        notes.push(`Skipped ${relisted.missing[provider]} missing ${provider === "claude" ? "Claude" : "Codex"} session(s).`);
      }
    }
    if (oversizedCodexReads) {
      notes.push(`Skipped ${oversizedCodexReads} Codex session(s) that exceeded the reviewed per-session byte cap.`);
    }
    return {
      sources: sourceFunnels.map((source) => ({ source: source.source, count: source.read })),
      episodes: selected.episodes,
      signals: selected.episodes.map(episodeEvidence),
      notes,
      consentDigest: consent.selectionDigest,
      funnel: {
        sources: sourceFunnels,
        visibleEvents: sourceFunnels.reduce((sum, source) => sum + source.visibleEvents, 0),
        recurringPatterns: new Set(
          selected.episodes
            .filter((episode) => episode.distinctSessions > 1)
            .map(episodePatternKey),
        ).size,
        retainedEpisodes: selected.episodes.length,
        omittedEpisodes: selected.omitted + Math.max(allEpisodes.length - collapsedEpisodes.length, 0),
        truncatedEpisodes: selected.episodes.filter((episode) => episode.truncated).length
          + sourceFunnels.reduce((sum, source) => sum + (source.truncatedEpisodes ?? 0), 0),
      },
    };
  } finally {
    if (closeCodexOnAbort) input.signal?.removeEventListener("abort", closeCodexOnAbort);
    await codexClient?.close();
  }
}
