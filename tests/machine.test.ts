import { describe, expect, test } from "bun:test";
import type { SkillSearchResult } from "../src/engine/skills";
import type { HookId, SkillRef } from "../src/packs/types";
import { createInitialWizardState, cycleAgents, wizardReducer, type WizardState } from "../src/tui/machine";

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

// Past the Agent step with a pack explicitly picked — nothing is preselected
// without detection, so navigation tests must choose a stack before advancing.
function stackedState(): WizardState {
  const afterAgent = wizardReducer(initialState(), { type: "NEXT" });
  return wizardReducer(afterAgent, {
    type: "SELECT_PACK",
    packId: "python-fastapi",
    skills: defaultSkills,
    hooks: defaultHooks
  });
}

describe("wizard machine", () => {
  test("opens on the agent step with no stack preselected when detection is empty", () => {
    const state = initialState();

    expect(state.step).toBe("Agent");
    expect(state.packId).toBe("");
    expect(state.detectedPackId).toBeUndefined();
    expect(state.availablePackIds).toEqual(["python-fastapi", "python-uv"]);
    expect(state.selectedSkills).toEqual([]);
    expect(state.availableHooks).toEqual([]);
    expect(state.selectedHooks).toEqual([]);
    expect(state.agents).toEqual(["claude"]);
    expect(state.shareSkillsWithOtherAgent).toBe(false);
    expect(state.learnEnabled).toBe(false);
    expect(state.skillSearchStatus).toBe("idle");
  });

  test("no-detection stack cannot advance until a pack is explicitly picked", () => {
    let state = wizardReducer(initialState(), { type: "NEXT" });
    expect(state.step).toBe("Stack");

    // No pack selected yet: NEXT is a no-op on the stack step.
    const blocked = wizardReducer(state, { type: "NEXT" });
    expect(blocked).toBe(state);
    expect(blocked.step).toBe("Stack");

    state = wizardReducer(state, { type: "SELECT_PACK", packId: "python-uv", skills: [], hooks: [] });
    state = wizardReducer(state, { type: "NEXT" });
    expect(state.step).toBe("Skills");
  });

  test("selects the agent target from the agent step", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "SELECT_AGENTS", agents: ["codex"] });
    expect(state.agents).toEqual(["codex"]);

    state = wizardReducer(state, { type: "SELECT_AGENTS", agents: ["codex", "claude"] });
    expect(state.agents).toEqual(["claude", "codex"]);
  });

  test("an unambiguous startup pick skips the agent step and back on Stack stays put", () => {
    const state = createInitialWizardState({
      availablePackIds: ["python-fastapi", "python-uv"],
      defaultPackId: "python-fastapi",
      defaultAgents: ["codex"],
      skipAgentStep: true
    });

    expect(state.step).toBe("Stack");
    expect(state.agentStepSkipped).toBe(true);
    expect(state.agents).toEqual(["codex"]);

    // Stack is now the first step: the reducer refuses to reopen Agent; the
    // app-level back handler leaves the wizard instead.
    const backed = wizardReducer(state, { type: "BACK" });
    expect(backed).toBe(state);

    // Walking back from deeper steps still stops at Stack, never at Agent.
    let deeper = wizardReducer(state, { type: "SELECT_PACK", packId: "python-uv", skills: [], hooks: [] });
    deeper = wizardReducer(deeper, { type: "NEXT" });
    expect(deeper.step).toBe("Skills");
    deeper = wizardReducer(deeper, { type: "BACK" });
    expect(deeper.step).toBe("Stack");
    expect(wizardReducer(deeper, { type: "BACK" }).step).toBe("Stack");
  });

  test("skipAgentStep without a startup pick still opens on the agent step", () => {
    const state = createInitialWizardState({
      availablePackIds: ["python-fastapi"],
      defaultPackId: "python-fastapi",
      skipAgentStep: true
    });

    expect(state.step).toBe("Agent");
    expect(state.agentStepSkipped).toBe(false);
  });

  test("cycleAgents walks the same three choices the agent step offers", () => {
    expect(cycleAgents(["claude"])).toEqual(["codex"]);
    expect(cycleAgents(["codex"])).toEqual(["claude", "codex"]);
    expect(cycleAgents(["claude", "codex"])).toEqual(["claude"]);
    // Order-insensitive input, canonical output.
    expect(cycleAgents(["codex", "claude"])).toEqual(["claude"]);
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

    expect(state.step).toBe("Agent");
    expect(state.packId).toBe("rails");
    expect(state.detectedPackId).toBe("rails");
    expect(state.selectedSkills).toEqual(["owner/rails@patterns"]);
    expect(state.availableHooks).toEqual(["secret-shield", "write-guard", "quality-judge"]);
    expect(state.selectedHooks).toEqual(["secret-shield", "write-guard", "quality-judge"]);
  });

  test("ignores an unsupported detected pack and preselects nothing", () => {
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

    expect(state.packId).toBe("");
    expect(state.detectedPackId).toBeUndefined();
    expect(state.selectedSkills).toEqual([]);
    expect(state.availableHooks).toEqual([]);
  });

  test("steps through the happy path", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "NEXT" });
    expect(state.step).toBe("Stack");

    state = wizardReducer(state, { type: "SELECT_PACK", packId: "python-fastapi", skills: defaultSkills, hooks: defaultHooks });
    state = wizardReducer(state, { type: "NEXT" });
    expect(state.step).toBe("Skills");

    state = wizardReducer(state, { type: "NEXT" });
    expect(state.step).toBe("Create");

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

  test("backs up from review to agent and ignores back at agent", () => {
    let state = stackedState();

    state = wizardReducer(state, { type: "NEXT" });
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
    expect(state.step).toBe("Create");

    state = wizardReducer(state, { type: "BACK" });
    expect(state.step).toBe("Skills");

    state = wizardReducer(state, { type: "BACK" });
    expect(state.step).toBe("Stack");

    state = wizardReducer(state, { type: "BACK" });
    expect(state.step).toBe("Agent");

    state = wizardReducer(state, { type: "BACK" });
    expect(state.step).toBe("Agent");
  });

  test("writing and done ignore back", () => {
    let state = stackedState();

    state = wizardReducer(state, { type: "NEXT" });
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

  test("queues and removes create requests, and write-done carries outcomes", () => {
    let state = initialState();
    expect(state.createRequests).toEqual([]);
    expect(state.createOutcomes).toEqual([]);

    const request = {
      description: "Mask PII before sending text out",
      agents: ["claude" as const, "codex" as const],
      mode: "author-claude" as const
    };

    state = wizardReducer(state, { type: "ADD_CREATE_REQUEST", request });
    state = wizardReducer(state, {
      type: "ADD_CREATE_REQUEST",
      request: { ...request, description: "Second skill", mode: "per-agent" as const }
    });
    expect(state.createRequests).toHaveLength(2);

    state = wizardReducer(state, { type: "REMOVE_CREATE_REQUEST", index: 0 });
    expect(state.createRequests).toHaveLength(1);
    expect(state.createRequests[0]?.description).toBe("Second skill");

    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "SELECT_PACK", packId: "python-fastapi", skills: defaultSkills, hooks: defaultHooks });
    for (let i = 0; i < 5; i += 1) {
      state = wizardReducer(state, { type: "NEXT" });
    }
    state = wizardReducer(state, { type: "START_WRITING" });

    const outcome = {
      request: state.createRequests[0]!,
      name: "second-skill",
      files: ["skills/second-skill/SKILL.md"],
      installed: true,
      notes: []
    };

    state = wizardReducer(state, { type: "WRITE_DONE", message: "done", installResults: [], createOutcomes: [outcome] });
    expect(state.step).toBe("Done");
    expect(state.createOutcomes).toEqual([outcome]);
  });

  test("toggles skills", () => {
    let state = stackedState();

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
    let state = stackedState();

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

  test("toggles enforcement targets deterministically and never permits an empty selection", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "TOGGLE_AGENT", agent: "codex" });
    expect(state.agents).toEqual(["claude", "codex"]);

    state = wizardReducer(state, { type: "TOGGLE_AGENT", agent: "claude" });
    expect(state.agents).toEqual(["codex"]);

    const unchanged = wizardReducer(state, { type: "TOGGLE_AGENT", agent: "codex" });
    expect(unchanged).toBe(state);
    expect(unchanged.agents).toEqual(["codex"]);
  });

  test("preserves enforcement targets across pack selection and backward navigation", () => {
    let state = createInitialWizardState({
      availablePackIds: ["python-fastapi", "rails"],
      fallbackPackId: "python-fastapi",
      defaultAgents: ["codex"]
    });

    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "SELECT_PACK", packId: "python-fastapi", skills: [], hooks: [] });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    expect(state.step).toBe("Hooks");
    state = wizardReducer(state, { type: "BACK" });
    state = wizardReducer(state, { type: "SELECT_PACK", packId: "rails", skills: [], hooks: ["secret-shield"] });

    expect(state.agents).toEqual(["codex"]);
    expect(state.step).toBe("Create");
  });

  test("toggles learn", () => {
    let state = initialState();

    state = wizardReducer(state, { type: "TOGGLE_LEARN" });
    expect(state.learnEnabled).toBe(true);

    state = wizardReducer(state, { type: "TOGGLE_LEARN" });
    expect(state.learnEnabled).toBe(false);
  });

  test("setting a new context resets suggestions computed from the old one", () => {
    let state: WizardState = {
      ...initialState(),
      contextText: "old brief",
      contextSource: "deterministic-project-profile",
      adviseStatus: "ready",
      adviseError: undefined,
      recommendations: [{ ref: "acme@old-skill", name: "old-skill", installs: 3, reason: "stale" }]
    };

    state = wizardReducer(state, { type: "SET_CONTEXT", text: "We are building a wallet ledger.", source: "text" });

    expect(state.contextText).toBe("We are building a wallet ledger.");
    expect(state.contextSource).toBe("text");
    expect(state.adviseStatus).toBe("idle");
    expect(state.recommendations).toEqual([]);
  });

  test("toggles cross-agent skill install", () => {
    let state = initialState();
    expect(state.shareSkillsWithOtherAgent).toBe(false);

    state = wizardReducer(state, { type: "TOGGLE_SHARE_SKILLS" });
    expect(state.shareSkillsWithOtherAgent).toBe(true);

    state = wizardReducer(state, { type: "TOGGLE_SHARE_SKILLS" });
    expect(state.shareSkillsWithOtherAgent).toBe(false);
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

  test("supports registry hook refs in pack defaults and toggles", () => {
    let state = createInitialWizardState({
      availablePackIds: ["@acme/demo"],
      fallbackPackId: "@acme/demo",
      detectedPackId: "@acme/demo",
      packDefaults: {
        "@acme/demo": {
          skills: [],
          hooks: ["secret-shield", "@acme/guard"]
        }
      }
    });

    expect(state.availableHooks).toEqual(["secret-shield", "@acme/guard"]);
    expect(state.selectedHooks).toEqual(["secret-shield", "@acme/guard"]);

    state = wizardReducer(state, { type: "TOGGLE_HOOK", hook: "@acme/guard" });
    expect(state.selectedHooks).toEqual(["secret-shield"]);
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

    expect(state.step).toBe("Agent");
  });

  test("write completion events are ignored outside writing", () => {
    let state = initialState();

    state = wizardReducer(state, {
      type: "WRITE_DONE",
      message: "done",
      installResults: []
    });

    expect(state.step).toBe("Agent");
    expect(state.writeStatus).toBeUndefined();

    state = wizardReducer(state, {
      type: "WRITE_FAILED",
      message: "failed"
    });

    expect(state.step).toBe("Agent");
    expect(state.writeStatus).toBeUndefined();
  });

  test("write failure transitions to done with failure status", () => {
    let state = stackedState();

    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "NEXT" });
    state = wizardReducer(state, { type: "START_WRITING" });
    state = wizardReducer(state, {
      type: "WRITE_FAILED",
      message: "rollback conflicted",
      mutationState: "rollback-incomplete",
      recoveryPath: ".farrier-staging/backups/recovery",
      remediation: "Run `farrier doctor --dir /tmp/project` before retrying."
    });

    expect(state.step).toBe("Done");
    expect(state.writeStatus).toEqual({
      ok: false,
      message: "rollback conflicted",
      mutationState: "rollback-incomplete",
      recoveryPath: ".farrier-staging/backups/recovery",
      remediation: "Run `farrier doctor --dir /tmp/project` before retrying."
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

  test("advise never starts until the user explicitly enables it", () => {
    expect(createInitialWizardState(adviseInput).adviseEnabled).toBe(false);
    expect(createInitialWizardState({ ...adviseInput, adviseBackend: undefined }).adviseEnabled).toBe(false);
    expect(createInitialWizardState({ ...adviseInput, contextText: undefined }).adviseEnabled).toBe(false);
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
