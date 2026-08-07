import { createHash } from "node:crypto";

import { canonicalEvidence } from "../../behavior-evidence";
import {
  instant,
  integer,
  prospectiveArms,
  prospectiveLanguageStrata,
  record,
  SHA256,
  text,
  validateBacklog,
  validateIntervention,
  validateRepository,
  validateRunner,
  validateTask,
  type ProspectiveArm,
} from "./prospective-autonomy-protocol-items";

export { prospectiveArms, prospectiveLanguageStrata };
export type { ProspectiveArm };

export type ProspectiveRunCell = {
  taskId: string;
  arm: ProspectiveArm;
  repetition: 1 | 2;
  order: number;
  rescueSelected: boolean;
};

export type ProspectiveProtocolValidation = {
  problems: string[];
  repositoryCount: number;
  taskCount: number;
  plannedRunCount: number;
  ready: boolean;
};

export function canonicalProspectiveProtocolDigest(value: unknown): string {
  const protocol = record(value);
  const body = protocol
    ? Object.fromEntries(Object.entries(protocol).filter(([key]) => key !== "protocolDigest"))
    : value;
  return createHash("sha256").update(canonicalEvidence(body)).digest("hex");
}

function validateRandomization(
  raw: unknown,
  taskIds: Set<string>,
  taskRepositories: Map<string, string>,
  problems: string[],
): number {
  const randomization = record(raw);
  if (!randomization) {
    problems.push("randomization must be an object.");
    return 0;
  }
  if (integer(randomization.seed) === undefined) problems.push("randomization.seed must be a safe integer.");
  if (instant(randomization.frozenAt) === undefined) problems.push("randomization.frozenAt must be an ISO timestamp.");
  const cells = Array.isArray(randomization.cells) ? randomization.cells : [];
  if (!Array.isArray(randomization.cells)) problems.push("randomization.cells must be an array.");
  const keys = new Set<string>();
  const orders = new Set<number>();
  const sequences = new Map<string, Array<{ order: number; arm: string }>>();
  const rescueSelections = new Map<string, number>();
  for (const [index, rawCell] of cells.entries()) {
    const cell = record(rawCell);
    if (!cell) {
      problems.push(`randomization.cells[${index}] must be an object.`);
      continue;
    }
    const taskId = text(cell.taskId);
    const arm = text(cell.arm);
    const repetition = integer(cell.repetition);
    const order = integer(cell.order);
    if (!taskId || !taskIds.has(taskId)) problems.push(`randomization.cells[${index}].taskId is invalid.`);
    if (!prospectiveArms.includes(arm as ProspectiveArm)) problems.push(`randomization.cells[${index}].arm is invalid.`);
    if (repetition !== 1 && repetition !== 2) problems.push(`randomization.cells[${index}].repetition must be 1 or 2.`);
    if (order === undefined || order < 1 || order > cells.length || orders.has(order)) {
      problems.push(`randomization.cells[${index}].order is invalid or duplicated.`);
    } else orders.add(order);
    if (typeof cell.rescueSelected !== "boolean") {
      problems.push(`randomization.cells[${index}].rescueSelected must be boolean.`);
    } else if (cell.rescueSelected && taskId && arm) {
      const rescueKey = `${taskId}:${arm}`;
      rescueSelections.set(rescueKey, (rescueSelections.get(rescueKey) ?? 0) + 1);
    }
    const key = `${taskId}:${arm}:${repetition}`;
    if (keys.has(key)) problems.push(`randomization contains duplicate cell ${key}.`);
    keys.add(key);
    if (taskId && arm && order !== undefined) {
      sequences.set(taskId, [...sequences.get(taskId) ?? [], { order, arm }]);
    }
  }
  for (const taskId of taskIds) {
    for (const arm of prospectiveArms) {
      for (const repetition of [1, 2]) {
        if (!keys.has(`${taskId}:${arm}:${repetition}`)) {
          problems.push(`randomization is missing ${taskId}:${arm}:${repetition}.`);
        }
      }
      if (rescueSelections.get(`${taskId}:${arm}`) !== 1) {
        problems.push(`randomization must preselect exactly one rescue repetition for ${taskId}:${arm}.`);
      }
    }
  }
  const repositorySequences = new Map<string, string[]>();
  for (const [taskId, sequence] of sequences) {
    const value = sequence.sort((left, right) => left.order - right.order).map((item) => item.arm).join(",");
    if (value !== "native,oracle-brief,oracle-brief,native"
      && value !== "oracle-brief,native,native,oracle-brief") {
      problems.push(`randomization task ${taskId} does not use a balanced crossover sequence.`);
    }
    const repositoryId = taskRepositories.get(taskId);
    if (repositoryId) repositorySequences.set(repositoryId, [...repositorySequences.get(repositoryId) ?? [], value]);
  }
  for (const [repositoryId, values] of repositorySequences) {
    if (values.length !== 2 || new Set(values).size !== 2) {
      problems.push(`repository ${repositoryId} tasks must use opposite crossover sequences.`);
    }
  }
  return cells.length;
}

export function validateProspectiveProtocol(value: unknown): ProspectiveProtocolValidation {
  const root = record(value);
  if (!root) return { problems: ["Protocol must be an object."], repositoryCount: 0, taskCount: 0, plannedRunCount: 0, ready: false };
  const problems: string[] = [];
  if (root.schemaVersion !== 2) problems.push("schemaVersion must be 2.");
  if (root.track !== "prospective-autonomy-p0") problems.push("track must be prospective-autonomy-p0.");
  if (root.status !== "frozen") problems.push("status must be frozen before any calibration run.");
  if (root.originalGate0Status !== "unpassed" || root.prospectiveTasksCountTowardGate0 !== false) {
    problems.push("The prospective track must preserve Gate 0 as unpassed and separate.");
  }
  for (const key of ["amendmentDigest", "protocolDigest", "instrumentationClarificationDigest"]) {
    if (typeof root[key] !== "string" || !SHA256.test(root[key])) problems.push(`${key} must be a SHA-256 digest.`);
  }
  if (root.protocolDigest !== canonicalProspectiveProtocolDigest(root)) {
    problems.push("protocolDigest does not match the canonical frozen protocol body.");
  }
  const protocolFrozenAt = instant(root.protocolFrozenAt);
  if (protocolFrozenAt === undefined) problems.push("protocolFrozenAt must be an ISO timestamp.");
  if (root.firstCalibrationRunAt !== null) problems.push("firstCalibrationRunAt must remain null in the frozen protocol.");
  const rescue = record(root.rescuePolicy);
  if (!rescue || rescue.selection !== "one-preselected-repetition-per-task-arm"
    || rescue.maxActiveMinutes !== 20 || rescue.sameMaintainerWithinRepository !== true
    || rescue.blindToArm !== true || rescue.freezeAutonomousResultFirst !== true) {
    problems.push("rescuePolicy must use the frozen balanced 20-minute rescue design.");
  }

  const repositories = Array.isArray(root.repositories) ? root.repositories : [];
  if (!Array.isArray(root.repositories)) problems.push("repositories must be an array.");
  const repositoryIds = new Set<string>();
  const repositoryFacts = repositories.flatMap((rawRepository, index) => {
    const repository = record(rawRepository);
    if (!repository) {
      problems.push(`repositories[${index}] must be an object.`);
      return [];
    }
    return [validateRepository(repository, index, repositoryIds, problems)];
  });
  if (repositories.length !== 4) problems.push("P0 requires exactly four repositories.");
  const strata = new Set(repositoryFacts.map((facts) => facts.stratum).filter(Boolean));
  for (const stratum of prospectiveLanguageStrata) if (!strata.has(stratum)) problems.push(`P0 is missing repository stratum ${stratum}.`);
  if (repositoryFacts.filter((facts) => facts.externalMaintainer).length < 2) {
    problems.push("P0 requires at least two external-maintainer repositories.");
  }

  const tasks = Array.isArray(root.tasks) ? root.tasks : [];
  if (!Array.isArray(root.tasks)) problems.push("tasks must be an array.");
  const taskIds = new Set<string>();
  const taskRepositories = new Map<string, string>();
  const tasksPerRepository = new Map<string, number>();
  const frozenByRepository = new Map<string, number[]>();
  const repositoryFactsById = new Map(repositoryFacts.flatMap((facts) => facts.id ? [[facts.id, facts] as const] : []));
  for (const [index, rawTask] of tasks.entries()) {
    const task = record(rawTask);
    if (!task) {
      problems.push(`tasks[${index}] must be an object.`);
      continue;
    }
    const facts = validateTask(task, index, repositoryIds, taskIds, problems);
    if (facts.id && facts.repositoryId) taskRepositories.set(facts.id, facts.repositoryId);
    if (facts.repositoryId) {
      const repository = repositoryFactsById.get(facts.repositoryId);
      const snapshot = record(task.snapshot);
      if (repository && (snapshot?.commit !== repository.sourceCommit || snapshot?.tree !== repository.sourceTree)) {
        problems.push(`task ${facts.id ?? index} snapshot does not match repository ${facts.repositoryId} native harness source.`);
      }
      tasksPerRepository.set(facts.repositoryId, (tasksPerRepository.get(facts.repositoryId) ?? 0) + 1);
      if (facts.frozenAt !== undefined) frozenByRepository.set(facts.repositoryId, [...frozenByRepository.get(facts.repositoryId) ?? [], facts.frozenAt]);
    }
  }
  if (tasks.length !== 8) problems.push("P0 requires exactly eight scored task instances.");
  for (const repositoryId of repositoryIds) {
    if (tasksPerRepository.get(repositoryId) !== 2) problems.push(`repository ${repositoryId} must have exactly two scored tasks.`);
  }
  for (const facts of repositoryFacts) {
    const selected = new Set([...taskRepositories].filter(([, repositoryId]) => repositoryId === facts.id).map(([taskId]) => taskId));
    validateBacklog(facts, selected, problems);
  }

  const interventions = Array.isArray(root.interventions) ? root.interventions : [];
  if (!Array.isArray(root.interventions)) problems.push("interventions must be an array.");
  const interventionRepositories = new Set<string>();
  for (const [index, rawIntervention] of interventions.entries()) {
    const intervention = record(rawIntervention);
    if (!intervention) {
      problems.push(`interventions[${index}] must be an object.`);
      continue;
    }
    const repositoryId = text(intervention.repositoryId);
    const validated = validateIntervention(
      intervention,
      index,
      repositoryIds,
      frozenByRepository.get(repositoryId ?? "") ?? [],
      problems,
    );
    if (validated && interventionRepositories.has(validated)) problems.push(`interventions duplicate repository ${validated}.`);
    else if (validated) interventionRepositories.add(validated);
  }
  for (const repositoryId of repositoryIds) if (!interventionRepositories.has(repositoryId)) problems.push(`repository ${repositoryId} has no frozen intervention.`);
  validateRunner(record(root.runner), problems);
  const plannedRunCount = validateRandomization(root.randomization, taskIds, taskRepositories, problems);
  return {
    problems,
    repositoryCount: repositories.length,
    taskCount: tasks.length,
    plannedRunCount,
    ready: problems.length === 0,
  };
}
