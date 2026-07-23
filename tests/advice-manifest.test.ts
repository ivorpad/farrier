import { expect, test } from "bun:test";
import {
  adviceBatchGoal,
  adviceBatchRow,
  adviceBatchSkipReason,
  applyConfirmLine,
  batchStatusWord,
  classifyBatchFailure,
  humanizeFailureDetail,
  manifestOutcomeSummary,
  retryableSummary,
} from "../src/tui/advice-manifest";
import type { AdviceBatchItem, AdviceBatchState } from "../src/engine/advice-batch";
import type { HarnessChangePlan } from "../src/engine/create-plan";
import type { AdviceRecommendation } from "../src/engine/advice-types";

function recommendation(overrides: Partial<AdviceRecommendation> = {}): AdviceRecommendation {
  return {
    id: "hooks:secret-shield",
    category: "hooks",
    targetVendors: ["claude", "codex"],
    reason: "Observed need.",
    benefit: "Improves things.",
    evidence: ["project:1"],
    confidence: "high",
    implementationRoute: { id: "hooks:shared-policy", description: "Create shared config." },
    ...overrides,
  };
}

function item(overrides: Partial<AdviceBatchItem> = {}): AdviceBatchItem {
  return {
    recommendation: recommendation(),
    route: "files",
    status: "queued",
    detail: "Queued",
    ...overrides,
  };
}

function inspection(overrides: Partial<HarnessChangePlan> = {}): HarnessChangePlan {
  return {
    targetDir: "/tmp/example",
    existingHarness: false,
    files: [],
    counts: { create: 0, unchanged: 0, merge: 0, update: 0, replace: 0, blocked: 0 },
    replacementPaths: [],
    replacements: [],
    blockers: [],
    ...overrides,
  };
}

test("roster status words never leak the internal 'planned' state name", () => {
  expect(batchStatusWord.planned).toBe("Ready");
  expect(batchStatusWord.queued).toBe("Queued");
  expect(batchStatusWord.running).toBe("Working");
  expect(batchStatusWord.created).toBe("Created");
});

test("a roster goal names the outcome and audience in plain words", () => {
  expect(adviceBatchGoal(recommendation())).toBe("a safety check for Claude & Codex");
  expect(adviceBatchGoal(recommendation({ category: "skills", targetVendors: ["claude"] }))).toBe("a skill for Claude");
  expect(adviceBatchGoal(recommendation({ category: "mcp", targetVendors: ["codex"] }))).toBe("a tool connection for Codex");
  expect(adviceBatchGoal(recommendation({ category: "guidance", targetVendors: ["claude", "codex"] }))).toBe("a project rule for Claude & Codex");
});

test("the goal stays stable as the item moves queued → working → ready", () => {
  const base = { recommendation: recommendation() } as const;
  expect(adviceBatchRow(item({ ...base, status: "queued" })).text).toBe("a safety check for Claude & Codex");
  expect(adviceBatchRow(item({ ...base, status: "running" })).text).toBe("a safety check for Claude & Codex");
  const ready = adviceBatchRow(item({ ...base, status: "planned", plan: { recommendationId: "x", summary: "s", files: [{ path: "a", content: "b", purpose: "p" }] } }));
  expect(ready.statusWord).toBe("Ready");
  expect(ready.text).toBe("a safety check for Claude & Codex · 1 file");
});

test("a skipped row explains the manual next step, no route jargon", () => {
  const skipped = adviceBatchRow(item({ status: "skipped", route: "unsupported", recommendation: recommendation({ category: "plugins" }) }));
  expect(skipped.statusWord).toBe("Skipped");
  expect(skipped.text).toContain("by hand");
  expect(skipped.text).toContain("verified marketplace step");
  expect(skipped.text).not.toContain("constrained creator");
});

test("skip reasons cover registry, plugins, skills, and the generic fallback", () => {
  expect(adviceBatchSkipReason(item({ route: "inspect" }))).toContain("verified registry");
  expect(adviceBatchSkipReason(item({ route: "unsupported", recommendation: recommendation({ category: "plugins" }) }))).toContain("marketplace");
  expect(adviceBatchSkipReason(item({ route: "unsupported", recommendation: recommendation({ category: "skills" }) }))).toContain("skill");
  expect(adviceBatchSkipReason(item({ route: "unsupported", recommendation: recommendation({ category: "subagents" }) }))).toContain("by hand");
});

test("a failed row leads with a plain sentence and keeps the raw message dimmed", () => {
  const failed = adviceBatchRow(item({ status: "failed", detail: "Codex planning failed for this recommendation" }));
  expect(failed.statusWord).toBe("Failed");
  expect(failed.text).toBe("Couldn't create a safety check for Claude & Codex");
  expect(failed.detail).toBe("Codex planning failed for this recommendation");
});

test("timeout failures read as plain time, not milliseconds", () => {
  expect(classifyBatchFailure("external execution timed out after 600000ms")).toBe("timeout");
  expect(classifyBatchFailure("Codex planning failed")).toBe("unknown");
  // Real caps: skill authoring 600000ms (10 min), eval 900000ms (15 min); minutes derive from the message.
  expect(humanizeFailureDetail("external execution timed out after 600000ms", "Codex")).toBe("Codex ran out of time (10 minutes).");
  expect(humanizeFailureDetail("external execution timed out after 900000ms", "Claude")).toBe("Claude ran out of time (15 minutes).");
  expect(humanizeFailureDetail("external execution timed out after 90000ms", "Codex")).toBe("Codex ran out of time (1.5 minutes).");
  expect(humanizeFailureDetail("external execution timed out after 30000ms", "Claude")).toBe("Claude ran out of time (30 seconds).");
  // Anything we don't recognise falls through unchanged, so no detail is hidden.
  expect(humanizeFailureDetail("boom", "Codex")).toBe("boom");
});

test("a failed row humanizes a timeout detail with the backend name", () => {
  const failed = adviceBatchRow(
    item({ status: "failed", recommendation: recommendation({ category: "skills", targetVendors: ["codex"] }), detail: "external execution timed out after 600000ms" }),
    { backendLabel: "Codex" },
  );
  expect(failed.text).toBe("Couldn't create a skill for Codex");
  expect(failed.detail).toBe("Codex ran out of time (10 minutes).");
});

test("a retry run marks re-running items so only failures visibly re-run", () => {
  expect(adviceBatchRow(item({ status: "running" }), { retry: true }).statusWord).toBe("Retrying");
  expect(adviceBatchRow(item({ status: "queued" }), { retry: true }).statusWord).toBe("Retry");
  // Carried-over work is untouched: a kept plan still reads "Ready".
  expect(adviceBatchRow(item({ status: "planned" }), { retry: true }).statusWord).toBe("Ready");
  // Without the retry flag the first run reads normally.
  expect(adviceBatchRow(item({ status: "running" })).statusWord).toBe("Working");
});

test("retryableSummary counts only unfinished work, or nothing", () => {
  const state = (statuses: AdviceBatchItem["status"][]): AdviceBatchState => ({
    phase: "done",
    backend: "codex",
    items: statuses.map((status) => item({ status })),
  });
  expect(retryableSummary(state(["failed", "failed", "created"]))).toBe("2 failed");
  expect(retryableSummary(state(["cancelled"]))).toBe("1 stopped");
  expect(retryableSummary(state(["failed", "cancelled"]))).toBe("1 failed and 1 stopped");
  expect(retryableSummary(state(["created", "skipped"]))).toBeUndefined();
});

test("manifest summary frames counts as outcomes and calls out overwrites explicitly", () => {
  expect(manifestOutcomeSummary(inspection({ counts: { create: 1, unchanged: 0, merge: 0, update: 0, replace: 0, blocked: 0 } })))
    .toBe("Will create 1 new file. Nothing is overwritten.");
  expect(manifestOutcomeSummary(inspection({
    counts: { create: 1, unchanged: 0, merge: 0, update: 0, replace: 1, blocked: 0 },
    replacementPaths: ["AGENTS.md"],
  }))).toBe("Will create 1 new file and overwrite 1 existing file.");
  expect(manifestOutcomeSummary(inspection({ counts: { create: 0, unchanged: 2, merge: 0, update: 0, replace: 0, blocked: 0 } })))
    .toBe("Everything already matches, so there is nothing to write.");
});

test("apply confirm prompt names the concrete outcome per state", () => {
  expect(applyConfirmLine({
    inspection: inspection({ counts: { create: 2, unchanged: 0, merge: 0, update: 0, replace: 0, blocked: 0 }, files: [
      { path: "a", action: "create", purpose: "p", reason: "r", requiresForce: false, exists: false },
      { path: "b", action: "create", purpose: "p", reason: "r", requiresForce: false, exists: false },
    ] }),
    replacementArmed: false,
  })).toEqual({ text: "Press Enter to save 2 changes to your project.", tone: "gold" });

  const unarmed = applyConfirmLine({ inspection: inspection({ replacementPaths: ["AGENTS.md"], replacements: ["AGENTS.md"] }), replacementArmed: false });
  expect(unarmed.tone).toBe("gold");
  expect(unarmed.text).toContain("overwrites 1 existing file");

  const armed = applyConfirmLine({ inspection: inspection({ replacementPaths: ["AGENTS.md"], replacements: ["AGENTS.md"] }), replacementArmed: true });
  expect(armed.tone).toBe("warn");
  expect(armed.text).toContain("a backup is kept first");
  expect(armed.text).toContain("Press y to save");

  const blocked = applyConfirmLine({ inspection: inspection({ blockers: [{ path: "x", reason: "bad" }] }), replacementArmed: false });
  expect(blocked.tone).toBe("warn");
  expect(blocked.text).toContain("blocked");
});
