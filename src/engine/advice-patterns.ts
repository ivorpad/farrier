import { createHash } from "node:crypto";
import type {
  AdviceCategory,
  AdviceEvidence,
  AdviceSessionEpisode,
  AdviceVendor
} from "./advice-types";

const encoder = new TextEncoder();

export function redactSessionText(value: string): string {
  return value
    .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|gl(?:pat|rt)-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16})\b/g, "[REDACTED_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/\b(Bearer\s+)[^\s"']+/gi, "$1[REDACTED_TOKEN]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED_CREDENTIALS]@")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|credential|authorization|private[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/^\s*(?:api[_ -]?key|token|secret|password|authorization|username)\s+[A-Za-z0-9._~+/-]{8,}\s*$/gim, "[REDACTED_CREDENTIAL_ROW]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/data:(?:image|application)\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, "[REDACTED_BINARY_DATA]");
}

export function boundSessionText(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const clean = redactSessionText(value).replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (encoder.encode(clean).byteLength <= maxBytes) return { text: clean, truncated: false };
  const marker = "\n[truncated]";
  const points = Array.from(clean);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(points.slice(0, middle).join("") + marker).byteLength <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return { text: points.slice(0, low).join("").trimEnd() + marker, truncated: true };
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

export function requestCategories(request: string): AdviceCategory[] {
  const withoutUrls = request.replace(/https?:\/\/\S+/g, " ").toLowerCase();
  const categories = new Set<AdviceCategory>();
  if (/\b(?:metaprompt|prompt template|reusable prompt|workflow|checklist|release|publish|deploy|commit|migration|generate|scaffold)\b/.test(withoutUrls)) categories.add("skills");
  if (/\b(?:always|never|convention|guidance|instruction|remember|must|don['’]t)\b/.test(withoutUrls)) categories.add("guidance");
  if (/\b(?:format|lint|type.?check|validate|block|guard|after each|before each|on stop)\b/.test(withoutUrls)) categories.add("hooks");
  if (/\b(?:delegate|subagent|parallel review|specialist|security review|performance review)\b/.test(withoutUrls)) categories.add("subagents");
  if (/\bplugin\b/.test(withoutUrls)) categories.add("plugins");
  if (/\b(?:mcp|external system|live data|issue tracker|sentry|figma|linear|slack)\b/.test(withoutUrls)) categories.add("mcp");
  return Array.from(categories);
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
    allowedCategories: episode.allowedCategories,
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
