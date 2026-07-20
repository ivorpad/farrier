import type { AgentBackend } from "./backend";

export function backendProviderBudgetArgs(
  backend: AgentBackend,
  maxBudgetUsd: number | undefined,
): string[] {
  if (maxBudgetUsd === undefined) return [];
  if (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0) {
    throw new Error("maxBudgetUsd must be a positive finite number");
  }
  if (backend !== "claude") {
    throw new Error("maxBudgetUsd is supported only by the Claude backend");
  }
  return ["--max-budget-usd", String(maxBudgetUsd)];
}
