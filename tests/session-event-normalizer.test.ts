import { describe, expect, test } from "bun:test";

import { buildHumanInterventionLedger } from "../src/engine/evaluations/human-intervention-ledger";
import {
  normalizeClaudeRecord,
  normalizedEventDigest,
  normalizeRunnerNativeEvent,
} from "../src/engine/evaluations/session-event-normalizer";

function claudeUser(content: unknown, extra: Record<string, unknown> = {}): unknown {
  return {
    type: "user",
    uuid: "record-1",
    promptId: "interaction-1",
    timestamp: "2026-08-06T10:00:00Z",
    message: { role: "user", content },
    ...extra,
  };
}

describe("session event normalization", () => {
  test("classifies mixed blocks instead of trusting the outer user role", () => {
    const events = normalizeClaudeRecord(claudeUser([
      { type: "tool_result", tool_use_id: "tool-1", content: "build output" },
      { type: "text", text: "please use the repository pattern" },
      { type: "image", source: { type: "base64", data: "private-image" } },
    ]), "autonomous");

    expect(events.map((event) => [event.origin, event.kind])).toEqual([
      ["tool", "tool-result"],
      ["human", "human-text"],
      ["human", "human-multimodal"],
    ]);
    expect(new Set(events.map((event) => event.interactionId))).toEqual(new Set(["record-1"]));
    expect(JSON.stringify(events)).not.toContain("please use the repository pattern");
    expect(JSON.stringify(events)).not.toContain("private-image");
  });

  test("recognizes versioned synthetic user-side envelopes", () => {
    const records = [
      ["<task-notification><task-id>x</task-id></task-notification>", "subagent", "subagent-status"],
      ["Another Claude session sent a message: done", "subagent", "subagent-result"],
      ["This session is being continued from a previous conversation", "context-manager", "context-compaction"],
      ["Base directory for this skill: /private/path", "skill-loader", "skill-injection"],
      ["<local-command-stdout>ok</local-command-stdout>", "tool", "tool-result"],
    ];

    for (const [content, origin, kind] of records) {
      expect(normalizeClaudeRecord(claudeUser(content), "autonomous")[0]).toMatchObject({
        origin,
        kind,
        humanAuthored: false,
        classificationBasis: "versioned-synthetic-envelope",
      });
    }
  });

  test("treats an interruption as human runner control, not a correction message", () => {
    const event = normalizeClaudeRecord(
      claudeUser("[Request interrupted by user for tool use]"),
      "autonomous",
    )[0]!;

    expect(event).toMatchObject({
      origin: "human",
      kind: "interruption",
      changesRunnerControlState: true,
      agentVisible: true,
    });
  });

  test("abstains on ambiguous user-side content without input-channel provenance", () => {
    const event = normalizeClaudeRecord({
      type: "user",
      uuid: "ambiguous",
      message: { role: "user", content: "status" },
    }, "autonomous")[0]!;

    expect(event).toMatchObject({
      origin: "unknown",
      kind: "unknown-user-side",
      classificationBasis: "unknown",
    });
  });

  test("produces the same digest on repeated normalization", () => {
    const raw = claudeUser([{ type: "text", text: "continue" }]);
    const first = normalizeClaudeRecord(raw, "autonomous");
    const second = normalizeClaudeRecord(raw, "autonomous");

    expect(normalizedEventDigest(first)).toBe(normalizedEventDigest(second));
  });
});

describe("human intervention ledger", () => {
  test("counts one text-plus-image send as one in-band human interaction", () => {
    const events = normalizeClaudeRecord(claudeUser([
      { type: "text", text: "fix the layout" },
      { type: "image", source: { data: "image" } },
    ]), "autonomous");
    const ledger = buildHumanInterventionLedger({
      events,
      annotations: [{
        interactionId: "record-1",
        intent: "correction",
        taskRelation: "same-task",
        activeSeconds: 20,
        basis: "manual-adjudication",
      }],
    });

    expect(ledger.problems).toEqual([]);
    expect(ledger.humanEvents).toHaveLength(1);
    expect(ledger.derived).toMatchObject({
      agentVisibleHumanInteractions: 1,
      autonomousAssistanceSeconds: 20,
      autonomousHumanContactClear: false,
    });
  });

  test("does not fail autonomy for an out-of-band status view", () => {
    const event = normalizeRunnerNativeEvent({
      eventId: "observer-1",
      interactionId: "observer-1",
      observedAt: "2026-08-06T10:05:00Z",
      origin: "human",
      kind: "human-command",
      phase: "autonomous",
      humanAuthored: true,
      agentVisible: false,
      changesRunnerControlState: false,
      changesWorkspace: false,
    });
    const ledger = buildHumanInterventionLedger({
      events: [event],
      annotations: [{
        interactionId: "observer-1",
        intent: "status-check",
        taskRelation: "same-task",
        activeSeconds: 5,
        basis: "runner-control",
      }],
    });

    expect(ledger.derived.observationSeconds).toBe(5);
    expect(ledger.derived.autonomousHumanContactClear).toBe(true);
  });

  test("fails autonomy for an in-band continue control", () => {
    const event = normalizeRunnerNativeEvent({
      eventId: "continue-1",
      interactionId: "continue-1",
      observedAt: "2026-08-06T10:05:00Z",
      origin: "human",
      kind: "human-command",
      phase: "autonomous",
      humanAuthored: true,
      agentVisible: true,
      changesRunnerControlState: true,
      changesWorkspace: false,
    });
    const ledger = buildHumanInterventionLedger({
      events: [event],
      annotations: [{
        interactionId: "continue-1",
        intent: "continue-same-attempt",
        taskRelation: "resumes-same-task",
        activeSeconds: 3,
        basis: "runner-control",
      }],
    });

    expect(ledger.derived).toMatchObject({
      agentVisibleHumanInteractions: 1,
      humanControlActions: 1,
      autonomousHumanContactClear: false,
    });
  });

  test("keeps rescue edits out of the already frozen autonomous result", () => {
    const event = normalizeRunnerNativeEvent({
      eventId: "rescue-edit-1",
      interactionId: "rescue-edit-1",
      observedAt: "2026-08-06T10:20:00Z",
      origin: "human",
      kind: "human-workspace-edit",
      phase: "rescue",
      humanAuthored: true,
      agentVisible: false,
      changesRunnerControlState: false,
      changesWorkspace: true,
    });
    const ledger = buildHumanInterventionLedger({
      events: [event],
      annotations: [{
        interactionId: "rescue-edit-1",
        intent: "direct-code-edit",
        taskRelation: "same-task",
        activeSeconds: 60,
        basis: "runner-control",
      }],
    });

    expect(ledger.derived.autonomousHumanContactClear).toBe(true);
    expect(ledger.derived.postFreezeRescueSeconds).toBe(60);
  });

  test("makes unknown score-affecting provenance unscoreable", () => {
    const events = normalizeClaudeRecord({
      type: "user",
      uuid: "ambiguous",
      message: { role: "user", content: "continue" },
    }, "autonomous");
    const ledger = buildHumanInterventionLedger({ events, annotations: [] });

    expect(ledger.scoreable).toBe(false);
    expect(ledger.unknownScoreAffectingEventIds).toEqual(["ambiguous:0"]);
    expect(ledger.derived.autonomousHumanContactClear).toBe(false);
  });
});
