import { describe, expect, test } from "bun:test";
import {
  buildHarnessAuditPanelBudgetApproval,
  harnessAuditPanelBudgetProblems,
  harnessAuditRunProviderCostProblems,
  type HarnessAuditReviewPreflight,
} from "../src/engine/harness-audit-review-preflight";

const approvalReference = "approved-panel-budget";

function preflight(calls: number, tokens: number, cost = 0): HarnessAuditReviewPreflight {
  return {
    approvalReference,
    approvedMaxProviderCalls: calls,
    approvedMaxEstimatedInputTokens: tokens,
    approvedMaxProviderCostUsd: cost,
    plans: [],
  };
}

describe("harness audit panel budget", () => {
  test("accepts one exact approval covering every reviewer preflight", () => {
    const preflights = [preflight(4, 6_645, 0.4), preflight(4, 6_645, 0.4)];
    const approval = buildHarnessAuditPanelBudgetApproval(approvalReference, preflights);
    expect(harnessAuditPanelBudgetProblems({ approval, preflights })).toEqual([]);
    expect(approval).toMatchObject({
      approvedMaxProviderCalls: 8,
      approvedMaxEstimatedInputTokens: 13_290,
      approvedMaxProviderCostUsd: 0.8,
    });
  });

  test("rejects a ceiling that covers only one reviewer", () => {
    const preflights = [preflight(4, 6_645, 0.4), preflight(4, 6_645, 0.4)];
    const approval = buildHarnessAuditPanelBudgetApproval(approvalReference, [preflights[0]!]);
    const problems = harnessAuditPanelBudgetProblems({ approval, preflights });
    expect(problems.some((item) => item.includes("provider-call maximum"))).toBeTrue();
    expect(problems.some((item) => item.includes("input-token maximum"))).toBeTrue();
    expect(problems.some((item) => item.includes("provider-cost maximum"))).toBeTrue();
  });

  test("requires the panel reference on every complete reviewer preflight", () => {
    const preflights = [preflight(4, 6_645), { ...preflight(4, 6_645), approvalReference: "other" }];
    const approval = buildHarnessAuditPanelBudgetApproval(approvalReference, preflights);
    const problems = harnessAuditPanelBudgetProblems({ approval, preflights });
    expect(problems).toContain("Every reviewer preflight must use the panel budget approval reference.");
    expect(harnessAuditPanelBudgetProblems({ approval: undefined, preflights })).toEqual([
      "Required five-review panel budget approval is missing.",
    ]);
  });

  test("requires an enforceable cost ceiling on every paid Claude process", () => {
    const uncapped = harnessAuditRunProviderCostProblems({
      backend: "claude",
      modelCalls: 1,
      maxProviderCostUsdPerCall: undefined,
      prefix: "Reviewer one",
      key: "linen:baseline",
    });
    expect(uncapped).toContain(
      "Reviewer one: run linen:baseline has no positive Claude per-call provider-cost ceiling.",
    );
    expect(harnessAuditRunProviderCostProblems({
      backend: "claude",
      modelCalls: 1,
      maxProviderCostUsdPerCall: 0.05,
      prefix: "Reviewer one",
      key: "linen:baseline",
    })).toEqual([]);
    expect(harnessAuditRunProviderCostProblems({
      backend: "codex",
      modelCalls: 1,
      maxProviderCostUsdPerCall: 0.05,
      prefix: "Reviewer one",
      key: "linen:baseline",
    })[0]).toContain("Claude-only provider-cost ceiling");
  });
});
