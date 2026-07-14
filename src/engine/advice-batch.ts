import type { HarnessChangePlan } from "./create-plan";
import { adviceCreationSupport, type AdviceCreationPlan } from "./advice-apply";
import type { AdviceRecommendation, AdviceReport } from "./advice-types";

export type AdviceBatchPhase = "idle" | "planning" | "review" | "applying" | "done" | "cancelled" | "error";
export type AdviceBatchItemStatus = "queued" | "running" | "planned" | "created" | "skipped" | "failed" | "cancelled";

export type AdviceBatchItem = {
  recommendation: AdviceRecommendation;
  route: "files" | "skill" | "unsupported";
  status: AdviceBatchItemStatus;
  detail: string;
  plan?: AdviceCreationPlan;
};

export type AdviceBatchState = {
  phase: AdviceBatchPhase;
  author?: AdviceReport["author"];
  backend: AdviceReport["backend"];
  items: AdviceBatchItem[];
  plan?: AdviceCreationPlan;
  inspection?: HarnessChangePlan;
  error?: string;
};

export type AdviceBatchCounts = {
  completed: number;
  running: number;
  queued: number;
};

export type AdviceBatchDependencies = {
  planFiles: (recommendation: AdviceRecommendation, signal: AbortSignal) => Promise<AdviceCreationPlan>;
  planSkill: (recommendation: AdviceRecommendation, signal: AbortSignal) => Promise<AdviceCreationPlan>;
  inspect: (plan: AdviceCreationPlan) => Promise<HarnessChangePlan>;
  cleanup?: (plan: AdviceCreationPlan) => Promise<void>;
};

const defaultConcurrency = 3;

export function adviceBatchCounts(state: AdviceBatchState): AdviceBatchCounts {
  return {
    completed: state.items.filter((item) => !new Set<AdviceBatchItemStatus>(["queued", "running"]).has(item.status)).length,
    running: state.items.filter((item) => item.status === "running").length,
    queued: state.items.filter((item) => item.status === "queued").length
  };
}

export function adviceBatchRetryableCount(state: AdviceBatchState): number {
  return state.items.filter((item) => item.status === "failed" || item.status === "cancelled").length;
}

export function createInitialAdviceBatchState(report: AdviceReport): AdviceBatchState {
  return {
    phase: "idle",
    author: report.author ?? report.backend,
    backend: report.backend,
    items: report.recommendations.map((recommendation) => {
      const support = adviceCreationSupport(recommendation);
      return {
        recommendation,
        route: support.kind,
        status: support.kind === "unsupported" ? "skipped" : "queued",
        detail: support.kind === "unsupported" ? support.description : "Queued"
      };
    })
  };
}

function restartableItems(report: AdviceReport, previous?: AdviceBatchState): AdviceBatchItem[] {
  const priorById = new Map(previous?.items.map((item) => [item.recommendation.id, item]));
  return createInitialAdviceBatchState(report).items.map((item) => {
    const prior = priorById.get(item.recommendation.id);
    if (!prior || prior.route !== item.route) return item;
    if (prior.status === "created" || prior.status === "planned" || prior.status === "skipped") return { ...prior };
    return { ...item, detail: "Queued for retry" };
  });
}

function snapshot(state: AdviceBatchState): AdviceBatchState {
  return { ...state, items: state.items.map((item) => ({ ...item })) };
}

function conflictDetails(items: AdviceBatchItem[]): Map<number, string[]> {
  const byPath = new Map<string, Array<{ index: number; content: string }>>();
  items.forEach((item, index) => {
    if (item.status !== "planned" || !item.plan) return;
    for (const file of item.plan.files) {
      const entries = byPath.get(file.path) ?? [];
      entries.push({ index, content: file.content });
      byPath.set(file.path, entries);
    }
    for (const tree of item.plan.trees ?? []) {
      const entries = byPath.get(tree.path) ?? [];
      entries.push({ index, content: `tree:${tree.sourcePath}` });
      byPath.set(tree.path, entries);
    }
    for (const link of item.plan.links ?? []) {
      const entries = byPath.get(link.path) ?? [];
      entries.push({ index, content: `link:${link.target}` });
      byPath.set(link.path, entries);
    }
  });

  const conflicts = new Map<number, string[]>();
  for (const [path, entries] of byPath) {
    if (entries.length < 2 || new Set(entries.map((entry) => entry.content)).size === 1) continue;
    const ids = entries.map((entry) => items[entry.index]!.recommendation.id);
    for (const entry of entries) {
      const others = ids.filter((_, index) => entries[index]!.index !== entry.index);
      const messages = conflicts.get(entry.index) ?? [];
      messages.push(`${path} also has a different plan from ${others.join(", ")}`);
      conflicts.set(entry.index, messages);
    }
  }
  return conflicts;
}

function aggregatePlans(items: AdviceBatchItem[]): AdviceCreationPlan | undefined {
  const planned = items.filter((item) => item.status === "planned" && item.plan);
  if (planned.length === 0) return undefined;
  const seen = new Set<string>();
  const files = planned.flatMap((item) => item.plan!.files).filter((file) => {
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  });
  return {
    recommendationId: `batch:${planned.map((item) => item.recommendation.id).join(",")}`,
    summary: `Create ${planned.length} reviewed recommendation(s) as one transaction.`,
    files,
    trees: planned.flatMap((item) => item.plan!.trees ?? []),
    links: planned.flatMap((item) => item.plan!.links ?? []),
    cleanupPaths: planned.flatMap((item) => item.plan!.cleanupPaths ?? [])
  };
}

export async function planAdviceBatch(input: {
  report: AdviceReport;
  signal: AbortSignal;
  dependencies: AdviceBatchDependencies;
  previous?: AdviceBatchState;
  concurrency?: number;
  onProgress?: (state: AdviceBatchState) => void;
}): Promise<AdviceBatchState> {
  const state: AdviceBatchState = {
    phase: "planning",
    author: input.report.author ?? input.report.backend,
    backend: input.report.backend,
    items: restartableItems(input.report, input.previous)
  };
  const emit = () => input.onProgress?.(snapshot(state));
  emit();

  const pending = state.items.flatMap((item, index) => item.status === "queued" ? [index] : []);
  let cursor = 0;
  const worker = async () => {
    while (!input.signal.aborted) {
      const index = pending[cursor++];
      if (index === undefined) return;
      const item = state.items[index]!;
      item.status = "running";
      item.detail = item.route === "skill" ? "Authoring through the skill creator" : "Planning constrained files";
      emit();
      try {
        const plan = await (item.route === "skill"
          ? input.dependencies.planSkill(item.recommendation, input.signal)
          : input.dependencies.planFiles(item.recommendation, input.signal));
        if (input.signal.aborted) {
          item.status = "cancelled";
          item.detail = "Cancelled after the running backend settled";
        } else {
          item.plan = plan;
          item.status = "planned";
          item.detail = `${plan.files.length} file(s) ready for review`;
        }
      } catch (error) {
        item.status = input.signal.aborted ? "cancelled" : "failed";
        item.detail = input.signal.aborted ? "Cancelled" : (error instanceof Error ? error.message : String(error));
      }
      emit();
    }
  };

  const limit = Math.max(1, Math.floor(input.concurrency ?? defaultConcurrency));
  await Promise.allSettled(Array.from({ length: Math.min(limit, pending.length) }, () => worker()));
  if (input.signal.aborted) {
    for (const item of state.items) {
      if (item.status === "queued" || item.status === "running") {
        item.status = "cancelled";
        item.detail = "Cancelled before start";
      }
    }
    state.phase = "cancelled";
    await Promise.allSettled(state.items.flatMap((item) => item.plan && input.dependencies.cleanup
      ? [input.dependencies.cleanup(item.plan)]
      : []));
    emit();
    return snapshot(state);
  }

  const conflictCleanups: Promise<void>[] = [];
  for (const [index, messages] of conflictDetails(state.items)) {
    const item = state.items[index]!;
    item.status = "failed";
    item.detail = `Conflicting planned path: ${messages.join("; ")}. No conflicting plan will be applied.`;
    if (item.plan && input.dependencies.cleanup) conflictCleanups.push(input.dependencies.cleanup(item.plan));
  }
  await Promise.allSettled(conflictCleanups);
  state.plan = aggregatePlans(state.items);
  if (!state.plan) {
    state.phase = state.items.some((item) => item.status === "failed") ? "error" : "done";
    state.error = state.phase === "error" ? "No conflict-free recommendation plan is available to review." : undefined;
    emit();
    return snapshot(state);
  }

  try {
    state.inspection = await input.dependencies.inspect(state.plan);
    state.phase = "review";
  } catch (error) {
    state.phase = "error";
    state.error = error instanceof Error ? error.message : String(error);
    if (input.dependencies.cleanup) await input.dependencies.cleanup(state.plan);
  }
  emit();
  return snapshot(state);
}

export function completeAdviceBatch(state: AdviceBatchState): AdviceBatchState {
  return {
    ...state,
    phase: "done",
    error: undefined,
    items: state.items.map((item) => item.status === "planned"
      ? { ...item, status: "created", detail: `${item.plan?.files.length ?? 0} reviewed file(s) created` }
      : { ...item })
  };
}
