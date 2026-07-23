import { describe, expect, test } from "bun:test";
import type { CliBackendListing } from "../src/engine/model-listing";
import {
  displayedModel,
  effortOptions,
  initialEffortPick,
  initialModelPick,
  modelSuggestions,
  pickedValue,
  type CliListingFetch
} from "../src/tui/startup-picks";

const codexListing: CliBackendListing = {
  models: [
    { id: "gpt-a", supportedReasoningEfforts: ["low", "medium"], defaultReasoningEffort: "medium" },
    { id: "gpt-b", supportedReasoningEfforts: ["medium", "high"], defaultReasoningEffort: "high" },
    { id: "gpt-bare" }
  ]
};

const done = (listing: CliBackendListing): CliListingFetch => ({ status: "done", listing });

describe("model suggestions and picks", () => {
  test("model suggestions stay honest and deduplicated: configured first, then the CLI list", () => {
    // No hardcoded built-ins.
    expect(modelSuggestions("claude", { claude: { default: "sonnet", advise: "opus-x" } })).toEqual(["sonnet", "opus-x"]);
    expect(modelSuggestions("codex", {})).toEqual([]);
    expect(modelSuggestions("codex", { codex: { default: "gpt-5.5" } }, ["gpt-5.6-sol", "gpt-5.5"])).toEqual([
      "gpt-5.5",
      "gpt-5.6-sol"
    ]);
  });

  test("a remembered model becomes a suggestion index when listed and typed text otherwise", () => {
    const models = { claude: { default: "sonnet" } };
    expect(initialModelPick("claude", models, { agent: "claude", models: { claude: "sonnet" }, efforts: {} }))
      .toEqual({ suggestionIndex: 1, custom: "" });
    expect(initialModelPick("claude", models, { agent: "claude", models: { claude: "elsewhere" }, efforts: {} }))
      .toEqual({ suggestionIndex: 0, custom: "elsewhere" });
    expect(initialModelPick("claude", models)).toEqual({ suggestionIndex: 0, custom: "" });
  });

  test("a remembered effort is always prefilled as typed text (levels load asynchronously)", () => {
    expect(initialEffortPick("claude", { agent: "claude", models: {}, efforts: { claude: "max" } }))
      .toEqual({ suggestionIndex: 0, custom: "max" });
    expect(initialEffortPick("claude", { agent: "claude", models: {}, efforts: {} }))
      .toEqual({ suggestionIndex: 0, custom: "" });
  });

  test("pickedValue: typed text wins, index picks a suggestion, index 0 means config default", () => {
    expect(pickedValue({ suggestionIndex: 2, custom: "  typed  " }, ["a", "b"])).toBe("typed");
    expect(pickedValue({ suggestionIndex: 2, custom: "" }, ["a", "b"])).toBe("b");
    expect(pickedValue({ suggestionIndex: 0, custom: "" }, ["a", "b"])).toBeUndefined();
  });
});

describe("effort options follow the CLI and the selected model", () => {
  test("claude levels are session-wide from the --effort help list, with no model default", () => {
    const fetch = done({ models: [], efforts: ["low", "medium", "max"] });
    expect(effortOptions("claude", fetch, undefined)).toEqual({ levels: ["low", "medium", "max"] });
    expect(effortOptions("claude", fetch, "any-model")).toEqual({ levels: ["low", "medium", "max"] });
  });

  test("codex levels belong to the selected model and carry its default", () => {
    expect(effortOptions("codex", done(codexListing), "gpt-a")).toEqual({
      levels: ["low", "medium"],
      modelDefault: "medium"
    });
    expect(effortOptions("codex", done(codexListing), "gpt-b")).toEqual({
      levels: ["medium", "high"],
      modelDefault: "high"
    });
  });

  test("an unknown or unset codex model falls back to the deduplicated union across listed models", () => {
    const union = { levels: ["low", "medium", "high"] };
    expect(effortOptions("codex", done(codexListing), "gpt-typed-elsewhere")).toEqual(union);
    expect(effortOptions("codex", done(codexListing), undefined)).toEqual(union);
    // A listed model without declared efforts also falls back to the union.
    expect(effortOptions("codex", done(codexListing), "gpt-bare")).toEqual(union);
  });

  test("no listing yet (loading or absent) means no levels, never a built-in list", () => {
    expect(effortOptions("claude", undefined, undefined)).toEqual({ levels: [] });
    expect(effortOptions("claude", { status: "loading" }, undefined)).toEqual({ levels: [] });
    expect(effortOptions("codex", { status: "loading" }, "gpt-a")).toEqual({ levels: [] });
    expect(effortOptions("claude", done({ models: [], efforts: [] }), undefined)).toEqual({ levels: [] });
    expect(effortOptions("codex", done({ models: [] }), undefined)).toEqual({ levels: [] });
  });

  test("displayedModel resolves typed text, then the cycled suggestion, then the configured default", () => {
    const models = { codex: { default: { model: "gpt-a" } } };
    expect(displayedModel("codex", { suggestionIndex: 0, custom: "typed" }, ["gpt-b"], models)).toBe("typed");
    expect(displayedModel("codex", { suggestionIndex: 1, custom: "" }, ["gpt-b"], models)).toBe("gpt-b");
    // "config default" follows the configured default entry, so the effort
    // line can show that model's own levels.
    expect(displayedModel("codex", { suggestionIndex: 0, custom: "" }, ["gpt-b"], models)).toBe("gpt-a");
    expect(displayedModel("codex", { suggestionIndex: 0, custom: "" }, [], {})).toBeUndefined();
  });
});
