import { describe, expect, test } from "bun:test";

import {
  canonicalProspectiveProtocolDigest,
  validateProspectiveProtocol,
} from "../src/engine/evaluations/contracts/prospective-autonomy-protocol";
import { sha256Evidence } from "../src/engine/evaluations/contracts/prospective-autonomy-protocol-items";
import { frozenProspectiveProtocol } from "./fixtures/prospective-autonomy-fixture";

describe("prospective autonomy protocol", () => {
  test("accepts the frozen eight-task P0 design at the task unit", () => {
    expect(validateProspectiveProtocol(frozenProspectiveProtocol())).toMatchObject({
      problems: [], repositoryCount: 4, taskCount: 8, plannedRunCount: 32, ready: true,
    });
  });

  test("keeps prospective tasks separate from the failed historical Gate 0", () => {
    const protocol = frozenProspectiveProtocol();
    protocol.originalGate0Status = "passed";
    protocol.prospectiveTasksCountTowardGate0 = true;
    expect(validateProspectiveProtocol(protocol).problems).toContain(
      "The prospective track must preserve Gate 0 as unpassed and separate.",
    );
  });

  test("rejects future Git objects and intervention authoring before task freeze", () => {
    const protocol = frozenProspectiveProtocol();
    protocol.tasks[0].snapshot.noFutureObjects = false;
    protocol.interventions[0].authoringStartedAt = "2026-08-06T10:06:00Z";
    const problems = validateProspectiveProtocol(protocol).problems;
    expect(problems).toContain("task task-1-1.snapshot must use a future-free snapshot-root history.");
    expect(problems).toContain(
      "intervention repo-1 authoring started before task packets, suites, and contracts were frozen.",
    );
  });

  test("binds the native harness manifest to every task snapshot", () => {
    const protocol = frozenProspectiveProtocol();
    protocol.repositories[0].nativeHarnessManifest.sourceTree = "d".repeat(40);

    const problems = validateProspectiveProtocol(protocol).problems;
    expect(problems).toContain("task task-1-1 snapshot does not match repository repo-1 native harness source.");
    expect(problems).toContain("task task-1-2 snapshot does not match repository repo-1 native harness source.");
  });

  test("rejects session history and any mutation of the native harness", () => {
    const protocol = frozenProspectiveProtocol();
    protocol.interventions[0].evidenceSources.push("session");
    protocol.interventions[0].nativeHarnessPreserved = false;
    const problems = validateProspectiveProtocol(protocol).problems;
    expect(problems).toContain("intervention repo-1.evidenceSources must contain eligible task-blind sources.");
    expect(problems).toContain("intervention repo-1.nativeHarnessPreserved must be true.");
  });

  test("accepts an evidence-backed none decision without fake artifact delivery", () => {
    const protocol = frozenProspectiveProtocol();
    protocol.interventions[0] = {
      ...protocol.interventions[0],
      kind: "none",
      singleNativeArtifact: false,
      delivery: "not-applicable",
    };
    for (const key of ["artifactPath", "contentDigest", "evidenceDigest", "utf8Bytes", "estimatedTokens", "normativeStatements"]) {
      delete protocol.interventions[0][key];
    }
    const { interventionDigest: _, ...interventionBody } = protocol.interventions[0];
    protocol.interventions[0].interventionDigest = sha256Evidence(interventionBody);
    protocol.protocolDigest = canonicalProspectiveProtocolDigest(protocol);
    expect(validateProspectiveProtocol(protocol).problems).toEqual([]);
  });

  test("rejects cherry-picked backlog tasks and a missing repetition", () => {
    const protocol = frozenProspectiveProtocol();
    protocol.repositories[0].backlog[0].selectedAs = null;
    protocol.repositories[0].backlog[2].selectedAs = "scored";
    protocol.randomization.cells.pop();
    const problems = validateProspectiveProtocol(protocol).problems;
    expect(problems).toContain(
      "repository repo-1.backlog must select the first two eligible tasks and next two replacements.",
    );
    expect(problems.some((problem: string) => problem.includes("randomization is missing"))).toBe(true);
  });
});
