import { describe, expect, test } from "bun:test";

import {
  buildProspectiveNativeEventLog,
  type ProspectiveNativeEventDescriptor,
  type ProspectiveNativeEventKind,
} from "../src/engine/evaluations/prospective-native-event-log";
import {
  validateProspectiveRunEvidence,
  type ProspectiveRunEvidenceBundle,
} from "../src/engine/evaluations/prospective-run-evidence";
import {
  buildEvidenceIndependentAudit,
  passingRunEvidenceBundle,
} from "./fixtures/prospective-run-evidence-fixture";

function descriptors(bundle: ProspectiveRunEvidenceBundle): ProspectiveNativeEventDescriptor[] {
  return bundle.eventLog.events.map((event) => ({
    eventId: event.eventId,
    interactionId: event.interactionId,
    observedAt: event.observedAt,
    kind: event.kind,
    payload: event.payload,
  }));
}

function syncIndependentAudit(bundle: ProspectiveRunEvidenceBundle): void {
  bundle.independentAudit = buildEvidenceIndependentAudit(
    bundle.eventLog,
    bundle.run.runId,
    bundle.protocol.body,
  );
}

function withAutonomousEvent(
  kind: ProspectiveNativeEventKind,
  payload: Record<string, unknown> = {},
): ProspectiveRunEvidenceBundle {
  const bundle = passingRunEvidenceBundle();
  const items = descriptors(bundle);
  const verificationIndex = items.findIndex((event) => event.kind === "assistant-tool-call");
  const priorTime = Date.parse(items[verificationIndex - 1]!.observedAt);
  items.splice(verificationIndex, 0, {
    eventId: `${bundle.run.runId}-${kind}`,
    observedAt: new Date(priorTime + 30_000).toISOString(),
    kind,
    payload,
  });
  bundle.eventLog = buildProspectiveNativeEventLog(items);
  syncIndependentAudit(bundle);
  return bundle;
}

describe("prospective instrumentation canaries", () => {
  test("keeps an out-of-band observer view outside autonomous human contact", () => {
    const report = validateProspectiveRunEvidence(withAutonomousEvent("observer-view", { activeSeconds: 5 }));

    expect(report.problems).toEqual([]);
    expect(report.run?.humanLedger.derived).toMatchObject({
      observationSeconds: 5,
      autonomousHumanContactClear: true,
    });
  });

  test("classifies an in-band continue as agent-visible runner control", () => {
    const report = validateProspectiveRunEvidence(withAutonomousEvent("human-continue", { activeSeconds: 3 }));

    expect(report.problems).toEqual([]);
    expect(report.run?.humanLedger.humanEvents[0]).toMatchObject({
      intent: "continue-same-attempt",
      taskRelation: "resumes-same-task",
    });
    expect(report.run?.humanLedger.derived).toMatchObject({
      agentVisibleHumanInteractions: 1,
      humanControlActions: 1,
      autonomousHumanContactClear: false,
    });
  });

  test("classifies a permission decision as human control", () => {
    const report = validateProspectiveRunEvidence(withAutonomousEvent("permission-decision", { activeSeconds: 2 }));

    expect(report.problems).toEqual([]);
    expect(report.run?.humanLedger.humanEvents[0]).toMatchObject({
      kind: "permission-decision",
      intent: "permission-decision",
    });
    expect(report.run?.humanLedger.derived.autonomousHumanContactClear).toBe(false);
  });

  test("treats a human workspace edit as both intervention and last code change", () => {
    const report = validateProspectiveRunEvidence(withAutonomousEvent("human-workspace-edit", { activeSeconds: 20 }));

    expect(report.problems).toEqual([]);
    expect(report.run?.humanLedger.derived).toMatchObject({
      humanWorkspaceEdits: 1,
      autonomousHumanContactClear: false,
    });
    expect(report.run?.verificationAfterLastCodeChange).toBe(true);
  });

  test("records a human safety stop without pretending the run submitted", () => {
    const bundle = withAutonomousEvent("human-safety-stop", { activeSeconds: 4 });
    const items = descriptors(bundle);
    const terminal = items.find((event) => event.kind === "submission")!;
    terminal.kind = "safety-abort";
    terminal.payload = { reasonCode: "human-stop" };
    bundle.eventLog = buildProspectiveNativeEventLog(items);
    syncIndependentAudit(bundle);
    const report = validateProspectiveRunEvidence(bundle);

    expect(report.problems).toEqual([]);
    expect(report.run?.submitted).toBe(false);
    expect(report.run?.humanLedger.derived).toMatchObject({
      safetyResponseSeconds: 4,
      autonomousAssistanceSeconds: 0,
      autonomousHumanContactClear: false,
    });
  });

  test("does not misclassify tool and subagent traffic as human", () => {
    const bundle = withAutonomousEvent("subagent-event", { status: "completed" });
    const subagent = bundle.eventLog.events.find((event) => event.kind === "subagent-event")!;
    const report = validateProspectiveRunEvidence(bundle);

    expect(report.problems).toEqual([]);
    expect(subagent.sourceChannel).toBe("subagent");
    expect(report.run?.toolCalls).toBe(1);
    expect(report.run?.humanLedger.humanEvents.filter((event) => event.phase === "autonomous")).toEqual([]);
    expect(report.run?.humanLedger.derived.autonomousHumanContactClear).toBe(true);
  });
});
