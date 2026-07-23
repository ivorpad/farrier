import type { ModelsConfig } from "../config/farrier-config";
import type { StartupChoice } from "../config/startup-choice";
import type { AgentBackend } from "../engine/backend";
import type { CliBackendListing } from "../engine/model-listing";

/**
 * Pure pick logic for the startup screen's model + effort phase, kept out of
 * startup.tsx so the component stays under the file-size cap and the option
 * sourcing is testable without a renderer.
 */

/**
 * One editable option line: index 0 is "config default", higher indices pick
 * a suggestion, and non-empty typed text overrides both.
 */
export type OptionPick = { suggestionIndex: number; custom: string };

export type CliListingFetch = { status: "loading" } | { status: "done"; listing: CliBackendListing };

export const emptyPick: OptionPick = { suggestionIndex: 0, custom: "" };

/**
 * Model suggestions per backend: the user's configured models first, then
 * whatever the installed CLI reports (codex `model/list`, the claude
 * `--model` help text). No hardcoded catalog: when the CLI reports nothing
 * the row falls back to configured models plus free text. Appending the CLI
 * list keeps earlier indices stable when a probe resolves mid-edit. Index 0
 * of the rendered options is always "config default".
 */
export function modelSuggestions(backend: AgentBackend, models: ModelsConfig, cliModels: readonly string[] = []): string[] {
  const configured = Object.values(models[backend] ?? {})
    .map((entry) => (typeof entry === "string" ? entry : entry.model))
    .filter((model): model is string => Boolean(model));
  return Array.from(new Set([...configured, ...cliModels]));
}

export function initialModelPick(backend: AgentBackend, models: ModelsConfig, remembered?: StartupChoice): OptionPick {
  const rememberedModel = remembered?.models[backend];
  if (!rememberedModel) return { ...emptyPick };
  const index = modelSuggestions(backend, models).indexOf(rememberedModel);
  return index >= 0 ? { suggestionIndex: index + 1, custom: "" } : { suggestionIndex: 0, custom: rememberedModel };
}

/**
 * Effort levels arrive from an async CLI probe, so a remembered level is
 * prefilled as typed text instead of being matched against a list that may
 * not have loaded yet; confirming keeps the exact same value.
 */
export function initialEffortPick(backend: AgentBackend, remembered?: StartupChoice): OptionPick {
  const rememberedEffort = remembered?.efforts?.[backend];
  return rememberedEffort ? { suggestionIndex: 0, custom: rememberedEffort } : { ...emptyPick };
}

/** The confirmed value: typed text wins, then a cycled suggestion, else config default (undefined). */
export function pickedValue(pick: OptionPick, suggestions: readonly string[]): string | undefined {
  const custom = pick.custom.trim();
  if (custom.length > 0) return custom;
  return pick.suggestionIndex > 0 ? suggestions[pick.suggestionIndex - 1] : undefined;
}

/**
 * The model string the effort line follows: typed text, a cycled suggestion,
 * or the backend's configured default entry when the line reads
 * "config default".
 */
export function displayedModel(
  backend: AgentBackend,
  pick: OptionPick,
  suggestions: readonly string[],
  models: ModelsConfig
): string | undefined {
  const picked = pickedValue(pick, suggestions);
  if (picked !== undefined) return picked;
  const entry = models[backend]?.default;
  return typeof entry === "string" ? entry : entry?.model;
}

export type EffortOptions = {
  levels: string[];
  /** codex only: the selected model's server-declared default level. */
  modelDefault?: string;
};

/**
 * Effort levels for the currently displayed model, straight from the CLI.
 * claude levels are session-wide (the `--effort` help list). codex levels
 * belong to the selected model, so they follow the model line; a free-typed
 * or unknown model falls back to the union across listed models. An empty
 * result means "the CLI did not report levels", never a built-in list.
 */
export function effortOptions(
  backend: AgentBackend,
  fetch: CliListingFetch | undefined,
  displayed: string | undefined
): EffortOptions {
  if (fetch?.status !== "done") return { levels: [] };
  if (backend === "claude") return { levels: [...(fetch.listing.efforts ?? [])] };

  const models = fetch.listing.models;
  const match = displayed === undefined ? undefined : models.find((model) => model.id === displayed);
  if (match && (match.supportedReasoningEfforts?.length ?? 0) > 0) {
    return {
      levels: [...match.supportedReasoningEfforts!],
      ...(match.defaultReasoningEffort ? { modelDefault: match.defaultReasoningEffort } : {})
    };
  }

  const union: string[] = [];
  for (const model of models) {
    for (const level of model.supportedReasoningEfforts ?? []) {
      if (!union.includes(level)) union.push(level);
    }
  }
  return { levels: union };
}
