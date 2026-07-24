import { listClaudeSessions } from "./advice-session-claude";
import { listCodexSafely } from "./advice-sessions";
import { sessionProjectRoot } from "./advice-session-index";
import { createCodexAppServerClient, type CodexAppServerFactory } from "./codex-app-server";
import type { SessionIndexEntry } from "./advice-session-consent";
import type { SessionSelection } from "./session-evidence";

/**
 * Session listing for the Improve picker. The picker shows the same
 * SessionIndexEntry rows advise uses; alongside them this keeps a LOCAL
 * opaqueId → file-identity map (Claude transcript stem / Codex thread id) so
 * a confirmed selection can restrict the deterministic miners to exactly the
 * chosen sessions. The map never leaves the machine and is never part of any
 * prompt.
 */

type SessionSource =
  | { provider: "claude"; stem: string }
  | { provider: "codex"; threadId: string };

export type ImproveSessionList = {
  /** Newest first, both providers merged. */
  entries: SessionIndexEntry[];
  sources: Map<string, SessionSource>;
  notes: string[];
};

export async function listImproveSessions(input: {
  targetDir: string;
  claudeTranscriptsDir?: string;
  codexClientFactory?: CodexAppServerFactory;
  now?: number;
  signal?: AbortSignal;
}): Promise<ImproveSessionList> {
  const now = input.now ?? Date.now();
  // The same root resolution advise lists against, so Improve run from a
  // subdirectory sees the same session set.
  const project = await sessionProjectRoot(input.targetDir);
  const [claude, codex] = await Promise.all([
    listClaudeSessions({
      targetDir: project.root,
      lookback: "all",
      transcriptsDir: input.claudeTranscriptsDir,
      now,
      signal: input.signal
    }),
    listCodexSafely({
      targetDir: project.root,
      lookback: "all",
      now,
      clientFactory: input.codexClientFactory ?? createCodexAppServerClient,
      signal: input.signal
    })
  ]);

  const entries: SessionIndexEntry[] = [];
  const sources = new Map<string, SessionSource>();
  const updatedAtMs = new Map<string, number>();
  for (const session of claude.sessions) {
    entries.push(session.entry);
    updatedAtMs.set(session.entry.opaqueId, session.updatedAt);
    sources.set(session.entry.opaqueId, {
      provider: "claude",
      stem: session.locator.filename.replace(/\.jsonl$/, "")
    });
  }
  for (const session of codex.sessions) {
    entries.push(session.entry);
    updatedAtMs.set(session.entry.opaqueId, session.updatedAt);
    sources.set(session.entry.opaqueId, { provider: "codex", threadId: session.locator.threadId });
  }

  entries.sort((left, right) =>
    (updatedAtMs.get(right.opaqueId) ?? 0) - (updatedAtMs.get(left.opaqueId) ?? 0)
    || left.provider.localeCompare(right.provider)
    || left.opaqueId.localeCompare(right.opaqueId));

  return { entries, sources, notes: [...claude.notes, ...codex.notes] };
}

/**
 * A confirmed picker selection as the miners' filter. Both fields are always
 * present so an all-Claude selection scans zero Codex rollouts (and the
 * reverse), instead of silently widening back to "all sessions".
 */
export function improveSessionSelection(
  chosen: readonly SessionIndexEntry[],
  list: ImproveSessionList
): SessionSelection {
  const claudeStems = new Set<string>();
  const codexThreadIds = new Set<string>();
  for (const entry of chosen) {
    const source = list.sources.get(entry.opaqueId);
    if (!source) continue;
    if (source.provider === "claude") claudeStems.add(source.stem);
    else codexThreadIds.add(source.threadId);
  }
  return { claudeStems, codexThreadIds };
}
