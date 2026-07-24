import type { AdviseBackend, SkillRecommendation } from "../engine/advise";
import type { SkillCreationOutcome, SkillCreationRequest } from "../engine/create-skill";
import type { ApplyHarnessChangePlanResult } from "../engine/create-plan";
import type { InstallSkillResult, SkillSearchResult } from "../engine/skills";
import { enforcementAgentCombos, normalizeAgents, type EnforcementAgent } from "../engine/agent-selection";
import type { PackHookRef, SkillRef } from "../packs/types";

export type WizardStep = "Agent" | "Stack" | "Skills" | "Create" | "Hooks" | "Learn" | "Review" | "Writing" | "Done";

export type SkillSearchStatus = "idle" | "loading" | "ready" | "error";

export type AdviseStatus = "idle" | "running" | "ready" | "error";

export type PackDefaults = Record<
  string,
  {
    skills: SkillRef[];
    hooks: PackHookRef[];
  }
>;

export type WizardWriteStatus = {
  ok: boolean;
  message: string;
  partial?: boolean;
  mutationState?: "not-started" | "rolled-back" | "rollback-incomplete";
  recoveryPath?: string | null;
  remediation?: string;
};

export type WizardState = {
  step: WizardStep;
  /** Startup pick was unambiguous: the wizard opens on Stack and back from Stack leaves it. */
  agentStepSkipped: boolean;
  packId: string;
  detectedPackId?: string;
  availablePackIds: string[];

  skillQuery: string;
  skillResults: SkillSearchResult[];
  selectedSkills: SkillRef[];
  skillSearchStatus: SkillSearchStatus;
  skillSearchError?: string;

  createRequests: SkillCreationRequest[];
  createOutcomes: SkillCreationOutcome[];

  availableHooks: PackHookRef[];
  selectedHooks: PackHookRef[];
  agents: EnforcementAgent[];
  shareSkillsWithOtherAgent: boolean;

  learnEnabled: boolean;

  contextText?: string;
  contextSource?: string;
  adviseBackend?: AdviseBackend;
  adviseEnabled: boolean;
  adviseStatus: AdviseStatus;
  adviseError?: string;
  recommendations: SkillRecommendation[];

  writeStatus?: WizardWriteStatus;
  applyResult?: ApplyHarnessChangePlanResult;

  installResults: InstallSkillResult[];
};

export type WizardEvent =
  | { type: "SELECT_PACK"; packId: string; skills: SkillRef[]; hooks: PackHookRef[] }
  | { type: "SET_SKILL_QUERY"; query: string }
  | { type: "SKILL_SEARCH_STARTED"; query: string }
  | { type: "SKILL_SEARCH_SUCCEEDED"; query: string; results: SkillSearchResult[] }
  | { type: "SKILL_SEARCH_FAILED"; query: string; error: string }
  | { type: "TOGGLE_SKILL"; ref: SkillRef }
  | { type: "ADD_CREATE_REQUEST"; request: SkillCreationRequest }
  | { type: "REMOVE_CREATE_REQUEST"; index: number }
  | { type: "TOGGLE_HOOK"; hook: PackHookRef }
  | { type: "SELECT_AGENTS"; agents: EnforcementAgent[] }
  | { type: "TOGGLE_AGENT"; agent: EnforcementAgent }
  | { type: "TOGGLE_SHARE_SKILLS" }
  | { type: "TOGGLE_LEARN" }
  | { type: "SET_CONTEXT"; text: string; source: string }
  | { type: "TOGGLE_ADVISE" }
  | { type: "ADVISE_STARTED" }
  | { type: "ADVISE_SUCCEEDED"; recommendations: SkillRecommendation[] }
  | { type: "ADVISE_FAILED"; error: string }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "START_WRITING" }
  | {
      type: "WRITE_DONE";
      message: string;
      partial?: boolean;
      applyResult?: ApplyHarnessChangePlanResult;
      installResults: InstallSkillResult[];
      createOutcomes?: SkillCreationOutcome[];
    }
  | {
      type: "WRITE_FAILED";
      message: string;
      mutationState?: WizardWriteStatus["mutationState"];
      recoveryPath?: string | null;
      remediation?: string;
      applyResult?: ApplyHarnessChangePlanResult;
      installResults?: InstallSkillResult[];
      createOutcomes?: SkillCreationOutcome[];
    };

export type CreateInitialWizardStateInput = {
  availablePackIds: string[];
  defaultPackId?: string;
  fallbackPackId?: string;
  detectedPackId?: string;
  defaultSkills?: SkillRef[];
  defaultHooks?: PackHookRef[];
  defaultAgents?: EnforcementAgent[];
  /**
   * Startup already asked which agent the user works with; when that pick is
   * unambiguous (defaultAgents present) the Agent step repeats the question,
   * so the wizard opens on Stack and the Review step keeps the pick editable.
   */
  skipAgentStep?: boolean;
  packDefaults?: PackDefaults;
  contextText?: string;
  contextSource?: string;
  adviseBackend?: AdviseBackend;
};

function packDefaultFor(input: CreateInitialWizardStateInput, packId: string): { skills: SkillRef[]; hooks: PackHookRef[] } {
  const explicit = input.packDefaults?.[packId];

  if (explicit) {
    return {
      skills: [...explicit.skills],
      hooks: [...explicit.hooks],
    };
  }

  return {
    skills: [...(input.defaultSkills ?? [])],
    hooks: [...(input.defaultHooks ?? [])],
  };
}

export function createInitialWizardState(input: CreateInitialWizardStateInput): WizardState {
  const fallbackPackId = input.fallbackPackId ?? input.defaultPackId ?? input.availablePackIds[0];

  if (!fallbackPackId) {
    throw new Error("createInitialWizardState requires at least one available pack or a default pack");
  }

  const availablePackIds = input.availablePackIds.includes(fallbackPackId) ? [...input.availablePackIds] : [fallbackPackId, ...input.availablePackIds];

  const detectedPackId = input.detectedPackId && availablePackIds.includes(input.detectedPackId) ? input.detectedPackId : undefined;

  // Zero-detection never picks a silent default: with no detected pack the stack
  // is left unselected (packId ""), which the NEXT reducer blocks from advancing
  // until the user explicitly picks a row. The fallback pack only guarantees the
  // available list is non-empty; it is no longer a preselection.
  const selectedPackId = detectedPackId ?? "";
  const defaults = selectedPackId ? packDefaultFor(input, selectedPackId) : { skills: [], hooks: [] };
  const agentStepSkipped = input.skipAgentStep === true && (input.defaultAgents?.length ?? 0) > 0;

  return {
    step: agentStepSkipped ? "Stack" : "Agent",
    agentStepSkipped,
    packId: selectedPackId,
    detectedPackId,
    availablePackIds,
    skillQuery: "",
    skillResults: [],
    selectedSkills: defaults.skills,
    skillSearchStatus: "idle",
    skillSearchError: undefined,
    createRequests: [],
    createOutcomes: [],
    availableHooks: defaults.hooks,
    selectedHooks: defaults.hooks,
    agents: normalizeAgents(input.defaultAgents),
    shareSkillsWithOtherAgent: false,
    learnEnabled: false,
    contextText: input.contextText,
    contextSource: input.contextSource,
    adviseBackend: input.adviseBackend,
    adviseEnabled: false,
    adviseStatus: "idle",
    adviseError: undefined,
    recommendations: [],
    writeStatus: undefined,
    applyResult: undefined,
    installResults: [],
  };
}

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/**
 * Review-step edit: cycle the enforcement target through the shared combo
 * list, so it offers exactly the choices the Agent step does.
 */
export function cycleAgents(agents: readonly EnforcementAgent[]): EnforcementAgent[] {
  const normalized = normalizeAgents(agents);
  const index = enforcementAgentCombos.findIndex(
    (combo) => combo.length === normalized.length && combo.every((agent, position) => agent === normalized[position])
  );
  return [...enforcementAgentCombos[(index + 1) % enforcementAgentCombos.length]!];
}

/** The step back leaves the wizard from; the app maps that to the launcher. */
export function isFirstWizardStep(state: WizardState): boolean {
  return state.step === "Agent" || (state.step === "Stack" && state.agentStepSkipped);
}

function nextStep(step: WizardStep): WizardStep {
  switch (step) {
    case "Agent":
      return "Stack";
    case "Stack":
      return "Skills";
    case "Skills":
      return "Create";
    case "Create":
      return "Hooks";
    case "Hooks":
      return "Learn";
    case "Learn":
      return "Review";
    case "Review":
    case "Writing":
    case "Done":
      return step;
  }
}

function previousStep(step: WizardStep, agentStepSkipped: boolean): WizardStep {
  switch (step) {
    case "Stack":
      // With the Agent step skipped, Stack is the first step: BACK clamps
      // here the same way it clamps at Agent; the app-level handler leaves
      // the wizard (isFirstWizardStep).
      return agentStepSkipped ? "Stack" : "Agent";
    case "Skills":
      return "Stack";
    case "Create":
      return "Skills";
    case "Hooks":
      return "Create";
    case "Learn":
      return "Hooks";
    case "Review":
      return "Learn";
    case "Agent":
    case "Writing":
    case "Done":
      return step;
  }
}

export function wizardReducer(state: WizardState, event: WizardEvent): WizardState {
  switch (event.type) {
    case "SELECT_PACK":
      return {
        ...state,
        packId: event.packId,
        skillQuery: "",
        skillResults: [],
        selectedSkills: [...event.skills],
        skillSearchStatus: "idle",
        skillSearchError: undefined,
        availableHooks: [...event.hooks],
        selectedHooks: [...event.hooks],
        adviseStatus: "idle",
        adviseError: undefined,
        recommendations: [],
      };

    case "SET_SKILL_QUERY":
      return {
        ...state,
        skillQuery: event.query,
        ...(event.query.trim().length === 0
          ? {
              skillResults: [],
              skillSearchStatus: "idle" as const,
              skillSearchError: undefined,
            }
          : {}),
      };

    case "SKILL_SEARCH_STARTED":
      if (event.query !== state.skillQuery) {
        return state;
      }

      return {
        ...state,
        skillSearchStatus: "loading",
        skillSearchError: undefined,
      };

    case "SKILL_SEARCH_SUCCEEDED":
      if (event.query !== state.skillQuery) {
        return state;
      }

      return {
        ...state,
        skillResults: [...event.results],
        skillSearchStatus: "ready",
        skillSearchError: undefined,
      };

    case "SKILL_SEARCH_FAILED":
      if (event.query !== state.skillQuery) {
        return state;
      }

      return {
        ...state,
        skillResults: [],
        skillSearchStatus: "error",
        skillSearchError: event.error,
      };

    case "TOGGLE_SKILL":
      return {
        ...state,
        selectedSkills: toggle(state.selectedSkills, event.ref),
      };

    case "ADD_CREATE_REQUEST":
      return {
        ...state,
        createRequests: [...state.createRequests, event.request],
      };

    case "REMOVE_CREATE_REQUEST":
      return {
        ...state,
        createRequests: state.createRequests.filter((_, index) => index !== event.index),
      };

    case "TOGGLE_HOOK":
      return {
        ...state,
        selectedHooks: toggle(state.selectedHooks, event.hook),
      };

    case "SELECT_AGENTS":
      return {
        ...state,
        agents: normalizeAgents(event.agents),
      };

    case "TOGGLE_AGENT": {
      const next = state.agents.includes(event.agent)
        ? state.agents.filter((agent) => agent !== event.agent)
        : [...state.agents, event.agent];

      return next.length === 0
        ? state
        : {
            ...state,
            agents: normalizeAgents(next),
          };
    }

    case "TOGGLE_SHARE_SKILLS":
      return {
        ...state,
        shareSkillsWithOtherAgent: !state.shareSkillsWithOtherAgent,
      };

    case "TOGGLE_LEARN":
      return {
        ...state,
        learnEnabled: !state.learnEnabled,
      };

    case "SET_CONTEXT":
      // A new brief invalidates suggestions computed from the old one; the
      // Skills-step effect re-runs when it is enabled and idle.
      return {
        ...state,
        contextText: event.text,
        contextSource: event.source,
        adviseStatus: "idle",
        adviseError: undefined,
        recommendations: [],
      };

    case "TOGGLE_ADVISE": {
      const adviseEnabled = !state.adviseEnabled;

      return {
        ...state,
        adviseEnabled,
        ...(adviseEnabled
          ? {}
          : {
              adviseStatus: "idle" as const,
              adviseError: undefined,
              recommendations: [],
            }),
      };
    }

    case "ADVISE_STARTED":
      if (!state.adviseEnabled) {
        return state;
      }

      return {
        ...state,
        adviseStatus: "running",
        adviseError: undefined,
      };

    case "ADVISE_SUCCEEDED":
      if (!state.adviseEnabled || state.adviseStatus !== "running") {
        return state;
      }

      return {
        ...state,
        adviseStatus: "ready",
        recommendations: [...event.recommendations],
      };

    case "ADVISE_FAILED":
      if (!state.adviseEnabled || state.adviseStatus !== "running") {
        return state;
      }

      return {
        ...state,
        adviseStatus: "error",
        adviseError: event.error,
      };

    case "NEXT":
      // The stack step cannot advance until a pack is explicitly selected; with
      // no detection there is no preselected default to carry forward.
      if (state.step === "Stack" && !state.packId) {
        return state;
      }

      return {
        ...state,
        step: nextStep(state.step),
      };

    case "BACK": {
      const step = previousStep(state.step, state.agentStepSkipped);
      return step === state.step ? state : { ...state, step };
    }

    case "START_WRITING":
      if (state.step !== "Review") {
        return state;
      }

      return {
        ...state,
        step: "Writing",
        writeStatus: undefined,
        applyResult: undefined,
        installResults: [],
        createOutcomes: [],
      };

    case "WRITE_DONE":
      if (state.step !== "Writing") {
        return state;
      }

      return {
        ...state,
        step: "Done",
        writeStatus: event.partial ? { ok: false, partial: true, message: event.message } : { ok: true, message: event.message },
        applyResult: event.applyResult,
        installResults: [...event.installResults],
        createOutcomes: [...(event.createOutcomes ?? [])],
      };

    case "WRITE_FAILED":
      if (state.step !== "Writing") {
        return state;
      }

      return {
        ...state,
        step: "Done",
        writeStatus: {
          ok: false,
          message: event.message,
          mutationState: event.mutationState,
          recoveryPath: event.recoveryPath,
          remediation: event.remediation,
        },
        applyResult: event.applyResult,
        installResults: [...(event.installResults ?? [])],
        createOutcomes: [...(event.createOutcomes ?? [])],
      };
  }
}
