import { describe, expect, test } from "bun:test";

import { buildProspectiveNativeEventLog } from "../src/engine/evaluations/prospective-native-event-log";
import type { ProspectiveRunEvidenceBundle } from "../src/engine/evaluations/prospective-run-evidence";
import { evaluateProspectiveP0 } from "../src/engine/evaluations/contracts/prospective-autonomy-result";
import {
  buildEvidenceIndependentAudit,
  passingEvidenceExperiment,
} from "./fixtures/prospective-run-evidence-fixture";

function experiment(): ProspectiveRunEvidenceBundle[] {
  return passingEvidenceExperiment();
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

describe("prospective autonomy P0 evidence result", () => {
  test("passes only from 32 protocol-bound bundles at the task unit", () => {
    const result = evaluateProspectiveP0({ bundles: experiment() });

    expect(result).toMatchObject({
      ready: true,
      pass: true,
      meanAcasLift: 0.375,
      wins: 3,
      ties: 5,
      losses: 0,
      problems: [],
    });
    expect(result.taskEffects).toHaveLength(8);
  });

  test("does not let duplicate or missing runs replace a task", () => {
    const bundles = experiment();
    bundles.pop();
    bundles.push(structuredClone(bundles[0]!));

    const result = evaluateProspectiveP0({ bundles });
    expect(result.ready).toBe(false);
    expect(result.problems.some((problem) => problem.includes("duplicate scored evidence"))).toBe(true);
    expect(result.problems.some((problem) => problem.includes("missing scored evidence"))).toBe(true);
  });

  test("enforces actual start order rather than trusting the frozen cell field", () => {
    const bundles = experiment();
    const first = bundles.find((bundle) => bundle.plannedCell.order === 1)!;
    const last = bundles.find((bundle) => bundle.plannedCell.order === 32)!;
    const firstStart = first.eventLog.events[0]!.observedAt;
    first.eventLog.events.forEach((event) => {
      event.observedAt = new Date(Date.parse(event.observedAt) + 400 * 60_000).toISOString();
    });
    last.eventLog.events.forEach((event) => {
      event.observedAt = new Date(Date.parse(event.observedAt) - 400 * 60_000).toISOString();
    });
    rechain(first);
    rechain(last);
    expect(firstStart).not.toBe(first.eventLog.events[0]!.observedAt);

    const result = evaluateProspectiveP0({ bundles });
    expect(result.ready).toBe(false);
    expect(result.problems).toContain(
      "actual first-attempt order differs from the frozen randomization order.",
    );
  });

  test("requires causal harm adjudication when the oracle arm regresses", () => {
    const bundles = experiment();
    const affectedTask = "task-4-2";
    for (const bundle of bundles.filter((item) =>
      item.plannedCell.taskId === affectedTask && item.plannedCell.arm === "oracle-brief")) {
      bundle.executions.hiddenAcceptance.exitCode = 1;
    }

    const result = evaluateProspectiveP0({ bundles });
    expect(result.ready).toBe(false);
    expect(result.problems.some((problem) =>
      problem.includes("has no causal harm adjudication"))).toBe(true);
  });

  test("rejects a protocol mutation even when every bundle repeats it", () => {
    const bundles = experiment();
    for (const bundle of bundles) {
      (bundle.protocol.body as any).runner.maxToolInvocations = 151;
    }

    const result = evaluateProspectiveP0({ bundles });
    expect(result.ready).toBe(false);
    expect(result.problems.some((problem) =>
      problem.includes("protocolDigest does not match"))).toBe(true);
  });

  test("requires the same blinded rescuer within a repository", () => {
    const bundles = experiment();
    const changed = bundles.find((bundle) =>
      bundle.plannedCell.repositoryId === "repo-1" && bundle.plannedCell.rescueSelected)!;
    changed.rescue.rescuerAlias = "rescuer-other";
    changed.eventLog.events.find((event) => event.kind === "rescue-start")!.payload.rescuerAlias = "rescuer-other";
    rechain(changed);
    changed.independentAudit = buildEvidenceIndependentAudit(changed.eventLog, changed.run.runId, changed.protocol.body);

    const result = evaluateProspectiveP0({ bundles });
    expect(result.ready).toBe(false);
    expect(result.problems).toContain(
      "repository repo-1 uses different preselected rescuers across arms.",
    );
  });
});
