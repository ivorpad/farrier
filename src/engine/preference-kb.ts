/**
 * The preference knowledge base: farrier's durable record of reviewed team
 * preferences. One JSON file, farrier's own format. It starts EMPTY and grows
 * only through reviewed Improve proposals — no seed content, no template
 * rules, nothing enters without evidence citations and explicit user review.
 *
 * Each rule routes to an enforcement tier (the repo's routing principle):
 * lintable → a deterministic gate should hold it; declarative → its owning
 * subagent reads it as a scoped rule; judgment → a reviewer checklist item.
 */

export const preferenceKbPath = ".farrier/preferences.json";

export const preferenceTiers = ["lintable", "declarative", "judgment"] as const;
export type PreferenceTier = (typeof preferenceTiers)[number];

export type PreferenceRule = {
  /** Stable kebab-case id; a re-proposed id replaces the existing rule. */
  id: string;
  rule: string;
  tier: PreferenceTier;
  /** Owning subagent (kebab name) for declarative/judgment rules. */
  owner?: string;
  /** Human-readable evidence citations ("steer 3", "cluster 1", "8 of 30 sessions"). */
  evidence: string[];
  /** ISO date the rule was applied through review. */
  addedAt: string;
};

export type PreferenceKb = {
  version: 1;
  rules: PreferenceRule[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRule(value: unknown): value is PreferenceRule {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.rule === "string" &&
    preferenceTiers.includes(value.tier as PreferenceTier) &&
    (value.owner === undefined || typeof value.owner === "string") &&
    Array.isArray(value.evidence) &&
    value.evidence.every((item) => typeof item === "string") &&
    typeof value.addedAt === "string"
  );
}

/** Parses KB content; malformed content throws so a hand-edited file is never silently overwritten. */
export function parsePreferenceKb(content: string | undefined): PreferenceKb {
  if (content === undefined || content.trim().length === 0) {
    return { version: 1, rules: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`${preferenceKbPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.rules) || !parsed.rules.every(isRule)) {
    throw new Error(`${preferenceKbPath} does not match the preference KB format (version 1).`);
  }
  const ids = new Set(parsed.rules.map((rule) => rule.id));
  if (ids.size !== parsed.rules.length) {
    throw new Error(`${preferenceKbPath} contains duplicate rule ids; fix the file before merging into it.`);
  }
  return { version: 1, rules: parsed.rules };
}

/**
 * Merge one reviewed rule: same id replaces (a reviewed update), otherwise
 * append. Existing rules are never dropped or reordered.
 */
export function mergePreferenceRule(content: string | undefined, rule: PreferenceRule): string {
  const kb = parsePreferenceKb(content);
  const index = kb.rules.findIndex((existing) => existing.id === rule.id);
  const rules = index >= 0
    ? kb.rules.map((existing, position) => (position === index ? rule : existing))
    : [...kb.rules, rule];
  return `${JSON.stringify({ version: 1, rules }, null, 2)}\n`;
}
