import type { AdviseBackend, SkillRecommendation } from "../engine/advise";
import type { SkillCreationOutcome, SkillCreationRequest } from "../engine/create-skill";
import type { InstallSkillResult, SkillSearchResult } from "../engine/skills";
import type { PackHookRef, SkillRef } from "../packs/types";

export type WizardStep = "Stack" | "Skills" | "Create" | "Hooks" | "Learn" | "Review" | "Writing" | "Done";

export type SkillSearchStatus = "idle" | "loading" | "ready" | "error";

export type AdviseStatus = "idle" | "running" | "ready" | "error";

export type PackDefaults = Record<
  string,
  {
    skills: SkillRef[];
    hooks: PackHookRef[];
  }
>;

export type WizardState = {
  step: WizardStep;
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

  learnEnabled: boolean;

  contextText?: string;
  contextSource?: string;
  adviseBackend?: AdviseBackend;
  adviseEnabled: boolean;
  adviseStatus: AdviseStatus;
  adviseError?: string;
  recommendations: SkillRecommendation[];

  writeStatus?: {
    ok: boolean;
    message: string;
  };

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
  | { type: "TOGGLE_LEARN" }
  | { type: "TOGGLE_ADVISE" }
  | { type: "ADVISE_STARTED" }
  | { type: "ADVISE_SUCCEEDED"; recommendations: SkillRecommendation[] }
  | { type: "ADVISE_FAILED"; error: string }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "START_WRITING" }
  | { type: "WRITE_DONE"; message: string; installResults: InstallSkillResult[]; createOutcomes?: SkillCreationOutcome[] }
  | { type: "WRITE_FAILED"; message: string; installResults?: InstallSkillResult[]; createOutcomes?: SkillCreationOutcome[] };

export type CreateInitialWizardStateInput = {
  availablePackIds: string[];
  defaultPackId?: string;
  fallbackPackId?: string;
  detectedPackId?: string;
  defaultSkills?: SkillRef[];
  defaultHooks?: PackHookRef[];
  packDefaults?: PackDefaults;
  contextText?: string;
  contextSource?: string;
  adviseBackend?: AdviseBackend;
  adviseAutoStart?: boolean;
};

function packDefaultFor(input: CreateInitialWizardStateInput, packId: string): { skills: SkillRef[]; hooks: PackHookRef[] } {
  const explicit = input.packDefaults?.[packId];

  if (explicit) {
    return {
      skills: [...explicit.skills],
      hooks: [...explicit.hooks]
    };
  }

  return {
    skills: [...(input.defaultSkills ?? [])],
    hooks: [...(input.defaultHooks ?? [])]
  };
}

export function createInitialWizardState(input: CreateInitialWizardStateInput): WizardState {
  const fallbackPackId = input.fallbackPackId ?? input.defaultPackId ?? input.availablePackIds[0];

  if (!fallbackPackId) {
    throw new Error("createInitialWizardState requires at least one available pack or a default pack");
  }

  const availablePackIds = input.availablePackIds.includes(fallbackPackId)
    ? [...input.availablePackIds]
    : [fallbackPackId, ...input.availablePackIds];

  const detectedPackId =
    input.detectedPackId && availablePackIds.includes(input.detectedPackId) ? input.detectedPackId : undefined;

  const selectedPackId = detectedPackId ?? fallbackPackId;
  const defaults = packDefaultFor(input, selectedPackId);

  return {
    step: "Stack",
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
    learnEnabled: false,
    contextText: input.contextText,
    contextSource: input.contextSource,
    adviseBackend: input.adviseBackend,
    adviseEnabled: Boolean(input.adviseAutoStart && input.contextText && input.adviseBackend),
    adviseStatus: "idle",
    adviseError: undefined,
    recommendations: [],
    writeStatus: undefined,
    installResults: []
  };
}

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function nextStep(step: WizardStep): WizardStep {
  switch (step) {
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

function previousStep(step: WizardStep): WizardStep {
  switch (step) {
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
    case "Stack":
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
        recommendations: []
      };

    case "SET_SKILL_QUERY":
      return {
        ...state,
        skillQuery: event.query,
        ...(event.query.trim().length === 0
          ? {
              skillResults: [],
              skillSearchStatus: "idle" as const,
              skillSearchError: undefined
            }
          : {})
      };

    case "SKILL_SEARCH_STARTED":
      if (event.query !== state.skillQuery) {
        return state;
      }

      return {
        ...state,
        skillSearchStatus: "loading",
        skillSearchError: undefined
      };

    case "SKILL_SEARCH_SUCCEEDED":
      if (event.query !== state.skillQuery) {
        return state;
      }

      return {
        ...state,
        skillResults: [...event.results],
        skillSearchStatus: "ready",
        skillSearchError: undefined
      };

    case "SKILL_SEARCH_FAILED":
      if (event.query !== state.skillQuery) {
        return state;
      }

      return {
        ...state,
        skillResults: [],
        skillSearchStatus: "error",
        skillSearchError: event.error
      };

    case "TOGGLE_SKILL":
      return {
        ...state,
        selectedSkills: toggle(state.selectedSkills, event.ref)
      };

    case "ADD_CREATE_REQUEST":
      return {
        ...state,
        createRequests: [...state.createRequests, event.request]
      };

    case "REMOVE_CREATE_REQUEST":
      return {
        ...state,
        createRequests: state.createRequests.filter((_, index) => index !== event.index)
      };

    case "TOGGLE_HOOK":
      return {
        ...state,
        selectedHooks: toggle(state.selectedHooks, event.hook)
      };

    case "TOGGLE_LEARN":
      return {
        ...state,
        learnEnabled: !state.learnEnabled
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
              recommendations: []
            })
      };
    }

    case "ADVISE_STARTED":
      if (!state.adviseEnabled) {
        return state;
      }

      return {
        ...state,
        adviseStatus: "running",
        adviseError: undefined
      };

    case "ADVISE_SUCCEEDED":
      if (!state.adviseEnabled || state.adviseStatus !== "running") {
        return state;
      }

      return {
        ...state,
        adviseStatus: "ready",
        recommendations: [...event.recommendations]
      };

    case "ADVISE_FAILED":
      if (!state.adviseEnabled || state.adviseStatus !== "running") {
        return state;
      }

      return {
        ...state,
        adviseStatus: "error",
        adviseError: event.error
      };

    case "NEXT":
      return {
        ...state,
        step: nextStep(state.step)
      };

    case "BACK":
      return {
        ...state,
        step: previousStep(state.step)
      };

    case "START_WRITING":
      if (state.step !== "Review") {
        return state;
      }

      return {
        ...state,
        step: "Writing",
        writeStatus: undefined,
        installResults: [],
        createOutcomes: []
      };

    case "WRITE_DONE":
      if (state.step !== "Writing") {
        return state;
      }

      return {
        ...state,
        step: "Done",
        writeStatus: {
          ok: true,
          message: event.message
        },
        installResults: [...event.installResults],
        createOutcomes: [...(event.createOutcomes ?? [])]
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
          message: event.message
        },
        installResults: [...(event.installResults ?? [])],
        createOutcomes: [...(event.createOutcomes ?? [])]
      };
  }
}
