import { createHash } from "node:crypto";

import { canonicalEvidence } from "../behavior-evidence";
import type { HumanEventAnnotation } from "./human-intervention-ledger";
import type { NormalizedEvent, RunPhase } from "./session-event-normalizer";

export type ProspectiveNativeEventKind =
  | "run-start"
  | "first-model-action"
  | "assistant-message"
  | "assistant-tool-call"
  | "tool-result"
  | "human-input"
  | "human-control"
  | "human-continue"
  | "human-safety-stop"
  | "human-workspace-edit"
  | "observer-view"
  | "permission-request"
  | "permission-decision"
  | "subagent-event"
  | "workspace-change"
  | "submission"
  | "autonomous-result-frozen"
  | "rescue-start"
  | "rescue-end"
  | "run-end"
  | "timeout"
  | "safety-abort";

export type ProspectiveNativeEvent = {
  schemaVersion: 1;
  sequence: number;
  previousEventDigest: string | null;
  eventDigest: string;
  eventId: string;
  interactionId: string;
  observedAt: string;
  kind: ProspectiveNativeEventKind;
  sourceChannel: string;
  payloadDigest: string;
  payload: Record<string, unknown>;
};

export type ProspectiveNativeEventDescriptor = Pick<ProspectiveNativeEvent,
  "eventId" | "observedAt" | "kind" | "payload"
> & { interactionId?: string };

export type ProspectiveHumanEventKind = Extract<ProspectiveNativeEventKind,
  "human-input" | "human-control" | "human-continue" | "human-safety-stop" |
  "human-workspace-edit" | "observer-view" | "permission-decision"
>;

export type ProspectiveNativeEventLog = {
  schemaVersion: 1;
  events: ProspectiveNativeEvent[];
  headDigest: string;
};

export type ProspectiveNativeEventLogReport = {
  valid: boolean;
  problems: string[];
  phases: Map<string, RunPhase>;
  normalizedEvents: NormalizedEvent[];
  annotations: HumanEventAnnotation[];
  startedAt: string | null;
  endedAt: string | null;
  firstModelActionAt: string | null;
  autonomousFrozenAt: string | null;
  submittedTree: string | null;
  frozenTree: string | null;
  lastWorkspaceChangeAt: string | null;
  toolCalls: number;
  terminalKind: "submission" | "timeout" | "safety-abort" | null;
  rescueObserved: boolean;
};

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const kinds = new Set<ProspectiveNativeEventKind>([
  "run-start", "first-model-action", "assistant-message", "assistant-tool-call", "tool-result",
  "human-input", "human-control", "human-continue", "human-safety-stop", "human-workspace-edit",
  "observer-view", "permission-request", "permission-decision", "subagent-event", "workspace-change",
  "submission", "autonomous-result-frozen",
  "rescue-start", "rescue-end", "run-end", "timeout", "safety-abort",
]);
const restrictedPayloadKeys = /^(raw|content|text|attachment|environment|stdout|stderr|secret|token|password)$/i;

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalEvidence(value)).digest("hex");
}

function sourceChannel(kind: ProspectiveNativeEventKind): string {
  if (kind.startsWith("human-")) return kind === "human-workspace-edit" ? "workspace-audit" : "interactive-input";
  if (kind === "observer-view") return "observer";
  if (kind === "permission-decision") return "interactive-permission";
  if (kind === "permission-request") return "permission-system";
  if (kind === "subagent-event") return "subagent";
  if (kind.startsWith("assistant-") || kind === "first-model-action") return "provider";
  if (kind === "tool-result") return "tool";
  if (kind === "workspace-change") return "workspace-audit";
  return "runner";
}

function eventBody(event: Omit<ProspectiveNativeEvent, "eventDigest">): object {
  return event;
}

function containsRestrictedPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRestrictedPayload);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => restrictedPayloadKeys.test(key) || containsRestrictedPayload(item));
}

export function buildProspectiveNativeEventLog(
  descriptors: readonly ProspectiveNativeEventDescriptor[],
): ProspectiveNativeEventLog {
  const events: ProspectiveNativeEvent[] = [];
  let previousEventDigest: string | null = null;
  for (const [index, descriptor] of descriptors.entries()) {
    const payloadDigest = sha256(descriptor.payload);
    const body: Omit<ProspectiveNativeEvent, "eventDigest"> = {
      schemaVersion: 1 as const,
      sequence: index + 1,
      previousEventDigest,
      eventId: descriptor.eventId,
      interactionId: descriptor.interactionId ?? descriptor.eventId,
      observedAt: descriptor.observedAt,
      kind: descriptor.kind,
      sourceChannel: sourceChannel(descriptor.kind),
      payloadDigest,
      payload: descriptor.payload,
    };
    const event: ProspectiveNativeEvent = { ...body, eventDigest: sha256(eventBody(body)) };
    events.push(event);
    previousEventDigest = event.eventDigest;
  }
  return { schemaVersion: 1, events, headDigest: previousEventDigest ?? sha256([]) };
}

function phaseAndTransitions(
  events: readonly ProspectiveNativeEvent[],
  problems: string[],
): Map<string, RunPhase> {
  const phases = new Map<string, RunPhase>();
  let phase: RunPhase = "prestart";
  let started = false;
  let frozen = false;
  let rescue = false;
  let ended = false;
  for (const event of events) {
    phases.set(event.eventId, phase);
    if (event.kind === "run-start") {
      if (started || event.sequence !== 1) problems.push("run-start must be the first and only start event.");
      started = true;
      phase = "autonomous";
    } else if (!started) {
      problems.push(`event ${event.eventId} occurs before run-start.`);
    } else if (event.kind === "autonomous-result-frozen") {
      if (phase !== "autonomous" || frozen) problems.push("autonomous-result-frozen must close the autonomous phase exactly once.");
      frozen = true;
      phase = "post-autonomous-freeze";
    } else if (event.kind === "rescue-start") {
      if (phase !== "post-autonomous-freeze" || rescue) problems.push("rescue-start must follow the autonomous freeze exactly once.");
      rescue = true;
      phase = "rescue";
    } else if (event.kind === "rescue-end") {
      if (phase !== "rescue") problems.push("rescue-end must close an active rescue phase.");
      phase = "postrun";
    } else if (event.kind === "run-end") {
      if (!frozen || phase === "rescue" || ended) problems.push("run-end requires a frozen autonomous result and closed rescue.");
      ended = true;
      phase = "postrun";
    } else if (ended) {
      problems.push(`event ${event.eventId} occurs after run-end.`);
    }
  }
  if (!started) problems.push("event log is missing run-start.");
  if (!frozen) problems.push("event log is missing autonomous-result-frozen.");
  if (!ended) problems.push("event log is missing run-end.");
  if (events.at(-1)?.kind !== "run-end") problems.push("run-end must be the final event.");
  return phases;
}

function humanSemantics(event: ProspectiveNativeEvent): {
  normalized?: Pick<NormalizedEvent, "origin" | "kind" | "humanAuthored" | "agentVisible" | "changesRunnerControlState" | "changesWorkspace">;
  annotation?: HumanEventAnnotation;
} {
  const activeSeconds = Number.isSafeInteger(event.payload.activeSeconds) && Number(event.payload.activeSeconds) >= 0
    ? Number(event.payload.activeSeconds)
    : 0;
  const base = { origin: "human" as const, humanAuthored: true, agentVisible: true };
  if (event.kind === "human-input") return {
    normalized: { ...base, kind: "human-text", changesRunnerControlState: false, changesWorkspace: false },
    annotation: { interactionId: event.interactionId, intent: "correction", taskRelation: "same-task", activeSeconds, basis: "runner-control" },
  };
  if (event.kind === "human-control" || event.kind === "permission-decision") return {
    normalized: { ...base, kind: event.kind === "permission-decision" ? "permission-decision" : "human-command", changesRunnerControlState: true, changesWorkspace: false },
    annotation: { interactionId: event.interactionId, intent: event.kind === "permission-decision" ? "permission-decision" : "direct-runtime-command", taskRelation: "same-task", activeSeconds, basis: "runner-control" },
  };
  if (event.kind === "human-continue") return {
    normalized: { ...base, kind: "human-command", changesRunnerControlState: true, changesWorkspace: false },
    annotation: { interactionId: event.interactionId, intent: "continue-same-attempt", taskRelation: "resumes-same-task", activeSeconds, basis: "runner-control" },
  };
  if (event.kind === "human-safety-stop") return {
    normalized: { ...base, kind: "interruption", changesRunnerControlState: true, changesWorkspace: false },
    annotation: { interactionId: event.interactionId, intent: "safety-stop", taskRelation: "ends-task", activeSeconds, basis: "runner-control" },
  };
  if (event.kind === "human-workspace-edit") return {
    normalized: { ...base, kind: "human-workspace-edit", changesRunnerControlState: false, changesWorkspace: true },
    annotation: { interactionId: event.interactionId, intent: "direct-code-edit", taskRelation: "same-task", activeSeconds, basis: "runner-control" },
  };
  if (event.kind === "observer-view") return {
    normalized: { ...base, kind: "human-command", agentVisible: false, changesRunnerControlState: false, changesWorkspace: false },
    annotation: { interactionId: event.interactionId, intent: "status-check", taskRelation: "same-task", activeSeconds, basis: "runner-control" },
  };
  return {};
}

export function validateProspectiveNativeEventLog(
  log: ProspectiveNativeEventLog,
): ProspectiveNativeEventLogReport {
  const problems: string[] = [];
  if (log.schemaVersion !== 1) problems.push("event log schemaVersion must be 1.");
  const ids = new Set<string>();
  let previous: string | null = null;
  let priorTime = Number.NEGATIVE_INFINITY;
  for (const [index, event] of log.events.entries()) {
    if (event.schemaVersion !== 1 || event.sequence !== index + 1) problems.push(`event ${index} has an invalid schema or sequence.`);
    if (!event.eventId?.trim() || ids.has(event.eventId)) problems.push(`event ${index} has a missing or duplicate id.`);
    ids.add(event.eventId);
    if (!kinds.has(event.kind)) problems.push(`event ${event.eventId} has an unknown kind.`);
    if (event.previousEventDigest !== previous) problems.push(`event ${event.eventId} breaks the previous-digest chain.`);
    if (event.sourceChannel !== sourceChannel(event.kind)) problems.push(`event ${event.eventId} has a self-declared source channel.`);
    if (event.payloadDigest !== sha256(event.payload)) problems.push(`event ${event.eventId} payload digest is invalid.`);
    const { eventDigest: _, ...body } = event;
    if (event.eventDigest !== sha256(body) || !SHA256.test(event.eventDigest)) problems.push(`event ${event.eventId} digest is invalid.`);
    if (containsRestrictedPayload(event.payload)) problems.push(`event ${event.eventId} contains raw or sensitive payload fields.`);
    const time = Date.parse(event.observedAt);
    if (!Number.isFinite(time) || time < priorTime) problems.push(`event ${event.eventId} timestamp is invalid or non-monotonic.`);
    priorTime = time;
    previous = event.eventDigest;
  }
  if (log.headDigest !== (previous ?? sha256([]))) problems.push("event log head digest does not match its chain.");
  const phases = phaseAndTransitions(log.events, problems);
  const count = (kind: ProspectiveNativeEventKind) => log.events.filter((event) => event.kind === kind).length;
  const firstModelActions = log.events.filter((event) => event.kind === "first-model-action");
  if (firstModelActions.length !== 1) problems.push("event log must contain exactly one first-model-action.");
  if (firstModelActions[0] && phases.get(firstModelActions[0].eventId) !== "autonomous") {
    problems.push("first-model-action must occur during the autonomous phase.");
  }
  const terminals = log.events.filter((event) => ["submission", "timeout", "safety-abort"].includes(event.kind));
  if (terminals.length !== 1) problems.push("event log must contain exactly one autonomous terminal event.");
  const freeze = log.events.find((event) => event.kind === "autonomous-result-frozen");
  if (terminals[0] && phases.get(terminals[0].eventId) !== "autonomous") {
    problems.push("the terminal event must occur during the autonomous phase.");
  }
  if (terminals[0] && freeze && terminals[0].sequence >= freeze.sequence) {
    problems.push("autonomous-result-frozen must follow the terminal event.");
  }
  const submission = terminals.find((event) => event.kind === "submission");
  const submittedTree = submission && SHA1.test(String(submission.payload.tree)) ? String(submission.payload.tree) : null;
  const frozenTree = freeze && SHA1.test(String(freeze.payload.tree)) ? String(freeze.payload.tree) : null;
  if (submission && !submittedTree) problems.push("submission must contain a full Git tree id.");
  if (!frozenTree) problems.push("autonomous-result-frozen must contain a full Git tree id.");
  if (submittedTree && frozenTree !== submittedTree) problems.push("frozen tree does not match the submitted tree.");

  const normalizedEvents: NormalizedEvent[] = [];
  const annotations: HumanEventAnnotation[] = [];
  for (const event of log.events) {
    const human = humanSemantics(event);
    if (!human.normalized) continue;
    const phase = phases.get(event.eventId) ?? "prestart";
    normalizedEvents.push({
      schemaVersion: 1,
      rawRecordId: event.eventId,
      blockIndex: 0,
      interactionId: event.interactionId,
      observedAt: event.observedAt,
      sourceRole: "human",
      phase,
      ...human.normalized,
      classificationBasis: "explicit-schema",
      ruleId: `farrier.prospective.${event.kind}.v1`,
      extractorVersion: "prospective-native-v1",
      contentSha256: event.payloadDigest,
      contentBytes: new TextEncoder().encode(canonicalEvidence(event.payload)).byteLength,
    });
    annotations.push(human.annotation!);
  }
  const eventAt = (kind: ProspectiveNativeEventKind) => log.events.find((event) => event.kind === kind)?.observedAt ?? null;
  return {
    valid: problems.length === 0,
    problems,
    phases,
    normalizedEvents,
    annotations,
    startedAt: eventAt("run-start"),
    endedAt: eventAt("run-end"),
    firstModelActionAt: eventAt("first-model-action"),
    autonomousFrozenAt: eventAt("autonomous-result-frozen"),
    submittedTree,
    frozenTree,
    lastWorkspaceChangeAt: log.events
      .filter((event) => (event.kind === "workspace-change" || event.kind === "human-workspace-edit")
        && phases.get(event.eventId) === "autonomous")
      .at(-1)?.observedAt ?? null,
    toolCalls: count("assistant-tool-call"),
    terminalKind: terminals[0]?.kind as ProspectiveNativeEventLogReport["terminalKind"] ?? null,
    rescueObserved: count("rescue-start") > 0 || count("rescue-end") > 0,
  };
}
