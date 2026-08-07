import { createHash } from "node:crypto";

import { canonicalEvidence } from "../behavior-evidence";
import type { NormalizedEvent } from "./session-event-normalizer";

export type HumanIntent =
  | "initial-task-request"
  | "clarification-answer"
  | "status-check"
  | "continue-same-attempt"
  | "restart-same-task"
  | "correction"
  | "verification-direction"
  | "scope-change"
  | "new-task-request"
  | "direct-runtime-command"
  | "direct-code-edit"
  | "permission-decision"
  | "safety-stop"
  | "other";

export type TaskRelation =
  | "starts-run-task"
  | "same-task"
  | "resumes-same-task"
  | "restarts-attempt"
  | "ends-task"
  | "new-task"
  | "not-applicable"
  | "unknown";

export type HumanEventAnnotation = {
  interactionId: string;
  intent: HumanIntent;
  taskRelation: TaskRelation;
  activeSeconds: number;
  basis: "runner-control" | "manual-adjudication";
};

export type HumanEventReference = {
  interactionId: string;
  eventIds: string[];
  phase: NormalizedEvent["phase"];
  kind: NormalizedEvent["kind"];
  intent: HumanIntent;
  taskRelation: TaskRelation;
  agentVisible: boolean;
  changesRunnerControlState: boolean;
  changesWorkspace: boolean;
  activeSeconds: number;
};

export type HumanInterventionLedger = {
  schemaVersion: 1;
  extractorVersion: string;
  normalizedEventDigest: string;
  ledgerDigest: string;
  eventCount: number;
  humanEvents: HumanEventReference[];
  unknownScoreAffectingEventIds: string[];
  derived: {
    agentVisibleHumanInteractions: number;
    humanControlActions: number;
    humanWorkspaceEdits: number;
    autonomousAssistanceSeconds: number;
    postFreezeRescueSeconds: number;
    safetyResponseSeconds: number;
    observationSeconds: number;
    autonomousHumanContactClear: boolean;
  };
  problems: string[];
  scoreable: boolean;
};

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalEvidence(value)).digest("hex");
}

function eventId(event: NormalizedEvent): string {
  return `${event.rawRecordId}:${event.blockIndex}`;
}

function validSeconds(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function humanInteraction(event: NormalizedEvent): boolean {
  return event.origin === "human" || event.humanAuthored;
}

export function buildHumanInterventionLedger(input: {
  events: readonly NormalizedEvent[];
  annotations: readonly HumanEventAnnotation[];
}): HumanInterventionLedger {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const event of input.events) {
    const id = eventId(event);
    if (ids.has(id)) problems.push(`Duplicate normalized event id ${id}.`);
    ids.add(id);
    if (event.schemaVersion !== 1) problems.push(`Event ${id} has an unsupported schema version.`);
    if (!event.extractorVersion?.trim()) problems.push(`Event ${id} has no extractor version.`);
  }
  const extractorVersions = new Set(input.events.map((event) => event.extractorVersion));
  if (extractorVersions.size > 1) problems.push("A ledger cannot mix extractor versions.");

  const annotations = new Map<string, HumanEventAnnotation>();
  for (const annotation of input.annotations) {
    if (!annotation.interactionId?.trim()) {
      problems.push("Human event annotation has no interaction id.");
      continue;
    }
    if (annotations.has(annotation.interactionId)) {
      problems.push(`Duplicate human event annotation ${annotation.interactionId}.`);
    }
    if (!validSeconds(annotation.activeSeconds)) {
      problems.push(`Human event annotation ${annotation.interactionId} has invalid active seconds.`);
    }
    annotations.set(annotation.interactionId, annotation);
  }

  const grouped = new Map<string, NormalizedEvent[]>();
  for (const event of input.events.filter(humanInteraction)) {
    grouped.set(event.interactionId, [...grouped.get(event.interactionId) ?? [], event]);
  }
  const humanEvents: HumanEventReference[] = [];
  for (const [interactionId, events] of grouped) {
    const annotation = annotations.get(interactionId);
    if (!annotation) problems.push(`Human interaction ${interactionId} has no intent annotation.`);
    const phases = new Set(events.map((event) => event.phase));
    if (phases.size !== 1) problems.push(`Human interaction ${interactionId} crosses run phases.`);
    humanEvents.push({
      interactionId,
      eventIds: events.map(eventId).sort(),
      phase: events[0]!.phase,
      kind: events.find((event) => event.kind === "human-text")?.kind ?? events[0]!.kind,
      intent: annotation?.intent ?? "other",
      taskRelation: annotation?.taskRelation ?? "unknown",
      agentVisible: events.some((event) => event.agentVisible),
      changesRunnerControlState: events.some((event) => event.changesRunnerControlState),
      changesWorkspace: events.some((event) => event.changesWorkspace),
      activeSeconds: annotation?.activeSeconds ?? 0,
    });
  }
  for (const interactionId of annotations.keys()) {
    if (!grouped.has(interactionId)) problems.push(`Annotation ${interactionId} has no normalized human interaction.`);
  }
  humanEvents.sort((left, right) => left.interactionId.localeCompare(right.interactionId));

  const autonomous = humanEvents.filter((item) => item.phase === "autonomous");
  const unknownScoreAffectingEventIds = input.events
    .filter((item) => item.phase === "autonomous"
      && item.origin === "unknown"
      && (item.agentVisible || item.changesRunnerControlState || item.changesWorkspace))
    .map(eventId)
    .sort();
  const seconds = (predicate: (item: HumanEventReference) => boolean) => humanEvents
    .filter(predicate)
    .reduce((sum, item) => sum + item.activeSeconds, 0);
  const agentVisibleHumanInteractions = autonomous.filter((item) => item.agentVisible).length;
  const humanControlActions = autonomous.filter((item) => item.changesRunnerControlState).length;
  const humanWorkspaceEdits = autonomous.filter((item) => item.changesWorkspace).length;
  const derived = {
    agentVisibleHumanInteractions,
    humanControlActions,
    humanWorkspaceEdits,
    autonomousAssistanceSeconds: seconds((item) =>
      item.phase === "autonomous" && item.intent !== "status-check" && item.intent !== "safety-stop"),
    postFreezeRescueSeconds: seconds((item) => item.phase === "rescue" && item.intent !== "safety-stop"),
    safetyResponseSeconds: seconds((item) => item.intent === "safety-stop"),
    observationSeconds: seconds((item) => item.intent === "status-check"),
    autonomousHumanContactClear:
      agentVisibleHumanInteractions === 0
      && humanControlActions === 0
      && humanWorkspaceEdits === 0
      && unknownScoreAffectingEventIds.length === 0,
  };
  const normalizedEventDigest = digest(input.events);
  const body = {
    schemaVersion: 1 as const,
    extractorVersion: [...extractorVersions][0] ?? "unknown",
    normalizedEventDigest,
    eventCount: input.events.length,
    humanEvents,
    unknownScoreAffectingEventIds,
    derived,
  };
  return {
    ...body,
    ledgerDigest: digest(body),
    problems,
    scoreable: problems.length === 0 && unknownScoreAffectingEventIds.length === 0,
  };
}
