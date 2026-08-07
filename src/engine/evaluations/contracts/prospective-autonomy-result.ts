import {
  validateProspectiveEvidenceSet,
  type ProspectiveRunEvidenceBundle,
  type ValidatedProspectiveRun,
} from "../prospective-run-evidence";
import type { ProspectiveArm } from "./prospective-autonomy-protocol-items";

export type ProspectiveTaskEffect = {
  taskId: string;
  repositoryId: string;
  nativeAcas: number;
  oracleAcas: number;
  acasLift: number;
  nativeFunctionalSuccess: number;
  oracleFunctionalSuccess: number;
  toolCallOverhead: number;
  inputTokenOverhead: number;
};

export type ProspectiveP0Check = { id: string; ok: boolean; actual: string; limit: string };
export type ProspectiveP0Report = {
  ready: boolean;
  problems: string[];
  taskEffects: ProspectiveTaskEffect[];
  meanAcasLift: number;
  wins: number;
  ties: number;
  losses: number;
  checks: ProspectiveP0Check[];
  pass: boolean;
};

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: readonly number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function ratio(after: number, before: number): number {
  return before === 0 ? (after === 0 ? 0 : Number.POSITIVE_INFINITY) : after / before - 1;
}

function percent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "infinite";
}

export function functionalSuccess(run: ValidatedProspectiveRun): boolean {
  return run.submitted
    && run.withinBudget
    && run.hiddenAcceptancePassed
    && run.regressionSuitePassed;
}

export function autonomousContractAdherentSuccess(run: ValidatedProspectiveRun): boolean {
  return functionalSuccess(run)
    && run.requiredVerificationPassed
    && run.verificationAfterLastCodeChange
    && run.humanLedger.scoreable
    && run.humanLedger.derived.autonomousHumanContactClear
    && run.materialContractViolations === 0
    && run.prohibitedIntegrityActions === 0;
}

function taskEffect(taskId: string, runs: readonly ValidatedProspectiveRun[]): ProspectiveTaskEffect {
  const native = runs.filter((run) => run.arm === "native");
  const oracle = runs.filter((run) => run.arm === "oracle-brief");
  const average = (items: readonly ValidatedProspectiveRun[], key: "toolCalls" | "inputTokens") =>
    mean(items.map((run) => run[key]));
  const nativeAcas = mean(native.map((run) => Number(autonomousContractAdherentSuccess(run))));
  const oracleAcas = mean(oracle.map((run) => Number(autonomousContractAdherentSuccess(run))));
  return {
    taskId,
    repositoryId: runs[0]!.repositoryId,
    nativeAcas,
    oracleAcas,
    acasLift: oracleAcas - nativeAcas,
    nativeFunctionalSuccess: mean(native.map((run) => Number(functionalSuccess(run)))),
    oracleFunctionalSuccess: mean(oracle.map((run) => Number(functionalSuccess(run)))),
    toolCallOverhead: ratio(average(oracle, "toolCalls"), average(native, "toolCalls")),
    inputTokenOverhead: ratio(average(oracle, "inputTokens"), average(native, "inputTokens")),
  };
}

function validateCompleteSchedule(
  bundles: readonly ProspectiveRunEvidenceBundle[],
  runs: readonly ValidatedProspectiveRun[],
  problems: string[],
): void {
  const protocol = bundles[0]?.protocol.body as any;
  const expected = new Set<string>((protocol?.randomization?.cells ?? []).map((cell: any) =>
    `${cell.taskId}:${cell.arm}:${cell.repetition}`));
  const actual = new Set<string>();
  for (const run of runs) {
    const key = `${run.taskId}:${run.arm}:${run.repetition}`;
    if (actual.has(key)) problems.push(`duplicate scored evidence for ${key}.`);
    actual.add(key);
    if (run.attempt !== 1 || run.replacementForAttempt !== null) {
      problems.push(`${key} uses replacement evidence before E0 replacement handling is implemented.`);
    }
  }
  for (const key of expected) if (!actual.has(key)) problems.push(`missing scored evidence for ${key}.`);
  for (const key of actual) if (!expected.has(key)) problems.push(`unplanned scored evidence for ${key}.`);
  if (expected.size !== 32 || actual.size !== 32) problems.push("P0 requires exactly 32 protocol-bound scored runs.");
}

function validateHarmCoverage(
  taskRuns: Map<string, ValidatedProspectiveRun[]>,
  effects: readonly ProspectiveTaskEffect[],
  problems: string[],
): void {
  for (const effect of effects) {
    const runs = taskRuns.get(effect.taskId) ?? [];
    const native = runs.filter((run) => run.arm === "native");
    const oracle = runs.filter((run) => run.arm === "oracle-brief");
    const nativeVerification = mean(native.map((run) => Number(run.requiredVerificationPassed)));
    const oracleVerification = mean(oracle.map((run) => Number(run.requiredVerificationPassed)));
    const nativeViolations = mean(native.map((run) => run.materialContractViolations));
    const oracleViolations = mean(oracle.map((run) => run.materialContractViolations));
    const triggered = effect.oracleAcas < effect.nativeAcas
      || effect.oracleFunctionalSuccess < effect.nativeFunctionalSuccess
      || oracleVerification < nativeVerification
      || oracleViolations > nativeViolations;
    if (!triggered) continue;
    for (const run of oracle.filter((item) =>
      !autonomousContractAdherentSuccess(item) || item.materialContractViolations > 0)) {
      if (run.harmAdjudications.length === 0) {
        problems.push(`oracle regression ${run.runId} has no causal harm adjudication.`);
      }
    }
  }
}

export function evaluateProspectiveP0(input: {
  bundles: readonly ProspectiveRunEvidenceBundle[];
}): ProspectiveP0Report {
  const evidence = validateProspectiveEvidenceSet(input.bundles);
  const problems = [...evidence.problems];
  validateCompleteSchedule(input.bundles, evidence.runs, problems);
  const taskRuns = new Map<string, ValidatedProspectiveRun[]>();
  for (const run of evidence.runs) taskRuns.set(run.taskId, [...taskRuns.get(run.taskId) ?? [], run]);
  const taskEffects = [...taskRuns].filter(([, runs]) => runs.length === 4)
    .map(([taskId, runs]) => taskEffect(taskId, runs))
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
  validateHarmCoverage(taskRuns, taskEffects, problems);
  const meanAcasLift = mean(taskEffects.map((effect) => effect.acasLift));
  const wins = taskEffects.filter((effect) => effect.acasLift > 0).length;
  const losses = taskEffects.filter((effect) => effect.acasLift < 0).length;
  const ties = taskEffects.length - wins - losses;
  const nativeFunctional = mean(taskEffects.map((effect) => effect.nativeFunctionalSuccess));
  const oracleFunctional = mean(taskEffects.map((effect) => effect.oracleFunctionalSuccess));
  const repositoryLift = new Map<string, number[]>();
  for (const effect of taskEffects) {
    repositoryLift.set(effect.repositoryId, [...repositoryLift.get(effect.repositoryId) ?? [], effect.acasLift]);
  }
  const positiveRepositories = [...repositoryLift.values()].filter((values) => mean(values) > 0).length;
  const harmfulTasks = new Set(evidence.runs.flatMap((run) =>
    run.harmAdjudications.filter((item) => item.causedRegression).map(() => run.taskId))).size;
  const rescueSeconds = (arm: ProspectiveArm) => evidence.runs
    .filter((run) => run.arm === arm && run.rescueSelected)
    .reduce((sum, run) => sum + run.rescueSeconds, 0);
  const toolOverhead = median(taskEffects.map((effect) => effect.toolCallOverhead));
  const tokenOverhead = median(taskEffects.map((effect) => effect.inputTokenOverhead));
  const checks: ProspectiveP0Check[] = [
    { id: "acas-lift", ok: meanAcasLift >= 0.15, actual: percent(meanAcasLift), limit: ">= 15.0%" },
    { id: "task-wins", ok: wins >= 2, actual: String(wins), limit: ">= 2" },
    { id: "task-losses", ok: losses <= 1, actual: String(losses), limit: "<= 1" },
    { id: "functional-success", ok: oracleFunctional >= nativeFunctional, actual: `oracle ${percent(oracleFunctional)} vs native ${percent(nativeFunctional)}`, limit: "oracle >= native" },
    { id: "repository-lift", ok: positiveRepositories >= 2, actual: String(positiveRepositories), limit: ">= 2" },
    { id: "harmful-briefs", ok: harmfulTasks === 0, actual: String(harmfulTasks), limit: "0" },
    { id: "human-rescue", ok: rescueSeconds("oracle-brief") <= rescueSeconds("native"), actual: `oracle ${rescueSeconds("oracle-brief")}s vs native ${rescueSeconds("native")}s`, limit: "oracle <= native" },
    { id: "tool-overhead", ok: toolOverhead < 0.10, actual: percent(toolOverhead), limit: "< 10.0%" },
    { id: "token-overhead", ok: tokenOverhead < 0.25, actual: percent(tokenOverhead), limit: "< 25.0%" },
    { id: "context-delivery", ok: evidence.ready, actual: "derived from each run bundle", limit: "every scored run" },
  ];
  const ready = problems.length === 0 && taskEffects.length === 8 && evidence.runs.length === 32;
  return { ready, problems, taskEffects, meanAcasLift, wins, ties, losses, checks, pass: ready && checks.every((check) => check.ok) };
}
