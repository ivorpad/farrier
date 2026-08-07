import type { HumanInterventionLedger } from "../human-intervention-ledger";
import type { CodexPromptDeliveryProof } from "../codex-prompt-delivery";
import type { ProspectiveIndependentAuditEvidence } from "../prospective-independent-audit";
import type { ProspectiveNativeEventLog } from "../prospective-native-event-log";
import type { ProspectiveSnapshotEvidence } from "../prospective-snapshot";
import type { ProspectiveArm } from "./prospective-autonomy-protocol";

export type CommandExecutionEvidence = {
  executionId: string;
  kind: "verification" | "hidden-acceptance" | "regression-suite";
  stepId: string | null;
  actor: "agent" | "grader";
  initiatedByEventId: string | null;
  argv: string[];
  cwd: string;
  timeoutSeconds: number;
  startedAt: string;
  completedAt: string;
  exitCode: number | null;
  treeBefore: string;
  treeAfter: string;
  outputDigest: string;
  suiteDigest: string;
};

export type ContractGradeEvidence = {
  runAlias: string;
  reviewerId: string;
  applicableContractsDigest: string;
  patchDigest: string;
  materialContractViolations: number;
  prohibitedIntegrityActions: number;
  rationaleDigest: string;
};

export type HarmAdjudicationEvidence = {
  runAlias: string;
  statementId: string;
  causedRegression: boolean;
  diffLocations: string[];
  rationaleDigest: string;
  reviewerIds: string[];
};

export type ProspectiveRunEvidenceBundle = {
  schemaVersion: 1;
  run: {
    runId: string;
    runAlias: string;
    attempt: 1 | 2;
    replacementForAttempt: 1 | null;
  };
  protocol: { body: unknown; canonicalDigest: string };
  plannedCell: {
    taskId: string;
    repositoryId: string;
    arm: ProspectiveArm;
    repetition: 1 | 2;
    order: number;
    rescueSelected: boolean;
  };
  snapshot: ProspectiveSnapshotEvidence;
  recognizedNativeHarnessDigest: string;
  overlay: {
    kind: "brief" | "none";
    baselineTree: string;
    instructionPath: string;
    baselineInstructionBase64: string;
    briefBase64: string | null;
    finalInstructionBase64: string;
    changedPaths: string[];
    workspaceManifestDigest: string;
  };
  eventLog: ProspectiveNativeEventLog;
  independentAudit: ProspectiveIndependentAuditEvidence;
  contextDelivery: {
    providerRequestId: string;
    loadedInstructionPath: string;
    loadedInstructionDigest: string;
    effectivePromptDigest: string;
    proof: CodexPromptDeliveryProof;
  };
  runnerIdentity: {
    binarySha256: string;
    systemPromptSha256: string;
    toolSchemaSha256: string;
    toolchainManifestDigest: string;
  };
  providerUsage: Array<{
    requestId: string;
    requestedModelId: string;
    resolvedModelId: string;
    inputTokens: number;
    outputTokens: number;
  }>;
  finalWorkspace: {
    submittedTree: string;
    contentManifestDigest: string;
    patchDigest: string;
  };
  executions: {
    verification: CommandExecutionEvidence[];
    hiddenAcceptance: CommandExecutionEvidence;
    regressionSuite: CommandExecutionEvidence;
  };
  blindedGrades: {
    contractGrades: ContractGradeEvidence[];
    harmAdjudications: HarmAdjudicationEvidence[];
  };
  rescue: {
    status: "not-required" | "completed" | "capped" | "protocol-error";
    rescuerAlias: string | null;
    correctionCategories: string[];
    editedFiles: number;
    changedLines: number;
  };
};

export type ValidatedProspectiveRun = {
  evidenceDigest: string;
  runId: string;
  runAlias: string;
  protocolDigest: string;
  taskId: string;
  repositoryId: string;
  arm: ProspectiveArm;
  repetition: 1 | 2;
  attempt: 1 | 2;
  replacementForAttempt: 1 | null;
  plannedOrder: number;
  rescueSelected: boolean;
  actualStartAt: string;
  actualEndAt: string;
  providerRequestIds: string[];
  resolvedModelId: string;
  toolCalls: number;
  inputTokens: number;
  humanLedger: HumanInterventionLedger;
  submitted: boolean;
  withinBudget: boolean;
  hiddenAcceptancePassed: boolean;
  regressionSuitePassed: boolean;
  requiredVerificationPassed: boolean;
  verificationAfterLastCodeChange: boolean;
  submittedTree: string;
  materialContractViolations: number;
  prohibitedIntegrityActions: number;
  rescueSeconds: number;
  rescueStatus: ProspectiveRunEvidenceBundle["rescue"]["status"];
  rescuerAlias: string | null;
  harmAdjudications: HarmAdjudicationEvidence[];
};

export type ProspectiveRunEvidenceReport = {
  ready: boolean;
  problems: string[];
  run?: ValidatedProspectiveRun;
};
