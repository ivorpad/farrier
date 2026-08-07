import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalEvidence } from "../behavior-evidence";
import type { ProspectiveNativeEvent } from "./prospective-native-event-log";

export type IndependentAuditChannelName =
  | "provider-transcript"
  | "runner-control"
  | "workspace-audit";

export type IndependentAuditKind =
  | "channel-open"
  | "channel-close"
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
  | "rescue-start"
  | "rescue-end"
  | "unknown-score-affecting";

export type IndependentAuditProducer = {
  adapterId: string;
  version: string;
  binarySha256: string;
};

export type IndependentAuditSourceRecord = {
  sourceRecordId: string;
  interactionId: string;
  observedAt: string;
  kind: IndependentAuditKind;
  facts: Record<string, unknown>;
};

export type IndependentAuditRecord = IndependentAuditSourceRecord & {
  schemaVersion: 1;
  sequence: number;
  previousRecordDigest: string | null;
  recordDigest: string;
};

export type IndependentAuditChannel = {
  schemaVersion: 1;
  channel: IndependentAuditChannelName;
  producer: IndependentAuditProducer;
  sourceArtifactDigest: string;
  sourceBytes: number;
  sourceRecordCount: number;
  records: IndependentAuditRecord[];
  headDigest: string;
  artifactDigest: string;
};

export type ProspectiveIndependentAuditEvidence = {
  schemaVersion: 1;
  providerTranscript: IndependentAuditChannel;
  runnerControl: IndependentAuditChannel;
  workspaceAudit: IndependentAuditChannel;
};

export type IndependentAuditValidation = {
  valid: boolean;
  problems: string[];
};

const SHA256 = /^[0-9a-f]{64}$/;
const restrictedKeys = /^(raw|content|text|attachment|environment|stdout|stderr|secret|token|password)$/i;
const channelKinds: Record<IndependentAuditChannelName, ReadonlySet<IndependentAuditKind>> = {
  "provider-transcript": new Set([
    "channel-open", "channel-close", "first-model-action", "assistant-message",
    "assistant-tool-call", "tool-result", "human-input", "subagent-event",
    "unknown-score-affecting",
  ]),
  "runner-control": new Set([
    "channel-open", "channel-close", "human-control", "human-continue", "human-safety-stop",
    "observer-view", "permission-request", "permission-decision", "rescue-start", "rescue-end",
    "unknown-score-affecting",
  ]),
  "workspace-audit": new Set([
    "channel-open", "channel-close", "workspace-change", "human-workspace-edit",
    "unknown-score-affecting",
  ]),
};

function sha256(value: unknown): string {
  return createHash("sha256").update(
    typeof value === "string" || value instanceof Uint8Array ? value : canonicalEvidence(value),
  ).digest("hex");
}

function containsRestricted(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRestricted);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => restrictedKeys.test(key) || containsRestricted(item));
}

function channelBody(channel: Omit<IndependentAuditChannel, "artifactDigest">): object {
  return channel;
}

function recordBody(record: Omit<IndependentAuditRecord, "recordDigest">): object {
  return record;
}

function canonicalSource(records: readonly IndependentAuditSourceRecord[]): Uint8Array {
  const body = records.map((record) => canonicalEvidence(record)).join("\n") + "\n";
  return new TextEncoder().encode(body);
}

function buildChannel(
  channel: IndependentAuditChannelName,
  producer: IndependentAuditProducer,
  descriptors: readonly IndependentAuditSourceRecord[],
  sourceBytes = canonicalSource(descriptors),
): IndependentAuditChannel {
  const records: IndependentAuditRecord[] = [];
  let previousRecordDigest: string | null = null;
  for (const [index, descriptor] of descriptors.entries()) {
    const body: Omit<IndependentAuditRecord, "recordDigest"> = {
      schemaVersion: 1,
      sequence: index + 1,
      previousRecordDigest,
      sourceRecordId: descriptor.sourceRecordId,
      interactionId: descriptor.interactionId,
      observedAt: descriptor.observedAt,
      kind: descriptor.kind,
      facts: descriptor.facts,
    };
    const record = { ...body, recordDigest: sha256(recordBody(body)) };
    records.push(record);
    previousRecordDigest = record.recordDigest;
  }
  const withoutDigest: Omit<IndependentAuditChannel, "artifactDigest"> = {
    schemaVersion: 1,
    channel,
    producer,
    sourceArtifactDigest: sha256(sourceBytes),
    sourceBytes: sourceBytes.byteLength,
    sourceRecordCount: descriptors.length,
    records,
    headDigest: previousRecordDigest ?? sha256([]),
  };
  return { ...withoutDigest, artifactDigest: sha256(channelBody(withoutDigest)) };
}

export function buildProviderTranscriptAudit(
  producer: IndependentAuditProducer,
  records: readonly IndependentAuditSourceRecord[],
): IndependentAuditChannel {
  return buildChannel("provider-transcript", producer, records);
}

export function buildRunnerControlAudit(
  producer: IndependentAuditProducer,
  records: readonly IndependentAuditSourceRecord[],
): IndependentAuditChannel {
  return buildChannel("runner-control", producer, records);
}

export function buildWorkspaceAudit(
  producer: IndependentAuditProducer,
  records: readonly IndependentAuditSourceRecord[],
): IndependentAuditChannel {
  return buildChannel("workspace-audit", producer, records);
}

export async function loadIndependentAuditJsonl(input: {
  path: string;
  channel: IndependentAuditChannelName;
  producer: IndependentAuditProducer;
}): Promise<IndependentAuditChannel> {
  const source = await readFile(input.path);
  const lines = source.toString("utf8").split(/\r?\n/).filter((line) => line.trim());
  const records = lines.map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${input.channel} source line ${index + 1} is not JSON.`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${input.channel} source line ${index + 1} is not an object.`);
    }
    return value as IndependentAuditSourceRecord;
  });
  return buildChannel(input.channel, input.producer, records, source);
}

function exactProducer(actual: IndependentAuditProducer, expected: IndependentAuditProducer): boolean {
  return actual.adapterId === expected.adapterId
    && actual.version === expected.version
    && actual.binarySha256 === expected.binarySha256;
}

function validateChannel(input: {
  channel: IndependentAuditChannel;
  expectedName: IndependentAuditChannelName;
  expectedProducer: IndependentAuditProducer;
  runId: string;
}): string[] {
  const { channel, expectedName, expectedProducer, runId } = input;
  const problems: string[] = [];
  if (channel.schemaVersion !== 1 || channel.channel !== expectedName) problems.push(`${expectedName} channel identity is invalid.`);
  if (!exactProducer(channel.producer, expectedProducer)) problems.push(`${expectedName} adapter differs from the frozen runner.`);
  if (!SHA256.test(channel.sourceArtifactDigest) || channel.sourceBytes < 1
    || channel.sourceRecordCount !== channel.records.length) problems.push(`${expectedName} source artifact evidence is invalid.`);
  const ids = new Set<string>();
  let previous: string | null = null;
  let priorTime = Number.NEGATIVE_INFINITY;
  for (const [index, record] of channel.records.entries()) {
    if (record.schemaVersion !== 1 || record.sequence !== index + 1) problems.push(`${expectedName} record ${index} has invalid sequence.`);
    if (!record.sourceRecordId?.trim() || ids.has(record.sourceRecordId)) problems.push(`${expectedName} record ${index} has a missing or duplicate source id.`);
    ids.add(record.sourceRecordId);
    if (!record.interactionId?.trim() || !channelKinds[expectedName].has(record.kind)) problems.push(`${expectedName} record ${record.sourceRecordId} has invalid semantics.`);
    if (containsRestricted(record.facts)) problems.push(`${expectedName} record ${record.sourceRecordId} contains raw or sensitive fields.`);
    if (record.previousRecordDigest !== previous) problems.push(`${expectedName} record ${record.sourceRecordId} breaks its hash chain.`);
    const { recordDigest: _, ...body } = record;
    if (!SHA256.test(record.recordDigest) || record.recordDigest !== sha256(recordBody(body))) problems.push(`${expectedName} record ${record.sourceRecordId} digest is invalid.`);
    const time = Date.parse(record.observedAt);
    if (!Number.isFinite(time) || time < priorTime) problems.push(`${expectedName} record ${record.sourceRecordId} timestamp is invalid or non-monotonic.`);
    priorTime = time;
    previous = record.recordDigest;
  }
  if (channel.records.length < 2 || channel.records[0]?.kind !== "channel-open"
    || channel.records.at(-1)?.kind !== "channel-close") problems.push(`${expectedName} must prove recorder open and close.`);
  if (channel.records[0]?.facts.runId !== runId || channel.records.at(-1)?.facts.runId !== runId) {
    problems.push(`${expectedName} lifecycle is not bound to the run.`);
  }
  if (channel.headDigest !== (previous ?? sha256([]))) problems.push(`${expectedName} head digest is invalid.`);
  const { artifactDigest: _, ...body } = channel;
  if (!SHA256.test(channel.artifactDigest) || channel.artifactDigest !== sha256(channelBody(body))) {
    problems.push(`${expectedName} artifact digest is invalid.`);
  }
  if (channel.records.some((record) => record.kind === "unknown-score-affecting")) {
    problems.push(`${expectedName} contains an unknown score-affecting record.`);
  }
  return problems;
}

function expectedChannel(kind: ProspectiveNativeEvent["kind"]): IndependentAuditChannelName | undefined {
  if (["first-model-action", "assistant-message", "assistant-tool-call", "tool-result", "human-input", "subagent-event"].includes(kind)) {
    return "provider-transcript";
  }
  if (["human-control", "human-continue", "human-safety-stop", "observer-view", "permission-request", "permission-decision", "rescue-start", "rescue-end"].includes(kind)) {
    return "runner-control";
  }
  if (kind === "workspace-change" || kind === "human-workspace-edit") return "workspace-audit";
  return undefined;
}

function projection(value: { interactionId: string; observedAt: string; kind: string; facts: Record<string, unknown> }): object {
  return { interactionId: value.interactionId, observedAt: value.observedAt, kind: value.kind, facts: value.facts };
}

export function validateProspectiveIndependentAudit(input: {
  evidence: ProspectiveIndependentAuditEvidence;
  nativeEvents: readonly ProspectiveNativeEvent[];
  expectedProducers: Record<"providerTranscript" | "runnerControl" | "workspaceAudit", IndependentAuditProducer>;
  runId: string;
}): IndependentAuditValidation {
  const problems: string[] = [];
  if (input.evidence.schemaVersion !== 1) problems.push("independent audit schemaVersion must be 1.");
  const channels = [
    ["provider-transcript", input.evidence.providerTranscript, input.expectedProducers.providerTranscript],
    ["runner-control", input.evidence.runnerControl, input.expectedProducers.runnerControl],
    ["workspace-audit", input.evidence.workspaceAudit, input.expectedProducers.workspaceAudit],
  ] as const;
  for (const [name, channel, producer] of channels) {
    problems.push(...validateChannel({ channel, expectedName: name, expectedProducer: producer, runId: input.runId }));
    const expected = input.nativeEvents.filter((event) => expectedChannel(event.kind) === name)
      .map((event) => projection({ ...event, facts: event.payload }));
    const actual = channel.records.filter((record) => record.kind !== "channel-open" && record.kind !== "channel-close")
      .map(projection);
    if (canonicalEvidence(actual) !== canonicalEvidence(expected)) problems.push(`${name} does not match the native event projection.`);
  }
  return { valid: problems.length === 0, problems };
}
