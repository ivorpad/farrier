import { adviceCategories, adviceSessionLookbacks, type AdviceCategory, type AdviceReport, type AdviceSessionLookback } from "../engine/advice-types";
import type { AgentAvailability, AgentBackend } from "../engine/backend";

export type AdviceTuiScope = "all" | AdviceCategory;
export const adviceTuiScopes: AdviceTuiScope[] = ["all", ...adviceCategories];

export type AdviceTuiState = {
  availability: AgentAvailability;
  author?: AgentBackend;
  /** @deprecated UI compatibility alias for author. */
  backend: AgentBackend;
  includeSessions: boolean;
  lookback: AdviceSessionLookback;
  scope: AdviceTuiScope;
  status: "ready" | "running" | "done" | "error";
  progress?: string;
  progressHistory: string[];
  report?: AdviceReport;
  error?: string;
};

export type AdviceTuiEvent =
  | { type: "SET_AUTHOR"; author: AgentBackend }
  | { type: "SET_BACKEND"; backend: AgentBackend }
  | { type: "TOGGLE_SESSIONS" }
  | { type: "SET_LOOKBACK"; lookback: AdviceSessionLookback }
  | { type: "SET_SCOPE"; scope: AdviceTuiScope }
  | { type: "CYCLE_SCOPE" }
  | { type: "START" }
  | { type: "PROGRESS"; message: string }
  | { type: "SUCCEEDED"; report: AdviceReport }
  | { type: "FAILED"; error: string }
  | { type: "RESET" };

export function initialAdviceBackend(availability: AgentAvailability): AgentBackend | undefined {
  if (availability.claude && !availability.codex) return "claude";
  if (availability.codex && !availability.claude) return "codex";
  return undefined;
}

export const initialAdviceAuthor = initialAdviceBackend;

export function adjacentAvailableAdviceBackend(
  current: AgentBackend | undefined,
  availability: AgentAvailability,
  direction: -1 | 1
): AgentBackend | undefined {
  const available = (["claude", "codex"] as const).filter((backend) => availability[backend]);
  if (available.length === 0) return undefined;
  if (!current) return direction > 0 ? available[0] : available.at(-1);
  const currentIndex = available.indexOf(current);
  if (currentIndex < 0) return available[0];
  return available[(currentIndex + direction + available.length) % available.length];
}

export function createInitialAdviceTuiState(sessionCount: number, availability: AgentAvailability): AdviceTuiState {
  if (!availability.claude && !availability.codex) throw new Error("No author provider is available.");
  const author = initialAdviceAuthor(availability);
  const backend = author ?? (availability.claude ? "claude" : "codex");
  return { availability, author, backend, includeSessions: sessionCount > 0, lookback: "7d", scope: "all", status: "ready", progressHistory: [] };
}

export function adjacentAdviceLookback(current: AdviceSessionLookback, direction: -1 | 1): AdviceSessionLookback {
  const index = adviceSessionLookbacks.indexOf(current);
  return adviceSessionLookbacks[(index + direction + adviceSessionLookbacks.length) % adviceSessionLookbacks.length]!;
}

export function adviceTuiReducer(state: AdviceTuiState, event: AdviceTuiEvent): AdviceTuiState {
  if (event.type === "SET_AUTHOR" && state.status === "ready" && state.availability[event.author]) {
    return { ...state, author: event.author, backend: event.author };
  }
  if (event.type === "SET_BACKEND" && state.status === "ready" && state.availability[event.backend]) {
    return { ...state, author: event.backend, backend: event.backend };
  }
  if (event.type === "TOGGLE_SESSIONS" && state.status === "ready") return { ...state, includeSessions: !state.includeSessions };
  if (event.type === "SET_LOOKBACK" && state.status === "ready") return { ...state, lookback: event.lookback };
  if (event.type === "SET_SCOPE" && state.status === "ready") return { ...state, scope: event.scope };
  if (event.type === "CYCLE_SCOPE" && state.status === "ready") {
    const index = adviceTuiScopes.indexOf(state.scope);
    return { ...state, scope: adviceTuiScopes[(index + 1) % adviceTuiScopes.length]! };
  }
  if (event.type === "START" && state.status === "ready" && state.author) {
    const message = `Starting ${state.author === "claude" ? "Claude" : "Codex"} analysis…`;
    return { ...state, status: "running", error: undefined, report: undefined, progress: message, progressHistory: [message] };
  }
  if (event.type === "PROGRESS" && state.status === "running") {
    const previous = state.progressHistory.at(-1);
    return {
      ...state,
      progress: event.message,
      progressHistory: previous === event.message ? state.progressHistory : [...state.progressHistory, event.message]
    };
  }
  if (event.type === "SUCCEEDED" && state.status === "running") return { ...state, status: "done", report: event.report };
  if (event.type === "FAILED" && state.status === "running") return { ...state, status: "error", error: event.error };
  if (event.type === "RESET" && (state.status === "done" || state.status === "error")) {
    return { ...state, status: "ready", progress: undefined, progressHistory: [], report: undefined, error: undefined };
  }
  return state;
}
