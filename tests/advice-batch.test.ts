import { expect, test } from "bun:test";
import {
  completeAdviceBatch,
  planAdviceBatch,
  type AdviceBatchState
} from "../src/engine/advice-batch";
import type { AdviceCreationPlan } from "../src/engine/advice-apply";
import type { AdviceRecommendation, AdviceReport } from "../src/engine/advice-types";

function recommendation(index: number, category: AdviceRecommendation["category"] = "guidance"): AdviceRecommendation {
  return {
    id: `${category}:item-${index}`,
    category,
    targetVendors: index % 2 === 0 ? ["claude"] : ["codex"],
    reason: `Observed need ${index}.`,
    benefit: `Improve workflow ${index}.`,
    evidence: [`project:${index}`],
    confidence: "high",
    implementationRoute: category === "plugins"
      ? { id: "plugins:claude-install", description: "Install a plugin manually." }
      : { id: "guidance:agents-md", description: "Update guidance." }
  };
}

function report(recommendations: AdviceRecommendation[], backend: AdviceReport["backend"] = "codex"): AdviceReport {
  return {
    schemaVersion: 1,
    targetDir: "/tmp/example",
    backend,
    reportOnly: true,
    sessions: { mode: "none", lookback: "7d", included: false, sources: [], evidence: [] },
    profile: { targetDir: "/tmp/example", stacks: [], languages: [], tests: [], ci: [], services: [], structure: [], configuration: {}, evidence: [] },
    recommendations,
    coverage: [],
    notes: []
  };
}

function plan(item: AdviceRecommendation, path = `${item.id}.md`, content = item.id): AdviceCreationPlan {
  return {
    recommendationId: item.id,
    summary: `Plan ${item.id}.`,
    files: [{ path, content, purpose: `Create ${path}.` }]
  };
}

function inspection(files: AdviceCreationPlan["files"]) {
  return {
    targetDir: "/tmp/example",
    existingHarness: false,
    files: files.map((file) => ({ path: file.path, action: "create" as const, purpose: file.purpose, reason: "missing", requiresForce: false, exists: false })),
    counts: { create: files.length, unchanged: 0, merge: 0, update: 0, replace: 0, blocked: 0 },
    replacementPaths: [],
    replacements: [],
    blockers: []
  };
}

test("advice batch starts five jobs with bounded genuine concurrency", async () => {
  const recommendations = Array.from({ length: 5 }, (_, index) => recommendation(index));
  let active = 0;
  let maximum = 0;
  let started = 0;
  let release!: () => void;
  let threeStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reachedLimit = new Promise<void>((resolve) => { threeStarted = resolve; });
  const planner = async (item: AdviceRecommendation) => {
    active += 1;
    started += 1;
    maximum = Math.max(maximum, active);
    if (started === 3) threeStarted();
    await gate;
    active -= 1;
    return plan(item);
  };

  const running = planAdviceBatch({
    report: report(recommendations),
    signal: new AbortController().signal,
    concurrency: 3,
    dependencies: { planFiles: planner, planSkill: planner, inspect: async (value) => inspection(value.files) }
  });
  await reachedLimit;
  expect(started).toBe(3);
  expect(active).toBe(3);
  release();
  const state = await running;

  expect(started).toBe(5);
  expect(maximum).toBe(3);
  expect(state.phase).toBe("review");
  expect(state.items.map((item) => item.status)).toEqual(["planned", "planned", "planned", "planned", "planned"]);
});

test("manual routes are explained and one backend failure preserves sibling plans", async () => {
  const failed = recommendation(1);
  const manual = recommendation(2, "plugins");
  const state = await planAdviceBatch({
    report: report([recommendation(0), failed, manual]),
    signal: new AbortController().signal,
    dependencies: {
      planFiles: async (item) => {
        if (item.id === failed.id) throw new Error("Codex planning failed for this recommendation");
        return plan(item);
      },
      planSkill: async (item) => plan(item),
      inspect: async (value) => inspection(value.files)
    }
  });

  expect(state.phase).toBe("review");
  expect(state.items.map((item) => item.status)).toEqual(["planned", "failed", "skipped"]);
  expect(state.items[1]?.detail).toContain("Codex planning failed");
  expect(state.items[2]?.detail).toContain("verified marketplace command");
  expect(state.plan?.files.map((file) => file.path)).toEqual(["guidance:item-0.md"]);
});

test("different plans for an overlapping path become explicit conflicts", async () => {
  const first = recommendation(0);
  const second = recommendation(1);
  const safe = recommendation(2);
  const state = await planAdviceBatch({
    report: report([first, second, safe]),
    signal: new AbortController().signal,
    dependencies: {
      planFiles: async (item) => item.id === safe.id ? plan(item, "safe.md") : plan(item, "AGENTS.md", item.id),
      planSkill: async (item) => plan(item),
      inspect: async (value) => inspection(value.files)
    }
  });

  expect(state.items.map((item) => item.status)).toEqual(["failed", "failed", "planned"]);
  expect(state.items[0]?.detail).toContain("Conflicting planned path");
  expect(state.items[0]?.detail).toContain(second.id);
  expect(state.plan?.files.map((file) => file.path)).toEqual(["safe.md"]);
});

test("one abort signal reaches every running job, stops queued work, and settles cancellation", async () => {
  const controller = new AbortController();
  const signals: AbortSignal[] = [];
  let started = 0;
  let twoStarted!: () => void;
  const reachedLimit = new Promise<void>((resolve) => { twoStarted = resolve; });
  const planner = (item: AdviceRecommendation, signal: AbortSignal) => new Promise<AdviceCreationPlan>((_resolve, reject) => {
    signals.push(signal);
    started += 1;
    if (started === 2) twoStarted();
    signal.addEventListener("abort", () => reject(new Error(`cancelled ${item.id}`)), { once: true });
  });
  let inspections = 0;
  const running = planAdviceBatch({
    report: report(Array.from({ length: 5 }, (_, index) => recommendation(index))),
    signal: controller.signal,
    concurrency: 2,
    dependencies: {
      planFiles: planner,
      planSkill: planner,
      inspect: async (value) => { inspections += 1; return inspection(value.files); }
    }
  });
  await reachedLimit;
  controller.abort();
  const state = await running;

  expect(started).toBe(2);
  expect(signals.every((signal) => signal === controller.signal && signal.aborted)).toBe(true);
  expect(state.phase).toBe("cancelled");
  expect(state.items.map((item) => item.status)).toEqual(["cancelled", "cancelled", "cancelled", "cancelled", "cancelled"]);
  expect(inspections).toBe(0);
});

test("retry keeps created work and plans only failed or cancelled recommendations", async () => {
  const first = recommendation(0);
  const second = recommendation(1);
  let firstAttempt = true;
  const dependencies = {
    planFiles: async (item: AdviceRecommendation) => {
      if (firstAttempt && item.id === second.id) throw new Error("temporary failure");
      return plan(item);
    },
    planSkill: async (item: AdviceRecommendation) => plan(item),
    inspect: async (value: AdviceCreationPlan) => inspection(value.files)
  };
  const initial = await planAdviceBatch({ report: report([first, second]), signal: new AbortController().signal, dependencies });
  const applied = completeAdviceBatch(initial);
  let retried: AdviceBatchState | undefined;
  firstAttempt = false;
  retried = await planAdviceBatch({
    report: report([first, second]),
    previous: applied,
    signal: new AbortController().signal,
    dependencies
  });

  expect(applied.items.map((item) => item.status)).toEqual(["created", "failed"]);
  expect(retried.items.map((item) => item.status)).toEqual(["created", "planned"]);
  expect(retried.plan?.files.map((file) => file.path)).toEqual(["guidance:item-1.md"]);
});
