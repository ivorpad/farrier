import type { AdviceSessionEvidence } from "./advice-types";

export function visibleSessionEvents(episodes: AdviceSessionEvidence["episodes"]): number {
  return (episodes ?? []).reduce((sum, item) =>
    sum + 1 + item.corrections.length + item.actions.length + (item.outcome ? 1 : 0), 0);
}
