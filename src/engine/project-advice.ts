import { resolve } from "node:path";
import type { ReasoningEffort } from "../config/farrier-config";
import { invokeBackend, defaultBackendRunner, type BackendCommandRunner } from "./backend";
import { compareEvidence, createEvidenceSet, redactEvidence } from "./behavior-evidence";
import { builtinAdviceRegistry, type AdviceRegistryEntry } from "./advice-catalog";
import { advicePolicyFor } from "./advice-policy";
import { buildAdvicePrompt, validateAdviceCoverage, validateAdviceResponse } from "./advice-recommender";
import { collectSkillRegistry } from "./advice-registry";
import { boundSessionText, episodeEvidence, episodePatternKey, extractUserRequest, requestCategories, selectFairEpisodes, stripSessionAmbient } from "./advice-patterns";
import { collectProjectSessionEvidence } from "./advice-sessions";
import {
  adviceCategories,
  adviceSessionLookbackLabel,
  type AdviceCategory,
  type AdviceEvidence,
  type AdviceEvidenceFunnel,
  type AdviceReport,
  type AdviceSessionEvidence,
  type AdviceSessionLookback,
  type AdviceVendor,
  type ProjectProfile
} from "./advice-types";
import type { CodexAppServerFactory } from "./codex-app-server";
import { profileProject } from "./project-profile";
import { searchSkills, type SkillSearchResult } from "./skills";

export type ProjectAdviceInput = {
  targetDir: string;
  backend: AdviceVendor;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sessions?: "auto" | "none";
  lookback?: AdviceSessionLookback;
  targets?: AdviceVendor[];
  sessionSources?: AdviceVendor[];
  only?: AdviceCategory[];
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
  search?: (query: string) => Promise<SkillSearchResult[]>;
  codexClientFactory?: CodexAppServerFactory;
  sessionEvidence?: AdviceSessionEvidence;
  onProgress?: (event: AdviceProgressEvent) => void;
};

export type AdviceProgressEvent = {
  stage: "profile" | "sessions" | "catalog" | "backend" | "validation" | "complete";
  message: string;
};

function emptyEvidenceFunnel(targets: AdviceVendor[]): AdviceEvidenceFunnel {
  return {
    sources: targets.map((source) => ({
      source, discovered: 0, eligible: 0, read: 0, parsed: 0, visibleEvents: 0,
      discarded: { filtering: 0, redaction: 0, deduplication: 0, malformed: 0, limits: 0 },
      retainedPatterns: 0, retainedEpisodes: 0, omittedEpisodes: 0, truncatedEpisodes: 0
    })),
    visibleEvents: 0, recurringPatterns: 0, retainedEpisodes: 0, omittedEpisodes: 0, truncatedEpisodes: 0
  };
}

function isolateSessionEvidence(evidence: AdviceSessionEvidence, provider: AdviceVendor): AdviceSessionEvidence {
  const cleanedEpisodes = (evidence.episodes ?? []).filter((item) => item.provider === provider).flatMap((item) => {
    const request = extractUserRequest(item.request);
    if (!request) return [];
    const boundedRequest = boundSessionText(request, 4_000);
    return [{
      ...item,
      request: boundedRequest.text,
      corrections: item.corrections.slice(0, 12).map((value) => boundSessionText(extractUserRequest(value), 1_500).text).filter(Boolean),
      actions: item.actions.slice(0, 12).map((value) => ({ ...value, summary: boundSessionText(stripSessionAmbient(value.summary), 600).text })).filter((value) => value.summary),
      ...(item.outcome ? { outcome: boundSessionText(stripSessionAmbient(item.outcome), 1_000).text } : {}),
      truncated: item.truncated || boundedRequest.truncated,
      allowedCategories: Array.from(new Set([...item.allowedCategories, ...requestCategories(boundedRequest.text)]))
    }];
  });
  const selected = selectFairEpisodes(cleanedEpisodes);
  const episodes = selected.episodes;
  const signals = evidence.episodes
    ? episodes.map(episodeEvidence)
    : evidence.signals.filter((item) => item.source === provider && (!item.targetVendors || item.targetVendors.includes(provider))).map((item) => ({
      ...item, targetVendors: [provider] as AdviceVendor[]
    }));
  const source = evidence.sources.find((item) => item.source === provider) ?? { source: provider, count: 0 };
  const funnelSource = evidence.funnel?.sources.find((item) => item.source === provider);
  const visibleEvents = funnelSource?.visibleEvents ?? episodes.reduce((sum, item) => sum + 1 + item.actions.length + item.corrections.length + (item.outcome ? 1 : 0), 0);
  return {
    sources: [source], episodes, signals, notes: [...evidence.notes],
    funnel: {
      sources: funnelSource ? [{ ...funnelSource, retainedPatterns: signals.length, retainedEpisodes: episodes.length }] : emptyEvidenceFunnel([provider]).sources,
      visibleEvents, recurringPatterns: new Set(episodes.filter((item) => item.distinctSessions > 1).map(episodePatternKey)).size,
      retainedEpisodes: episodes.length,
      omittedEpisodes: (evidence.funnel?.omittedEpisodes ?? 0) + selected.omitted,
      truncatedEpisodes: episodes.filter((item) => item.truncated).length
    }
  };
}

function orderedEvidence(profile: ProjectProfile, sessions: AdviceEvidence[], provider: AdviceVendor): AdviceEvidence[] {
  const priorityKinds = /^(?:structure|manifest|capability:|workflow|ci|tests|config:)/;
  const priority = profile.evidence.filter((item) => priorityKinds.test(item.kind));
  const remaining = profile.evidence.filter((item) => !priority.includes(item));
  return [
    { id: `provenance:selected-provider:${provider}`, source: "project", kind: "provenance", summary: `Advice evidence is isolated to selected provider ${provider}.`, selectedProvider: provider },
    ...priority, ...sessions, ...remaining
  ];
}

function registryFor(input: {
  entries: AdviceRegistryEntry[];
  categories: AdviceCategory[];
  provider: AdviceVendor;
}): AdviceRegistryEntry[] {
  return [...builtinAdviceRegistry, ...input.entries].filter((entry) => input.categories.includes(entry.category) && entry.vendors.includes(input.provider));
}

export async function adviseProject(input: ProjectAdviceInput): Promise<AdviceReport> {
  const targetDir = resolve(input.targetDir);
  const sessions = input.sessions ?? "auto";
  const lookback = input.lookback ?? "7d";
  if (input.targets && (input.targets.length !== 1 || input.targets[0] !== input.backend)) throw new Error(`Advice targets must equal the selected backend (${input.backend}); choose --targets ${input.backend} or omit --targets.`);
  if (input.sessionSources && (input.sessionSources.length !== 1 || input.sessionSources[0] !== input.backend)) throw new Error(`Advice session sources must equal the selected backend (${input.backend}).`);
  const targets: AdviceVendor[] = [input.backend];
  const categories = input.only?.length ? input.only : [...adviceCategories];
  const policy = advicePolicyFor(input.backend);
  const progress = (stage: AdviceProgressEvent["stage"], message: string): void => {
    try { input.onProgress?.({ stage, message }); } catch { /* display callbacks do not control analysis */ }
  };

  progress("profile", "Profiling dependencies, workflows, services, and installed automation…");
  progress("sessions", sessions === "auto" ? `Finding exact-project ${input.backend} sessions from the ${adviceSessionLookbackLabel(lookback)}…` : "Skipping project sessions; using codebase evidence only…");
  const [rawProfile, collected] = await Promise.all([
    profileProject(targetDir),
    sessions === "auto"
      ? input.sessionEvidence ?? collectProjectSessionEvidence({ targetDir, targets, lookback, codexClientFactory: input.codexClientFactory })
      : Promise.resolve<AdviceSessionEvidence>({ sources: [{ source: input.backend, count: 0 }], episodes: [], signals: [], notes: [], funnel: emptyEvidenceFunnel(targets) })
  ]);
  const profile = redactEvidence(rawProfile);
  const sessionEvidence = redactEvidence(isolateSessionEvidence(collected, input.backend));
  const sessionCount = sessionEvidence.sources.reduce((sum, source) => sum + source.count, 0);
  progress("sessions", sessions === "auto" ? `Found ${sessionCount} matching session(s); retained ${sessionEvidence.episodes?.length ?? 0} bounded episode(s).` : "Session enrichment disabled; codebase analysis remains enabled.");

  progress("catalog", categories.includes("skills") ? "Planning capability-based skill searches and verifying exact matches…" : "Building provider-native implementation routes…");
  const skills = await collectSkillRegistry({ categories, profile, search: input.search ?? searchSkills });
  const registry = registryFor({ entries: skills.entries, categories, provider: input.backend });
  const bounded = createEvidenceSet({
    workflow: "advice", items: orderedEvidence(profile, sessionEvidence.signals, input.backend),
    maxItems: 300, maxItemBytes: 5_000, maxTotalBytes: 512_000
  });
  const evidence = bounded.items.filter((item): item is AdviceEvidence => Boolean(item && typeof item === "object" && "id" in item));
  const evidenceIds = new Set(evidence.map((item) => item.id));
  profile.evidence = profile.evidence.filter((item) => evidenceIds.has(item.id));
  sessionEvidence.signals = sessionEvidence.signals.filter((item) => evidenceIds.has(item.id));
  sessionEvidence.episodes = (sessionEvidence.episodes ?? []).filter((item) => evidenceIds.has(item.id));

  progress("backend", `Asking the ${policy.id} recommender for bounded recommendations…`);
  const parsed = await invokeBackend({
    backend: input.backend, model: input.model, reasoningEffort: input.reasoningEffort, targetDir,
    prompt: buildAdvicePrompt({ profile, evidence, episodes: sessionEvidence.episodes ?? [], categories, policy, registry, queries: skills.queries }),
    ephemeral: true, runner: input.runner ?? defaultBackendRunner, signal: input.signal
  });
  progress("validation", "Validating provider routes, evidence, registry references, safety, duplicates, and presentation bounds…");
  const validated = validateAdviceResponse({ parsed, evidence, categories, policy, registry });
  const coverage = validateAdviceCoverage({ parsed, categories, ...validated });
  const notes = [...sessionEvidence.notes, ...skills.notes, ...validated.notes];
  if (bounded.truncated) notes.push(`Advice evidence was bounded: retained ${bounded.itemCount}/${bounded.inputItemCount} items; ${bounded.truncatedItemCount} truncated and ${bounded.omittedItemCount} omitted.`);
  if (sessions === "none") notes.unshift("Project sessions were disabled; recommendations use codebase evidence only.");
  else if (!sessionCount) notes.unshift("No matching project sessions were found; recommendations use codebase evidence only.");
  if (validated.omitted.length) notes.push(`${validated.omitted.length} valid opportunity or opportunities were omitted by per-category presentation bounds and remain in omittedRecommendations.`);
  if (validated.weakLeads.length) notes.push(`${validated.weakLeads.length} low-confidence item(s) are shown as weak leads.`);
  notes.push("Report only: Farrier did not install recommendations or change project configuration.");

  const evidenceCases = evidence.map((item) => ({ id: item.id, outcome: "inconclusive" as const }));
  const comparison = compareEvidence({ beforeSet: bounded, afterSet: bounded, before: evidenceCases, after: evidenceCases });
  const funnel = sessionEvidence.funnel ?? emptyEvidenceFunnel(targets);
  funnel.recommendation = {
    patternsSent: sessionEvidence.episodes?.length ?? sessionEvidence.signals.length,
    returned: validated.returned,
    accepted: validated.recommendations.length + validated.weakLeads.length + validated.omitted.length,
    merged: 0,
    rejected: Math.max(validated.returned - validated.recommendations.length - validated.weakLeads.length - validated.omitted.length, 0),
    rejectionReasons: validated.notes,
    recoveryCalls: 0
  };
  progress("complete", `Report ready with ${validated.recommendations.length} supported recommendation(s), ${validated.omitted.length} bounded omission(s), and ${validated.weakLeads.length} weak lead(s).`);

  return {
    schemaVersion: 1, targetDir, backend: input.backend, ...(input.model ? { model: input.model } : {}), reportOnly: true, targets,
    sessions: {
      mode: sessions, lookback, included: sessions === "auto" && sessionCount > 0, requestedSources: targets,
      sources: sessionEvidence.sources, evidence: sessions === "auto" ? sessionEvidence.signals : [],
      episodes: sessions === "auto" ? sessionEvidence.episodes : [], funnel
    },
    profile, policy: { provider: policy.provider, id: policy.id },
    registry: { queries: skills.queries, verifiedMatches: registry.map((item) => item.ref) },
    recommendations: validated.recommendations, omittedRecommendations: validated.omitted,
    weakLeads: validated.weakLeads, coverage, evidence: comparison, notes
  };
}
