import { expect, test } from "bun:test";
import type { AdviceReport } from "../src/engine/advice-types";
import { advicePlanPreviewLines } from "../src/tui/AdviceApplyFlow";
import {
  adjacentAdviceRecommendationIndex,
  adviceBackendControlLabel,
  adviceDecisionSummary,
  adviceSetupControls,
  adviceSkillCreationRequest,
  createAdviceWizardActions,
  formatAdviceTuiReportLines,
  isAdviceCancelKey,
  runAdviceWizard
} from "../src/tui/advise-app";
import {
  adjacentAdviceLookback,
  adjacentAvailableAdviceBackend,
  adviceTuiReducer,
  createInitialAdviceTuiState,
  initialAdviceBackend
} from "../src/tui/advise-machine";
import type { ProjectAdviceInput } from "../src/engine/project-advice";

const bothAvailable = { claude: true, codex: true };

function emptyReport(backend: "claude" | "codex", model?: string): AdviceReport {
  return {
    schemaVersion: 1,
    targetDir: "/tmp/example",
    backend,
    ...(model ? { model } : {}),
    reportOnly: true,
    sessions: { mode: "none", lookback: "7d", included: false, sources: [], evidence: [] },
    profile: {
      targetDir: "/tmp/example",
      stacks: ["ts-base"],
      languages: ["TypeScript"],
      tests: [],
      ci: [],
      services: [],
      structure: [],
      configuration: {},
      evidence: []
    },
    recommendations: [],
    coverage: [{ category: "guidance", status: "no-strong-evidence", reason: "No supported recommendation." }],
    notes: []
  };
}

test("advice TUI cycles bounded windows and scopes while surfacing running progress", () => {
  let state = createInitialAdviceTuiState(3, bothAvailable);
  expect(state.includeSessions).toBe(true);
  expect(state.lookback).toBe("7d");
  expect(adjacentAdviceLookback("7d", 1)).toBe("14d");
  expect(adjacentAdviceLookback("7d", -1)).toBe("all");

  state = adviceTuiReducer(state, { type: "SET_LOOKBACK", lookback: "14d" });
  state = adviceTuiReducer(state, { type: "CYCLE_SCOPE" });
  expect(state.lookback).toBe("14d");
  expect(state.scope).toBe("guidance");

  state = adviceTuiReducer(state, { type: "START" });
  state = adviceTuiReducer(state, { type: "PROGRESS", message: "Profiling project structure…" });
  state = adviceTuiReducer(state, { type: "PROGRESS", message: "Finding exact-project sessions…" });
  expect(state.status).toBe("running");
  expect(state.progress).toBe("Finding exact-project sessions…");
  expect(state.progressHistory).toEqual([
    "Starting Claude analysis…",
    "Profiling project structure…",
    "Finding exact-project sessions…"
  ]);
});

test("advice TUI retains the completed report until the user resets or exits", () => {
  const report = emptyReport("codex");
  let state = adviceTuiReducer(createInitialAdviceTuiState(0, bothAvailable), { type: "START" });
  state = adviceTuiReducer(state, { type: "SUCCEEDED", report });

  expect(state.status).toBe("done");
  expect(state.report).toBe(report);
  expect(formatAdviceTuiReportLines(report)).toContain("Recommendations");
  expect(formatAdviceTuiReportLines(report)).toContain("Coverage");

  state = adviceTuiReducer(state, { type: "RESET" });
  expect(state.status).toBe("ready");
  expect(state.report).toBeUndefined();
});

test("reasoning backend selection prefers Claude and cycles only through available backends", () => {
  expect(initialAdviceBackend(bothAvailable)).toBe("claude");
  expect(adjacentAvailableAdviceBackend("claude", bothAvailable, 1)).toBe("codex");
  expect(adjacentAvailableAdviceBackend("codex", bothAvailable, 1)).toBe("claude");
  expect(adjacentAvailableAdviceBackend("claude", bothAvailable, -1)).toBe("codex");

  const claudeOnly = { claude: true, codex: false };
  expect(initialAdviceBackend(claudeOnly)).toBe("claude");
  expect(adjacentAvailableAdviceBackend("claude", claudeOnly, 1)).toBe("claude");
  expect(adviceBackendControlLabel("claude", claudeOnly)).toContain("Codex unavailable");

  const codexOnly = { claude: false, codex: true };
  expect(initialAdviceBackend(codexOnly)).toBe("codex");
  expect(adjacentAvailableAdviceBackend("codex", codexOnly, -1)).toBe("codex");
  expect(adviceBackendControlLabel("codex", codexOnly)).toContain("Claude unavailable");

  const unavailable = { claude: false, codex: false };
  expect(initialAdviceBackend(unavailable)).toBeUndefined();
  expect(adjacentAvailableAdviceBackend("claude", unavailable, 1)).toBeUndefined();
  expect(() => createInitialAdviceTuiState(0, unavailable)).toThrow("No reasoning backend is available");
  expect(adviceSetupControls).toEqual(["backend", "sessions", "lookback", "scope", "analyze"]);
});

test("advice wizard preserves the actionable no-backend startup failure", async () => {
  const messages: string[] = [];
  const outcome = await runAdviceWizard("/tmp/example", {
    probeAvailability: async () => ({ claude: false, codex: false }),
    log: (message) => messages.push(message)
  });

  expect(outcome).toBe("cancel");
  expect(messages).toEqual(["farrier advise: no agent backend found. Install claude or codex."]);
});

test("reasoning backend state rejects unavailable values and survives errors and option resets", () => {
  let state = createInitialAdviceTuiState(0, bothAvailable);
  state = adviceTuiReducer(state, { type: "SET_BACKEND", backend: "codex" });
  state = adviceTuiReducer(state, { type: "START" });
  state = adviceTuiReducer(state, { type: "FAILED", error: "codex backend unavailable" });
  state = adviceTuiReducer(state, { type: "RESET" });
  expect(state.backend).toBe("codex");
  state = adviceTuiReducer(state, { type: "SET_BACKEND", backend: "claude" });
  expect(state.backend).toBe("claude");

  const claudeOnly = createInitialAdviceTuiState(0, { claude: true, codex: false });
  expect(adviceTuiReducer(claudeOnly, { type: "SET_BACKEND", backend: "codex" }).backend).toBe("claude");
});

test("advice wizard actions resolve fresh analysis settings for the selected backend", async () => {
  const calls: ProjectAdviceInput[] = [];
  const actions = createAdviceWizardActions(
    {
      targetDir: "/tmp/example",
      models: {
        claude: { advise: { model: "claude-advise" } },
        codex: { advise: { model: "codex-advise", reasoningEffort: "high" } }
      },
      signal: new AbortController().signal
    },
    {
      isBackendAvailable: async () => true,
      advise: async (input) => {
        calls.push(input);
        return emptyReport(input.backend, input.model);
      }
    }
  );

  const codexReport = await actions.onRun("codex", true, "14d", "hooks", () => undefined);
  await actions.onRun("claude", false, "7d", "all", () => undefined);
  await actions.onRun("codex", false, "all", "all", () => undefined);

  expect(codexReport.backend).toBe("codex");
  expect(calls.map(({ backend, model, reasoningEffort }) => ({ backend, model, reasoningEffort }))).toEqual([
    { backend: "codex", model: "codex-advise", reasoningEffort: "high" },
    { backend: "claude", model: "claude-advise", reasoningEffort: undefined },
    { backend: "codex", model: "codex-advise", reasoningEffort: "high" }
  ]);
  expect(calls[0]?.targets).toEqual(["codex"]);
  expect(calls[0]?.only).toEqual(["hooks"]);
  expect(calls[1]?.sessions).toBe("none");
});

test("advice wizard actions fail on the selected unavailable backend without fallback", async () => {
  let invoked = false;
  const actions = createAdviceWizardActions(
    { targetDir: "/tmp/example", models: {}, signal: new AbortController().signal },
    {
      isBackendAvailable: async (backend) => backend === "claude",
      advise: async () => {
        invoked = true;
        return emptyReport("claude");
      }
    }
  );

  await expect(actions.onRun("codex", false, "7d", "all", () => undefined)).rejects.toThrow(
    "Selected Codex reasoning backend is unavailable"
  );
  expect(invoked).toBe(false);
});

test("advice planning follows the report backend and resolves that backend's settings", async () => {
  const planningCalls: Array<{ backend: string; model?: string; reasoningEffort?: string }> = [];
  const plan = { recommendationId: "hooks:verify", summary: "Add the verified hook.", files: [] };
  const actions = createAdviceWizardActions(
    {
      targetDir: "/tmp/example",
      models: {
        claude: { advise: "claude-plan" },
        codex: { advise: { model: "codex-plan", reasoningEffort: "xhigh" } }
      },
      signal: new AbortController().signal
    },
    {
      isBackendAvailable: async () => true,
      plan: async (input) => {
        planningCalls.push({ backend: input.backend, model: input.model, reasoningEffort: input.reasoningEffort });
        return plan;
      },
      inspect: async () => ({
        targetDir: "/tmp/example",
        existingHarness: false,
        files: [],
        counts: { create: 0, unchanged: 0, merge: 0, update: 0, replace: 0, blocked: 0 },
        replacementPaths: [],
        replacements: [],
        blockers: []
      })
    }
  );
  const recommendation = {
    id: "hooks:verify",
    category: "hooks",
    targetVendors: ["claude", "codex"],
    reason: "Verification is repeated.",
    benefit: "Verification becomes reliable.",
    evidence: ["project:root"],
    confidence: "high",
    implementationRoute: { id: "hooks:shared-policy", description: "Configure shared hooks." }
  } satisfies AdviceReport["recommendations"][number];

  await actions.onPlan(emptyReport("codex"), recommendation);
  await actions.onPlan(emptyReport("claude"), recommendation);

  expect(planningCalls).toEqual([
    { backend: "codex", model: "codex-plan", reasoningEffort: "xhigh" },
    { backend: "claude", model: "claude-plan", reasoningEffort: undefined }
  ]);
});

test("Create all resolves fresh report-backend settings for file and skill jobs without target leakage", async () => {
  const fileCalls: Array<{ backend: string; model?: string; reasoningEffort?: string }> = [];
  const skillCalls: Array<{ backend: string; mode: string; model?: string; reasoningEffort?: string; agents: string[] }> = [];
  const prepared: string[] = [];
  let configRead = 0;
  const configurations = [
    {
      codex: {
        advise: { model: "codex-plan-v1", reasoningEffort: "high" as const },
        skillCreation: { model: "codex-skill-v1", reasoningEffort: "xhigh" as const }
      }
    },
    {
      codex: {
        advise: { model: "codex-plan-v2", reasoningEffort: "medium" as const },
        skillCreation: { model: "codex-skill-v2", reasoningEffort: "low" as const }
      }
    },
    {
      claude: { advise: "claude-plan", skillCreation: "claude-skill" }
    }
  ];
  const actions = createAdviceWizardActions(
    {
      targetDir: "/tmp/example",
      signal: new AbortController().signal,
      loadModels: async () => configurations[configRead++] ?? {}
    },
    {
      isBackendAvailable: async () => true,
      prepareSkillCreator: async (backend) => {
        prepared.push(backend);
        return undefined;
      },
      plan: async (input) => {
        fileCalls.push({ backend: input.backend, model: input.model, reasoningEffort: input.reasoningEffort });
        return {
          recommendationId: input.recommendation.id,
          summary: "Plan one file.",
          files: [{ path: `${input.recommendation.id}.md`, content: input.recommendation.id, purpose: "test" }]
        };
      },
      planSkill: async (input) => {
        skillCalls.push({
          backend: input.report.backend,
          mode: input.request.mode,
          model: input.modelSettings.model,
          reasoningEffort: input.modelSettings.reasoningEffort,
          agents: input.request.agents
        });
        return {
          recommendationId: input.recommendation.id,
          summary: "Author one skill.",
          files: [{ path: `.agents/skills/${input.recommendation.id}/SKILL.md`, content: input.recommendation.id, purpose: "skill" }]
        };
      },
      inspect: async (targetDir, plan) => ({
        targetDir,
        existingHarness: false,
        files: plan.files.map((file) => ({ path: file.path, action: "create", purpose: file.purpose, reason: "missing", requiresForce: false, exists: false })),
        counts: { create: plan.files.length, unchanged: 0, merge: 0, update: 0, replace: 0, blocked: 0 },
        replacementPaths: [],
        replacements: [],
        blockers: []
      })
    }
  );
  const fileRecommendation = {
    id: "hooks:verify",
    category: "hooks",
    targetVendors: ["claude"],
    reason: "Verification is repeated.",
    benefit: "Verification becomes reliable.",
    evidence: ["session:claude"],
    confidence: "high",
    implementationRoute: { id: "hooks:claude-settings", description: "Configure a Claude hook." }
  } satisfies AdviceReport["recommendations"][number];
  const skillRecommendation = {
    ...fileRecommendation,
    id: "skills:verify-helper",
    category: "skills",
    implementationRoute: { id: "skills:agents-shared", description: "Create a shared skill." }
  } satisfies AdviceReport["recommendations"][number];
  const codexReport = emptyReport("codex");
  codexReport.sessions = {
    mode: "auto",
    lookback: "7d",
    included: true,
    sources: [{ source: "claude", count: 4 }],
    evidence: []
  };
  codexReport.recommendations = [fileRecommendation, skillRecommendation];
  await actions.onPlanBatch(codexReport, undefined, new AbortController().signal, () => undefined);
  await actions.onPlanBatch(codexReport, undefined, new AbortController().signal, () => undefined);
  const claudeReport = { ...codexReport, backend: "claude" as const };
  await actions.onPlanBatch(claudeReport, undefined, new AbortController().signal, () => undefined);

  expect(configRead).toBe(3);
  expect(fileCalls).toEqual([
    { backend: "codex", model: "codex-plan-v1", reasoningEffort: "high" },
    { backend: "codex", model: "codex-plan-v2", reasoningEffort: "medium" },
    { backend: "claude", model: "claude-plan", reasoningEffort: undefined }
  ]);
  expect(skillCalls).toEqual([
    { backend: "codex", mode: "author-codex", model: "codex-skill-v1", reasoningEffort: "xhigh", agents: ["claude"] },
    { backend: "codex", mode: "author-codex", model: "codex-skill-v2", reasoningEffort: "low", agents: ["claude"] },
    { backend: "claude", mode: "author-claude", model: "claude-skill", reasoningEffort: undefined, agents: ["claude"] }
  ]);
  expect(prepared).toEqual(["codex", "codex", "claude"]);
});

test("advice TUI treats Ctrl+C, q, and Escape as cancellation keys", () => {
  expect(isAdviceCancelKey({ name: "c", ctrl: true })).toBe(true);
  expect(isAdviceCancelKey({ name: "q" })).toBe(true);
  expect(isAdviceCancelKey({ name: "escape" })).toBe(true);
  expect(isAdviceCancelKey({ name: "c" })).toBe(false);
});

test("advice report selection clamps and skill recommendations prefill the creator", () => {
  expect(adjacentAdviceRecommendationIndex(0, 3, 1)).toBe(1);
  expect(adjacentAdviceRecommendationIndex(2, 3, 1)).toBe(2);
  expect(adjacentAdviceRecommendationIndex(0, 3, -1)).toBe(0);
  const recommendation = {
    id: "skills:verification-helper",
    category: "skills",
    targetVendors: ["claude", "codex"],
    reason: "Package the repeated verification workflow.",
    benefit: "Makes the workflow reusable without explaining it again in every session.",
    evidence: ["project:root"],
    confidence: "high",
    implementationRoute: { id: "skills:agents-shared", description: "Create a shared skill." }
  } satisfies AdviceReport["recommendations"][number];
  const request = adviceSkillCreationRequest("codex", recommendation);
  expect(request.mode).toBe("author-codex");
  expect(request.nameOverride).toBe("verification-helper");
  expect(request.description).toContain("Makes the workflow reusable");
  expect(request.description).toContain("Create a shared skill.");
});

test("advice report selection explains why the recommendation is useful before creation", () => {
  const recommendation = {
    id: "hooks:verify-before-done",
    category: "hooks",
    targetVendors: ["claude"],
    reason: "Sessions repeatedly run the same verification command before declaring work complete.",
    benefit: "Prevents missed checks and removes a repeated manual step.",
    evidence: ["session:verification", "project:commands"],
    confidence: "high",
    implementationRoute: { id: "hooks:claude-settings", description: "Create a declarative Claude Stop hook." }
  } satisfies AdviceReport["recommendations"][number];
  const report = {
    schemaVersion: 1,
    targetDir: "/tmp/example",
    backend: "claude",
    reportOnly: true,
    sessions: {
      mode: "auto",
      lookback: "7d",
      included: true,
      sources: [{ source: "claude", count: 3 }],
      evidence: [{ id: "session:verification", source: "claude", kind: "verification", summary: "Repeated `bun test` before completion." }]
    },
    profile: {
      targetDir: "/tmp/example",
      stacks: ["ts-base"],
      languages: ["TypeScript"],
      tests: ["tests/example.test.ts"],
      ci: [],
      services: [],
      structure: [],
      configuration: {},
      evidence: [{ id: "project:commands", source: "project", kind: "commands", summary: "test command: bun test", path: "package.json" }]
    },
    recommendations: [recommendation],
    coverage: [{ category: "hooks", status: "recommended", reason: "Repeated verification evidence." }],
    notes: []
  } satisfies AdviceReport;

  expect(adviceDecisionSummary(report, recommendation)).toEqual({
    why: recommendation.reason,
    benefit: recommendation.benefit,
    evidence: "claude: Repeated `bun test` before completion. · +1 more",
    creates: recommendation.implementationRoute.description
  });
});

test("advice creation preview wraps every line for complete paged inspection", () => {
  expect(advicePlanPreviewLines("abcdefgh\n\nxyz", 4)).toEqual(["abcd", "efgh", " ", "xyz"]);
});
