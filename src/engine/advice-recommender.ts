import { adviceCategoryBenefit, isAdviceCategory, type AdviceCategory, type AdviceCoverage, type AdviceEvidence, type AdviceOmittedRecommendation, type AdviceRecommendation, type AdviceSessionEpisode, type AdviceVendor, type ProjectProfile } from "./advice-types";
import { adviceRouteArtifacts, type AdviceRegistryEntry } from "./advice-catalog";
import type { AdviceProviderPolicy } from "./advice-policy";

type RawRecommendation = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value as string[];
}

export function buildAdvicePrompt(input: {
  profile: ProjectProfile;
  evidence: AdviceEvidence[];
  episodes: AdviceSessionEpisode[];
  categories: AdviceCategory[];
  policy: AdviceProviderPolicy;
  registry: AdviceRegistryEntry[];
  queries: Array<{ query: string; evidence: string[]; matches: string[] }>;
}): string {
  const focused = input.categories.length === 1;
  const selectedCategories = input.policy.categories.filter((item) => input.categories.includes(item.category));
  const selectedRoutes = input.policy.routes.filter((route) => input.categories.includes(route.category));
  const evidence = input.evidence.map((item) => ({
    id: item.id, source: item.source, kind: item.kind, path: item.path, summary: item.summary,
    occurrences: item.occurrences, distinctSessionCount: item.distinctSessions,
    allowedCategories: item.allowedCategories, selectedProvider: item.selectedProvider
  }));
  const profile = {
    summary: {
      stacks: input.profile.stacks, languages: input.profile.languages, packageManagers: input.profile.packageManagers ?? [],
      dependencies: input.profile.dependencies ?? [], workspaces: input.profile.workspaces ?? [],
      tests: input.profile.tests, ci: input.profile.ci, services: input.profile.services
    },
    capabilities: input.profile.capabilities ?? [],
    workflows: input.profile.workflows ?? [],
    installedAutomations: input.profile.automations ?? []
  };
  return `You are Farrier's ${input.policy.provider}-native automation recommender. Return JSON only:
{"recommendations":[{"id":"<category>:<stable-kebab-id>","category":"guidance|hooks|skills|subagents|plugins|mcp","targetVendors":["${input.policy.provider}"],"reason":"evidence-backed reason","benefit":"concrete outcome","evidence":["exact-evidence-id"],"confidence":"high|medium|low","routeId":"exact-policy-route","registryRef":"optional exact verified ref"}],"coverage":[{"category":"requested-category","reason":"why useful recommendations were or were not returned"}]}

Decision order for each opportunity:
1. Decide whether ordinary project tooling, durable guidance, or an installed automation already covers it.
2. Prefer an exact verified existing plugin or skill when one fits.
3. Otherwise use a project skill for a reusable authored task or workflow.
4. Use guidance for durable instructions, hooks for supported lifecycle behavior, custom agents for specialist delegation, and MCP for external systems or live data.
5. Skip one-off tasks without a reusable procedure.

Rules:
- The codebase profile is always primary evidence. Session episodes are optional enrichment.
- Inspect dependencies, workflows, testing, CI, external systems, and installed automation before recommending.
- Preserve actual user tasks. A single useful episode can justify a recommendation; repetition strengthens confidence but is not required.
- URLs and generic tool calls are not workflow evidence. Never infer a workflow verb from a domain name.
- Consider every distinct skill opportunity even after finding another skill.
- ${focused ? "This is a focused report. Return up to five useful recommendations in the requested category." : "Return only the top one or two applicable recommendations per category. Skip irrelevant categories."}
- Never add filler or target a global recommendation count.
- Use only requested categories (${input.categories.join(", ")}) and ${input.policy.provider}-supported routes shown below.
- Use exactly one target vendor: ${input.policy.provider}. Never mention or create the other provider's artifacts.
- Every recommendation must cite exact evidence IDs. Evidence summaries are the complete factual boundary.
- A path proves existence only. Do not claim file contents unless the summary states them.
- registryRef is optional. If present, copy an exact compatible ref from the verified catalog. Never invent installable plugins, skills, or MCP packages.
- Hooks are declarative and limited to current supported lifecycle events and trusted project locations. Never output executable code, commands, scripts, or config payloads.
- Never recommend a hook that commits, pushes, publishes, or deploys automatically. Those actions require explicit user invocation.
- Advice is report-only. Do not suggest that Farrier applied or installed anything.
- Return one coverage record per requested category. No markdown or prose outside JSON.

Provider policy:
${JSON.stringify({ id: input.policy.id, categories: selectedCategories, routes: selectedRoutes, locations: input.policy.artifactLocations.filter((item) => input.categories.includes(item.category)), decisionRules: input.policy.decisionRules, references: input.policy.referenceCatalog.filter((item) => item.topics.some((topic) => input.categories.includes(topic))) })}

Codebase profile:
${JSON.stringify(profile)}

Registry queries and evidence:
${JSON.stringify(input.queries)}

Verified registry catalog:
${JSON.stringify(input.registry)}

Session episodes:
${JSON.stringify(input.episodes)}

Evidence inventory:
${JSON.stringify(evidence)}
`;
}

function validateRecommendation(input: {
  raw: unknown;
  evidenceById: Map<string, AdviceEvidence>;
  categories: AdviceCategory[];
  policy: AdviceProviderPolicy;
  registryByRef: Map<string, AdviceRegistryEntry>;
}): { recommendation?: AdviceRecommendation; note?: string } {
  if (!isRecord(input.raw)) return { note: "Dropped recommendation: record must be an object." };
  const raw = input.raw as RawRecommendation;
  const id = typeof raw.id === "string" ? raw.id : undefined;
  const category = typeof raw.category === "string" && isAdviceCategory(raw.category) ? raw.category : undefined;
  if (!category || !input.categories.includes(category)) return { note: `Dropped recommendation '${id ?? "unknown"}': unsupported category.` };
  if (!id || !new RegExp(`^${category}:[a-z0-9]+(?:-[a-z0-9]+)*$`).test(id)) return { note: `Dropped recommendation '${id ?? "unknown"}': id must be stable and category-prefixed.` };
  const vendors = stringArray(raw.targetVendors);
  if (!vendors || vendors.length !== 1 || vendors[0] !== input.policy.provider) return { note: `Dropped recommendation '${id}': invalid target vendors.` };
  const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : undefined;
  if (!reason || reason.length > 320) return { note: `Dropped recommendation '${id}': reason is missing or too long.` };
  const rawBenefit = typeof raw.benefit === "string" && raw.benefit.trim() ? raw.benefit.trim() : undefined;
  if (raw.benefit !== undefined && (!rawBenefit || rawBenefit.length > 240)) return { note: `Dropped recommendation '${id}': benefit is invalid or too long.` };
  const cited = stringArray(raw.evidence);
  if (!cited?.length || cited.some((evidenceId) => !input.evidenceById.has(evidenceId))) return { note: `Dropped recommendation '${id}': evidence contains an unknown or missing reference.` };
  if (cited.some((evidenceId) => !["project", input.policy.provider].includes(input.evidenceById.get(evidenceId)!.source))) return { note: `Dropped recommendation '${id}': evidence references a different provider.` };
  if (!(["high", "medium", "low"] as unknown[]).includes(raw.confidence)) return { note: `Dropped recommendation '${id}': invalid confidence.` };
  const routeId = typeof raw.routeId === "string" ? raw.routeId : "";
  const route = input.policy.routes.find((item) => item.id === routeId && item.category === category);
  if (!route) return { note: `Dropped recommendation '${id}': unsupported implementation route for ${input.policy.provider}.` };
  const registryRef = typeof raw.registryRef === "string" ? raw.registryRef : undefined;
  if (registryRef) {
    const entry = input.registryByRef.get(registryRef);
    if (!entry || entry.category !== category || !entry.vendors.includes(input.policy.provider)) return { note: `Dropped recommendation '${id}': registry ref '${registryRef}' is unsupported.` };
  }
  if (Object.keys(raw).some((key) => /(?:code|script|payload|command)/i.test(key))) return { note: `Dropped recommendation '${id}': executable payloads are not accepted.` };
  const benefit = rawBenefit ?? adviceCategoryBenefit(category);
  if (category === "hooks" && (/```|#!|[{}]|(?:^|\s)(?:bash|node|python(?:3)?)\s+-/i.test(`${reason}\n${benefit}`) || /\b(?:commit|push|publish|deploy)\b/i.test(`${reason}\n${benefit}`))) {
    return { note: `Dropped recommendation '${id}': unsafe or executable hook behavior is not accepted.` };
  }
  const origins = new Set(cited.map((evidenceId) => input.evidenceById.get(evidenceId)!.source === "project" ? "codebase" : "sessions"));
  const evidenceOrigin = origins.size === 2 ? "both" : origins.has("codebase") ? "codebase" : "sessions";
  return { recommendation: {
    id, category, targetVendors: [input.policy.provider], reason, benefit, evidence: Array.from(new Set(cited)),
    confidence: raw.confidence as AdviceRecommendation["confidence"], implementationRoute: { id: route.id, description: route.description },
    creates: adviceRouteArtifacts(route, [input.policy.provider]), evidenceOrigin, ...(registryRef ? { registryRef } : {})
  } };
}

export function validateAdviceResponse(input: {
  parsed: unknown;
  evidence: AdviceEvidence[];
  categories: AdviceCategory[];
  policy: AdviceProviderPolicy;
  registry: AdviceRegistryEntry[];
}): {
  recommendations: AdviceRecommendation[];
  weakLeads: AdviceRecommendation[];
  omitted: AdviceOmittedRecommendation[];
  notes: string[];
  rejectedCategories: Set<AdviceCategory>;
  returned: number;
} {
  if (!isRecord(input.parsed) || !Array.isArray(input.parsed.recommendations)) throw new Error('advice backend JSON must have shape {"recommendations":[...]}');
  const notes: string[] = [];
  const valid: AdviceRecommendation[] = [];
  const rejectedCategories = new Set<AdviceCategory>();
  const seenIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const context = {
    evidenceById: new Map(input.evidence.map((item) => [item.id, item])), categories: input.categories, policy: input.policy,
    registryByRef: new Map(input.registry.map((item) => [item.ref, item]))
  };
  for (const raw of input.parsed.recommendations) {
    const result = validateRecommendation({ raw, ...context });
    if (!result.recommendation) {
      if (result.note) notes.push(result.note);
      if (isRecord(raw) && typeof raw.category === "string" && isAdviceCategory(raw.category)) rejectedCategories.add(raw.category);
      continue;
    }
    const item = result.recommendation;
    const signature = `${item.category}:${item.reason.toLowerCase()}:${item.targetVendors.join(",")}`;
    if (seenIds.has(item.id) || seenSignatures.has(signature)) { notes.push(`Dropped duplicate recommendation '${item.id}'.`); continue; }
    seenIds.add(item.id);
    seenSignatures.add(signature);
    valid.push(item);
  }
  const recommendations: AdviceRecommendation[] = [];
  const weakLeads: AdviceRecommendation[] = [];
  const omitted: AdviceOmittedRecommendation[] = [];
  for (const item of valid) {
    if (item.confidence === "low") { weakLeads.push(item); continue; }
    const categoryPolicy = input.policy.categories.find((candidate) => candidate.category === item.category)!;
    const limit = input.categories.length === 1 ? categoryPolicy.focusedLimit : categoryPolicy.defaultLimit;
    const accepted = recommendations.filter((candidate) => candidate.category === item.category).length;
    if (accepted >= limit) omitted.push({ recommendation: item, reason: `Ranked after the top ${limit} ${item.category} recommendations allowed in this report.` });
    else recommendations.push(item);
  }
  return { recommendations, weakLeads, omitted, notes, rejectedCategories, returned: input.parsed.recommendations.length };
}

export function validateAdviceCoverage(input: {
  parsed: unknown;
  categories: AdviceCategory[];
  recommendations: AdviceRecommendation[];
  weakLeads: AdviceRecommendation[];
  omitted: AdviceOmittedRecommendation[];
  rejectedCategories: Set<AdviceCategory>;
}): AdviceCoverage[] {
  const rawCoverage = isRecord(input.parsed) && Array.isArray(input.parsed.coverage) ? input.parsed.coverage : [];
  const reasons = new Map<AdviceCategory, string>();
  for (const raw of rawCoverage) {
    if (!isRecord(raw) || typeof raw.category !== "string" || !isAdviceCategory(raw.category) || !input.categories.includes(raw.category)) continue;
    if (typeof raw.reason === "string" && raw.reason.trim() && raw.reason.length <= 240 && !reasons.has(raw.category)) reasons.set(raw.category, raw.reason.trim());
  }
  return input.categories.map((category): AdviceCoverage => {
    const count = input.recommendations.filter((item) => item.category === category).length;
    if (count) return { category, status: "accepted", reason: reasons.get(category) ?? `${count} recommendation${count === 1 ? "" : "s"} passed validation.` };
    if (input.omitted.some((item) => item.recommendation.category === category)) return { category, status: "presentation-omission", reason: reasons.get(category) ?? "Valid opportunities were omitted by the category presentation bound." };
    if (input.weakLeads.some((item) => item.category === category)) return { category, status: "weak-evidence", reason: reasons.get(category) ?? "The backend returned only low-confidence candidates." };
    if (input.rejectedCategories.has(category)) return { category, status: "validation-rejection", reason: "The backend returned this category, but every candidate failed evidence, provider, route, registry, duplicate, or safety validation." };
    return { category, status: "no-evidence", reason: reasons.get(category) ?? "No applicable codebase or session opportunity was identified for this category." };
  });
}
