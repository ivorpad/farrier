import { describe, expect, test } from "bun:test";
import type { SkillSearchResult } from "../src/engine/skills";
import type { HookId, SkillRef } from "../src/packs/types";
import { createInitialWizardState, wizardReducer, type WizardState } from "../src/tui/machine";

const defaultSkills: SkillRef[] = [
  "wshobson/agents@python-code-style",
  "wshobson/agents@python-project-structure"
];

const defaultHooks: HookId[] = [
  "secret-shield",
  "tool-policy",
  "write-guard",
  "verb-runner",
  "quality-judge",
  "stop-judge"
];

function initialState(): WizardState {
  return createInitialWizardState({
    availablePackIds: ["python-fastapi", "python-uv"],
    defaultPackId: "python-fastapi",
    defaultSkills,
    defaultHooks
  });
}

describe("wizard machine", () => {
  test("creates initial state with defaults selected", () => {
    const state = initialState();

    expect(state.step).toBe("Stack");
    expect(state.packId).toBe("python-fastapi");
    expect(state.detectedPackId).toBeUndefined();
    expect(state.availablePackIds).toEqual(["python-fastapi", "python-uv"]);
    expect(state.selectedSkills).toEqual(defaultSkills);
    expect(state.availableHooks).toEqual(defaultHooks);
    expect(state.selectedHooks).toEqual(defaultHooks);
    expect(state.learnEnabled).toBe(false);
    expect(state.skillSearchStatus).toBe("idle");
  });

  test("preselects detected pack and uses detected pack defaults", () => {
    const state = createInitialWizardState({
      availablePackIds: ["python-fastapi", "python-uv", "rails"],
      fallbackPackId: "python-fastapi",
      detectedPackId: "rails",
      packDefaults: {
        "python-fastapi": {
          skills: ["owner/python@fastapi"],
          hooks: ["secret-shield", "tool-policy"]
        },
        "python-uv": {
          skills: ["owner/python@uv"],
          hooks: ["secret-shield"]
        },
        rails: {
          skills: ["owner/rails@patterns"],
          hooks: ["secret-shield", "write-guard", "quality-judge"]
        }
      }
    });

    expect(state.step).toBe("Stack");
    expect(state.packId).toBe("rails");
    expect(state.detectedPackId).toBe("rails");
    expect(state.selectedSkills).toEqual(["owner/rails@patterns"]);
    expect(state.availableHooks).toEqual(["secret-shield", "write-guard", "quality-judge"]);
    expect(state.selectedHooks).toEqual(["secret-shield", "write-guard", "quality-judge"]);
  });

  test("ignores unsupported detected pack and falls back", () => {
    const state = createInitialWizardState({
      availablePackIds: ["python-fastapi", "python-uv"],
      fallbackPackId: "python-fastapi",
      detectedPackId: "rails",
      packDefaults: {
        "python-fastapi": {
          skills: ["owner/python@fastapi"],
          hooks: ["secret-shield", "tool-policy"]
        }
      }
    });

    expect(state.packId).toBe("python-fastapi");
    expect(state.detectedPackId).toBeUndefined();
    expect(state.selectedSkills).toEqual(["owner/python@fastapi"]);
    expect(state.availableHooks).toEqual(["secret-shield", "tool-policy"]);
  });

  test("steps through the happy path", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "NEXT" });
    expect(state.step).toBe("Skills");

    state = wizardReducer(state, { type: "NEXT" });
    expect(state.step).toBe("Hooks");

    state = wizardReducer(state, { type: "NEXT" });
    expect(state.step).toBe("Learn");

    state = wizardReducer(state, { type: "NEXT" });
    expect(state.step).toBe("Review");

    state = wizardReducer(state, { type: "START_WRITING" });
    expect(state.step).toBe("Writing");

    state = wizardReducer(state, {
      type: "WRITE_DONE",
      message: "Wrote files",
      installResults: []
    });
    expect(state.step).toBe("Done");
    expect(state.writeStatus).toEqual({
      ok: true,
      message: "Wrote files"
    });
  });

  test("backs up from review to stack and ignores back at stack", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    expect(state.step).toBe("Review");

    state = wizardReducer(state, { type: "BACK" });
    expect(state.step).toBe("Learn");

    state = wizardReducer(state, { type: "BACK" });
    expect(state.step).toBe("Hooks");

    state = wizardReducer(state, { type: "BACK" });
    expect(state.step).toBe("Skills");

    state = wizardReducer(state, { type: "BACK" });
    expect(state.step).toBe("Stack");

    state = wizardReducer(state, { type: "BACK" });
    expect(state.step).toBe("Stack");
  });

  test("writing and done ignore back", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "START_WRITING" });
    state = wizardReducer(state, { type: "BACK" });

    expect(state.step).toBe("Writing");

    state = wizardReducer(state, {
      type: "WRITE_DONE",
      message: "done",
      installResults: []
    });
    state = wizardReducer(state, { type: "BACK" });

    expect(state.step).toBe("Done");
  });

  test("toggles skills", () => {
    let state = initialState();

    state = wizardReducer(state, {
      type: "TOGGLE_SKILL",
      ref: "wshobson/agents@python-code-style"
    });
    expect(state.selectedSkills).toEqual(["wshobson/agents@python-project-structure"]);

    state = wizardReducer(state, {
      type: "TOGGLE_SKILL",
      ref: "wshobson/agents@python-code-style"
    });
    expect(state.selectedSkills).toEqual([
      "wshobson/agents@python-project-structure",
      "wshobson/agents@python-code-style"
    ]);
  });

  test("toggles hooks", () => {
    let state = initialState();

    state = wizardReducer(state, {
      type: "TOGGLE_HOOK",
      hook: "verb-runner"
    });
    expect(state.selectedHooks).toEqual([
      "secret-shield",
      "tool-policy",
      "write-guard",
      "quality-judge",
      "stop-judge"
    ]);

    state = wizardReducer(state, {
      type: "TOGGLE_HOOK",
      hook: "verb-runner"
    });
    expect(state.selectedHooks).toEqual([
      "secret-shield",
      "tool-policy",
      "write-guard",
      "quality-judge",
      "stop-judge",
      "verb-runner"
    ]);
  });

  test("toggles learn", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "TOGGLE_LEARN" });
    expect(state.learnEnabled).toBe(true);

    state = wizardReducer(state, { type: "TOGGLE_LEARN" });
    expect(state.learnEnabled).toBe(false);
  });

  test("ignores stale skill search results by query", () => {
    const pythonResult: SkillSearchResult = {
      skillId: "python-code-style",
      name: "Python Code Style",
      installs: 100,
      source: "wshobson/agents"
    };

    const fastapiResult: SkillSearchResult = {
      skillId: "fastapi-patterns",
      name: "FastAPI Patterns",
      installs: 50,
      source: "wshobson/agents"
    };

    let state = initialState();

    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "SET_SKILL_QUERY", query: "python" });
    state = wizardReducer(state, { type: "SKILL_SEARCH_STARTED", query: "python" });
    expect(state.skillSearchStatus).toBe("loading");

    state = wizardReducer(state, { type: "SET_SKILL_QUERY", query: "fastapi" });
    state = wizardReducer(state, {
      type: "SKILL_SEARCH_SUCCEEDED",
      query: "python",
      results: [pythonResult]
    });

    expect(state.skillResults).toEqual([]);
    expect(state.skillSearchStatus).toBe("loading");

    state = wizardReducer(state, { type: "SKILL_SEARCH_STARTED", query: "fastapi" });
    state = wizardReducer(state, {
      type: "SKILL_SEARCH_SUCCEEDED",
      query: "fastapi",
      results: [fastapiResult]
    });

    expect(state.skillSearchStatus).toBe("ready");
    expect(state.skillResults).toEqual([fastapiResult]);
  });

  test("ignores stale skill search failures by query", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "SET_SKILL_QUERY", query: "python" });
    state = wizardReducer(state, { type: "SKILL_SEARCH_STARTED", query: "python" });
    state = wizardReducer(state, { type: "SET_SKILL_QUERY", query: "fastapi" });
    state = wizardReducer(state, {
      type: "SKILL_SEARCH_FAILED",
      query: "python",
      error: "stale failure"
    });

    expect(state.skillSearchStatus).toBe("loading");
    expect(state.skillSearchError).toBeUndefined();

    state = wizardReducer(state, { type: "SKILL_SEARCH_STARTED", query: "fastapi" });
    state = wizardReducer(state, {
      type: "SKILL_SEARCH_FAILED",
      query: "fastapi",
      error: "current failure"
    });

    expect(state.skillSearchStatus).toBe("error");
    expect(state.skillSearchError).toBe("current failure");
  });

  test("blank skill query clears search state", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "SET_SKILL_QUERY", query: "python" });
    state = wizardReducer(state, { type: "SKILL_SEARCH_STARTED", query: "python" });
    state = wizardReducer(state, {
      type: "SKILL_SEARCH_SUCCEEDED",
      query: "python",
      results: [
        {
          skillId: "python-code-style",
          name: "Python Code Style",
          installs: 100,
          source: "wshobson/agents"
        }
      ]
    });

    expect(state.skillSearchStatus).toBe("ready");
    expect(state.skillResults).toHaveLength(1);

    state = wizardReducer(state, { type: "SET_SKILL_QUERY", query: "   " });

    expect(state.skillQuery).toBe("   ");
    expect(state.skillSearchStatus).toBe("idle");
    expect(state.skillResults).toEqual([]);
    expect(state.skillSearchError).toBeUndefined();
  });

  test("selecting a pack resets skills hooks and search state", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "SET_SKILL_QUERY", query: "python" });
    state = wizardReducer(state, { type: "SKILL_SEARCH_STARTED", query: "python" });
    state = wizardReducer(state, { type: "TOGGLE_HOOK", hook: "verb-runner" });

    state = wizardReducer(state, {
      type: "SELECT_PACK",
      packId: "python-uv",
      skills: ["owner/repo@skill"],
      hooks: ["secret-shield"]
    });

    expect(state.packId).toBe("python-uv");
    expect(state.skillQuery).toBe("");
    expect(state.skillResults).toEqual([]);
    expect(state.selectedSkills).toEqual(["owner/repo@skill"]);
    expect(state.availableHooks).toEqual(["secret-shield"]);
    expect(state.selectedHooks).toEqual(["secret-shield"]);
    expect(state.skillSearchStatus).toBe("idle");
  });

  test("selecting a pack preserves detected metadata", () => {
    let state = createInitialWizardState({
      availablePackIds: ["python-fastapi", "rails"],
      fallbackPackId: "python-fastapi",
      detectedPackId: "rails",
      packDefaults: {
        "python-fastapi": {
          skills: ["owner/python@fastapi"],
          hooks: ["secret-shield"]
        },
        rails: {
          skills: ["owner/rails@patterns"],
          hooks: ["secret-shield", "tool-policy"]
        }
      }
    });

    state = wizardReducer(state, {
      type: "SELECT_PACK",
      packId: "python-fastapi",
      skills: ["owner/python@fastapi"],
      hooks: ["secret-shield"]
    });

    expect(state.packId).toBe("python-fastapi");
    expect(state.detectedPackId).toBe("rails");
    expect(state.selectedSkills).toEqual(["owner/python@fastapi"]);
    expect(state.selectedHooks).toEqual(["secret-shield"]);
  });

  test("start writing is ignored outside review", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "START_WRITING" });

    expect(state.step).toBe("Stack");
  });

  test("write completion events are ignored outside writing", () => {
    let state = initialState();

    state = wizardReducer(state, {
      type: "WRITE_DONE",
      message: "done",
      installResults: []
    });

    expect(state.step).toBe("Stack");
    expect(state.writeStatus).toBeUndefined();

    state = wizardReducer(state, {
      type: "WRITE_FAILED",
      message: "failed"
    });

    expect(state.step).toBe("Stack");
    expect(state.writeStatus).toBeUndefined();
  });

  test("write failure transitions to done with failure status", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "START_WRITING" });
    state = wizardReducer(state, { type: "WRITE_FAILED", message: "disk full" });

    expect(state.step).toBe("Done");
    expect(state.writeStatus).toEqual({
      ok: false,
      message: "disk full"
    });
    expect(state.installResults).toEqual([]);
  });

  const recommendations = [{ ref: "owner/repo@skill", name: "skill", installs: 5, reason: "fits" }];
  const adviseInput = {
    availablePackIds: ["python-fastapi", "python-uv"],
    defaultPackId: "python-fastapi",
    defaultSkills,
    defaultHooks,
    contextText: "a billing service",
    contextSource: "detected:PRP.md",
    adviseBackend: "claude" as const
  };

  function adviseRunningState(): WizardState {
    const state = wizardReducer(createInitialWizardState(adviseInput), { type: "TOGGLE_ADVISE" });
    return wizardReducer(state, { type: "ADVISE_STARTED" });
  }

  test("advise starts disabled and idle, and carries context metadata", () => {
    const state = initialState();

    expect(state.adviseEnabled).toBe(false);
    expect(state.adviseStatus).toBe("idle");
    expect(state.recommendations).toEqual([]);
    expect(state.contextText).toBeUndefined();
    expect(adviseRunningState().contextSource).toBe("detected:PRP.md");
  });

  test("advise auto-start enables the toggle only when context and backend are both present", () => {
    expect(createInitialWizardState({ ...adviseInput, adviseAutoStart: true }).adviseEnabled).toBe(true);
    expect(createInitialWizardState({ ...adviseInput, adviseAutoStart: true, adviseBackend: undefined }).adviseEnabled).toBe(false);
    expect(createInitialWizardState({ ...adviseInput, adviseAutoStart: true, contextText: undefined }).adviseEnabled).toBe(false);
    expect(createInitialWizardState(adviseInput).adviseEnabled).toBe(false);
  });

  test("advise events are ignored unless enabled and running", () => {
    const staleEvents = [
      { type: "ADVISE_STARTED" } as const,
      { type: "ADVISE_SUCCEEDED", recommendations } as const,
      { type: "ADVISE_FAILED", error: "backend down" } as const
    ];

    for (const event of staleEvents) {
      const state = wizardReducer(initialState(), event);
      expect(state.adviseStatus).toBe("idle");
      expect(state.recommendations).toEqual([]);
    }
  });

  test("advise success lands while running, then toggling off resets results", () => {
    let state = wizardReducer(adviseRunningState(), { type: "ADVISE_SUCCEEDED", recommendations });
    expect(state.adviseStatus).toBe("ready");
    expect(state.recommendations).toEqual(recommendations);

    state = wizardReducer(state, { type: "TOGGLE_ADVISE" });
    expect(state.adviseEnabled).toBe(false);
    expect(state.adviseStatus).toBe("idle");
    expect(state.recommendations).toEqual([]);
  });

  test("advise failure while running records the error", () => {
    const state = wizardReducer(adviseRunningState(), { type: "ADVISE_FAILED", error: "backend down" });
    expect(state.adviseStatus).toBe("error");
    expect(state.adviseError).toBe("backend down");
  });

  test("selecting a pack resets advise results but keeps the toggle and context", () => {
    let state = wizardReducer(adviseRunningState(), { type: "ADVISE_SUCCEEDED", recommendations });
    state = wizardReducer(state, { type: "SELECT_PACK", packId: "python-uv", skills: [], hooks: [] });

    expect(state.adviseEnabled).toBe(true);
    expect(state.adviseStatus).toBe("idle");
    expect(state.recommendations).toEqual([]);
    expect(state.contextText).toBe("a billing service");
  });
});
