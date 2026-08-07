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

function boundRecommendationText(value: string, maxCharacters: number): { value: string; truncated: boolean } {
  const characters = Array.from(value.trim());
  if (characters.length <= maxCharacters) return { value: characters.join(""), truncated: false };
  return {
    value: `${characters.slice(0, maxCharacters - 1).join("").trimEnd()}…`,
    truncated: true,
  };
}

function recommendationIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[a-z]+:/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
}

type RecommendationValidation = {
  recommendation?: AdviceRecommendation;
  notes: string[];
  rejection?: string;
  normalized: boolean;
};

function rejectRecommendation(message: string): RecommendationValidation {
  return { notes: [], rejection: message, normalized: false };
}

export function buildAdvicePrompt(input: {
  profile: ProjectProfile;
  evidence: AdviceEvidence[];
  episodes: AdviceSessionEpisode[];
  categories: AdviceCategory[];
  focused: boolean;
  policy: AdviceProviderPolicy;
  registry: AdviceRegistryEntry[];
  queries: Array<{ query: string; evidence: string[]; matches: string[] }>;
}): string {
  const selectedCategories = input.policy.categories.filter((item) => input.categories.includes(item.category));
  const selectedRoutes = input.policy.routes.filter((route) => input.categories.includes(route.category));
  const evidence = input.evidence.map((item) => ({
    id: item.id, source: item.source, kind: item.kind, path: item.path, summary: item.summary,
    occurrences: item.occurrences, distinctSessionCount: item.distinctSessions,
    targetVendors: item.targetVendors,
    selectedProvider: item.selectedProvider,
    line: item.line, extractor: item.extractor, factConfidence: item.factConfidence,
    contentDigest: item.contentDigest,
  }));
  const profile = {
    summary: {
      stacks: input.profile.stacks, languages: input.profile.languages, packageManagers: input.profile.packageManagers ?? [],
      dependencies: input.profile.dependencies ?? [], workspaces: input.profile.workspaces ?? [],
      tests: input.profile.tests, ci: input.profile.ci, services: input.profile.services
    },
    capabilities: input.profile.capabilities ?? [],
    workflows: input.profile.workflows ?? [],
    installedAutomations: input.profile.automations ?? [],
    installedSkills: input.profile.skillInventory?.entries ?? [],
    repositoryCoverage: input.profile.repositoryCoverage ? {
      complete: input.profile.repositoryCoverage.complete,
      skippedPaths: input.profile.repositoryCoverage.skippedPaths.slice(0, 30),
      readErrors: input.profile.repositoryCoverage.readErrors.slice(0, 30),
      truncatedPaths: input.profile.repositoryCoverage.truncatedPaths.slice(0, 30),
    } : undefined,
    skillInventoryCoverage: input.profile.skillInventory ? {
      complete: input.profile.skillInventory.complete,
      roots: input.profile.skillInventory.roots,
      malformedLocations: input.profile.skillInventory.malformedLocations.slice(0, 30),
    } : undefined,
  };
  return `You are Farrier's ${input.policy.provider}-native automation recommender. Return JSON only:
{"recommendations":[{"id":"<category>:<stable-kebab-id>","category":"guidance|hooks|skills|subagents|plugins|mcp","evidence":["exact-evidence-id"],"routeId":"exact-policy-route","reason":"optional evidence-backed reason, at most 320 characters","benefit":"optional concrete outcome, at most 240 characters","confidence":"optional high|medium|low","registryRef":"optional exact verified ref"}],"coverage":[{"category":"requested-category","reason":"why useful recommendations were or were not returned"}]}

Only category, evidence, and routeId are required. Farrier binds the selected provider and can derive missing ids, reasons, benefits, and confidence locally without another model call.

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
- Evaluate every session episode independently against every requested category. Do not collapse different reusable tasks into one candidate.
- Consider every distinct opportunity even after finding another recommendation in that category.
- ${input.focused ? "The user selected only this category. Return up to five useful recommendations." : "This is one category worker in a multi-category report. Return up to five useful candidates so a later coordinator can resolve overlap and presentation limits."}
- Never add filler or target a global recommendation count.
- Use only requested categories (${input.categories.join(", ")}) and ${input.policy.provider}-supported routes shown below.
- Do not return targetVendors. Farrier binds every accepted candidate to ${input.policy.provider}. Never mention or create the other provider's artifacts.
- Every recommendation must cite exact evidence IDs. Evidence summaries are the complete factual boundary.
- A path proves existence only. Do not claim file contents unless the summary states them.
- registryRef is optional and valid only for skills, plugins, or MCP. If present, copy an exact compatible ref from the verified registry catalog. Policy reference IDs such as codex-guidance are not registry refs. Never invent installable plugins, skills, or MCP packages.
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
}): RecommendationValidation {
  if (!isRecord(input.raw)) return rejectRecommendation("Dropped recommendation: record must be an object.");
  const raw = input.raw as RawRecommendation;
  const rawId = typeof raw.id === "string" ? raw.id.trim() : undefined;
  const idCategory = rawId?.split(":", 1)[0];
  const suppliedCategory = typeof raw.category === "string" && isAdviceCategory(raw.category) ? raw.category : undefined;
  const category = suppliedCategory ?? (idCategory && isAdviceCategory(idCategory) ? idCategory : undefined);
  if (!category || !input.categories.includes(category)) return rejectRecommendation(`Dropped recommendation '${rawId || "unknown"}': unsupported category.`);
  const cited = stringArray(raw.evidence);
  if (!cited?.length || cited.some((evidenceId) => !input.evidenceById.has(evidenceId))) return rejectRecommendation(`Dropped recommendation '${rawId || "unknown"}': evidence contains an unknown or missing reference.`);
  if (cited.some((evidenceId) => !["project", input.policy.provider].includes(input.evidenceById.get(evidenceId)!.source))) return rejectRecommendation(`Dropped recommendation '${rawId || "unknown"}': evidence references a different provider.`);
  if (cited.some((evidenceId) => {
    const evidence = input.evidenceById.get(evidenceId)!;
    return (evidence.targetVendors !== undefined && !evidence.targetVendors.includes(input.policy.provider))
      || (evidence.selectedProvider !== undefined && evidence.selectedProvider !== input.policy.provider);
  })) return rejectRecommendation(`Dropped recommendation '${rawId || "unknown"}': cited evidence excludes the selected provider.`);
  const suppliedReason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : undefined;
  const suppliedBenefit = typeof raw.benefit === "string" && raw.benefit.trim() ? raw.benefit.trim() : undefined;
  const idSeed = rawId || suppliedReason || suppliedBenefit || input.evidenceById.get(cited[0]!)!.summary;
  const idPart = recommendationIdPart(idSeed);
  if (!idPart) return rejectRecommendation(`Dropped recommendation '${rawId || "unknown"}': no stable identifier could be recovered.`);
  const expectedId = `${category}:${idPart}`;
  const id = rawId && new RegExp(`^${category}:[a-z0-9]+(?:-[a-z0-9]+)*$`).test(rawId) ? rawId : expectedId;
  const notes: string[] = [];
  if (!suppliedCategory) notes.push(`Recovered category '${category}' for recommendation '${id}' from its id.`);
  if (id !== rawId) notes.push(`Normalized recommendation id '${rawId || "missing"}' to '${id}'.`);
  const vendors = stringArray(raw.targetVendors);
  if (!vendors || vendors.length !== 1 || vendors[0] !== input.policy.provider) notes.push(`Normalized recommendation '${id}' target vendor to ${input.policy.provider}.`);
  const fullReason = suppliedReason ?? `Cited evidence: ${cited.map((evidenceId) => input.evidenceById.get(evidenceId)!.summary).join(" ")}`;
  const reason = boundRecommendationText(fullReason, 320);
  const confidence = (["high", "medium", "low"] as unknown[]).includes(raw.confidence)
    ? raw.confidence as AdviceRecommendation["confidence"]
    : "medium";
  if (confidence !== raw.confidence) notes.push(`Normalized recommendation '${id}' confidence to medium.`);
  const suppliedRouteId = typeof raw.routeId === "string" && raw.routeId.trim() ? raw.routeId.trim() : undefined;
  const route = suppliedRouteId
    ? input.policy.routes.find((item) => item.id === suppliedRouteId && item.category === category)
    : input.policy.routes.find((item) => item.category === category);
  if (!route) return rejectRecommendation(`Dropped recommendation '${id}': unsupported implementation route for ${input.policy.provider}.`);
  if (!suppliedRouteId) notes.push(`Filled missing route for recommendation '${id}' with '${route.id}'.`);
  const suppliedRegistryRef = typeof raw.registryRef === "string" ? raw.registryRef : undefined;
  const registryCategory = category === "skills" || category === "plugins" || category === "mcp";
  if (suppliedRegistryRef && registryCategory) {
    const entry = input.registryByRef.get(suppliedRegistryRef);
    if (!entry || entry.category !== category || !entry.vendors.includes(input.policy.provider)) return rejectRecommendation(`Dropped recommendation '${id}': registry ref '${suppliedRegistryRef}' is unsupported.`);
  }
  if (suppliedRegistryRef && !registryCategory) notes.push(`Ignored registry ref '${suppliedRegistryRef}' on non-installable ${category} recommendation '${id}'.`);
  const registryRef = registryCategory ? suppliedRegistryRef : undefined;
  const unboundedBenefit = suppliedBenefit ?? adviceCategoryBenefit(category);
  const benefit = boundRecommendationText(unboundedBenefit, 240);
  const origins = new Set(cited.map((evidenceId) => input.evidenceById.get(evidenceId)!.source === "project" ? "codebase" : "sessions"));
  const evidenceOrigin = origins.size === 2 ? "both" : origins.has("codebase") ? "codebase" : "sessions";
  if (!suppliedReason) notes.push(`Filled missing reason for recommendation '${id}' from cited evidence.`);
  if (!suppliedBenefit) notes.push(`Filled missing benefit for recommendation '${id}' from the ${category} default.`);
  if (reason.truncated || benefit.truncated) notes.push(`Bounded recommendation '${id}' text to the report limits (${reason.truncated ? "reason" : ""}${reason.truncated && benefit.truncated ? " and " : ""}${benefit.truncated ? "benefit" : ""}).`);
  return { recommendation: {
    id, category, targetVendors: [input.policy.provider], reason: reason.value, benefit: benefit.value, evidence: Array.from(new Set(cited)),
    confidence, implementationRoute: { id: route.id, description: route.description },
    creates: adviceRouteArtifacts(route, [input.policy.provider]), evidenceOrigin, ...(registryRef ? { registryRef } : {})
  }, notes, normalized: notes.length > 0 };
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
  rejectionReasons: string[];
  localRecoveries: number;
  rejectedCategories: Set<AdviceCategory>;
  returned: number;
} {
  if (!isRecord(input.parsed) || !Array.isArray(input.parsed.recommendations)) throw new Error('advice backend JSON must have shape {"recommendations":[...]}');
  const notes: string[] = [];
  const rejectionReasons: string[] = [];
  let localRecoveries = 0;
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
    notes.push(...result.notes);
    if (!result.recommendation) {
      if (result.rejection) {
        notes.push(result.rejection);
        rejectionReasons.push(result.rejection);
      }
      if (isRecord(raw) && typeof raw.category === "string" && isAdviceCategory(raw.category)) rejectedCategories.add(raw.category);
      continue;
    }
    const item = result.recommendation;
    const signature = `${item.category}:${item.reason.toLowerCase()}:${item.targetVendors.join(",")}`;
    if (seenIds.has(item.id) || seenSignatures.has(signature)) {
      const rejection = `Dropped duplicate recommendation '${item.id}'.`;
      notes.push(rejection);
      rejectionReasons.push(rejection);
      continue;
    }
    if (result.normalized) localRecoveries += 1;
    seenIds.add(item.id);
    seenSignatures.add(signature);
    valid.push(item);
  }
  const recommendations: AdviceRecommendation[] = [];
  const weakLeads: AdviceRecommendation[] = [];
  const omitted: AdviceOmittedRecommendation[] = [];
  for (const item of valid) {
    const categoryPolicy = input.policy.categories.find((candidate) => candidate.category === item.category)!;
    const limit = input.categories.length === 1 ? categoryPolicy.focusedLimit : categoryPolicy.defaultLimit;
    if (item.confidence === "low") {
      const weakCount = weakLeads.filter((candidate) => candidate.category === item.category).length;
      if (weakCount >= categoryPolicy.focusedLimit) {
        omitted.push({ recommendation: item, reason: `Ranked after the top ${categoryPolicy.focusedLimit} low-confidence ${item.category} leads retained for review.` });
      } else weakLeads.push(item);
      continue;
    }
    const accepted = recommendations.filter((candidate) => candidate.category === item.category).length;
    if (accepted >= limit) omitted.push({ recommendation: item, reason: `Ranked after the top ${limit} ${item.category} recommendations allowed in this report.` });
    else recommendations.push(item);
  }
  return { recommendations, weakLeads, omitted, notes, rejectionReasons, localRecoveries, rejectedCategories, returned: input.parsed.recommendations.length };
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
    if (input.rejectedCategories.has(category)) return { category, status: "validation-rejection", reason: "The backend returned this category, but every candidate failed evidence, provider, route, registry, or duplicate validation." };
    return { category, status: "no-evidence", reason: reasons.get(category) ?? "No applicable codebase or session opportunity was identified for this category." };
  });
}
