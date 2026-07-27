import { describe, expect, test } from "bun:test";
import type { KbCompilePlan, KbCompileTarget } from "../src/engine/kb-compile";
import type { PreferenceKb, PreferenceRule, PreferenceTier } from "../src/engine/preference-kb";
import {
  buildPlanState,
  canAuthorPatterns,
  canInstallHook,
  describeTarget,
  planReducer,
  selectedTargets,
  unpatternedAuthoringRules
} from "../src/tui/compile-machine";

function rule(id: string, tier: PreferenceTier, overrides: Partial<PreferenceRule> = {}): PreferenceRule {
  return {
    id,
    rule: overrides.rule ?? `Rule ${id}.`,
    tier,
    ...(overrides.owner ? { owner: overrides.owner } : {}),
    evidence: overrides.evidence ?? ["steer 1"],
    addedAt: "2026-07-27"
  };
}

function plan(targets: KbCompileTarget[], skipped: KbCompilePlan["skipped"] = []): KbCompilePlan {
  return { targets, skipped };
}

const kb: PreferenceKb = {
  version: 1,
  rules: [
    rule("a", "declarative", { rule: "Keep functions short." }),
    rule("b", "lintable", { rule: "No inline imports." }),
    rule("c", "lintable", { rule: "No broad except." })
  ]
};

describe("describeTarget", () => {
  test("labels every target kind distinctly", () => {
    const ruleText = (id: string) => `text-${id}`;
    expect(describeTarget({ kind: "agents-md-rule", ruleId: "a", line: "L" }, ruleText).label).toBe("AGENTS.md Hard Rule");
    expect(describeTarget({ kind: "subagent-rule", owner: "rev", ruleId: "a", line: "L" }, ruleText).label).toBe("Scoped rule → rev");
    expect(describeTarget({ kind: "reviewer-checklist", owner: "rev", ruleId: "a", item: "I" }, ruleText).label).toBe("Review checklist → rev");
    const guard = describeTarget({ kind: "taste-guard", ruleId: "b" }, ruleText);
    expect(guard.label).toBe("taste-guard hook");
    expect(guard.detail).toContain("text-b");
  });
});

describe("buildPlanState", () => {
  test("selects all targets by default and detects the taste-guard target", () => {
    const state = buildPlanState({
      kb,
      plan: plan([
        { kind: "agents-md-rule", ruleId: "a", line: "Keep functions short." },
        { kind: "taste-guard", ruleId: "b" }
      ], [{ ruleId: "c", reason: "no reviewed patterns yet — author patterns first" }]),
      hookInstalled: false,
      harnessPresent: true
    });
    expect(state.rows).toHaveLength(2);
    expect(state.selected).toEqual([true, true]);
    expect(state.tasteGuardPresent).toBe(true);
    expect(state.unpatterned.map((entry) => entry.ruleId)).toEqual(["c"]);
  });
});

describe("unpatternedAuthoringRules", () => {
  test("returns only skipped lintable rules with their evidence", () => {
    const rules = unpatternedAuthoringRules(kb, plan([], [
      { ruleId: "c", reason: "no reviewed patterns yet — author patterns first" },
      { ruleId: "a", reason: "irrelevant" }
    ]));
    expect(rules).toEqual([{ ruleId: "c", rule: "No broad except.", evidence: ["steer 1"] }]);
  });
});

describe("planReducer + selectedTargets", () => {
  const base = buildPlanState({
    kb,
    plan: plan([
      { kind: "agents-md-rule", ruleId: "a", line: "Keep functions short." },
      { kind: "taste-guard", ruleId: "b" }
    ]),
    hookInstalled: false,
    harnessPresent: true
  });

  test("moves focus within bounds", () => {
    expect(planReducer(base, { type: "up" }).focus).toBe(0);
    const down = planReducer(base, { type: "down" });
    expect(down.focus).toBe(1);
    expect(planReducer(down, { type: "down" }).focus).toBe(1);
  });

  test("toggle flips the focused row; toggle-all clears then restores", () => {
    const off = planReducer(base, { type: "toggle" });
    expect(off.selected).toEqual([false, true]);
    expect(selectedTargets(off)).toEqual([{ kind: "taste-guard", ruleId: "b" }]);
    const allOff = planReducer(base, { type: "toggle-all" });
    expect(allOff.selected).toEqual([false, false]);
    expect(planReducer(allOff, { type: "toggle-all" }).selected).toEqual([true, true]);
  });
});

describe("offer gating", () => {
  test("author needs a manifest and unpatterned rules; install needs patterns and an uninstalled hook", () => {
    const withGuard = buildPlanState({
      kb,
      plan: plan([{ kind: "taste-guard", ruleId: "b" }], [{ ruleId: "c", reason: "no reviewed patterns yet — author patterns first" }]),
      hookInstalled: false,
      harnessPresent: true
    });
    expect(canAuthorPatterns(withGuard)).toBe(true);
    expect(canInstallHook(withGuard)).toBe(true);

    const installed = buildPlanState({ kb, plan: plan([{ kind: "taste-guard", ruleId: "b" }]), hookInstalled: true, harnessPresent: true });
    expect(canInstallHook(installed)).toBe(false);

    const noManifest = buildPlanState({ kb, plan: plan([], [{ ruleId: "c", reason: "no reviewed patterns yet — author patterns first" }]), hookInstalled: false, harnessPresent: false });
    expect(canAuthorPatterns(noManifest)).toBe(false);
  });
});
