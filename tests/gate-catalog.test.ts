import { describe, expect, test } from "bun:test";
import {
  annotateSessionEvidence,
  seedGateCatalog,
  type GateCatalogEntry
} from "../src/engine/gate-catalog";
import type { SessionEvidence } from "../src/engine/session-evidence";
import type { FailureSignal } from "../src/engine/learn-signals";

function evidence(overrides: Partial<SessionEvidence> = {}): SessionEvidence {
  return {
    projectDir: "/tmp/project",
    steers: [],
    failureClusters: [],
    skillUsage: [],
    codexSessionsMatched: 0,
    codexSessionsScanned: 0,
    notes: [],
    ...overrides
  };
}

function cluster(overrides: Partial<FailureSignal> = {}): FailureSignal {
  return {
    class: "work-loop-failure",
    key: "xcodebuild -scheme",
    count: 10,
    sessionCount: 1,
    dates: ["2026-07-22"],
    sessionRefs: ["codex:rollout-x"],
    samples: [],
    ...overrides
  };
}

describe("seed gate catalog", () => {
  test("imports all 12 gates plus the style rule with valid signature patterns", () => {
    expect(seedGateCatalog.filter((entry) => entry.kind === "gate")).toHaveLength(12);
    expect(seedGateCatalog.filter((entry) => entry.kind === "style")).toHaveLength(1);
    for (const entry of seedGateCatalog) {
      expect(entry.portable.length).toBeGreaterThan(0);
      expect(entry.binding.length).toBeGreaterThan(0);
      expect(entry.symptom.length).toBeGreaterThan(0);
      expect(entry.origin.length).toBeGreaterThan(0);
      for (const signature of entry.signatures) {
        expect(() => new RegExp(signature, "i")).not.toThrow();
      }
    }
    const orders = seedGateCatalog.map((entry) => entry.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe("annotateSessionEvidence", () => {
  test("verbatim WalkLedger steers hit their gates", () => {
    const annotated = annotateSessionEvidence(evidence({
      steers: [
        { text: "the UI is stupidly shitty as you haven't used any of the skills", sessionRef: "codex:a", truncated: false },
        { text: "Open up the simulator and take screenshots of every single page you find in this app", sessionRef: "codex:b", truncated: false },
        { text: "when i invoke the skill is coz im ready. no questpns asked", sessionRef: "codex:c", truncated: false },
        { text: "authorize replacement key; do not submit yet", sessionRef: "codex:d", truncated: false },
        { text: "start failed when I started recording after I added all the permissions", sessionRef: "codex:e", truncated: false },
        { text: "k let's rename the app entirely. what do u propose", sessionRef: "codex:f", truncated: false }
      ]
    }));

    const hintIds = annotated.steers.map((steer) => steer.hints.map((hint) => hint.gateId));
    expect(hintIds[0]).toContain("skeleton-before-features");
    expect(hintIds[1]).toContain("visual-review-multi");
    expect(hintIds[2]).toContain("execute-dont-interrogate");
    expect(hintIds[3]).toContain("human-stop-gate-irreversible");
    expect(hintIds[4]).toContain("device-verification");
    expect(hintIds[5]).toContain("name-preflight");
  });

  test("failure-cluster samples hit pitfall signatures, and unmatched evidence is kept", () => {
    const annotated = annotateSessionEvidence(evidence({
      steers: [{ text: "please add a settings page", sessionRef: "codex:g", truncated: false }],
      failureClusters: [
        cluster({
          samples: ["xcodebuild -scheme App build — error opening '~/.cache/clang/ModuleCache/x' for output: Operation not permitted"]
        }),
        cluster({ key: "swift build", samples: ["swift build — warning: unrelated"] })
      ]
    }));

    expect(annotated.failureClusters[0]!.hints.map((hint) => hint.gateId)).toContain("one-capability-per-change");
    // Annotation never filters: the unmatched steer and cluster survive with empty hints.
    expect(annotated.steers).toHaveLength(1);
    expect(annotated.steers[0]!.hints).toEqual([]);
    expect(annotated.failureClusters[1]!.hints).toEqual([]);
  });

  test("a custom catalog entry participates in matching", () => {
    const custom: GateCatalogEntry = {
      id: "migrations-reviewed",
      kind: "gate",
      order: 99,
      portable: "Schema migrations get a named reviewer.",
      stack: "rails",
      binding: "strong_migrations gate.",
      symptom: "Migration rollbacks in production.",
      origin: "test",
      signatures: ["rollback the migration"]
    };
    const annotated = annotateSessionEvidence(
      evidence({ steers: [{ text: "we had to rollback the migration again", sessionRef: "codex:h", truncated: false }] }),
      [custom]
    );
    expect(annotated.steers[0]!.hints).toEqual([{ gateId: "migrations-reviewed", signature: "rollback the migration" }]);
  });
});
