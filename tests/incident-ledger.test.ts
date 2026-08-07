import { describe, expect, test } from "bun:test";

import { validateIncidentLedger } from "../src/engine/evaluations/contracts/incident-ledger";

const commit = "a".repeat(40);
const tree = "b".repeat(40);

function auditShape(): any {
  return {
    schemaVersion: 1,
    gate: {
      minimumIndependentIncidents: 12,
      observed: {
        candidateIncidents: 12,
        independentCandidateClusters: 8,
        qualifiedIncidents: 0,
        independentQualifiedClusters: 0,
      },
      status: "collecting",
    },
    incidents: Array.from({ length: 12 }, (_, index) => ({
      id: `synthetic-contract-case-${index + 1}`,
      status: "candidate",
      independentCluster: `cluster-${(index % 8) + 1}`,
      repository: { slug: `owner/repository-${index + 1}` },
      qualification: {
        material: true,
        preventable: true,
        exactSnapshot: true,
        originalRequestRecovered: true,
        environmentRecovered: false,
        prevalenceMeasured: false,
        blockers: ["environment and prevalence are not reconstructed"],
      },
      snapshot: { commit, tree, overlay: "clean-commit" },
      task: {
        summary: "Exercise the ledger validator without private session data.",
        evidenceCutoff: "2026-08-06T07:00:00Z",
      },
      preincidentEvidence: [],
      recoveryAblation: {
        pathsLoc: "not-assessed",
        static: "not-assessed",
        staticPlusEligibleSessions: "not-assessed",
      },
      groundTruth: { fixCommit: commit },
      rubric: { criteria: ["The objective verifier passes."] },
    })),
  };
}

describe("incident ledger", () => {
  test("derives the corrected Gate 0 audit shape without claiming a pass", () => {
    const result = validateIncidentLedger(auditShape());

    expect(result.problems).toEqual([]);
    expect(result.candidateIncidentCount).toBe(12);
    expect(result.independentCandidateClusters).toBe(8);
    expect(result.qualifiedIncidentCount).toBe(0);
    expect(result.gatePassed).toBe(false);
  });

  test("rejects session evidence observed after the incident cutoff", () => {
    const ledger = auditShape();
    const incident = ledger.incidents[0];
    incident.preincidentEvidence.push({
      kind: "session",
      use: "selector",
      session: "late-session",
      event: 1,
      observedAt: "2026-08-06T07:16:33Z",
    });

    const result = validateIncidentLedger(ledger);
    expect(result.problems).toContain(
      "synthetic-contract-case-1: selector session evidence occurs after the incident cutoff.",
    );
  });

  test("rejects an sxr recovery lift without eligible preincident session evidence", () => {
    const ledger = auditShape();
    ledger.incidents[0].recoveryAblation.staticPlusEligibleSessions = "full";

    const result = validateIncidentLedger(ledger);
    expect(result.problems).toContain(
      "synthetic-contract-case-1: session-driven recovery lift has no eligible preincident session evidence.",
    );
  });

  test("does not allow an incomplete candidate to be relabeled qualified", () => {
    const ledger = auditShape();
    ledger.incidents[0].status = "qualified";
    ledger.gate.observed.qualifiedIncidents = 1;
    ledger.gate.observed.independentQualifiedClusters = 1;

    const result = validateIncidentLedger(ledger);
    expect(result.problems).toContain(
      "synthetic-contract-case-1: qualified incident requires qualification.environmentRecovered=true.",
    );
    expect(result.problems).toContain(
      "synthetic-contract-case-1: qualified incident requires qualification.prevalenceMeasured=true.",
    );
  });
});
