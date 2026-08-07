import type { ClassificationBasis, EventKind, EventOrigin } from "./session-event-normalizer";
import type { HumanIntent, TaskRelation } from "./human-intervention-ledger";

export type EventCalibrationLabel = {
  annotatorId: string;
  origin: EventOrigin;
  kind: EventKind;
  intent: HumanIntent | null;
  taskRelation: TaskRelation | null;
};

export type EventCalibrationItem = {
  opaqueEventId: string;
  contentSha256: string;
  predictedOrigin: EventOrigin;
  predictedKind: EventKind;
  classificationBasis: ClassificationBasis;
  labels: [EventCalibrationLabel, EventCalibrationLabel];
  adjudication: EventCalibrationLabel | null;
};

export type EventOriginCalibrationReport = {
  problems: string[];
  eventCount: number;
  automaticCoverage: number;
  falseHuman: number;
  missedHuman: number;
  originKappa: number;
  kindKappa: number;
  intentKappa: number;
  taskRelationKappa: number;
  syntheticMacroF1: number;
  minimumSyntheticRecall: number;
  checks: Array<{ id: string; ok: boolean; actual: number | boolean; limit: string }>;
  pass: boolean;
};

const SHA256 = /^[0-9a-f]{64}$/;
const prohibitedKeys = new Set(["text", "content", "image", "attachment", "raw", "payload"]);

function containsRawContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRawContent);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => prohibitedKeys.has(key) || containsRawContent(item));
}

function kappa(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  const observed = left.filter((value, index) => value === right[index]).length / left.length;
  const labels = new Set([...left, ...right]);
  const expected = [...labels].reduce((sum, label) => {
    const leftRate = left.filter((value) => value === label).length / left.length;
    const rightRate = right.filter((value) => value === label).length / right.length;
    return sum + leftRate * rightRate;
  }, 0);
  if (expected === 1) return observed === 1 ? 1 : 0;
  return (observed - expected) / (1 - expected);
}

function truth(item: EventCalibrationItem): EventCalibrationLabel {
  const [left, right] = item.labels;
  const agree = left.origin === right.origin
    && left.kind === right.kind
    && left.intent === right.intent
    && left.taskRelation === right.taskRelation;
  return agree ? left : item.adjudication ?? left;
}

function macroF1(items: readonly EventCalibrationItem[]): { macro: number; minimumRecall: number } {
  const synthetic = items.filter((item) => truth(item).origin !== "human");
  const kinds = new Set(synthetic.map((item) => truth(item).kind));
  const values = [...kinds].map((kind) => {
    const truePositive = synthetic.filter((item) => truth(item).kind === kind && item.predictedKind === kind).length;
    const falsePositive = synthetic.filter((item) => truth(item).kind !== kind && item.predictedKind === kind).length;
    const falseNegative = synthetic.filter((item) => truth(item).kind === kind && item.predictedKind !== kind).length;
    const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
    const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
    const f1 = precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
    return { f1, recall };
  });
  return {
    macro: values.length ? values.reduce((sum, value) => sum + value.f1, 0) / values.length : 0,
    minimumRecall: values.length ? Math.min(...values.map((value) => value.recall)) : 0,
  };
}

export function evaluateEventOriginCalibration(input: {
  rawBlockCount: number;
  normalizedEventCount: number;
  firstExtractionDigest: string;
  secondExtractionDigest: string;
  items: readonly EventCalibrationItem[];
}): EventOriginCalibrationReport {
  const problems: string[] = [];
  if (containsRawContent(input)) problems.push("Calibration artifacts must not contain raw content or attachments.");
  if (!Number.isSafeInteger(input.rawBlockCount) || input.rawBlockCount < 1
    || input.normalizedEventCount !== input.rawBlockCount || input.items.length !== input.normalizedEventCount) {
    problems.push("Calibration must conserve every raw content block into one annotated event.");
  }
  if (!SHA256.test(input.firstExtractionDigest) || !SHA256.test(input.secondExtractionDigest)) {
    problems.push("Calibration needs two extraction digests.");
  }
  const ids = new Set<string>();
  for (const [index, item] of input.items.entries()) {
    if (!item.opaqueEventId?.trim() || ids.has(item.opaqueEventId)) problems.push(`items[${index}] has a missing or duplicate opaque id.`);
    ids.add(item.opaqueEventId);
    if (!SHA256.test(item.contentSha256)) problems.push(`items[${index}].contentSha256 is invalid.`);
    if (item.labels.length !== 2 || item.labels[0].annotatorId === item.labels[1].annotatorId) {
      problems.push(`items[${index}] needs two independent annotators.`);
      continue;
    }
    const [left, right] = item.labels;
    const disagree = left.origin !== right.origin || left.kind !== right.kind
      || left.intent !== right.intent || left.taskRelation !== right.taskRelation;
    if (disagree && (!item.adjudication || item.adjudication.annotatorId === left.annotatorId
      || item.adjudication.annotatorId === right.annotatorId)) {
      problems.push(`items[${index}] disagreement needs a third adjudicator.`);
    }
    for (const label of item.labels) {
      if (label.origin === "human" && (!label.intent || !label.taskRelation)) {
        problems.push(`items[${index}] human labels need intent and task relation.`);
      }
    }
  }

  const left = input.items.map((item) => item.labels[0]);
  const right = input.items.map((item) => item.labels[1]);
  const binary = (origin: EventOrigin) => origin === "human" ? "human" : "synthetic";
  const originKappa = kappa(left.map((label) => binary(label.origin)), right.map((label) => binary(label.origin)));
  const kindKappa = kappa(left.map((label) => label.kind), right.map((label) => label.kind));
  const humanPairs = input.items.filter((item) =>
    item.labels[0].origin === "human" && item.labels[1].origin === "human");
  const intentKappa = kappa(
    humanPairs.map((item) => String(item.labels[0].intent)),
    humanPairs.map((item) => String(item.labels[1].intent)),
  );
  const taskRelationKappa = kappa(
    humanPairs.map((item) => String(item.labels[0].taskRelation)),
    humanPairs.map((item) => String(item.labels[1].taskRelation)),
  );
  const falseHuman = input.items.filter((item) => item.predictedOrigin === "human" && truth(item).origin !== "human").length;
  const missedHuman = input.items.filter((item) => item.predictedOrigin !== "human" && truth(item).origin === "human").length;
  const automaticCoverage = input.items.length
    ? input.items.filter((item) => item.classificationBasis !== "unknown").length / input.items.length
    : 0;
  const synthetic = macroF1(input.items);
  const checks = [
    { id: "block-conservation", ok: input.rawBlockCount === input.normalizedEventCount, actual: input.normalizedEventCount, limit: "100%" },
    { id: "deterministic-digest", ok: input.firstExtractionDigest === input.secondExtractionDigest, actual: input.firstExtractionDigest === input.secondExtractionDigest, limit: "true" },
    { id: "origin-agreement", ok: originKappa >= 0.95, actual: originKappa, limit: ">= 0.95" },
    { id: "kind-agreement", ok: kindKappa >= 0.90, actual: kindKappa, limit: ">= 0.90" },
    { id: "intent-agreement", ok: intentKappa >= 0.80, actual: intentKappa, limit: ">= 0.80" },
    { id: "task-relation-agreement", ok: taskRelationKappa >= 0.80, actual: taskRelationKappa, limit: ">= 0.80" },
    { id: "false-human", ok: falseHuman === 0, actual: falseHuman, limit: "0" },
    { id: "missed-human", ok: missedHuman === 0, actual: missedHuman, limit: "0" },
    { id: "automatic-coverage", ok: automaticCoverage >= 0.95, actual: automaticCoverage, limit: ">= 0.95" },
    { id: "synthetic-macro-f1", ok: synthetic.macro >= 0.95, actual: synthetic.macro, limit: ">= 0.95" },
    { id: "synthetic-minimum-recall", ok: synthetic.minimumRecall >= 0.90, actual: synthetic.minimumRecall, limit: ">= 0.90" },
  ];
  return {
    problems,
    eventCount: input.items.length,
    automaticCoverage,
    falseHuman,
    missedHuman,
    originKappa,
    kindKappa,
    intentKappa,
    taskRelationKappa,
    syntheticMacroF1: synthetic.macro,
    minimumSyntheticRecall: synthetic.minimumRecall,
    checks,
    pass: problems.length === 0 && checks.every((check) => check.ok),
  };
}
