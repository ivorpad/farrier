export const enforcementAgentOrder = ["claude", "codex"] as const;

export type EnforcementAgent = (typeof enforcementAgentOrder)[number];
export type ArtifactAuthor = EnforcementAgent;

export type AuthorAvailability = Record<ArtifactAuthor, boolean>;

export type SingleAuthorSelectors = {
  author?: ArtifactAuthor;
  backend?: ArtifactAuthor;
  targets?: ArtifactAuthor[];
};

export type ResolvedAuthorSelector = {
  author?: ArtifactAuthor;
  warnings: string[];
};

const enforcementAgentSet = new Set<string>(enforcementAgentOrder);

export function isEnforcementAgent(value: unknown): value is EnforcementAgent {
  return typeof value === "string" && enforcementAgentSet.has(value);
}

export function normalizeAgents(
  value: unknown,
  fallback: readonly EnforcementAgent[] = ["claude"]
): EnforcementAgent[] {
  const candidate = value === undefined ? [...fallback] : value;

  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error("agents must be a non-empty array containing claude, codex, or both");
  }

  if (!candidate.every(isEnforcementAgent)) {
    throw new Error("agents must contain only claude and codex");
  }

  const selected = new Set<EnforcementAgent>(candidate);
  return enforcementAgentOrder.filter((agent) => selected.has(agent));
}

export function parseAgents(value: string): EnforcementAgent[] {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return normalizeAgents(values);
}

export function formatAgents(agents: readonly EnforcementAgent[]): string {
  return normalizeAgents(agents).map((agent) => agent === "claude" ? "Claude" : "Codex").join(" + ");
}

export function parseArtifactAuthor(value: string, flag = "--author"): ArtifactAuthor {
  if (isEnforcementAgent(value)) return value;
  throw new Error(`${flag} must be claude or codex`);
}

/**
 * Normalizes the 0.4 canonical selector and its temporary aliases without
 * probing provider CLIs. This keeps parse-time conflicts deterministic.
 */
export function resolveSingleAuthorSelectors(selectors: SingleAuthorSelectors): ResolvedAuthorSelector {
  const warnings: string[] = [];
  const candidates: Array<{ source: string; value: ArtifactAuthor }> = [];

  if (selectors.author) candidates.push({ source: "--author", value: selectors.author });
  if (selectors.backend) {
    candidates.push({ source: "--backend", value: selectors.backend });
    warnings.push("--backend is deprecated; use --author.");
  }
  if (selectors.targets) {
    if (selectors.targets.length !== 1) {
      throw new Error("--targets accepts exactly one provider for advice; use --author claude|codex");
    }
    candidates.push({ source: "--targets", value: selectors.targets[0]! });
    warnings.push("--targets is deprecated for advice; use --author.");
  }

  const first = candidates[0];
  const conflict = first && candidates.find((candidate) => candidate.value !== first.value);
  if (first && conflict) {
    throw new Error(`${first.source} ${first.value} conflicts with ${conflict.source} ${conflict.value}`);
  }

  return { author: first?.value, warnings };
}

export function availableAuthors(availability: AuthorAvailability): ArtifactAuthor[] {
  return enforcementAgentOrder.filter((author) => availability[author]);
}

/** Resolve an omitted canonical author only when provider availability is unambiguous. */
export function resolveAvailableAuthor(
  selected: ArtifactAuthor | undefined,
  availability: AuthorAvailability,
  command: string
): ArtifactAuthor {
  if (selected) {
    if (!availability[selected]) throw new Error(`requested author '${selected}' was not found on PATH`);
    return selected;
  }

  const available = availableAuthors(availability);
  if (available.length === 1) return available[0]!;
  if (available.length === 0) throw new Error("no provider CLI found; install claude or codex");
  throw new Error(`${command} requires --author claude|codex when both provider CLIs are available`);
}
