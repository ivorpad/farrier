import { describe, expect, test } from "bun:test";

import { evaluateProspectiveP0 } from "../src/engine/evaluations/contracts/prospective-autonomy-result";
import { buildProspectiveNativeEventLog } from "../src/engine/evaluations/prospective-native-event-log";
import {
  validateProspectiveEvidenceSet,
  validateProspectiveRunEvidence,
  type ProspectiveRunEvidenceBundle,
} from "../src/engine/evaluations/prospective-run-evidence";
import {
  passingEvidenceExperiment,
  passingRunEvidenceBundle,
} from "./fixtures/prospective-run-evidence-fixture";

function rechain(bundle: ProspectiveRunEvidenceBundle): void {
  bundle.eventLog = buildProspectiveNativeEventLog(bundle.eventLog.events.map((event) => ({
    eventId: event.eventId,
    interactionId: event.interactionId,
    observedAt: event.observedAt,
    kind: event.kind,
    payload: event.payload,
  })));
}

function rejectSingle(
  mutate: (bundle: ProspectiveRunEvidenceBundle) => void,
  expected: string,
  includeHumanCorrection = false,
): void {
  const bundle = passingRunEvidenceBundle({ includeHumanCorrection });
  mutate(bundle);
  const report = validateProspectiveRunEvidence(bundle);
  expect(report.ready).toBe(false);
  expect(report.problems.some((problem) => problem.includes(expected))).toBe(true);
}

describe("Oracle E0 pass-forgery matrix", () => {
  test("E0-01 rejects a deleted run-start", () => rejectSingle((bundle) => {
    bundle.eventLog.events = bundle.eventLog.events.filter((event) => event.kind !== "run-start");
    rechain(bundle);
  }, "missing run-start"));

  test("E0-02 rejects a deleted autonomous freeze", () => rejectSingle((bundle) => {
    bundle.eventLog.events = bundle.eventLog.events.filter((event) => event.kind !== "autonomous-result-frozen");
    rechain(bundle);
  }, "missing autonomous-result-frozen"));

  test("E0-03 rejects a broken hash-chain event", () => rejectSingle((bundle) => {
    bundle.eventLog.events[1]!.payload.requestId = "forged-request";
  }, "digest is invalid"));

  test("E0-04 rejects removal of a human correction", () => rejectSingle((bundle) => {
    bundle.eventLog.events = bundle.eventLog.events.filter((event) => event.kind !== "human-input");
    rechain(bundle);
  }, "provider-transcript does not match the native event projection", true));

  test("E0-05 rejects moving autonomous human contact into rescue", () => rejectSingle((bundle) => {
    const items = bundle.eventLog.events
      .filter((event) => event.kind !== "human-input")
      .map((event) => ({
        eventId: event.eventId,
        interactionId: event.interactionId,
        observedAt: event.observedAt,
        kind: event.kind,
        payload: event.payload,
      }));
    const freezeIndex = items.findIndex((event) => event.kind === "autonomous-result-frozen");
    const frozenAt = Date.parse(items[freezeIndex]!.observedAt);
    items.splice(freezeIndex + 1, 0,
      { eventId: "forged-rescue-start", interactionId: "forged-rescue-start", observedAt: new Date(frozenAt + 10_000).toISOString(), kind: "rescue-start", payload: {} },
      { eventId: `${bundle.run.runId}-human`, interactionId: `${bundle.run.runId}-human`, observedAt: new Date(frozenAt + 20_000).toISOString(), kind: "human-input", payload: { activeSeconds: 30 } },
      { eventId: "forged-rescue-end", interactionId: "forged-rescue-end", observedAt: new Date(frozenAt + 30_000).toISOString(), kind: "rescue-end", payload: {} },
    );
    bundle.eventLog = buildProspectiveNativeEventLog(items);
  }, "provider-transcript does not match the native event projection", true));

  test("E0-06 rejects changing actual execution order", () => {
    const bundles = passingEvidenceExperiment();
    const first = bundles.find((bundle) => bundle.plannedCell.order === 1)!;
    const last = bundles.find((bundle) => bundle.plannedCell.order === 32)!;
    first.eventLog.events.forEach((event) => {
      event.observedAt = new Date(Date.parse(event.observedAt) + 400 * 60_000).toISOString();
    });
    last.eventLog.events.forEach((event) => {
      event.observedAt = new Date(Date.parse(event.observedAt) - 400 * 60_000).toISOString();
    });
    rechain(first);
    rechain(last);
    const report = evaluateProspectiveP0({ bundles });
    expect(report.ready).toBe(false);
    expect(report.problems).toContain("actual first-attempt order differs from the frozen randomization order.");
  });

  test("E0-07 rejects a protocol body mutation without a new digest", () => rejectSingle((bundle) => {
    (bundle.protocol.body as any).runner.maxToolInvocations += 1;
  }, "protocol digest"));

  test("E0-08 rejects post-hoc rescue selection", () => rejectSingle((bundle) => {
    bundle.plannedCell.rescueSelected = !bundle.plannedCell.rescueSelected;
  }, "planned cell differs"));

  test("E0-09 rejects replacing native instructions", () => rejectSingle((bundle) => {
    bundle.overlay.finalInstructionBase64 = Buffer.from("# Replacement\n").toString("base64");
  }, "did not preserve"));

  test("E0-10 rejects changing a second workspace path", () => rejectSingle((bundle) => {
    bundle.overlay.changedPaths.push("src/extra.ts");
  }, "change exactly the frozen instruction path"));

  test("E0-11 rejects wrong intervention bytes", () => rejectSingle((bundle) => {
    bundle.overlay.briefBase64 = Buffer.from("wrong brief\n").toString("base64");
  }, "frozen intervention digest"));

  test("E0-12 rejects an unproved context-delivery claim", () => rejectSingle((bundle) => {
    bundle.contextDelivery.loadedInstructionDigest = "b".repeat(64);
  }, "does not prove exact instruction delivery"));

  test("E0-13 rejects an invented easy verification", () => rejectSingle((bundle) => {
    bundle.executions.verification[0]!.stepId = "easy";
  }, "protocol-required step ids"));

  test("E0-14 rejects a hidden-pass claim without execution", () => rejectSingle((bundle) => {
    (bundle.executions as any).hiddenAcceptance = undefined;
    (bundle as any).hiddenAcceptancePassed = true;
  }, "hidden acceptance execution is missing"));

  test("E0-15 rejects final-tree drift after verification", () => rejectSingle((bundle) => {
    bundle.finalWorkspace.submittedTree = "f".repeat(40);
  }, "final workspace does not match"));

  test("E0-16 rejects zero contract violations without grades", () => rejectSingle((bundle) => {
    bundle.blindedGrades.contractGrades = [];
    (bundle as any).materialContractViolations = 0;
  }, "requires two distinct blinded reviewers"));

  test("E0-17 rejects an Oracle regression without harm adjudication", () => {
    const bundles = passingEvidenceExperiment();
    for (const bundle of bundles.filter((item) =>
      item.plannedCell.taskId === "task-4-2" && item.plannedCell.arm === "oracle-brief")) {
      bundle.executions.hiddenAcceptance.exitCode = 1;
    }
    const report = evaluateProspectiveP0({ bundles });
    expect(report.ready).toBe(false);
    expect(report.problems.some((problem) => problem.includes("has no causal harm adjudication"))).toBe(true);
  });

  test("E0-18 rejects reuse of a provider request", () => {
    const first = passingRunEvidenceBundle({ taskId: "task-1-1", arm: "oracle-brief", repetition: 1 });
    const second = passingRunEvidenceBundle({
      protocol: first.protocol.body,
      taskId: "task-1-1",
      arm: "oracle-brief",
      repetition: 2,
    });
    second.providerUsage[0]!.requestId = first.providerUsage[0]!.requestId;
    second.contextDelivery.providerRequestId = first.contextDelivery.providerRequestId;
    second.eventLog.events.find((event) => event.kind === "first-model-action")!.payload.requestId =
      first.contextDelivery.providerRequestId;
    rechain(second);
    const report = validateProspectiveEvidenceSet([first, second]);
    expect(report.ready).toBe(false);
    expect(report.problems).toContain("provider request id must be unique across runs.");
  });

  test("E0-19 rejects altered reported tool and token counts", () => rejectSingle((bundle) => {
    (bundle as any).toolCalls = 0;
    (bundle as any).inputTokens = 0;
  }, "authoritative toolCalls"));

  test("E0-20 rejects an empty event log", () => rejectSingle((bundle) => {
    bundle.eventLog = buildProspectiveNativeEventLog([]);
  }, "missing run-start"));
});
