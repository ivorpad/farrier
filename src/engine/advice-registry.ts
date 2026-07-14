import type { AdviceRegistryEntry } from "./advice-catalog";
import type { AdviceCategory, AdviceRegistryQuery, ProjectCapability, ProjectProfile } from "./advice-types";
import type { SkillSearchResult } from "./skills";

type PlannedQuery = Omit<AdviceRegistryQuery, "matches">;

function capability(profile: ProjectProfile, group: ProjectCapability["group"], name?: RegExp): ProjectCapability | undefined {
  return (profile.capabilities ?? []).find((item) => item.group === group && (!name || name.test(item.name)));
}

function queryEvidence(...items: Array<ProjectCapability | undefined>): string[] {
  return items.filter((item): item is ProjectCapability => item !== undefined).map((item) => `project:capability:${item.id}`);
}

export function planSkillRegistryQueries(profile: ProjectProfile): PlannedQuery[] {
  const typescript = capability(profile, "language", /typescript/i) ?? capability(profile, "runtime", /typescript/i);
  const drizzle = capability(profile, "orm", /drizzle/i);
  const postgres = capability(profile, "database", /postgres/i);
  const migrations = capability(profile, "migrations");
  const testing = capability(profile, "testing");
  const api = capability(profile, "api");
  const release = capability(profile, "release");
  const deployment = capability(profile, "deployment");
  const ci = capability(profile, "ci");
  const candidates: PlannedQuery[] = [];
  const add = (query: string, evidence: string[]) => {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalized && evidence.length && !candidates.some((item) => item.query === normalized)) candidates.push({ query: normalized, evidence: Array.from(new Set(evidence)) });
  };
  if (typescript && drizzle && postgres) add("typescript drizzle postgres", queryEvidence(typescript, drizzle, postgres));
  if (drizzle && migrations) add("drizzle migrations", queryEvidence(drizzle, migrations));
  if (postgres) add("postgres schema review", queryEvidence(postgres, migrations));
  if (typescript && api && testing) add("typescript api testing", queryEvidence(typescript, api, testing));
  if (release || deployment) add("release deployment github actions", queryEvidence(release, deployment, ci));
  for (const item of profile.capabilities ?? []) {
    if (["automation", "language", "runtime", "ci"].includes(item.group)) continue;
    const language = profile.languages[0]?.toLowerCase();
    add(`${language ? `${language} ` : ""}${item.name}`, [`project:capability:${item.id}`]);
  }
  if (!candidates.length) {
    const fallback = profile.capabilities?.[0];
    if (fallback) add(`${profile.languages[0]?.toLowerCase() ?? "software"} ${fallback.name}`, [`project:capability:${fallback.id}`]);
    else candidates.push({ query: "software engineering", evidence: ["project:root"] });
  }
  return candidates.slice(0, 8);
}

export async function collectSkillRegistry(input: {
  categories: AdviceCategory[];
  profile: ProjectProfile;
  search: (query: string) => Promise<SkillSearchResult[]>;
}): Promise<{ entries: AdviceRegistryEntry[]; queries: AdviceRegistryQuery[]; notes: string[] }> {
  if (!input.categories.includes("skills")) return { entries: [], queries: [], notes: [] };
  const planned = planSkillRegistryQueries(input.profile);
  const outcomes = await Promise.allSettled(planned.map((item) => input.search(item.query)));
  const entries = new Map<string, AdviceRegistryEntry>();
  const queries: AdviceRegistryQuery[] = [];
  const notes: string[] = [];
  for (const [index, outcome] of outcomes.entries()) {
    const plan = planned[index]!;
    if (outcome.status === "rejected") {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      notes.push(`Skill registry search for '${plan.query}' failed: ${message}`);
      queries.push({ ...plan, matches: [] });
      continue;
    }
    const matches: string[] = [];
    for (const result of outcome.value.slice(0, 10)) {
      const ref = `${result.source}@${result.skillId}`;
      matches.push(ref);
      const existing = entries.get(ref);
      if (existing) existing.evidence = Array.from(new Set([...(existing.evidence ?? []), ...plan.evidence]));
      else entries.set(ref, { ref, category: "skills", name: result.name, vendors: ["claude", "codex"], query: plan.query, evidence: plan.evidence });
    }
    queries.push({ ...plan, matches });
  }
  return { entries: Array.from(entries.values()).slice(0, 40), queries, notes };
}
