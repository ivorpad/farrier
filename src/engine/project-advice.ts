import { resolve } from "node:path";
import type { ReasoningEffort } from "../config/farrier-config";
import { invokeBackend, defaultBackendRunner, type BackendCommandRunner } from "./backend";
import { builtinAdviceRegistry, adviceRouteArtifacts, adviceRoutes, type AdviceRegistryEntry } from "./advice-catalog";
import { collectProjectSessionEvidence } from "./advice-sessions";
import {
  adviceCategories,
  adviceCategoryBenefit,
  adviceSessionLookbackLabel,
  type AdviceCategory,
  type AdviceCoverage,
  type AdviceEvidence,
  type AdviceEvidenceFunnel,
  type AdviceRecommendation,
  type AdviceReport,
  type AdviceSessionEvidence,
  type AdviceSessionLookback,
  type AdviceVendor,
  isAdviceCategory
} from "./advice-types";
import type { CodexAppServerFactory } from "./codex-app-server";
import { profileProject, projectProfileSummary } from "./project-profile";
import { searchSkills, type SkillSearchResult } from "./skills";

export type ProjectAdviceInput = {
  targetDir: string;
  author?: AdviceVendor;
  /** @deprecated Compatibility alias for author. */
  backend?: AdviceVendor;
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

type RawRecommendation = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function skillQueries(stacks: string[], languages: string[]): string[] {
  const values = [...stacks, ...languages.map((language) => language.toLowerCase())]
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
    .slice(0, 3);
  return values.length > 0 ? values : ["software engineering"];
}

async function collectSkillRegistry(input: {
  categories: AdviceCategory[];
  stacks: string[];
  languages: string[];
  search: (query: string) => Promise<SkillSearchResult[]>;
}): Promise<{ entries: AdviceRegistryEntry[]; notes: string[] }> {
  if (!input.categories.includes("skills")) return { entries: [], notes: [] };
  const queries = skillQueries(input.stacks, input.languages);
  const outcomes = await Promise.allSettled(queries.map((query) => input.search(query)));
  const entries = new Map<string, AdviceRegistryEntry>();
  const notes: string[] = [];
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === "rejected") {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      notes.push(`Skill registry search for '${queries[index]}' failed: ${message}`);
      continue;
    }
    for (const result of outcome.value.slice(0, 10)) {
      const ref = `${result.source}@${result.skillId}`;
      if (!entries.has(ref)) entries.set(ref, { ref, category: "skills", name: result.name, vendors: ["claude", "codex"] });
    }
  }
  return { entries: Array.from(entries.values()).slice(0, 30), notes };
}

function buildPrompt(input: {
  profileText: string;
  evidence: AdviceEvidence[];
  categories: AdviceCategory[];
  targets: AdviceVendor[];
  registry: AdviceRegistryEntry[];
  focused: boolean;
}): string {
  const cap = input.focused ? 5 : 2;
  const evidence = input.evidence.slice(0, 120).map((item) => ({
    id: item.id,
    source: item.source,
    kind: item.kind,
    path: item.path,
    summary: item.summary,
    occurrences: item.occurrences
    ,distinctSessionCount: item.distinctSessions
    ,allowedCategories: item.allowedCategories
    ,targetVendors: item.targetVendors
    ,supportedImplementationRoutes: adviceRoutes.filter((route) =>
      (item.allowedCategories ?? input.categories).includes(route.category) && route.vendors.some((vendor) => input.targets.includes(vendor))
    ).map((route) => route.id)
  }));
  return `You are Farrier's project advisor. Return JSON only with this shape:
{"recommendations":[{"id":"<category>:<stable-kebab-id>","category":"guidance|hooks|skills|subagents|plugins|mcp","targetVendors":["claude"],"reason":"observed problem or opportunity in one concise sentence","benefit":"concrete user-facing outcome in one concise sentence","evidence":["evidence-id"],"confidence":"high|medium|low","routeId":"catalog route id","registryRef":"optional exact catalog ref"}],"coverage":[{"category":"guidance","reason":"why this category did or did not produce a strong recommendation"}]}

Rules:
- Analyze only the bounded project/session signals below. They contain visible prompts, responses, tool events, failures, and outcomes; never claim access to hidden reasoning.
- Evidence summaries are the complete factual boundary. A path-only summary proves existence only; never claim what a file contains unless its summary explicitly says so.
- A short vendor guidance file that delegates to shared guidance is not missing guidance; never recommend duplicating the shared file solely because the vendor file is short.
- Recommend no more than ${cap} items per applicable category. Skip categories without strong evidence.
- Evaluate every requested category independently and include exactly one coverage record for each.
- Treat occurrence count and distinct-session count separately. Repetition across sessions is stronger than repetition inside one session.
- ${input.focused ? "Return every distinct strong recommendation in the focused category." : "Aim for 3–8 distinct recommendations overall when the evidence supports them; do not invent filler to hit a count."}
- Use only requested categories (${input.categories.join(", ")}) and target vendors (${input.targets.join(", ")}).
- Every recommendation must cite one or more evidence IDs exactly and use one route ID exactly.
- reason must explain why the recommendation exists using the cited evidence. benefit must explain why implementing it is useful; do not repeat the reason or route description.
- registryRef is optional, but when used it must exactly copy a compatible catalog ref.
- Hooks must remain declarative. Never output executable hook code, scripts, shell fragments, or configuration payloads.
- Do not suggest applying changes. Farrier is producing a report only.
- No markdown or prose outside the JSON object.

Project profile:
${input.profileText}

Allowed route catalog:
${JSON.stringify(adviceRoutes.filter((route) => input.categories.includes(route.category) && route.vendors.some((vendor) => input.targets.includes(vendor))).map(({ id, category, vendors, description }) => ({ id, category, vendors, description })))}

Validated registry catalog:
${JSON.stringify(input.registry)}

Evidence signals:
${JSON.stringify(evidence)}
`;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value as string[];
}

function validateRecommendation(input: {
  raw: unknown;
  evidenceIds: Set<string>;
  categories: AdviceCategory[];
  targets: AdviceVendor[];
  routesById: Map<string, (typeof adviceRoutes)[number]>;
  registryByRef: Map<string, AdviceRegistryEntry>;
}): { recommendation?: AdviceRecommendation; note?: string } {
  if (!isRecord(input.raw)) return { note: "Dropped recommendation: record must be an object." };
  const raw = input.raw as RawRecommendation;
  const category = typeof raw.category === "string" && isAdviceCategory(raw.category) ? raw.category : undefined;
  const id = typeof raw.id === "string" ? raw.id : undefined;
  if (!category || !input.categories.includes(category)) return { note: `Dropped recommendation '${id ?? "unknown"}': unsupported category.` };
  if (!id || !new RegExp(`^${category}:[a-z0-9]+(?:-[a-z0-9]+)*$`).test(id)) return { note: `Dropped recommendation '${id ?? "unknown"}': id must be stable and category-prefixed.` };
  const vendors = stringArray(raw.targetVendors);
  if (!vendors || vendors.length === 0 || vendors.some((vendor) => !["claude", "codex"].includes(vendor) || !input.targets.includes(vendor as AdviceVendor))) {
    return { note: `Dropped recommendation '${id}': invalid target vendors.` };
  }
  const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : undefined;
  if (!reason || reason.length > 320) return { note: `Dropped recommendation '${id}': reason is missing or too long.` };
  const rawBenefit = typeof raw.benefit === "string" && raw.benefit.trim() ? raw.benefit.trim() : undefined;
  if (raw.benefit !== undefined && (!rawBenefit || rawBenefit.length > 240)) {
    return { note: `Dropped recommendation '${id}': benefit is invalid or too long.` };
  }
  const benefit = rawBenefit ?? adviceCategoryBenefit(category);
  const evidence = stringArray(raw.evidence);
  if (!evidence || evidence.length === 0 || evidence.some((evidenceId) => !input.evidenceIds.has(evidenceId))) {
    return { note: `Dropped recommendation '${id}': evidence contains an unknown or missing reference.` };
  }
  const confidence = raw.confidence;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") return { note: `Dropped recommendation '${id}': invalid confidence.` };
  const routeId = typeof raw.routeId === "string" ? raw.routeId : "";
  const route = input.routesById.get(routeId);
  if (!route || route.category !== category || !(vendors as AdviceVendor[]).every((vendor) => route.vendors.includes(vendor))) {
    return { note: `Dropped recommendation '${id}': unsupported implementation route.` };
  }
  const registryRef = typeof raw.registryRef === "string" ? raw.registryRef : undefined;
  if (registryRef) {
    const entry = input.registryByRef.get(registryRef);
    if (!entry || entry.category !== category || !(vendors as AdviceVendor[]).every((vendor) => entry.vendors.includes(vendor))) {
      return { note: `Dropped recommendation '${id}': registry ref '${registryRef}' is unsupported.` };
    }
  }
  if (Object.keys(raw).some((key) => /(?:code|script|payload|command)/i.test(key))) {
    return { note: `Dropped recommendation '${id}': executable payloads are not accepted.` };
  }
  if (category === "hooks" && /```|#!|[{}]|(?:^|\s)(?:bash|node|python(?:3)?)\s+-/i.test(`${reason}\n${benefit}`)) {
    return { note: `Dropped recommendation '${id}': executable hook content is not accepted.` };
  }
  return {
    recommendation: {
      id,
      category,
      targetVendors: vendors as AdviceVendor[],
      reason,
      benefit,
      evidence: Array.from(new Set(evidence)),
      confidence,
      implementationRoute: { id: route.id, description: route.description },
      creates: adviceRouteArtifacts(route, vendors as AdviceVendor[]),
      ...(registryRef ? { registryRef } : {})
    }
  };
}

function validateRecommendations(input: {
  parsed: unknown;
  evidence: AdviceEvidence[];
  categories: AdviceCategory[];
  targets: AdviceVendor[];
  registry: AdviceRegistryEntry[];
}): { recommendations: AdviceRecommendation[]; notes: string[]; rejectedCategories: Set<AdviceCategory>; returned: number } {
  if (!isRecord(input.parsed) || !Array.isArray(input.parsed.recommendations)) {
    throw new Error('advice backend JSON must have shape {"recommendations":[...]}');
  }
  const notes: string[] = [];
  const recommendations: AdviceRecommendation[] = [];
  const seenIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const cap = input.categories.length === 1 ? 5 : 2;
  const counts = new Map<AdviceCategory, number>();
  const rejectedCategories = new Set<AdviceCategory>();
  const context = {
    evidenceIds: new Set(input.evidence.map((item) => item.id)),
    categories: input.categories,
    targets: input.targets,
    routesById: new Map(adviceRoutes.map((route) => [route.id, route])),
    registryByRef: new Map(input.registry.map((entry) => [entry.ref, entry]))
  };
  for (const raw of input.parsed.recommendations) {
    const result = validateRecommendation({ raw, ...context });
    if (!result.recommendation) {
      if (result.note) notes.push(result.note);
      if (isRecord(raw) && typeof raw.category === "string" && isAdviceCategory(raw.category)) rejectedCategories.add(raw.category);
      continue;
    }
    const recommendation = result.recommendation;
    const signature = `${recommendation.category}:${recommendation.reason.toLowerCase()}:${recommendation.targetVendors.join(",")}`;
    if (seenIds.has(recommendation.id) || seenSignatures.has(signature)) {
      notes.push(`Dropped duplicate recommendation '${recommendation.id}'.`);
      continue;
    }
    if ((counts.get(recommendation.category) ?? 0) >= cap) {
      notes.push(`Dropped recommendation '${recommendation.id}' beyond the ${cap} ${recommendation.category} limit.`);
      continue;
    }
    seenIds.add(recommendation.id);
    seenSignatures.add(signature);
    counts.set(recommendation.category, (counts.get(recommendation.category) ?? 0) + 1);
    recommendations.push(recommendation);
  }
  return { recommendations, notes, rejectedCategories, returned: input.parsed.recommendations.length };
}

function validateCoverage(input: {
  parsed: unknown;
  categories: AdviceCategory[];
  recommendations: AdviceRecommendation[];
  weakLeads: AdviceRecommendation[];
  sessionEvidence: AdviceEvidence[];
  rejectedCategories: Set<AdviceCategory>;
  targets: AdviceVendor[];
}): AdviceCoverage[] {
  const { parsed, categories, recommendations } = input;
  const rawCoverage = isRecord(parsed) && Array.isArray(parsed.coverage) ? parsed.coverage : [];
  const reasons = new Map<AdviceCategory, string>();
  for (const raw of rawCoverage) {
    if (!isRecord(raw) || typeof raw.category !== "string" || !isAdviceCategory(raw.category) || !categories.includes(raw.category)) continue;
    if (typeof raw.reason !== "string" || !raw.reason.trim() || raw.reason.length > 240 || reasons.has(raw.category)) continue;
    reasons.set(raw.category, raw.reason.trim());
  }
  return categories.map((category): AdviceCoverage => {
    const count = recommendations.filter((item) => item.category === category).length;
    const patterns = input.sessionEvidence.filter((item) => item.allowedCategories?.includes(category));
    const supported = patterns.filter((item) => (item.distinctSessions ?? 0) >= 2 || (item.occurrences ?? 1) >= 3);
    const hasRoute = adviceRoutes.some((route) => route.category === category && route.vendors.some((vendor) => input.targets.includes(vendor)));
    if (count > 0) return {
      category, status: "accepted",
      reason: reasons.get(category) ?? `${count} supported recommendation${count === 1 ? "" : "s"} passed validation.`
    };
    if (input.weakLeads.some((item) => item.category === category)) return {
      category, status: "weak-evidence",
      reason: reasons.get(category) ?? "The candidate remained low confidence; recurrence in another distinct session or a second independent signal would strengthen it."
    };
    if (input.rejectedCategories.has(category)) return {
      category, status: "validation-rejection",
      reason: `The backend returned this category, but every candidate failed evidence, route, registry, duplicate, or limit validation.`
    };
    if (supported.length > 0 && !hasRoute) return {
      category, status: "supported-no-route",
      reason: `${supported.length} recurring pattern${supported.length === 1 ? "" : "s"} supported this category, but no validated implementation route matched the selected targets.`
    };
    if (supported.length > 0) return {
      category, status: "backend-omission",
      reason: reasons.get(category) ?? `Recurring actionable evidence supported this category, but the backend returned no recommendation that passed validation.`
    };
    if (patterns.length > 0) return {
      category, status: "weak-evidence",
      reason: reasons.get(category) ?? "Evidence was isolated or repeated only within one session; recurrence across distinct sessions would strengthen it."
    };
    return {
      category,
      status: "no-evidence",
      reason: reasons.get(category) ?? "No visible recurring actionable evidence mapped to this category."
    };
  });
}

function emptyEvidenceFunnel(targets: AdviceVendor[]): AdviceEvidenceFunnel {
  return {
    sources: targets.map((source) => ({ source, discovered: 0, eligible: 0, read: 0, parsed: 0, visibleEvents: 0,
      discarded: { filtering: 0, redaction: 0, deduplication: 0, malformed: 0, limits: 0 }, retainedPatterns: 0 })),
    visibleEvents: 0,
    recurringPatterns: 0
  };
}

export async function adviseProject(input: ProjectAdviceInput): Promise<AdviceReport> {
  const targetDir = resolve(input.targetDir);
  const author = input.author ?? input.backend;
  if (!author) throw new Error("Project advice requires one author.");
  if (input.author && input.backend && input.author !== input.backend) {
    throw new Error(`Advice backend '${input.backend}' must match author '${input.author}'.`);
  }
  for (const [field, values] of [["targets", input.targets], ["sessionSources", input.sessionSources]] as const) {
    if (values && (values.length !== 1 || values[0] !== author)) {
      throw new Error(`Advice ${field} must contain only the selected author '${author}'.`);
    }
  }
  const sessions = input.sessions ?? "auto";
  const lookback = input.lookback ?? "7d";
  const targets: AdviceVendor[] = [author];
  const sessionSources: AdviceVendor[] = [author];
  const categories = input.only?.length ? input.only : [...adviceCategories];
  const progress = (stage: AdviceProgressEvent["stage"], message: string): void => {
    try {
      input.onProgress?.({ stage, message });
    } catch {
      // A display callback must not break analysis.
    }
  };
  progress("profile", "Profiling project structure and agent configuration…");
  progress("sessions", sessions === "auto"
    ? `Finding exact-project sessions from the ${adviceSessionLookbackLabel(lookback)}…`
    : "Skipping project sessions; using codebase evidence only…");
  const [profile, sessionEvidence] = await Promise.all([
    profileProject(targetDir),
    sessions === "auto"
      ? input.sessionEvidence ?? collectProjectSessionEvidence({ targetDir, targets: sessionSources, lookback, codexClientFactory: input.codexClientFactory })
      : Promise.resolve<AdviceSessionEvidence>({ sources: sessionSources.map((source) => ({ source, count: 0 })), signals: [], notes: [], funnel: emptyEvidenceFunnel(sessionSources) })
  ]);
  const pureSessionEvidence: AdviceSessionEvidence = {
    ...sessionEvidence,
    sources: sessionEvidence.sources.filter((source) => source.source === author),
    signals: sessionEvidence.signals.filter((signal) => signal.source === author),
    funnel: sessionEvidence.funnel ? {
      ...sessionEvidence.funnel,
      sources: sessionEvidence.funnel.sources.filter((source) => source.source === author)
    } : undefined
  };
  const sessionCount = pureSessionEvidence.sources.reduce((sum, source) => sum + source.count, 0);
  progress("sessions", sessions === "auto"
    ? `Found ${sessionCount} matching session(s); retained ${pureSessionEvidence.signals.length} bounded signal(s).`
    : "Session evidence disabled.");
  progress("catalog", categories.includes("skills") ? "Checking the skill registry for supported candidates…" : "Building supported implementation routes…");
  const skills = await collectSkillRegistry({ categories, stacks: profile.stacks, languages: profile.languages, search: input.search ?? searchSkills });
  const registry = [...builtinAdviceRegistry, ...skills.entries].filter((entry) => categories.includes(entry.category) && entry.vendors.some((vendor) => targets.includes(vendor)));
  const evidence = [...profile.evidence, ...pureSessionEvidence.signals];
  progress("backend", `Asking ${author} for bounded recommendations…`);
  const invoke = (requestCategories: AdviceCategory[]) => invokeBackend({
    backend: author,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    prompt: buildPrompt({ profileText: projectProfileSummary(profile), evidence, categories: requestCategories, targets, registry, focused: requestCategories.length === 1 }),
    targetDir,
    ephemeral: true,
    runner: input.runner ?? defaultBackendRunner,
    signal: input.signal
  });
  const firstParsed = await invoke(categories);
  progress("validation", "Validating evidence, routes, registry references, duplicates, and category limits…");
  const firstValidated = validateRecommendations({ parsed: firstParsed, evidence, categories, targets, registry });
  const supportedCategories = categories.filter((category) => pureSessionEvidence.signals.some((item) =>
    item.allowedCategories?.includes(category) && ((item.distinctSessions ?? 0) >= 2 || (item.occurrences ?? 1) >= 3)));
  const firstStrongCategories = new Set(firstValidated.recommendations.filter((item) => item.confidence !== "low").map((item) => item.category));
  const recoveryCategories = supportedCategories.filter((category) => !firstStrongCategories.has(category));
  const shouldRecover = categories.length > 1
    && firstValidated.recommendations.filter((item) => item.confidence !== "low").length < 3
    && supportedCategories.length >= 3
    && recoveryCategories.length > 0;
  let recoveryParsed: unknown;
  if (shouldRecover) {
    progress("backend", `Recovering omitted evidence-supported categories: ${recoveryCategories.join(", ")}…`);
    recoveryParsed = await invoke(recoveryCategories);
  }
  const combinedParsed = recoveryParsed && isRecord(recoveryParsed) && Array.isArray(recoveryParsed.recommendations)
    ? {
        recommendations: [
          ...(isRecord(firstParsed) && Array.isArray(firstParsed.recommendations) ? firstParsed.recommendations : []),
          ...recoveryParsed.recommendations
        ],
        coverage: [
          ...(isRecord(firstParsed) && Array.isArray(firstParsed.coverage) ? firstParsed.coverage : []),
          ...(Array.isArray(recoveryParsed.coverage) ? recoveryParsed.coverage : [])
        ]
      }
    : firstParsed;
  const validated = validateRecommendations({ parsed: combinedParsed, evidence, categories, targets, registry });
  const recommendations = validated.recommendations.filter((item) => item.confidence !== "low");
  const weakLeads = validated.recommendations.filter((item) => item.confidence === "low");
  const coverage = validateCoverage({
    parsed: combinedParsed, categories, recommendations, weakLeads,
    sessionEvidence: pureSessionEvidence.signals, rejectedCategories: validated.rejectedCategories, targets
  });
  const notes = [...pureSessionEvidence.notes, ...skills.notes, ...validated.notes];
  if (sessions === "none") notes.unshift("Project sessions were disabled; recommendations use codebase evidence only.");
  else if (sessionCount === 0) notes.unshift("No matching project sessions were found; recommendations use codebase evidence only.");
  notes.push("Report only: Farrier did not install recommendations or change project configuration.");
  if (weakLeads.length > 0) notes.push(`${weakLeads.length} low-confidence item(s) are shown as weak leads, not supported recommendations.`);
  progress("complete", `Report ready with ${validated.recommendations.length} validated recommendation(s): ${recommendations.length} supported and ${weakLeads.length} weak lead(s).`);

  const funnel = pureSessionEvidence.funnel ?? emptyEvidenceFunnel(targets);
  funnel.recommendation = {
    patternsSent: pureSessionEvidence.signals.length,
    returned: validated.returned,
    accepted: validated.recommendations.length,
    merged: recoveryParsed ? Math.max(validated.recommendations.length - firstValidated.recommendations.length, 0) : 0,
    rejected: Math.max(validated.returned - validated.recommendations.length, 0),
    rejectionReasons: validated.notes,
    recoveryCalls: recoveryParsed ? 1 : 0
  };

  return {
    schemaVersion: 1,
    targetDir,
    author,
    backend: author,
    ...(input.model ? { model: input.model } : {}),
    reportOnly: true,
    targets,
    sessions: {
      mode: sessions,
      lookback,
      included: sessions === "auto" && sessionCount > 0,
      requestedSources: sessionSources,
      sources: pureSessionEvidence.sources,
      evidence: sessions === "auto" ? pureSessionEvidence.signals : [],
      funnel
    },
    profile,
    recommendations,
    weakLeads,
    coverage,
    notes
  };
}
