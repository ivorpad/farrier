import { createHash } from "node:crypto";

import { canonicalEvidence } from "../behavior-evidence";
import { validateCodexPromptDeliveryProof } from "./codex-prompt-delivery";
import { buildHumanInterventionLedger } from "./human-intervention-ledger";
import { verifyNativeInstructionComposition } from "./native-harness-manifest";
import {
  validateProspectiveIndependentAudit,
  type IndependentAuditProducer,
} from "./prospective-independent-audit";
import {
  validateProspectiveNativeEventLog,
  type ProspectiveNativeEvent,
} from "./prospective-native-event-log";
import { validateProspectiveRescue } from "./prospective-rescue";
import {
  canonicalProspectiveProtocolDigest,
  validateProspectiveProtocol,
} from "./contracts/prospective-autonomy-protocol";
import { instant, record, SHA1, SHA256, text } from "./contracts/prospective-autonomy-protocol-items";
import type {
  CommandExecutionEvidence,
  ProspectiveRunEvidenceBundle,
  ProspectiveRunEvidenceReport,
  ValidatedProspectiveRun,
} from "./contracts/prospective-run-evidence-types";

export type {
  CommandExecutionEvidence,
  ContractGradeEvidence,
  HarmAdjudicationEvidence,
  ProspectiveRunEvidenceBundle,
  ProspectiveRunEvidenceReport,
  ValidatedProspectiveRun,
} from "./contracts/prospective-run-evidence-types";

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalEvidence(value)).digest("hex");
}

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function bytes(value: string, owner: string, problems: string[]): Uint8Array {
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.toString("base64") !== value) problems.push(`${owner} is not canonical base64.`);
    return decoded;
  } catch {
    problems.push(`${owner} is not valid base64.`);
    return new Uint8Array();
  }
}

function exactStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function lookup(bundle: ProspectiveRunEvidenceBundle, problems: string[]) {
  const protocol = record(bundle.protocol.body);
  const tasks = Array.isArray(protocol?.tasks) ? protocol.tasks.map(record).filter(Boolean) : [];
  const repositories = Array.isArray(protocol?.repositories) ? protocol.repositories.map(record).filter(Boolean) : [];
  const interventions = Array.isArray(protocol?.interventions) ? protocol.interventions.map(record).filter(Boolean) : [];
  const cells = Array.isArray(record(protocol?.randomization)?.cells)
    ? (record(protocol?.randomization)!.cells as unknown[]).map(record).filter(Boolean)
    : [];
  const task = tasks.find((item) => item!.id === bundle.plannedCell.taskId);
  const repository = repositories.find((item) => item!.id === bundle.plannedCell.repositoryId);
  const intervention = interventions.find((item) => item!.repositoryId === bundle.plannedCell.repositoryId);
  const cell = cells.find((item) => item!.taskId === bundle.plannedCell.taskId
    && item!.arm === bundle.plannedCell.arm && item!.repetition === bundle.plannedCell.repetition);
  if (!task || !repository || !intervention || !cell) problems.push("bundle does not name a complete frozen protocol cell.");
  return { protocol, task, repository, intervention, cell };
}

function validateProtocolBinding(bundle: ProspectiveRunEvidenceBundle, problems: string[]) {
  const validation = validateProspectiveProtocol(bundle.protocol.body);
  problems.push(...validation.problems.map((problem) => `protocol: ${problem}`));
  const computed = canonicalProspectiveProtocolDigest(bundle.protocol.body);
  if (bundle.protocol.canonicalDigest !== computed || record(bundle.protocol.body)?.protocolDigest !== computed) {
    problems.push("bundle protocol digest does not match its canonical body.");
  }
  const found = lookup(bundle, problems);
  const expectedCell = found.cell;
  if (expectedCell && (
    expectedCell.taskId !== bundle.plannedCell.taskId
    || expectedCell.arm !== bundle.plannedCell.arm
    || expectedCell.repetition !== bundle.plannedCell.repetition
    || expectedCell.order !== bundle.plannedCell.order
    || expectedCell.rescueSelected !== bundle.plannedCell.rescueSelected
  )) problems.push("bundle planned cell differs from the frozen randomization cell.");
  if (found.task?.repositoryId !== bundle.plannedCell.repositoryId) problems.push("bundle repository does not own the planned task.");
  return found;
}

function validateSnapshot(
  bundle: ProspectiveRunEvidenceBundle,
  task: ReturnType<typeof record>,
  repository: ReturnType<typeof record>,
  problems: string[],
): void {
  const expected = record(task?.snapshot);
  const snapshot = bundle.snapshot;
  if (!snapshot || snapshot.sourceCommit !== expected?.commit || snapshot.sourceTree !== expected?.tree
    || snapshot.stagedTree !== expected?.tree || snapshot.referenceCount !== 1 || snapshot.remoteCount !== 0
    || snapshot.unreachableObjectCount !== 0 || snapshot.noFutureObjects !== true
    || !SHA1.test(snapshot.stagedRootCommit) || !SHA256.test(snapshot.sourceStateSha256)
    || snapshot.contentManifestSha256 !== task?.workspaceContentDigest) {
    problems.push("snapshot evidence does not reproduce the frozen task workspace.");
  }
  const manifest = record(repository?.nativeHarnessManifest);
  if (bundle.recognizedNativeHarnessDigest !== manifest?.digest || manifest?.sourceTree !== snapshot?.sourceTree) {
    problems.push("recognized native harness is not bound to the staged source tree.");
  }
}

function validateOverlay(
  bundle: ProspectiveRunEvidenceBundle,
  intervention: ReturnType<typeof record>,
  problems: string[],
): { digest: string; bytes: Uint8Array } {
  const overlay = bundle.overlay;
  const baseline = bytes(overlay.baselineInstructionBase64, "overlay baseline", problems);
  const final = bytes(overlay.finalInstructionBase64, "overlay final", problems);
  const baselineDigest = createHash("sha256").update(baseline).digest("hex");
  const finalDigest = createHash("sha256").update(final).digest("hex");
  if (overlay.baselineTree !== bundle.snapshot.stagedTree || !SHA256.test(overlay.workspaceManifestDigest)) {
    problems.push("overlay is not bound to the staged workspace.");
  }
  const artifact = (record(bundle.protocol.body)?.repositories as unknown[] | undefined)
    ?.map(record).find((item) => item?.id === bundle.plannedCell.repositoryId);
  const manifestArtifact = (record(artifact?.nativeHarnessManifest)?.artifacts as unknown[] | undefined)
    ?.map(record).find((item) => item?.path === overlay.instructionPath);
  if (manifestArtifact && manifestArtifact.contentDigest !== baselineDigest) {
    problems.push("overlay baseline bytes do not match the recognized native instruction.");
  }
  const expectsBrief = bundle.plannedCell.arm === "oracle-brief" && intervention?.kind === "brief";
  if (expectsBrief) {
    if (overlay.kind !== "brief" || overlay.instructionPath !== intervention?.artifactPath
      || !exactStrings(overlay.changedPaths, [overlay.instructionPath]) || overlay.briefBase64 === null) {
      problems.push("oracle arm must change exactly the frozen instruction path.");
    } else {
      const brief = bytes(overlay.briefBase64, "overlay brief", problems);
      try {
        verifyNativeInstructionComposition({
          baseline,
          brief,
          final,
          expectedBriefDigest: String(intervention?.contentDigest),
        });
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
  } else if (overlay.kind !== "none" || overlay.briefBase64 !== null || overlay.changedPaths.length !== 0
    || baselineDigest !== finalDigest) {
    problems.push("native or oracle-none arm must preserve the exact native instruction bytes.");
  }
  return { digest: finalDigest, bytes: final };
}

function auditProducer(value: unknown): IndependentAuditProducer {
  const item = record(value);
  return {
    adapterId: String(item?.adapterId ?? ""),
    version: String(item?.version ?? ""),
    binarySha256: String(item?.binarySha256 ?? ""),
  };
}

function validateUsage(
  bundle: ProspectiveRunEvidenceBundle,
  runner: ReturnType<typeof record>,
  events: readonly ProspectiveNativeEvent[],
  finalInstruction: { digest: string; bytes: Uint8Array },
  promptInputProducer: IndependentAuditProducer,
  problems: string[],
): { requestIds: string[]; resolvedModelId: string; inputTokens: number } {
  const usage = bundle.providerUsage;
  const requestIds = usage.map((item) => item.requestId);
  if (!usage.length || new Set(requestIds).size !== requestIds.length) problems.push("provider usage needs unique request records.");
  for (const item of usage) {
    if (!text(item.requestId) || item.requestedModelId !== runner?.modelId || !text(item.resolvedModelId)
      || !integer(item.inputTokens) || !integer(item.outputTokens)) problems.push("provider usage record is malformed or changes the model.");
  }
  const resolved = new Set(usage.map((item) => item.resolvedModelId));
  if (resolved.size !== 1) problems.push("one run cannot mix provider-resolved model ids.");
  const firstAction = events.find((event) => event.kind === "first-model-action");
  if (firstAction?.payload.requestId !== bundle.contextDelivery.providerRequestId
    || !requestIds.includes(bundle.contextDelivery.providerRequestId)) {
    problems.push("first model action, context delivery, and usage request ids do not match.");
  }
  if (bundle.contextDelivery.loadedInstructionPath !== bundle.overlay.instructionPath
    || bundle.contextDelivery.loadedInstructionDigest !== finalInstruction.digest
    || bundle.contextDelivery.effectivePromptDigest !== bundle.contextDelivery.proof.promptInputSha256) {
    problems.push("loaded model context does not prove exact instruction delivery.");
  }
  problems.push(...validateCodexPromptDeliveryProof({
    proof: bundle.contextDelivery.proof,
    expectedProducer: promptInputProducer,
    expectedInstructionPath: bundle.overlay.instructionPath,
    expectedInstructionBytes: finalInstruction.bytes,
  }).map((problem) => `prompt delivery: ${problem}`));
  const identity = bundle.runnerIdentity;
  if (identity.binarySha256 !== runner?.runnerBinarySha256
    || identity.systemPromptSha256 !== runner?.systemPromptSha256
    || identity.toolSchemaSha256 !== runner?.toolSchemaSha256
    || identity.toolchainManifestDigest !== runner?.toolchainManifestDigest) {
    problems.push("actual runner identity differs from the frozen runner.");
  }
  return {
    requestIds,
    resolvedModelId: usage[0]?.resolvedModelId ?? "",
    inputTokens: usage.reduce((sum, item) => sum + item.inputTokens, 0),
  };
}

function validateExecutionShape(execution: CommandExecutionEvidence, problems: string[]): boolean {
  const start = instant(execution.startedAt);
  const end = instant(execution.completedAt);
  const valid = Boolean(text(execution.executionId) && Array.isArray(execution.argv) && execution.argv.length
    && execution.argv.every(text) && text(execution.cwd) && integer(execution.timeoutSeconds)
    && start !== undefined && end !== undefined && start! <= end!
    && (execution.exitCode === null || Number.isSafeInteger(execution.exitCode))
    && SHA1.test(execution.treeBefore) && SHA1.test(execution.treeAfter)
    && SHA256.test(execution.outputDigest) && SHA256.test(execution.suiteDigest));
  if (!valid) problems.push(`execution ${execution.executionId || "(missing)"} is malformed.`);
  return valid;
}

function validateExecutions(
  bundle: ProspectiveRunEvidenceBundle,
  task: ReturnType<typeof record>,
  repository: ReturnType<typeof record>,
  events: readonly ProspectiveNativeEvent[],
  lastChangeAt: string | null,
  problems: string[],
) {
  const verification = Array.isArray(bundle.executions.verification) ? bundle.executions.verification : [];
  const hidden = bundle.executions.hiddenAcceptance;
  const regression = bundle.executions.regressionSuite;
  if (!hidden) problems.push("hidden acceptance execution is missing.");
  if (!regression) problems.push("regression suite execution is missing.");
  const all = [
    ...verification,
    ...(hidden ? [hidden] : []),
    ...(regression ? [regression] : []),
  ];
  if (new Set(all.map((item) => item.executionId)).size !== all.length) problems.push("command execution ids must be unique.");
  all.forEach((item) => validateExecutionShape(item, problems));
  const plan = record(task?.verificationPlan);
  const required = (Array.isArray(plan?.steps) ? plan.steps : []).map(record).filter((step) => step?.required === true);
  const verificationIds = verification.map((item) => item.stepId);
  if (!exactStrings(verificationIds as string[], required.map((step) => String(step!.id)))) {
    problems.push("verification executions do not equal the protocol-required step ids.");
  }
  const toolEvents = new Map(events.filter((event) => event.kind === "assistant-tool-call")
    .map((event) => [event.eventId, event]));
  for (const [index, execution] of verification.entries()) {
    const step = required[index];
    const initiator = execution.initiatedByEventId ? toolEvents.get(execution.initiatedByEventId) : undefined;
    if (!step || execution.kind !== "verification" || execution.actor !== "agent"
      || !initiator || initiator.payload.executionId !== execution.executionId
      || !exactStrings(execution.argv, step.argv as string[]) || execution.cwd !== step.cwd
      || execution.timeoutSeconds !== step.timeoutSeconds) {
      problems.push(`verification ${execution.executionId} is not the frozen agent-initiated command.`);
    }
  }
  const finalTree = bundle.finalWorkspace.submittedTree;
  const unchanged = (execution: CommandExecutionEvidence) => execution.treeBefore === finalTree && execution.treeAfter === finalTree;
  const afterChange = (execution: CommandExecutionEvidence) => !lastChangeAt
    || Date.parse(execution.startedAt) >= Date.parse(lastChangeAt);
  const requiredPassed = verification.length > 0
    && verification.every((item) => item.exitCode === 0 && unchanged(item));
  const afterLastChange = verification.every((item) => afterChange(item));
  if (hidden && (hidden.kind !== "hidden-acceptance" || hidden.actor !== "grader" || hidden.stepId !== null
    || hidden.suiteDigest !== task?.hiddenSuiteDigest || !unchanged(hidden))) {
    problems.push("hidden acceptance is not bound to the frozen suite and final tree.");
  }
  if (regression && (regression.kind !== "regression-suite" || regression.actor !== "grader" || regression.stepId !== null
    || regression.suiteDigest !== repository?.regressionSuiteDigest || !unchanged(regression))) {
    problems.push("regression execution is not bound to the frozen suite and final tree.");
  }
  return {
    requiredPassed,
    afterLastChange,
    hiddenPassed: hidden?.exitCode === 0,
    regressionPassed: regression?.exitCode === 0,
  };
}

function validateGrades(
  bundle: ProspectiveRunEvidenceBundle,
  task: ReturnType<typeof record>,
  problems: string[],
): { material: number; integrity: number } {
  const grades = bundle.blindedGrades.contractGrades;
  if (grades.length < 2 || new Set(grades.map((grade) => grade.reviewerId)).size < 2) {
    problems.push("contract grading requires two distinct blinded reviewers.");
  }
  for (const grade of grades) {
    if (grade.runAlias !== bundle.run.runAlias || grade.applicableContractsDigest !== task?.applicableContractsDigest
      || grade.patchDigest !== bundle.finalWorkspace.patchDigest || !text(grade.reviewerId)
      || !integer(grade.materialContractViolations) || !integer(grade.prohibitedIntegrityActions)
      || !SHA256.test(grade.rationaleDigest)) problems.push("contract grade is malformed or unbound.");
  }
  const outcomes = new Set(grades.map((grade) => `${grade.materialContractViolations}:${grade.prohibitedIntegrityActions}`));
  if (outcomes.size !== 1) problems.push("contract reviewers disagree without adjudication.");
  for (const harm of bundle.blindedGrades.harmAdjudications) {
    if (harm.runAlias !== bundle.run.runAlias || !text(harm.statementId) || typeof harm.causedRegression !== "boolean"
      || !Array.isArray(harm.diffLocations) || !SHA256.test(harm.rationaleDigest)
      || new Set(harm.reviewerIds).size < 2) problems.push("harm adjudication is malformed or unbound.");
  }
  return {
    material: grades[0]?.materialContractViolations ?? 0,
    integrity: grades[0]?.prohibitedIntegrityActions ?? 0,
  };
}

export function validateProspectiveRunEvidence(
  bundle: ProspectiveRunEvidenceBundle,
): ProspectiveRunEvidenceReport {
  const problems: string[] = [];
  for (const forbidden of [
    "toolCalls", "inputTokens", "grade", "humanLedger", "nativeHarnessDelivery", "oracleBriefDelivery",
  ]) {
    if (forbidden in bundle) problems.push(`bundle must not accept authoritative ${forbidden} summaries.`);
  }
  if (bundle.schemaVersion !== 1 || !text(bundle.run.runId) || !text(bundle.run.runAlias)) {
    problems.push("run evidence bundle has an invalid schema or identity.");
  }
  const found = validateProtocolBinding(bundle, problems);
  validateSnapshot(bundle, found.task, found.repository, problems);
  const finalInstruction = validateOverlay(bundle, found.intervention, problems);
  const eventReport = validateProspectiveNativeEventLog(bundle.eventLog);
  problems.push(...eventReport.problems.map((problem) => `event log: ${problem}`));
  const runner = record(found.protocol?.runner);
  const adapters = record(runner?.auditAdapters);
  const independent = validateProspectiveIndependentAudit({
    evidence: bundle.independentAudit,
    nativeEvents: bundle.eventLog.events,
    runId: bundle.run.runId,
    expectedProducers: {
      providerTranscript: auditProducer(adapters?.providerTranscript),
      runnerControl: auditProducer(adapters?.runnerControl),
      workspaceAudit: auditProducer(adapters?.workspaceAudit),
    },
  });
  problems.push(...independent.problems.map((problem) => `independent audit: ${problem}`));
  const usage = validateUsage(
    bundle,
    runner,
    bundle.eventLog.events,
    finalInstruction,
    auditProducer(adapters?.promptInput),
    problems,
  );
  if (bundle.finalWorkspace.submittedTree !== eventReport.frozenTree
    || !SHA1.test(bundle.finalWorkspace.submittedTree) || !SHA256.test(bundle.finalWorkspace.contentManifestDigest)
    || !SHA256.test(bundle.finalWorkspace.patchDigest)) problems.push("final workspace does not match the submitted event evidence.");
  const executions = validateExecutions(
    bundle,
    found.task,
    found.repository,
    bundle.eventLog.events,
    eventReport.lastWorkspaceChangeAt,
    problems,
  );
  const grades = validateGrades(bundle, found.task, problems);
  const humanLedger = buildHumanInterventionLedger({
    events: eventReport.normalizedEvents,
    annotations: eventReport.annotations,
  });
  if (!humanLedger.scoreable) problems.push(...humanLedger.problems.map((problem) => `human ledger: ${problem}`));
  const selected = bundle.plannedCell.rescueSelected;
  const rescueSeconds = validateProspectiveRescue({ bundle, eventReport, ledger: humanLedger, problems });
  const started = eventReport.startedAt ? Date.parse(eventReport.startedAt) : Number.NaN;
  const ended = eventReport.endedAt ? Date.parse(eventReport.endedAt) : Number.NaN;
  const maxMinutes = Number(runner?.maxWallClockMinutes);
  const withinBudget = Number.isFinite(started) && Number.isFinite(ended)
    && ended - started <= maxMinutes * 60_000 && eventReport.toolCalls <= Number(runner?.maxToolInvocations);
  const run: ValidatedProspectiveRun | undefined = eventReport.startedAt && eventReport.endedAt ? {
    evidenceDigest: sha256(bundle),
    runId: bundle.run.runId,
    runAlias: bundle.run.runAlias,
    protocolDigest: bundle.protocol.canonicalDigest,
    taskId: bundle.plannedCell.taskId,
    repositoryId: bundle.plannedCell.repositoryId,
    arm: bundle.plannedCell.arm,
    repetition: bundle.plannedCell.repetition,
    attempt: bundle.run.attempt,
    replacementForAttempt: bundle.run.replacementForAttempt,
    plannedOrder: bundle.plannedCell.order,
    rescueSelected: selected,
    actualStartAt: eventReport.startedAt,
    actualEndAt: eventReport.endedAt,
    providerRequestIds: usage.requestIds,
    resolvedModelId: usage.resolvedModelId,
    toolCalls: eventReport.toolCalls,
    inputTokens: usage.inputTokens,
    humanLedger,
    submitted: eventReport.terminalKind === "submission",
    withinBudget,
    hiddenAcceptancePassed: executions.hiddenPassed,
    regressionSuitePassed: executions.regressionPassed,
    requiredVerificationPassed: executions.requiredPassed,
    verificationAfterLastCodeChange: executions.afterLastChange,
    submittedTree: bundle.finalWorkspace.submittedTree,
    materialContractViolations: grades.material,
    prohibitedIntegrityActions: grades.integrity,
    rescueSeconds,
    rescueStatus: bundle.rescue.status,
    rescuerAlias: bundle.rescue.rescuerAlias,
    harmAdjudications: bundle.blindedGrades.harmAdjudications,
  } : undefined;
  return { ready: problems.length === 0 && Boolean(run), problems, run };
}

export function validateProspectiveEvidenceSet(
  bundles: readonly ProspectiveRunEvidenceBundle[],
): { ready: boolean; problems: string[]; runs: ValidatedProspectiveRun[] } {
  const reports = bundles.map(validateProspectiveRunEvidence);
  const problems = reports.flatMap((report, index) =>
    report.problems.map((problem) => `bundles[${index}]: ${problem}`));
  const runs = reports.flatMap((report) => report.run ? [report.run] : []);
  const unique = (values: readonly string[], owner: string) => {
    if (new Set(values).size !== values.length) problems.push(`${owner} must be unique across runs.`);
  };
  unique(runs.map((run) => run.runId), "runId");
  unique(runs.map((run) => run.runAlias), "runAlias");
  unique(runs.flatMap((run) => run.providerRequestIds), "provider request id");
  if (new Set(runs.map((run) => run.protocolDigest)).size > 1) problems.push("all runs must use one frozen protocol digest.");
  if (new Set(runs.map((run) => run.resolvedModelId)).size > 1) problems.push("all compared runs must use one resolved model id.");
  const selectedRescuers = new Map<string, Set<string>>();
  for (const run of runs.filter((item) => item.rescueSelected && item.rescuerAlias)) {
    selectedRescuers.set(run.repositoryId, new Set([
      ...selectedRescuers.get(run.repositoryId) ?? [],
      run.rescuerAlias!,
    ]));
  }
  for (const [repositoryId, aliases] of selectedRescuers) {
    if (aliases.size !== 1) problems.push(`repository ${repositoryId} uses different preselected rescuers across arms.`);
  }
  const planned = [...runs].sort((left, right) => left.plannedOrder - right.plannedOrder).map((run) => run.runId);
  const actual = [...runs].sort((left, right) => Date.parse(left.actualStartAt) - Date.parse(right.actualStartAt)).map((run) => run.runId);
  if (!exactStrings(actual, planned)) problems.push("actual first-attempt order differs from the frozen randomization order.");
  return { ready: problems.length === 0 && runs.length === bundles.length, problems, runs };
}
