export const enforcementAgentOrder = ["claude", "codex"] as const;

export type EnforcementAgent = (typeof enforcementAgentOrder)[number];

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
