import { createHash } from "node:crypto";

import { canonicalEvidence } from "../../behavior-evidence";

export type UnknownRecord = Record<string, unknown>;

export const prospectiveArms = ["native", "oracle-brief"] as const;
export type ProspectiveArm = (typeof prospectiveArms)[number];
export const prospectiveLanguageStrata = [
  "typescript", "python", "ruby-rails", "typescript-python",
] as const;

export const SHA1 = /^[0-9a-f]{40}$/;
export const SHA256 = /^[0-9a-f]{64}$/;
const MODEL_ALIAS = /(^|[-_.])(latest|current|default)([-_.]|$)/i;
const EXCLUDED_REPOSITORIES = /(^|[/_-])(farrier|vibestage|vibe-stage|konpy|shipaton)([/_-]|$)/i;
const REQUIRED_UNCHANGED = new Set([
  "session-history", "hooks", "generated-linters", "new-ci-rules", "skills",
  "subagents", "generated-justfile", "repository-map",
]);
const NATIVE_HARNESS_CONSUMERS = new Set([
  "coding-agent", "claude-code", "codex", "agent-tooling", "ci", "repository-verifier",
]);

export function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function integer(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? value as number : undefined;
}

export function instant(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => !text(item))) return undefined;
  return value as string[];
}

function digest(value: unknown): boolean {
  return typeof value === "string" && SHA256.test(value);
}

export function sha256Evidence(value: unknown): string {
  return createHash("sha256").update(canonicalEvidence(value)).digest("hex");
}

function bodyDigest(value: UnknownRecord, omittedKey: string): string {
  return sha256Evidence(Object.fromEntries(Object.entries(value).filter(([key]) => key !== omittedKey)));
}

function relativePath(value: unknown): boolean {
  const path = text(value);
  return Boolean(path && !path.startsWith("/") && !path.split("/").includes(".."));
}

function requireValues(
  owner: string,
  value: UnknownRecord,
  keys: readonly string[],
  expected: boolean,
  problems: string[],
): void {
  for (const key of keys) {
    if (value[key] !== expected) problems.push(`${owner}.${key} must be ${expected}.`);
  }
}

function validateNativeHarness(owner: string, raw: unknown, problems: string[]): void {
  const manifest = record(raw);
  if (!manifest || manifest.schemaVersion !== 1 || !SHA1.test(String(manifest.sourceCommit ?? ""))
    || !SHA1.test(String(manifest.sourceTree ?? "")) || !digest(manifest.digest)
    || !Array.isArray(manifest.artifacts)) {
    problems.push(`${owner}.nativeHarnessManifest must bind a v1 manifest to a SHA-1 commit and tree.`);
    return;
  }
  if (manifest.digest !== bodyDigest(manifest, "digest")) {
    problems.push(`${owner}.nativeHarnessManifest.digest does not match its canonical body.`);
  }
  const paths = new Set<string>();
  for (const [index, rawArtifact] of manifest.artifacts.entries()) {
    const artifact = record(rawArtifact);
    const prefix = `${owner}.nativeHarnessManifest.artifacts[${index}]`;
    if (!artifact || !relativePath(artifact.path) || !digest(artifact.contentDigest)) {
      problems.push(`${prefix} must contain a relative path and content digest.`);
      continue;
    }
    const path = String(artifact.path);
    if (paths.has(path)) problems.push(`${prefix}.path is duplicated.`);
    paths.add(path);
    if (integer(artifact.mode) === undefined || !NATIVE_HARNESS_CONSUMERS.has(String(artifact.consumer))) {
      problems.push(`${prefix} must record mode and consumer.`);
    }
  }
}

function validateTestStability(owner: string, raw: unknown, problems: string[]): void {
  const test = record(raw);
  const stability = record(test?.stability);
  const argv = strings(test?.argv);
  if (!argv?.length || integer(test?.maxMinutes) === undefined || Number(test?.maxMinutes) > 15) {
    problems.push(`${owner}.baselineTest needs argv and maxMinutes <= 15.`);
  }
  const runs = integer(stability?.calibrationRuns);
  const passes = integer(stability?.passes);
  const failures = integer(stability?.failures);
  const allowed = stability?.allowedFlakeRate;
  if (runs !== 5 || passes !== 5 || failures !== 0 || allowed !== 0) {
    problems.push(`${owner}.baselineTest.stability must record a frozen 5/5 pass with zero allowed flake rate.`);
  }
  if (!digest(stability?.evidenceDigest)) problems.push(`${owner}.baselineTest.stability needs an evidence digest.`);
}

export type RepositoryFacts = {
  id?: string;
  stratum?: string;
  externalMaintainer: boolean;
  sourceCommit?: string;
  sourceTree?: string;
  raw: UnknownRecord;
};

export function validateRepository(
  repository: UnknownRecord,
  index: number,
  seen: Set<string>,
  problems: string[],
): RepositoryFacts {
  const prefix = `repositories[${index}]`;
  const id = text(repository.id);
  if (!id) problems.push(`${prefix}.id is required.`);
  else if (seen.has(id)) problems.push(`${prefix}.id duplicates '${id}'.`);
  else seen.add(id);
  const owner = id ? `repository ${id}` : prefix;
  const slug = text(repository.slug);
  if (!slug || slug.startsWith("/")) problems.push(`${owner}.slug must be a non-local repository slug.`);
  if (slug && EXCLUDED_REPOSITORIES.test(slug)) problems.push(`${owner}.slug is contaminated by prior Farrier evaluation work.`);
  const stratum = text(repository.languageStratum);
  if (!prospectiveLanguageStrata.includes(stratum as never)) problems.push(`${owner}.languageStratum is invalid.`);
  const loc = integer(repository.sourceLoc);
  if (loc === undefined || loc < 5_000 || loc > 100_000) problems.push(`${owner}.sourceLoc must be between 5000 and 100000.`);
  requireValues(owner, repository, ["maintained", "nonToy", "dependencyInstallVerified", "notMonorepo"], true, problems);
  if (typeof repository.externalMaintainer !== "boolean") problems.push(`${owner}.externalMaintainer must be boolean.`);
  for (const key of ["backlogDigest", "dependencyLockDigest", "regressionSuiteDigest"]) {
    if (!digest(repository[key])) problems.push(`${owner}.${key} must be a SHA-256 digest.`);
  }
  if (instant(repository.backlogFrozenAt) === undefined) problems.push(`${owner}.backlogFrozenAt must be an ISO timestamp.`);
  const locMeasurement = record(repository.locMeasurement);
  if (!locMeasurement || !text(locMeasurement.counter) || !text(locMeasurement.version)
    || !strings(locMeasurement.includedExtensions)?.length || !digest(locMeasurement.generatedExclusionsDigest)) {
    problems.push(`${owner}.locMeasurement must freeze the counter, extensions, and exclusions.`);
  }
  validateTestStability(owner, repository.baselineTest, problems);
  validateNativeHarness(owner, repository.nativeHarnessManifest, problems);
  if (Array.isArray(repository.backlog)
    && repository.backlogDigest !== sha256Evidence(repository.backlog)) {
    problems.push(`${owner}.backlogDigest does not match the frozen backlog.`);
  }
  const nativeHarness = record(repository.nativeHarnessManifest);
  return {
    id,
    stratum,
    externalMaintainer: repository.externalMaintainer === true,
    sourceCommit: SHA1.test(String(nativeHarness?.sourceCommit ?? ""))
      ? String(nativeHarness!.sourceCommit)
      : undefined,
    sourceTree: SHA1.test(String(nativeHarness?.sourceTree ?? ""))
      ? String(nativeHarness!.sourceTree)
      : undefined,
    raw: repository,
  };
}

function validateVerificationPlan(owner: string, raw: unknown, problems: string[]): void {
  const plan = record(raw);
  if (!plan || !digest(plan.digest) || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    problems.push(`${owner}.verificationPlan must contain a digest and steps.`);
    return;
  }
  if (plan.digest !== bodyDigest(plan, "digest")) {
    problems.push(`${owner}.verificationPlan.digest does not match its canonical body.`);
  }
  const ids = new Set<string>();
  for (const [index, rawStep] of plan.steps.entries()) {
    const step = record(rawStep);
    const prefix = `${owner}.verificationPlan.steps[${index}]`;
    const id = text(step?.id);
    if (!id || ids.has(id)) problems.push(`${prefix}.id is missing or duplicated.`);
    else ids.add(id);
    if (!strings(step?.argv)?.length || !relativePath(step?.cwd) || integer(step?.timeoutSeconds) === undefined) {
      problems.push(`${prefix} needs argv, relative cwd, and timeoutSeconds.`);
    }
    if (typeof step?.required !== "boolean") problems.push(`${prefix}.required must be boolean.`);
  }
}

export type TaskFacts = { id?: string; repositoryId?: string; frozenAt?: number };

export function validateTask(
  task: UnknownRecord,
  index: number,
  repositories: Set<string>,
  seen: Set<string>,
  problems: string[],
): TaskFacts {
  const prefix = `tasks[${index}]`;
  const id = text(task.id);
  if (!id) problems.push(`${prefix}.id is required.`);
  else if (seen.has(id)) problems.push(`${prefix}.id duplicates '${id}'.`);
  else seen.add(id);
  const owner = id ? `task ${id}` : prefix;
  const repositoryId = text(task.repositoryId);
  if (!repositoryId || !repositories.has(repositoryId)) problems.push(`${owner}.repositoryId must name a sampled repository.`);
  requireValues(owner, task, [
    "genuinePlannedWork", "productionCodeChange", "behaviorallyTestable", "noPreviousAgentAttempt",
    "noAccessibleSolution", "notIncidentReplay", "offlineSolvable", "hiddenSuiteOutsideWorkspace",
  ], true, problems);
  requireValues(owner, task, ["requiresExternalCredentials", "requiresExternalLiveService"], false, problems);
  const effort = integer(task.estimatedMaintainerMinutes);
  if (effort === undefined || effort < 30 || effort > 120) problems.push(`${owner}.estimatedMaintainerMinutes must be between 30 and 120.`);
  for (const key of ["taskPacketDigest", "hiddenSuiteDigest", "applicableContractsDigest", "workspaceContentDigest"]) {
    if (!digest(task[key])) problems.push(`${owner}.${key} must be a SHA-256 digest.`);
  }
  const snapshot = record(task.snapshot);
  if (!snapshot || snapshot.objectFormat !== "sha1" || !SHA1.test(String(snapshot.commit)) || !SHA1.test(String(snapshot.tree))) {
    problems.push(`${owner}.snapshot must declare sha1 and contain full commit and tree ids.`);
  }
  if (snapshot?.historyMode !== "snapshot-root" || snapshot?.noFutureObjects !== true) {
    problems.push(`${owner}.snapshot must use a future-free snapshot-root history.`);
  }
  const documentation = record(task.requiredExternalDocumentation);
  if (!documentation || !["none", "frozen-offline-corpus"].includes(String(documentation.kind))
    || (documentation.kind === "frozen-offline-corpus" && !digest(documentation.digest))) {
    problems.push(`${owner}.requiredExternalDocumentation is invalid.`);
  }
  const dates = ["taskFrozenAt", "hiddenSuiteFrozenAt", "contractsFrozenAt"].map((key) => instant(task[key]));
  dates.forEach((date, position) => {
    if (date === undefined) problems.push(`${owner}.${["taskFrozenAt", "hiddenSuiteFrozenAt", "contractsFrozenAt"][position]} must be an ISO timestamp.`);
  });
  validateVerificationPlan(owner, task.verificationPlan, problems);
  return { id, repositoryId, frozenAt: dates.every((date) => date !== undefined) ? Math.max(...dates as number[]) : undefined };
}

export function validateBacklog(
  repository: RepositoryFacts,
  selectedTaskIds: Set<string>,
  problems: string[],
): void {
  const owner = `repository ${repository.id ?? "(missing id)"}`;
  const entries = Array.isArray(repository.raw.backlog) ? repository.raw.backlog.map(record) : [];
  if (entries.some((entry) => !entry)) {
    problems.push(`${owner}.backlog must contain only objects.`);
    return;
  }
  const sorted = (entries as UnknownRecord[]).sort((left, right) => Number(left.position) - Number(right.position));
  const taskIds = new Set<string>();
  if (sorted.length === 0 || sorted.some((entry, index) => integer(entry.position) !== index + 1)) {
    problems.push(`${owner}.backlog positions must be unique and contiguous from 1.`);
  }
  for (const entry of sorted) {
    const taskId = text(entry.taskId);
    if (typeof entry.eligible !== "boolean" || !taskId) problems.push(`${owner}.backlog entries need taskId and eligible.`);
    else if (taskIds.has(taskId)) problems.push(`${owner}.backlog taskId ${taskId} is duplicated.`);
    else taskIds.add(taskId);
    const reasons = strings(entry.exclusionReasons);
    if (!reasons || (entry.eligible === false && reasons.length === 0) || (entry.eligible === true && reasons.length > 0)) {
      problems.push(`${owner}.backlog exclusion reasons contradict eligibility.`);
    }
  }
  const eligible = sorted.filter((entry) => entry.eligible === true).slice(0, 4);
  if (eligible.length !== 4
    || eligible.slice(0, 2).some((entry) => entry.selectedAs !== "scored" || !selectedTaskIds.has(String(entry.taskId)))
    || eligible.slice(2).some((entry) => entry.selectedAs !== "replacement" || selectedTaskIds.has(String(entry.taskId)))) {
    problems.push(`${owner}.backlog must select the first two eligible tasks and next two replacements.`);
  }
}

export function validateIntervention(
  intervention: UnknownRecord,
  index: number,
  repositories: Set<string>,
  taskFrozenAt: readonly number[],
  problems: string[],
): string | undefined {
  const repositoryId = text(intervention.repositoryId);
  const owner = repositoryId ? `intervention ${repositoryId}` : `interventions[${index}]`;
  if (!repositoryId || !repositories.has(repositoryId)) problems.push(`${owner}.repositoryId must name a sampled repository.`);
  const kind = text(intervention.kind);
  if (kind !== "brief" && kind !== "none") problems.push(`${owner}.kind must be brief or none.`);
  requireValues(owner, intervention, ["taskBlind", "nativeHarnessPreserved", "evidenceBacked"], true, problems);
  for (const key of ["interventionDigest", "selectionEvidenceDigest", "rationaleDigest", "accessManifestDigest"]) {
    if (!digest(intervention[key])) problems.push(`${owner}.${key} must be a SHA-256 digest.`);
  }
  const startedAt = instant(intervention.authoringStartedAt);
  const frozenAt = instant(intervention.frozenAt);
  if (startedAt === undefined || frozenAt === undefined || startedAt >= frozenAt) {
    problems.push(`${owner} must record ordered authoring and freeze times.`);
  }
  if (startedAt !== undefined && taskFrozenAt.some((value) => value > startedAt)) {
    problems.push(`${owner} authoring started before task packets, suites, and contracts were frozen.`);
  }
  requireValues(owner, intervention, [
    "taskPacketsFrozenBeforeAuthoring", "hiddenSuitesFrozenBeforeAuthoring", "applicableContractsHiddenFromAuthor",
  ], true, problems);
  if (intervention.taskIdentityAccess === "never") {
    if (intervention.taskIdentityAccessAt !== null) problems.push(`${owner}.taskIdentityAccessAt must be null when access is never.`);
  } else if (intervention.taskIdentityAccess === "after-scoring") {
    const accessAt = instant(intervention.taskIdentityAccessAt);
    if (accessAt === undefined || (frozenAt !== undefined && accessAt <= frozenAt)) problems.push(`${owner} task identity access must occur after freeze.`);
  } else problems.push(`${owner}.taskIdentityAccess is invalid.`);
  const unchanged = new Set(strings(intervention.mechanismsNotAddedOrModifiedByIntervention) ?? []);
  for (const mechanism of REQUIRED_UNCHANGED) if (!unchanged.has(mechanism)) problems.push(`${owner} does not freeze ${mechanism}.`);
  const sources = strings(intervention.evidenceSources);
  const allowed = new Set(["source", "tests", "documentation", "cutoff-git"]);
  if (!sources?.length || sources.some((source) => !allowed.has(source))) {
    problems.push(`${owner}.evidenceSources must contain eligible task-blind sources.`);
  }
  if (intervention.taskIdentityAccess !== "never") {
    problems.push(`${owner}.taskIdentityAccess must remain never in the frozen protocol.`);
  }
  if (kind === "brief") {
    requireValues(owner, intervention, ["singleNativeArtifact"], true, problems);
    if (intervention.delivery !== "native-repository-instruction" || !relativePath(intervention.artifactPath)) {
      problems.push(`${owner} brief needs one relative native instruction artifact.`);
    }
    for (const key of ["contentDigest", "evidenceDigest"]) if (!digest(intervention[key])) problems.push(`${owner}.${key} must be a SHA-256 digest.`);
    const bytes = integer(intervention.utf8Bytes);
    const tokens = integer(intervention.estimatedTokens);
    const statements = integer(intervention.normativeStatements);
    if (bytes === undefined || bytes < 1 || bytes > 4_000
      || tokens === undefined || tokens < 1 || tokens > 600
      || statements === undefined || statements < 1 || statements > 10) {
      problems.push(`${owner} brief exceeds its size or statement budget.`);
    }
  } else if (kind === "none") {
    if (intervention.singleNativeArtifact !== false || intervention.delivery !== "not-applicable") problems.push(`${owner} none decision cannot claim artifact delivery.`);
    for (const key of ["artifactPath", "contentDigest", "evidenceDigest"]) if (intervention[key] !== undefined) problems.push(`${owner}.${key} must be absent for none.`);
  }
  if (intervention.interventionDigest !== bodyDigest(intervention, "interventionDigest")) {
    problems.push(`${owner}.interventionDigest does not match its canonical body.`);
  }
  return repositoryId;
}

export function validateRunner(runner: UnknownRecord | undefined, problems: string[]): void {
  if (!runner) return void problems.push("runner must be an object.");
  for (const key of ["runnerName", "runnerVersion", "provider", "modelId", "reasoningEffort"]) if (!text(runner[key])) problems.push(`runner.${key} is required.`);
  if (MODEL_ALIAS.test(text(runner.modelId) ?? "")) problems.push("runner.modelId must not be a mutable alias.");
  for (const key of ["runnerBinarySha256", "systemPromptSha256", "toolSchemaSha256", "toolchainManifestDigest"]) if (!digest(runner[key])) problems.push(`runner.${key} must be a SHA-256 digest.`);
  if (runner.maxWallClockMinutes !== 60 || runner.maxToolInvocations !== 150) problems.push("runner must use the frozen 60-minute and 150-tool budgets.");
  const network = record(runner.networkPolicy);
  if (network?.agentToolNetwork !== "disabled" || network?.providerTransport !== "enabled") problems.push("runner.networkPolicy must disable agent tools but allow provider transport.");
  const environment = record(runner.executionEnvironment);
  if (!environment || !["oci", "vm", "host"].includes(String(environment.kind))
    || !digest(environment.kind === "host" ? environment.manifestDigest : environment.imageDigest)) {
    problems.push("runner.executionEnvironment is invalid.");
  }
  const adapters = record(runner.auditAdapters);
  for (const key of ["providerTranscript", "runnerControl", "workspaceAudit", "promptInput"]) {
    const adapter = record(adapters?.[key]);
    if (!adapter || !text(adapter.adapterId) || !text(adapter.version) || !digest(adapter.binarySha256)) {
      problems.push(`runner.auditAdapters.${key} must bind an adapter id, version, and binary digest.`);
    }
  }
  requireValues("runner", runner, [
    "sameAcrossArms", "freshWorkspace", "freshHome", "noGlobalAgentConfig", "noShellHistory",
    "noPriorTranscript", "noCrossRunCache", "noGitRemote", "noFutureGitObjects",
  ], true, problems);
}
