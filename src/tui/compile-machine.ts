import type { KbCompilePlan, KbCompileTarget } from "../engine/kb-compile";
import type { TasteGuardAuthoringRule } from "../engine/kb-taste-authoring";
import type { PreferenceKb } from "../engine/preference-kb";

/**
 * Pure state and view-model for the "Compile preferences" TUI: routing a
 * reviewed preference KB to its runtime primitives. No opentui here, so the
 * navigation, selection, and labelling are unit-testable on their own; the
 * component in compile-app.tsx renders this and owns the async engine calls.
 */

export type CompileTargetRow = {
  target: KbCompileTarget;
  label: string;
  detail: string;
};

export type CompilePlanState = {
  rows: CompileTargetRow[];
  /** Parallel to rows; a target is applied only when selected. Defaults to all on. */
  selected: boolean[];
  focus: number;
  skipped: KbCompilePlan["skipped"];
  /** Lintable rules with no reviewed patterns yet — candidates for the authoring pass. */
  unpatterned: TasteGuardAuthoringRule[];
  /** A taste-guard target exists (its patterns are already reviewed into the manifest). */
  tasteGuardPresent: boolean;
  /** The taste-guard hook is already in the manifest hookIds. */
  hookInstalled: boolean;
  /** A farrier manifest exists — hook install/pattern authoring need one. */
  harnessPresent: boolean;
};

export type CompileNavEvent =
  | { type: "up" }
  | { type: "down" }
  | { type: "toggle" }
  | { type: "toggle-all" };

export function describeTarget(target: KbCompileTarget, ruleText: (ruleId: string) => string): CompileTargetRow {
  switch (target.kind) {
    case "agents-md-rule":
      return { target, label: "AGENTS.md Hard Rule", detail: target.line };
    case "subagent-rule":
      return { target, label: `Scoped rule → ${target.owner}`, detail: target.line };
    case "reviewer-checklist":
      return { target, label: `Review checklist → ${target.owner}`, detail: target.item };
    case "taste-guard":
      return { target, label: "taste-guard hook", detail: `enforces "${ruleText(target.ruleId)}" on Edit/Write` };
  }
}

/** Lintable rules the compiler skipped for want of patterns, shaped for the authoring pass. */
export function unpatternedAuthoringRules(kb: PreferenceKb, plan: KbCompilePlan): TasteGuardAuthoringRule[] {
  const skippedIds = new Set(plan.skipped.map((entry) => entry.ruleId));
  return kb.rules
    .filter((rule) => rule.tier === "lintable" && skippedIds.has(rule.id))
    .map((rule) => ({ ruleId: rule.id, rule: rule.rule, evidence: rule.evidence }));
}

export function buildPlanState(input: {
  kb: PreferenceKb;
  plan: KbCompilePlan;
  hookInstalled: boolean;
  harnessPresent: boolean;
}): CompilePlanState {
  const ruleText = (ruleId: string): string => input.kb.rules.find((rule) => rule.id === ruleId)?.rule ?? ruleId;
  const rows = input.plan.targets.map((target) => describeTarget(target, ruleText));
  return {
    rows,
    selected: rows.map(() => true),
    focus: 0,
    skipped: input.plan.skipped,
    unpatterned: unpatternedAuthoringRules(input.kb, input.plan),
    tasteGuardPresent: input.plan.targets.some((target) => target.kind === "taste-guard"),
    hookInstalled: input.hookInstalled,
    harnessPresent: input.harnessPresent
  };
}

export function planReducer(state: CompilePlanState, event: CompileNavEvent): CompilePlanState {
  if (state.rows.length === 0) return state;
  switch (event.type) {
    case "up":
      return { ...state, focus: Math.max(0, state.focus - 1) };
    case "down":
      return { ...state, focus: Math.min(state.rows.length - 1, state.focus + 1) };
    case "toggle": {
      const selected = state.selected.slice();
      selected[state.focus] = !selected[state.focus];
      return { ...state, selected };
    }
    case "toggle-all": {
      const anyOff = state.selected.some((on) => !on);
      return { ...state, selected: state.selected.map(() => anyOff) };
    }
  }
}

export function selectedTargets(state: CompilePlanState): KbCompileTarget[] {
  return state.rows.filter((_, index) => state.selected[index]).map((row) => row.target);
}

/** Whether the "author patterns" offer applies: unpatterned lintable rules and a manifest to install into. */
export function canAuthorPatterns(state: CompilePlanState): boolean {
  return state.harnessPresent && state.unpatterned.length > 0;
}

/** Whether the "install taste-guard hook" offer applies: reviewed patterns present but the hook not yet wired. */
export function canInstallHook(state: CompilePlanState): boolean {
  return state.harnessPresent && state.tasteGuardPresent && !state.hookInstalled;
}
