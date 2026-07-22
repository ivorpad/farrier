import { createHash } from "node:crypto";
import { redactExactValues, redactPatternText } from "./behavior-evidence";
import type {
  AdviceEvidence,
  AdviceSessionEpisode,
  AdviceVendor
} from "./advice-types";

const encoder = new TextEncoder();

function decodeUtf8Prefix(bytes: Uint8Array, maxBytes: number): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = Math.min(Math.max(maxBytes, 0), bytes.byteLength);
  while (end > 0) {
    try {
      return decoder.decode(bytes.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return "";
}

/**
 * Session prose is redacted with the shared deterministic denylist plus a few
 * session-only shapes (inline base64 payloads). Prose PII (names, addresses,
 * secrets typed as ordinary sentences) is out of scope for denylist regexes
 * and needs its own design before session text gains new provider-bound uses.
 */
export function redactSessionText(value: string, exactValues: readonly string[] = []): string {
  return redactPatternText(
    redactExactValues(value, exactValues)
      .replace(/\b(Bearer\s+)[^\s"']+/gi, "$1[REDACTED_TOKEN]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
      .replace(/data:(?:image|application)\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, "[REDACTED_BINARY_DATA]")
  );
}

export function boundSessionText(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const clean = redactSessionText(value).replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const encoded = encoder.encode(clean);
  if (encoded.byteLength <= maxBytes) return { text: clean, truncated: false };
  const marker = "\n[truncated]";
  const markerBytes = encoder.encode(marker).byteLength;
  const suffix = markerBytes <= maxBytes ? marker : "";
  const prefix = decodeUtf8Prefix(encoded, maxBytes - (suffix ? markerBytes : 0));
  return { text: prefix.trimEnd() + suffix, truncated: true };
}

function extractTagged(value: string, tag: string): string | undefined {
  const match = value.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim();
}

export function stripSessionAmbient(value: string): string {
  return value
    .replace(/<in-app-browser-context(?:\s[^>]*)?>[\s\S]*?<\/in-app-browser-context>/gi, " ")
    .replace(/<(?:environment_context|system-reminder|developer-message|repository-instructions)(?:\s[^>]*)?>[\s\S]*?<\/(?:environment_context|system-reminder|developer-message|repository-instructions)>/gi, " ")
    .replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, " ")
    .replace(/```(?:image|screenshot|tool-output)[\s\S]*?```/gi, " ")
    .replace(/^# AGENTS\.md instructions.*$/gim, " ")
    .replace(/^# Files mentioned by the user:.*$/gim, " ");
}

export function extractUserRequest(value: string): string {
  const objective = extractTagged(value, "objective");
  if (objective) return boundSessionText(objective, 4_000).text;
  const marker = value.match(/##\s+My request for Codex:\s*([\s\S]*)$/i)?.[1]?.trim();
  if (marker) return boundSessionText(marker, 4_000).text;
  const comments = value.match(/(?:Comments? from (?:the )?user|User comments?):\s*([\s\S]*?)(?=<[A-Za-z][^>]*>|$)/i)?.[1]?.trim();
  return boundSessionText(stripSessionAmbient(comments || value), 4_000).text;
}

export function episodeId(provider: AdviceVendor, sessionId: string, turnId: string, request: string): string {
  const digest = createHash("sha256").update(`${provider}\0${sessionId}\0${turnId}\0${request}`).digest("hex").slice(0, 12);
  return `session:${provider}:episode:${digest}`;
}

export function episodeEvidence(episode: AdviceSessionEpisode): AdviceEvidence {
  return {
    id: episode.id,
    source: episode.provider,
    kind: "session-episode",
    summary: episode.request,
    sessionId: episode.sessionId,
    occurrences: episode.occurrences,
    distinctSessions: episode.distinctSessions,
    targetVendors: [episode.provider]
  };
}

function requestKey(request: string): string {
  return request.toLowerCase().replace(/https?:\/\/\S+/g, "[url]").replace(/\b\d+\b/g, "#").replace(/[^a-z0-9# ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function episodePatternKey(episode: AdviceSessionEpisode): string {
  return `${episode.provider}:${requestKey(episode.request)}`;
}

export function annotateEpisodeOccurrences(episodes: AdviceSessionEpisode[]): void {
  const groups = new Map<string, AdviceSessionEpisode[]>();
  for (const episode of episodes) {
    const key = episodePatternKey(episode);
    groups.set(key, [...(groups.get(key) ?? []), episode]);
  }
  for (const group of groups.values()) {
    const sessions = new Set(group.map((episode) => episode.sessionId)).size;
    for (const episode of group) {
      episode.occurrences = group.length;
      episode.distinctSessions = sessions;
    }
  }
}

export function collapseEpisodePatterns(episodes: AdviceSessionEpisode[]): AdviceSessionEpisode[] {
  const collapsed = new Map<string, AdviceSessionEpisode>();
  for (const episode of episodes) {
    const key = episodePatternKey(episode);
    const existing = collapsed.get(key);
    if (!existing) {
      collapsed.set(key, {
        ...episode,
        corrections: [...episode.corrections],
        actions: [...episode.actions],
      });
      continue;
    }
    existing.corrections = Array.from(new Set([
      ...existing.corrections,
      ...episode.corrections,
    ])).slice(0, 12);
    const actions = new Map(existing.actions.map((item) => [
      `${item.type}\0${item.status ?? ""}\0${item.summary}`,
      item,
    ]));
    for (const item of episode.actions) {
      actions.set(`${item.type}\0${item.status ?? ""}\0${item.summary}`, item);
    }
    existing.actions = Array.from(actions.values()).slice(0, 12);
    existing.outcome ??= episode.outcome;
    existing.truncated ||= episode.truncated;
    existing.occurrences = Math.max(existing.occurrences, episode.occurrences);
    existing.distinctSessions = Math.max(existing.distinctSessions, episode.distinctSessions);
  }
  return Array.from(collapsed.values());
}

export function selectFairEpisodes(episodes: AdviceSessionEpisode[], maxEpisodes = 80, maxBytes = 64_000): {
  episodes: AdviceSessionEpisode[];
  omitted: number;
} {
  const bySession = new Map<string, AdviceSessionEpisode[]>();
  for (const episode of episodes) {
    const key = `${episode.provider}:${episode.sessionId}`;
    bySession.set(key, [...(bySession.get(key) ?? []), episode]);
  }
  const queues = Array.from(bySession.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([, values]) => values);
  const selected: AdviceSessionEpisode[] = [];
  let byteCount = 2;
  while (selected.length < maxEpisodes && queues.some((queue) => queue.length)) {
    let added = false;
    for (const queue of queues) {
      const episode = queue.shift();
      if (!episode) continue;
      const bytes = encoder.encode(JSON.stringify(episode)).byteLength + 1;
      if (byteCount + bytes > maxBytes) continue;
      selected.push(episode);
      byteCount += bytes;
      added = true;
      if (selected.length >= maxEpisodes) break;
    }
    if (!added) break;
  }
  return { episodes: selected, omitted: Math.max(episodes.length - selected.length, 0) };
}
