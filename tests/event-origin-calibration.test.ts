import { describe, expect, test } from "bun:test";

import {
  evaluateEventOriginCalibration,
  type EventCalibrationItem,
  type EventCalibrationLabel,
} from "../src/engine/evaluations/event-origin-calibration";

const digest = "a".repeat(64);

function label(
  origin: EventCalibrationLabel["origin"],
  kind: EventCalibrationLabel["kind"],
  annotatorId: string,
): EventCalibrationLabel {
  return {
    annotatorId,
    origin,
    kind,
    intent: origin === "human" ? "correction" : null,
    taskRelation: origin === "human" ? "same-task" : null,
  };
}

function item(
  index: number,
  origin: EventCalibrationLabel["origin"],
  kind: EventCalibrationLabel["kind"],
): EventCalibrationItem {
  return {
    opaqueEventId: `event-${index}`,
    contentSha256: digest,
    predictedOrigin: origin,
    predictedKind: kind,
    classificationBasis: "explicit-schema",
    labels: [label(origin, kind, "annotator-1"), label(origin, kind, "annotator-2")],
    adjudication: null,
  };
}

function passingInput() {
  const items = [
    item(1, "human", "human-text"),
    item(2, "human", "human-command"),
    item(3, "tool", "tool-result"),
    item(4, "subagent", "subagent-result"),
    item(5, "context-manager", "context-compaction"),
    item(6, "skill-loader", "skill-injection"),
  ];
  return {
    rawBlockCount: items.length,
    normalizedEventCount: items.length,
    firstExtractionDigest: digest,
    secondExtractionDigest: digest,
    items,
  };
}

describe("event-origin calibration", () => {
  test("passes exact blinded agreement, conservation, coverage, and extraction", () => {
    const report = evaluateEventOriginCalibration(passingInput());

    expect(report).toMatchObject({
      problems: [],
      eventCount: 6,
      automaticCoverage: 1,
      falseHuman: 0,
      missedHuman: 0,
      originKappa: 1,
      kindKappa: 1,
      pass: true,
    });
  });

  test("fails one synthetic event promoted to human", () => {
    const input = passingInput();
    input.items[2]!.predictedOrigin = "human";
    input.items[2]!.predictedKind = "human-text";

    const report = evaluateEventOriginCalibration(input);
    expect(report.pass).toBe(false);
    expect(report.falseHuman).toBe(1);
  });

  test("requires a third adjudicator when the two labels disagree", () => {
    const input = passingInput();
    input.items[0]!.labels[1] = label("tool", "tool-result", "annotator-2");

    const report = evaluateEventOriginCalibration(input);
    expect(report.pass).toBe(false);
    expect(report.problems).toContain("items[0] disagreement needs a third adjudicator.");
  });

  test("rejects raw content in an exported calibration artifact", () => {
    const input: any = passingInput();
    input.items[0].raw = "private session text";

    const report = evaluateEventOriginCalibration(input);
    expect(report.pass).toBe(false);
    expect(report.problems).toContain(
      "Calibration artifacts must not contain raw content or attachments.",
    );
  });
});
