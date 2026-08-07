import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  loadIndependentAuditJsonl,
  type IndependentAuditChannelName,
  type IndependentAuditKind,
  type IndependentAuditSourceRecord,
} from "../src/engine/evaluations/prospective-independent-audit";
import {
  buildProspectiveNativeEventLog,
  type ProspectiveNativeEvent,
} from "../src/engine/evaluations/prospective-native-event-log";
import {
  validateProspectiveRunEvidence,
  type ProspectiveRunEvidenceBundle,
} from "../src/engine/evaluations/prospective-run-evidence";
import { passingRunEvidenceBundle } from "./fixtures/prospective-run-evidence-fixture";

function at(event: ProspectiveNativeEvent, seconds: number): string {
  return new Date(Date.parse(event.observedAt) + seconds * 1_000).toISOString();
}

function sourceRecord(prefix: string, event: ProspectiveNativeEvent): IndependentAuditSourceRecord {
  return {
    sourceRecordId: `${prefix}-${event.eventId}`,
    interactionId: event.interactionId,
    observedAt: event.observedAt,
    kind: event.kind as IndependentAuditKind,
    facts: event.payload,
  };
}

function channelRecords(
  bundle: ProspectiveRunEvidenceBundle,
  channel: IndependentAuditChannelName,
  kinds: readonly IndependentAuditKind[],
): IndependentAuditSourceRecord[] {
  const first = bundle.eventLog.events[0]!;
  const last = bundle.eventLog.events.at(-1)!;
  return [
    { sourceRecordId: `${channel}-source-open`, interactionId: `${channel}-source-open`, observedAt: first.observedAt, kind: "channel-open", facts: { runId: bundle.run.runId } },
    ...bundle.eventLog.events.filter((event) => kinds.includes(event.kind as IndependentAuditKind))
      .map((event) => sourceRecord(channel, event)),
    { sourceRecordId: `${channel}-source-close`, interactionId: `${channel}-source-close`, observedAt: last.observedAt, kind: "channel-close", facts: { runId: bundle.run.runId } },
  ];
}

async function writeJsonl(path: string, records: readonly IndependentAuditSourceRecord[]): Promise<void> {
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function calibrationBundle(): ProspectiveRunEvidenceBundle {
  const bundle = passingRunEvidenceBundle({ repetition: 2 });
  const original = bundle.eventLog.events;
  const changed = original.find((event) => event.kind === "workspace-change")!;
  const terminal = original.find((event) => event.kind === "submission")!;
  const descriptors = original.filter((event) => event.kind !== "submission").map((event) => ({
    eventId: event.eventId,
    interactionId: event.interactionId,
    observedAt: event.observedAt,
    kind: event.kind,
    payload: event.payload,
  }));
  descriptors.push(
    { eventId: "cal-observer", interactionId: "cal-observer", observedAt: at(changed, 5), kind: "observer-view", payload: { activeSeconds: 5 } },
    { eventId: "cal-continue", interactionId: "cal-continue", observedAt: at(changed, 10), kind: "human-continue", payload: { activeSeconds: 3 } },
    { eventId: "cal-permission-request", interactionId: "cal-permission", observedAt: at(changed, 15), kind: "permission-request", payload: { decisionId: "cal-permission" } },
    { eventId: "cal-permission-decision", interactionId: "cal-permission", observedAt: at(changed, 20), kind: "permission-decision", payload: { activeSeconds: 2, decisionId: "cal-permission" } },
    { eventId: "cal-human-edit", interactionId: "cal-human-edit", observedAt: at(changed, 25), kind: "human-workspace-edit", payload: { activeSeconds: 20, tree: bundle.finalWorkspace.submittedTree } },
    { eventId: "cal-subagent", interactionId: "cal-subagent", observedAt: at(changed, 30), kind: "subagent-event", payload: { status: "completed" } },
    { eventId: "cal-safety-stop", interactionId: "cal-safety-stop", observedAt: at(terminal, -5), kind: "human-safety-stop", payload: { activeSeconds: 4 } },
    { eventId: terminal.eventId, interactionId: terminal.interactionId, observedAt: terminal.observedAt, kind: "safety-abort", payload: { reasonCode: "human-stop" } },
  );
  descriptors.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  bundle.eventLog = buildProspectiveNativeEventLog(descriptors);
  return bundle;
}

async function ingestCalibrationSources(bundle: ProspectiveRunEvidenceBundle, root: string) {
  const source = {
    providerTranscript: channelRecords(bundle, "provider-transcript", [
      "first-model-action", "assistant-message", "assistant-tool-call", "tool-result", "human-input", "subagent-event",
    ]),
    runnerControl: channelRecords(bundle, "runner-control", [
      "human-control", "human-continue", "human-safety-stop", "observer-view", "permission-request", "permission-decision",
    ]),
    workspaceAudit: channelRecords(bundle, "workspace-audit", ["workspace-change", "human-workspace-edit"]),
  };
  const paths = {
    providerTranscript: join(root, "provider.jsonl"),
    runnerControl: join(root, "control.jsonl"),
    workspaceAudit: join(root, "workspace.jsonl"),
  };
  await Promise.all([
    writeJsonl(paths.providerTranscript, source.providerTranscript),
    writeJsonl(paths.runnerControl, source.runnerControl),
    writeJsonl(paths.workspaceAudit, source.workspaceAudit),
  ]);
  const adapters = (bundle.protocol.body as any).runner.auditAdapters;
  bundle.independentAudit = {
    schemaVersion: 1,
    providerTranscript: await loadIndependentAuditJsonl({ path: paths.providerTranscript, channel: "provider-transcript", producer: adapters.providerTranscript }),
    runnerControl: await loadIndependentAuditJsonl({ path: paths.runnerControl, channel: "runner-control", producer: adapters.runnerControl }),
    workspaceAudit: await loadIndependentAuditJsonl({ path: paths.workspaceAudit, channel: "workspace-audit", producer: adapters.workspaceAudit }),
  };
  return { paths, source };
}

describe("excluded independent-audit calibration", () => {
  test("proves exact parity from three separately ingested JSONL channels", async () => {
    const root = await mkdtemp(join(tmpdir(), "farrier-independent-calibration-"));
    const bundle = calibrationBundle();
    const { paths } = await ingestCalibrationSources(bundle, root);
    const first = validateProspectiveRunEvidence(bundle);
    const second = validateProspectiveRunEvidence(bundle);

    expect(first.problems).toEqual([]);
    expect(first.ready).toBe(true);
    expect(first.run?.submitted).toBe(false);
    expect(first.run?.humanLedger.derived).toMatchObject({
      observationSeconds: 5,
      safetyResponseSeconds: 4,
      humanControlActions: 3,
      humanWorkspaceEdits: 1,
      autonomousHumanContactClear: false,
    });
    expect(first.run?.evidenceDigest).toBe(second.run?.evidenceDigest);
    const providerBytes = await readFile(paths.providerTranscript);
    expect(bundle.independentAudit.providerTranscript.sourceArtifactDigest).toBe(
      createHash("sha256").update(providerBytes).digest("hex"),
    );
  });

  test("fails parity when a source channel omits a score-affecting record", async () => {
    const root = await mkdtemp(join(tmpdir(), "farrier-independent-omission-"));
    const bundle = calibrationBundle();
    const { paths, source } = await ingestCalibrationSources(bundle, root);
    const withoutPermission = source.runnerControl.filter((record) => record.kind !== "permission-decision");
    await writeJsonl(paths.runnerControl, withoutPermission);
    const adapters = (bundle.protocol.body as any).runner.auditAdapters;
    bundle.independentAudit.runnerControl = await loadIndependentAuditJsonl({
      path: paths.runnerControl,
      channel: "runner-control",
      producer: adapters.runnerControl,
    });

    const report = validateProspectiveRunEvidence(bundle);
    expect(report.ready).toBe(false);
    expect(report.problems).toContain(
      "independent audit: runner-control does not match the native event projection.",
    );
  });

  test("fails closed on an unknown score-affecting source record", async () => {
    const root = await mkdtemp(join(tmpdir(), "farrier-independent-unknown-"));
    const bundle = calibrationBundle();
    const { paths, source } = await ingestCalibrationSources(bundle, root);
    source.runnerControl.splice(-1, 0, {
      sourceRecordId: "control-unknown",
      interactionId: "control-unknown",
      observedAt: bundle.eventLog.events.at(-2)!.observedAt,
      kind: "unknown-score-affecting",
      facts: { sourceKindDigest: "a".repeat(64) },
    });
    await writeJsonl(paths.runnerControl, source.runnerControl);
    const adapters = (bundle.protocol.body as any).runner.auditAdapters;
    bundle.independentAudit.runnerControl = await loadIndependentAuditJsonl({
      path: paths.runnerControl,
      channel: "runner-control",
      producer: adapters.runnerControl,
    });

    const report = validateProspectiveRunEvidence(bundle);
    expect(report.ready).toBe(false);
    expect(report.problems).toContain(
      "independent audit: runner-control contains an unknown score-affecting record.",
    );
  });
});
