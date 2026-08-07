const digest = "a".repeat(64);
const commit = "b".repeat(40);
const tree = "c".repeat(40);
const strata = ["typescript", "python", "ruby-rails", "typescript-python"];
const unchangedMechanisms = [
  "session-history", "hooks", "generated-linters", "new-ci-rules", "skills",
  "subagents", "generated-justfile", "repository-map",
];

export const prospectiveFixtureDigest = digest;

export function frozenProspectiveProtocol(): any {
  const repositories = strata.map((languageStratum, index) => {
    const backlog = [1, 2, 3, 4].map((position) => ({
      position,
      taskId: position <= 2
        ? `task-${index + 1}-${position}`
        : `replacement-${index + 1}-${position}`,
      eligible: true,
      exclusionReasons: [],
      selectedAs: position <= 2 ? "scored" : "replacement",
    }));
    const nativeHarnessBody = {
      schemaVersion: 1,
      sourceCommit: commit,
      sourceTree: tree,
      artifacts: [{ path: "AGENTS.md", contentDigest: digest, mode: 420, consumer: "coding-agent" }],
    };
    return {
      id: `repo-${index + 1}`,
      slug: `maintainer/project-${index + 1}`,
      languageStratum,
      sourceLoc: 12_000,
      maintained: true,
      nonToy: true,
      dependencyInstallVerified: true,
      notMonorepo: true,
      externalMaintainer: index < 2,
      backlogDigest: sha256Evidence(backlog),
      dependencyLockDigest: digest,
      regressionSuiteDigest: digest,
      backlogFrozenAt: "2026-08-06T10:00:00Z",
      locMeasurement: {
        counter: "tokei",
        version: "14.0.0",
        includedExtensions: ["ts", "tsx"],
        generatedExclusionsDigest: digest,
      },
      baselineTest: {
        argv: ["bun", "test"],
        maxMinutes: 10,
        stability: {
          calibrationRuns: 5,
          passes: 5,
          failures: 0,
          allowedFlakeRate: 0,
          evidenceDigest: digest,
        },
      },
      nativeHarnessManifest: {
        ...nativeHarnessBody,
        digest: sha256Evidence(nativeHarnessBody),
      },
      backlog,
    };
  });
  const tasks = repositories.flatMap((repository, repositoryIndex) => [1, 2].map((position) => ({
    id: `task-${repositoryIndex + 1}-${position}`,
    repositoryId: repository.id,
    genuinePlannedWork: true,
    productionCodeChange: true,
    behaviorallyTestable: true,
    noPreviousAgentAttempt: true,
    noAccessibleSolution: true,
    notIncidentReplay: true,
    hiddenSuiteOutsideWorkspace: true,
    offlineSolvable: true,
    requiresExternalCredentials: false,
    requiresExternalLiveService: false,
    estimatedMaintainerMinutes: 60,
    taskPacketDigest: digest,
    hiddenSuiteDigest: digest,
    applicableContractsDigest: digest,
    workspaceContentDigest: digest,
    taskFrozenAt: "2026-08-06T10:05:00Z",
    hiddenSuiteFrozenAt: "2026-08-06T10:06:00Z",
    contractsFrozenAt: "2026-08-06T10:07:00Z",
    snapshot: { objectFormat: "sha1", commit, tree, historyMode: "snapshot-root", noFutureObjects: true },
    requiredExternalDocumentation: { kind: "none" },
    verificationPlan: (() => {
      const body = {
        steps: [{ id: "check", argv: ["bun", "test"], cwd: ".", timeoutSeconds: 900, required: true }],
      };
      return { ...body, digest: sha256Evidence(body) };
    })(),
  })));
  const interventions = repositories.map((repository) => {
    const body = {
      repositoryId: repository.id,
      kind: "brief",
      taskBlind: true,
      nativeHarnessPreserved: true,
      singleNativeArtifact: true,
      evidenceBacked: true,
      selectionEvidenceDigest: digest,
      rationaleDigest: digest,
      accessManifestDigest: digest,
      delivery: "native-repository-instruction",
      authoringStartedAt: "2026-08-06T10:08:00Z",
      frozenAt: "2026-08-06T10:10:00Z",
      taskPacketsFrozenBeforeAuthoring: true,
      hiddenSuitesFrozenBeforeAuthoring: true,
      applicableContractsHiddenFromAuthor: true,
      taskIdentityAccess: "never",
      taskIdentityAccessAt: null,
      mechanismsNotAddedOrModifiedByIntervention: unchangedMechanisms,
      evidenceSources: ["source", "tests", "documentation", "cutoff-git"],
      artifactPath: "AGENTS.md",
      contentDigest: digest,
      evidenceDigest: digest,
      utf8Bytes: 2_000,
      estimatedTokens: 400,
      normativeStatements: 8,
    };
    return { ...body, interventionDigest: sha256Evidence(body) };
  });
  let order = 0;
  const cells = repositories.flatMap((repository) => {
    const repositoryTasks = tasks.filter((task) => task.repositoryId === repository.id);
    return repositoryTasks.flatMap((task, index) => {
      const arms = index === 0
        ? ["native", "oracle-brief", "oracle-brief", "native"]
        : ["oracle-brief", "native", "native", "oracle-brief"];
      const repetitions = { native: 0, "oracle-brief": 0 };
      return arms.map((arm) => ({
        taskId: task.id,
        arm,
        repetition: ++repetitions[arm as keyof typeof repetitions],
        order: ++order,
        rescueSelected: repetitions[arm as keyof typeof repetitions] === 1,
      }));
    });
  });
  const protocol = {
    schemaVersion: 2,
    track: "prospective-autonomy-p0",
    status: "frozen",
    originalGate0Status: "unpassed",
    prospectiveTasksCountTowardGate0: false,
    amendmentDigest: digest,
    protocolDigest: "",
    instrumentationClarificationDigest: digest,
    protocolFrozenAt: "2026-08-06T10:20:00Z",
    firstCalibrationRunAt: null,
    rescuePolicy: {
      selection: "one-preselected-repetition-per-task-arm",
      maxActiveMinutes: 20,
      sameMaintainerWithinRepository: true,
      blindToArm: true,
      freezeAutonomousResultFirst: true,
    },
    repositories,
    tasks,
    interventions,
    runner: {
      runnerName: "codex-cli",
      runnerVersion: "0.145.0-alpha.4",
      runnerBinarySha256: digest,
      provider: "openai",
      modelId: "gpt-5.5-codex-2026-08-01",
      reasoningEffort: "high",
      temperature: null,
      seed: null,
      systemPromptSha256: digest,
      toolSchemaSha256: digest,
      toolchainManifestDigest: digest,
      auditAdapters: {
        providerTranscript: { adapterId: "openai-response-audit", version: "1.0.0", binarySha256: digest },
        runnerControl: { adapterId: "farrier-control-audit", version: "1.0.0", binarySha256: digest },
        workspaceAudit: { adapterId: "farrier-workspace-audit", version: "1.0.0", binarySha256: digest },
        promptInput: { adapterId: "codex-prompt-input-audit", version: "1.0.0", binarySha256: digest },
      },
      executionEnvironment: { kind: "host", manifestDigest: digest },
      maxWallClockMinutes: 60,
      maxToolInvocations: 150,
      networkPolicy: { agentToolNetwork: "disabled", providerTransport: "enabled" },
      sameAcrossArms: true,
      freshWorkspace: true,
      freshHome: true,
      noGlobalAgentConfig: true,
      noShellHistory: true,
      noPriorTranscript: true,
      noCrossRunCache: true,
      noGitRemote: true,
      noFutureGitObjects: true,
    },
    randomization: { seed: 8_062_026, frozenAt: "2026-08-06T10:19:00Z", cells },
  };
  protocol.protocolDigest = canonicalProspectiveProtocolDigest(protocol);
  return protocol;
}
import { canonicalProspectiveProtocolDigest } from "../../src/engine/evaluations/contracts/prospective-autonomy-protocol";
import { sha256Evidence } from "../../src/engine/evaluations/contracts/prospective-autonomy-protocol-items";
