import { describe, expect, test } from "bun:test";

import {
  buildProspectiveNativeEventLog,
  validateProspectiveNativeEventLog,
} from "../src/engine/evaluations/prospective-native-event-log";
import {
  validateProspectiveEvidenceSet,
  validateProspectiveRunEvidence,
  type ProspectiveRunEvidenceBundle,
} from "../src/engine/evaluations/prospective-run-evidence";
import {
  buildEvidenceIndependentAudit,
  evidenceBundleDigest,
  passingRunEvidenceBundle,
} from "./fixtures/prospective-run-evidence-fixture";

function clone(bundle = passingRunEvidenceBundle()): ProspectiveRunEvidenceBundle {
  return structuredClone(bundle);
}

function rechain(bundle: ProspectiveRunEvidenceBundle): void {
  bundle.eventLog = buildProspectiveNativeEventLog(bundle.eventLog.events.map((event) => ({
    eventId: event.eventId,
    interactionId: event.interactionId,
    observedAt: event.observedAt,
    kind: event.kind,
    payload: event.payload,
  })));
}

function syncIndependentAudit(bundle: ProspectiveRunEvidenceBundle): void {
  bundle.independentAudit = buildEvidenceIndependentAudit(bundle.eventLog, bundle.run.runId, bundle.protocol.body);
}

function rejected(mutator: (bundle: ProspectiveRunEvidenceBundle) => void): string[] {
  const bundle = clone();
  mutator(bundle);
  const report = validateProspectiveRunEvidence(bundle);
  expect(report.ready).toBe(false);
  return report.problems;
}

describe("prospective E0 run evidence", () => {
  test("derives a deterministic scoreable run from a complete no-model evidence bundle", () => {
    const bundle = clone();
    const first = validateProspectiveRunEvidence(bundle);
    const second = validateProspectiveRunEvidence(bundle);

    expect(first.problems).toEqual([]);
    expect(first.ready).toBe(true);
    expect(first.run).toMatchObject({
      submitted: true,
      withinBudget: true,
      hiddenAcceptancePassed: true,
      regressionSuitePassed: true,
      requiredVerificationPassed: true,
      verificationAfterLastCodeChange: true,
      toolCalls: 1,
      inputTokens: 1_000,
    });
    expect(first.run?.evidenceDigest).toBe(second.run?.evidenceDigest);
    expect(first.run?.evidenceDigest).toBe(evidenceBundleDigest(bundle));
  });

  test("rejects missing lifecycle events, broken chains, and an empty recorder", () => {
    expect(rejected((bundle) => bundle.eventLog.events.shift()).some((item) => item.includes("run-start"))).toBe(true);
    expect(rejected((bundle) => {
      bundle.eventLog.events = bundle.eventLog.events.filter((event) => event.kind !== "autonomous-result-frozen");
    }).some((item) => item.includes("autonomous-result-frozen"))).toBe(true);
    expect(rejected((bundle) => bundle.eventLog.events.splice(2, 1)).some((item) => item.includes("chain"))).toBe(true);
    expect(rejected((bundle) => {
      bundle.eventLog.events = [];
      bundle.eventLog.headDigest = "a".repeat(64);
    }).some((item) => item.includes("run-start"))).toBe(true);
  });

  test("rejects model or terminal activity outside the autonomous phase", () => {
    expect(rejected((bundle) => {
      const firstModel = bundle.eventLog.events.find((event) => event.kind === "first-model-action")!;
      const freeze = bundle.eventLog.events.find((event) => event.kind === "autonomous-result-frozen")!;
      firstModel.observedAt = new Date(Date.parse(freeze.observedAt) + 1_000).toISOString();
      bundle.eventLog.events.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
      rechain(bundle);
    }).some((item) => item.includes("first-model-action must occur during the autonomous phase"))).toBe(true);

    expect(rejected((bundle) => {
      const terminal = bundle.eventLog.events.find((event) => event.kind === "submission")!;
      const freeze = bundle.eventLog.events.find((event) => event.kind === "autonomous-result-frozen")!;
      freeze.observedAt = new Date(Date.parse(terminal.observedAt) - 1_000).toISOString();
      bundle.eventLog.events.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
      rechain(bundle);
    }).some((item) => item.includes("terminal event must occur during the autonomous phase"))).toBe(true);
  });

  test("counts normalized payload size as UTF-8 bytes", () => {
    const bundle = passingRunEvidenceBundle({ includeHumanCorrection: true });
    const human = bundle.eventLog.events.find((event) => event.kind === "human-input")!;
    human.payload.label = "corrección";
    rechain(bundle);
    const report = validateProspectiveNativeEventLog(bundle.eventLog);
    const normalized = report.normalizedEvents.find((event) => event.rawRecordId === human.eventId)!;
    const canonical = JSON.stringify({ activeSeconds: 30, label: "corrección" });
    expect(normalized.contentBytes).toBe(new TextEncoder().encode(canonical).byteLength);
    expect(normalized.contentBytes).toBeGreaterThan(canonical.length);
  });

  test("rejects hidden or rephased human interaction against the independent audit", () => {
    const withCorrection = passingRunEvidenceBundle({ includeHumanCorrection: true });
    expect(validateProspectiveRunEvidence(withCorrection).ready).toBe(true);
    const hidden = structuredClone(withCorrection);
    hidden.eventLog.events = hidden.eventLog.events.filter((event) => event.kind !== "human-input");
    rechain(hidden);
    expect(validateProspectiveRunEvidence(hidden).problems).toContain(
      "independent audit: provider-transcript does not match the native event projection.",
    );

    const rephased = structuredClone(withCorrection);
    const human = rephased.eventLog.events.find((event) => event.kind === "human-input")!;
    human.observedAt = new Date(Date.parse(rephased.eventLog.events.find((event) =>
      event.kind === "autonomous-result-frozen")!.observedAt) + 1_000).toISOString();
    rephased.eventLog.events.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
    rechain(rephased);
    expect(validateProspectiveRunEvidence(rephased).ready).toBe(false);
  });

  test("rejects protocol, cell, and post-hoc rescue mutations", () => {
    expect(rejected((bundle) => {
      (bundle.protocol.body as any).tasks[0].verificationPlan.steps[0].argv = ["true"];
    })).toContain("bundle protocol digest does not match its canonical body.");
    expect(rejected((bundle) => { bundle.plannedCell.order += 1; })).toContain(
      "bundle planned cell differs from the frozen randomization cell.",
    );
    expect(rejected((bundle) => { bundle.plannedCell.rescueSelected = false; })).toContain(
      "bundle planned cell differs from the frozen randomization cell.",
    );
  });

  test("rejects unattempted, zero-time, or unselected rescue burden", () => {
    expect(rejected((bundle) => {
      bundle.rescue.status = "not-required";
      bundle.rescue.rescuerAlias = null;
      bundle.rescue.correctionCategories = [];
    })).toContain("a preselected rescue requires a bound, blinded, positive, capped lifecycle.");

    expect(rejected((bundle) => {
      bundle.eventLog.events.find((event) => event.eventId.endsWith("rescue-work"))!.payload.activeSeconds = 0;
      rechain(bundle);
      syncIndependentAudit(bundle);
    })).toContain("a preselected rescue requires a bound, blinded, positive, capped lifecycle.");

    const unselected = passingRunEvidenceBundle({ repetition: 2 });
    unselected.rescue.status = "completed";
    unselected.rescue.rescuerAlias = "rescuer-repository-1";
    unselected.rescue.correctionCategories = ["none-needed"];
    expect(validateProspectiveRunEvidence(unselected).problems).toContain(
      "an unselected repetition cannot contain rescue work or burden.",
    );
  });

  test("rejects replacing native instructions, a second path, wrong brief bytes, and fake delivery", () => {
    expect(rejected((bundle) => {
      bundle.overlay.finalInstructionBase64 = Buffer.from("# Replacement\n").toString("base64");
    }).some((item) => item.includes("did not preserve"))).toBe(true);
    expect(rejected((bundle) => bundle.overlay.changedPaths.push("src/extra.ts"))).toContain(
      "oracle arm must change exactly the frozen instruction path.",
    );
    expect(rejected((bundle) => {
      bundle.overlay.briefBase64 = Buffer.from("different brief\n").toString("base64");
    }).some((item) => item.includes("frozen intervention digest"))).toBe(true);
    expect(rejected((bundle) => { bundle.contextDelivery.loadedInstructionDigest = "b".repeat(64); })).toContain(
      "loaded model context does not prove exact instruction delivery.",
    );
  });

  test("rejects invented verification, unbound grades, suite claims, and final-tree drift", () => {
    expect(rejected((bundle) => { bundle.executions.verification[0]!.stepId = "easy"; })).toContain(
      "verification executions do not equal the protocol-required step ids.",
    );
    expect(rejected((bundle) => { bundle.executions.hiddenAcceptance.suiteDigest = "b".repeat(64); })).toContain(
      "hidden acceptance is not bound to the frozen suite and final tree.",
    );
    expect(rejected((bundle) => { bundle.finalWorkspace.submittedTree = "f".repeat(40); })).toContain(
      "final workspace does not match the submitted event evidence.",
    );
    expect(rejected((bundle) => { bundle.blindedGrades.contractGrades = []; })).toContain(
      "contract grading requires two distinct blinded reviewers.",
    );
  });

  test("rejects self-declared summary counts and reused provider request ids", () => {
    expect(rejected((bundle) => { (bundle as any).toolCalls = 0; })).toContain(
      "bundle must not accept authoritative toolCalls summaries.",
    );
    const first = passingRunEvidenceBundle({ taskId: "task-1-1", arm: "oracle-brief", repetition: 1 });
    const second = passingRunEvidenceBundle({
      protocol: first.protocol.body,
      taskId: "task-1-1",
      arm: "oracle-brief",
      repetition: 2,
    });
    second.providerUsage[0]!.requestId = first.providerUsage[0]!.requestId;
    second.contextDelivery.providerRequestId = first.contextDelivery.providerRequestId;
    const firstModel = second.eventLog.events.find((event) => event.kind === "first-model-action")!;
    firstModel.payload.requestId = first.contextDelivery.providerRequestId;
    rechain(second);
    const set = validateProspectiveEvidenceSet([first, second]);
    expect(set.ready).toBe(false);
    expect(set.problems).toContain("provider request id must be unique across runs.");
  });
});
