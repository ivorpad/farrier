import { createHash } from "node:crypto";

import { canonicalEvidence } from "../../src/engine/behavior-evidence";
import { buildCodexPromptDeliveryProof } from "../../src/engine/evaluations/codex-prompt-delivery";
import { canonicalProspectiveProtocolDigest } from "../../src/engine/evaluations/contracts/prospective-autonomy-protocol";
import { sha256Evidence } from "../../src/engine/evaluations/contracts/prospective-autonomy-protocol-items";
import {
  composeNativeInstructionOverlay,
} from "../../src/engine/evaluations/native-harness-manifest";
import {
  buildProviderTranscriptAudit,
  buildRunnerControlAudit,
  buildWorkspaceAudit,
  type IndependentAuditChannelName,
  type IndependentAuditKind,
  type IndependentAuditSourceRecord,
  type ProspectiveIndependentAuditEvidence,
} from "../../src/engine/evaluations/prospective-independent-audit";
import {
  buildProspectiveNativeEventLog,
  type ProspectiveNativeEventLog,
} from "../../src/engine/evaluations/prospective-native-event-log";
import type { ProspectiveRunEvidenceBundle } from "../../src/engine/evaluations/prospective-run-evidence";
import { frozenProspectiveProtocol } from "./prospective-autonomy-fixture";

const digest = "a".repeat(64);
const rootCommit = "d".repeat(40);
const submittedTree = "e".repeat(40);
const encoder = new TextEncoder();

function contentDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export const evidenceBaseline = encoder.encode("# Native rules\nRun the repository check.\n");
export const evidenceBrief = encoder.encode("Use the repository parser for configuration files.\n");

const independentKinds: Record<IndependentAuditChannelName, ReadonlySet<string>> = {
  "provider-transcript": new Set([
    "first-model-action", "assistant-message", "assistant-tool-call", "tool-result", "human-input", "subagent-event",
  ]),
  "runner-control": new Set([
    "human-control", "human-continue", "human-safety-stop", "observer-view", "permission-request", "permission-decision",
    "rescue-start", "rescue-end",
  ]),
  "workspace-audit": new Set(["workspace-change", "human-workspace-edit"]),
};

export function buildEvidenceIndependentAudit(
  eventLog: ProspectiveNativeEventLog,
  runId: string,
  protocol: any,
): ProspectiveIndependentAuditEvidence {
  const startedAt = eventLog.events[0]!.observedAt;
  const endedAt = eventLog.events.at(-1)!.observedAt;
  const records = (channel: IndependentAuditChannelName): IndependentAuditSourceRecord[] => [
    { sourceRecordId: `${channel}-open`, interactionId: `${channel}-open`, observedAt: startedAt, kind: "channel-open", facts: { runId } },
    ...eventLog.events.filter((event) => independentKinds[channel].has(event.kind)).map((event) => ({
      sourceRecordId: `${channel}-${event.eventId}`,
      interactionId: event.interactionId,
      observedAt: event.observedAt,
      kind: event.kind as IndependentAuditKind,
      facts: event.payload,
    })),
    { sourceRecordId: `${channel}-close`, interactionId: `${channel}-close`, observedAt: endedAt, kind: "channel-close", facts: { runId } },
  ];
  const adapters = protocol.runner.auditAdapters;
  return {
    schemaVersion: 1,
    providerTranscript: buildProviderTranscriptAudit(adapters.providerTranscript, records("provider-transcript")),
    runnerControl: buildRunnerControlAudit(adapters.runnerControl, records("runner-control")),
    workspaceAudit: buildWorkspaceAudit(adapters.workspaceAudit, records("workspace-audit")),
  };
}

export function frozenEvidenceProtocol(): any {
  const protocol = frozenProspectiveProtocol();
  for (const repository of protocol.repositories) {
    repository.nativeHarnessManifest.artifacts[0].contentDigest = contentDigest(evidenceBaseline);
    const { digest: _, ...manifestBody } = repository.nativeHarnessManifest;
    repository.nativeHarnessManifest.digest = sha256Evidence(manifestBody);
  }
  for (const intervention of protocol.interventions) {
    intervention.contentDigest = contentDigest(evidenceBrief);
    intervention.utf8Bytes = evidenceBrief.length;
    const { interventionDigest: _, ...interventionBody } = intervention;
    intervention.interventionDigest = sha256Evidence(interventionBody);
  }
  protocol.protocolDigest = canonicalProspectiveProtocolDigest(protocol);
  return protocol;
}

function timestamp(order: number, offsetMinutes: number): string {
  const start = Date.parse("2026-08-07T00:00:00Z") + order * 10 * 60_000 + offsetMinutes * 60_000;
  return new Date(start).toISOString();
}

export function passingRunEvidenceBundle(input: {
  protocol?: any;
  taskId?: string;
  arm?: "native" | "oracle-brief";
  repetition?: 1 | 2;
  includeHumanCorrection?: boolean;
} = {}): ProspectiveRunEvidenceBundle {
  const protocol = input.protocol ?? frozenEvidenceProtocol();
  const taskId = input.taskId ?? "task-1-1";
  const arm = input.arm ?? "oracle-brief";
  const repetition = input.repetition ?? 1;
  const task = protocol.tasks.find((item: any) => item.id === taskId);
  const repository = protocol.repositories.find((item: any) => item.id === task.repositoryId);
  const intervention = protocol.interventions.find((item: any) => item.repositoryId === task.repositoryId);
  const cell = protocol.randomization.cells.find((item: any) =>
    item.taskId === taskId && item.arm === arm && item.repetition === repetition);
  const runId = `${taskId}-${arm}-${repetition}`;
  const requestId = `request-${runId}`;
  const verificationEventId = `${runId}-verify-call`;
  const descriptors: any[] = [
    { eventId: `${runId}-start`, observedAt: timestamp(cell.order, 0), kind: "run-start", payload: { runId } },
    { eventId: `${runId}-model`, observedAt: timestamp(cell.order, 1), kind: "first-model-action", payload: { requestId } },
    { eventId: `${runId}-change`, observedAt: timestamp(cell.order, 2), kind: "workspace-change", payload: { tree: submittedTree, reason: "agent" } },
  ];
  if (input.includeHumanCorrection) descriptors.push({
    eventId: `${runId}-human`,
    interactionId: `${runId}-human`,
    observedAt: timestamp(cell.order, 2.25),
    kind: "human-input",
    payload: { activeSeconds: 30 },
  });
  descriptors.push(
    { eventId: verificationEventId, observedAt: timestamp(cell.order, 3), kind: "assistant-tool-call", payload: { executionId: `${runId}-check` } },
    { eventId: `${runId}-tool-result`, observedAt: timestamp(cell.order, 3.25), kind: "tool-result", payload: { executionId: `${runId}-check`, exitCode: 0 } },
    { eventId: `${runId}-submit`, observedAt: timestamp(cell.order, 4), kind: "submission", payload: { tree: submittedTree } },
    { eventId: `${runId}-freeze`, observedAt: timestamp(cell.order, 4.25), kind: "autonomous-result-frozen", payload: { tree: submittedTree } },
  );
  if (cell.rescueSelected) descriptors.push(
    { eventId: `${runId}-rescue-start`, observedAt: timestamp(cell.order, 4.5), kind: "rescue-start", payload: { rescuerAlias: `rescuer-${task.repositoryId}` } },
    { eventId: `${runId}-rescue-work`, observedAt: timestamp(cell.order, 4.6), kind: "human-control", payload: { activeSeconds: 60 } },
    { eventId: `${runId}-rescue-end`, observedAt: timestamp(cell.order, 4.75), kind: "rescue-end", payload: { status: "completed" } },
  );
  descriptors.push(
    { eventId: `${runId}-end`, observedAt: timestamp(cell.order, 5), kind: "run-end", payload: { status: "completed" } },
  );
  const eventLog = buildProspectiveNativeEventLog(descriptors);
  const composition = composeNativeInstructionOverlay({ baseline: evidenceBaseline, brief: evidenceBrief });
  const finalInstruction = arm === "oracle-brief" ? composition.bytes : evidenceBaseline;
  const instructionDigest = contentDigest(finalInstruction);
  const promptInput = [{
    type: "message",
    role: "developer",
    content: [{
      type: "input_text",
      text: `# Repository instructions\n${new TextDecoder().decode(finalInstruction)}\n`,
    }],
  }];
  const deliveryProof = buildCodexPromptDeliveryProof({
    promptInput,
    producer: protocol.runner.auditAdapters.promptInput,
    instructionPath: intervention.artifactPath,
    instructionBytes: finalInstruction,
  });
  const command = {
    executionId: `${runId}-check`,
    kind: "verification" as const,
    stepId: "check",
    actor: "agent" as const,
    initiatedByEventId: verificationEventId,
    argv: ["bun", "test"],
    cwd: ".",
    timeoutSeconds: 900,
    startedAt: timestamp(cell.order, 3),
    completedAt: timestamp(cell.order, 3.5),
    exitCode: 0,
    treeBefore: submittedTree,
    treeAfter: submittedTree,
    outputDigest: digest,
    suiteDigest: task.verificationPlan.digest,
  };
  const grader = (kind: "hidden-acceptance" | "regression-suite", suiteDigest: string, offset: number) => ({
    executionId: `${runId}-${kind}`,
    kind,
    stepId: null,
    actor: "grader" as const,
    initiatedByEventId: null,
    argv: ["grader", kind],
    cwd: ".",
    timeoutSeconds: 900,
    startedAt: timestamp(cell.order, offset),
    completedAt: timestamp(cell.order, offset + 0.25),
    exitCode: 0,
    treeBefore: submittedTree,
    treeAfter: submittedTree,
    outputDigest: digest,
    suiteDigest,
  });
  return {
    schemaVersion: 1,
    run: { runId, runAlias: `alias-${runId}`, attempt: 1, replacementForAttempt: null },
    protocol: { body: protocol, canonicalDigest: protocol.protocolDigest },
    plannedCell: { ...cell, repositoryId: task.repositoryId },
    snapshot: {
      sourceCommit: task.snapshot.commit,
      sourceTree: task.snapshot.tree,
      stagedTree: task.snapshot.tree,
      stagedRootCommit: rootCommit,
      contentManifestSha256: task.workspaceContentDigest,
      referenceCount: 1,
      remoteCount: 0,
      unreachableObjectCount: 0,
      sourceStateSha256: digest,
      historyMode: "snapshot-root",
      noFutureObjects: true,
    },
    recognizedNativeHarnessDigest: repository.nativeHarnessManifest.digest,
    overlay: {
      kind: arm === "oracle-brief" ? "brief" : "none",
      baselineTree: task.snapshot.tree,
      instructionPath: intervention.artifactPath,
      baselineInstructionBase64: Buffer.from(evidenceBaseline).toString("base64"),
      briefBase64: arm === "oracle-brief" ? Buffer.from(evidenceBrief).toString("base64") : null,
      finalInstructionBase64: Buffer.from(finalInstruction).toString("base64"),
      changedPaths: arm === "oracle-brief" ? [intervention.artifactPath] : [],
      workspaceManifestDigest: sha256Evidence({ task: task.workspaceContentDigest, instructionDigest }),
    },
    eventLog,
    independentAudit: buildEvidenceIndependentAudit(eventLog, runId, protocol),
    contextDelivery: {
      providerRequestId: requestId,
      loadedInstructionPath: intervention.artifactPath,
      loadedInstructionDigest: instructionDigest,
      effectivePromptDigest: deliveryProof.promptInputSha256,
      proof: deliveryProof,
    },
    runnerIdentity: {
      binarySha256: protocol.runner.runnerBinarySha256,
      systemPromptSha256: protocol.runner.systemPromptSha256,
      toolSchemaSha256: protocol.runner.toolSchemaSha256,
      toolchainManifestDigest: protocol.runner.toolchainManifestDigest,
    },
    providerUsage: [{
      requestId,
      requestedModelId: protocol.runner.modelId,
      resolvedModelId: "gpt-5.5-codex-2026-08-01-snapshot",
      inputTokens: 1_000,
      outputTokens: 500,
    }],
    finalWorkspace: { submittedTree, contentManifestDigest: digest, patchDigest: digest },
    executions: {
      verification: [command],
      hiddenAcceptance: grader("hidden-acceptance", task.hiddenSuiteDigest, 6),
      regressionSuite: grader("regression-suite", repository.regressionSuiteDigest, 7),
    },
    blindedGrades: {
      contractGrades: ["reviewer-a", "reviewer-b"].map((reviewerId) => ({
        runAlias: `alias-${runId}`,
        reviewerId,
        applicableContractsDigest: task.applicableContractsDigest,
        patchDigest: digest,
        materialContractViolations: 0,
        prohibitedIntegrityActions: 0,
        rationaleDigest: digest,
      })),
      harmAdjudications: [],
    },
    rescue: {
      status: cell.rescueSelected ? "completed" : "not-required",
      rescuerAlias: cell.rescueSelected ? `rescuer-${task.repositoryId}` : null,
      correctionCategories: cell.rescueSelected ? ["none-needed"] : [],
      editedFiles: 0,
      changedLines: 0,
    },
  };
}

export function evidenceBundleDigest(bundle: ProspectiveRunEvidenceBundle): string {
  return createHash("sha256").update(canonicalEvidence(bundle)).digest("hex");
}

export function passingEvidenceExperiment(): ProspectiveRunEvidenceBundle[] {
  const protocol = frozenEvidenceProtocol();
  return protocol.tasks.flatMap((task: any, taskIndex: number) =>
    (["native", "oracle-brief"] as const).flatMap((arm) =>
      ([1, 2] as const).map((repetition) => passingRunEvidenceBundle({
        protocol,
        taskId: task.id,
        arm,
        repetition,
        includeHumanCorrection: arm === "native" && taskIndex < 3,
      }))));
}
