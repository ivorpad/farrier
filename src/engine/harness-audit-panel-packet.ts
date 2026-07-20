import { randomBytes, randomInt } from "node:crypto";
import { lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { planHarnessAudit, type HarnessAuditPlan } from "./harness-audit";
import type { HarnessAuditGroundTruth } from "./harness-audit-evaluation";
import {
  inspectHarnessAuditPanelSource,
  snapshotHarnessAuditPanelSource,
  type HarnessAuditPanelSnapshot,
  type HarnessAuditPanelSourceInspection,
} from "./harness-audit-panel-source";
import { harnessAuditPanelPacketProblems } from "./harness-audit-panel-packet-check";
import type { HarnessAuditRepositoryKind } from "./harness-audit-review-results";
import type { HarnessAuditReviewPreflightPlan } from "./harness-audit-review-preflight";
import { harnessAuditLayers, isHarnessAuditSeverity } from "./harness-audit-types";
import type { AdviceVendor } from "./advice-types";

export const harnessAuditPanelKinds = ["known-defects", "clean", "seeded"] as const;

export type HarnessAuditPanelSource = {
  kind: HarnessAuditRepositoryKind;
  sourceDir: string;
  truth: HarnessAuditGroundTruth;
  evidence: string[];
};

export type HarnessAuditPanelReviewer = {
  reviewerId: string;
  role: "staff" | "principal";
};

export type HarnessAuditPanelPacketInput = {
  schemaVersion: 1;
  farrierBuildId: string;
  backend: AdviceVendor;
  model: string;
  maxProviderCostUsdPerCall?: number;
  accountBudgetEvidence?: string[];
  reviewers: HarnessAuditPanelReviewer[];
  sources: HarnessAuditPanelSource[];
};

export type HarnessAuditBudgetProposal = {
  maxProviderCalls: number;
  maxEstimatedInputTokens: number;
  maxProviderCostUsd: number;
};

export type HarnessAuditPanelAliasPacket = {
  alias: string;
  kind: HarnessAuditRepositoryKind;
  targetDir: string;
  sourceDir: string;
  sourceCommit: string;
  corpusDigest: string;
  truth: HarnessAuditGroundTruth;
  snapshot: HarnessAuditPanelSnapshot;
  plans: HarnessAuditReviewPreflightPlan[];
  planFiles: string[];
};

export type HarnessAuditPanelReviewerPacket = HarnessAuditPanelReviewer & {
  aliases: HarnessAuditPanelAliasPacket[];
  budgetProposal: HarnessAuditBudgetProposal;
  assignmentFile: string;
  preflightProposalFile: string;
};

export type HarnessAuditPanelPacket = {
  schemaVersion: 1;
  packetOnly: true;
  status: "awaiting-external-approval";
  farrierBuildId: string;
  backend: AdviceVendor;
  model: string;
  providerCallsMade: 0;
  externalApprovalReference: null;
  outputDir: string;
  accountBudgetEvidence: string[];
  reviewers: HarnessAuditPanelReviewerPacket[];
  budgetProposal: HarnessAuditBudgetProposal;
};

export type HarnessAuditPanelPacketDeps = {
  alias: () => string;
  shuffleKinds: (kinds: HarnessAuditRepositoryKind[]) => HarnessAuditRepositoryKind[];
  inspectSource: typeof inspectHarnessAuditPanelSource;
  snapshotSource: typeof snapshotHarnessAuditPanelSource;
  plan: typeof planHarnessAudit;
};

const defaultDeps: HarnessAuditPanelPacketDeps = {
  alias: () => randomBytes(8).toString("hex"),
  shuffleKinds: (kinds) => {
    const shuffled = [...kinds];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = randomInt(index + 1);
      [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
    }
    return shuffled;
  },
  inspectSource: inspectHarnessAuditPanelSource,
  snapshotSource: snapshotHarnessAuditPanelSource,
  plan: planHarnessAudit,
};

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isComponent(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function validateTruth(source: HarnessAuditPanelSource): string[] {
  const problems: string[] = [];
  if (!source.truth || !Array.isArray(source.truth.issues)) return [`${source.kind} has no ground truth.`];
  if (!Array.isArray(source.evidence) || source.evidence.filter(isNonBlank).length === 0) {
    problems.push(`${source.kind} source has no recorded selection or adjudication evidence.`);
  }
  if (!isNonBlank(source.truth.repository)) problems.push(`${source.kind} ground truth has no repository label.`);
  const ids = new Set<string>();
  for (const issue of source.truth.issues) {
    if (!isNonBlank(issue?.id) || ids.has(issue.id)) problems.push(`${source.kind} has a missing or duplicate issue ID.`);
    else ids.add(issue.id);
    if (!harnessAuditLayers.includes(issue?.layer)) problems.push(`${source.kind} issue ${issue?.id ?? "(missing)"} has an invalid layer.`);
    if (!isHarnessAuditSeverity(issue?.severity)) problems.push(`${source.kind} issue ${issue?.id ?? "(missing)"} has an invalid severity.`);
    if (!Array.isArray(issue?.locations) || issue.locations.length === 0
      || issue.locations.some((location) => !isNonBlank(location?.path)
        || isAbsolute(location.path)
        || location.path.split(/[\\/]/).some((part) => part === "..")
        || !Number.isSafeInteger(location?.line) || location.line < 1)) {
      problems.push(`${source.kind} issue ${issue?.id ?? "(missing)"} has no valid exact location.`);
    }
  }
  if (source.kind === "known-defects" && source.truth.issues.length === 0) {
    problems.push("known-defects ground truth contains no issue.");
  }
  if (source.kind === "seeded") {
    const layers = new Set(source.truth.issues.map((issue) => String(issue.layer)));
    for (const layer of ["guidance", "verification", "skill", "hook", "toolchain"]) {
      if (!layers.has(layer)) problems.push(`seeded ground truth has no ${layer} issue.`);
    }
  }
  return problems;
}

function validateInput(input: HarnessAuditPanelPacketInput): void {
  const problems: string[] = [];
  if (input.schemaVersion !== 1) problems.push("Panel manifest schemaVersion must be 1.");
  if (!isNonBlank(input.farrierBuildId)) problems.push("Panel manifest requires a Farrier build ID.");
  if (!isNonBlank(input.model)) problems.push("Panel manifest requires one explicit comparison model.");
  if (input.backend !== "claude" && input.backend !== "codex") problems.push("Panel backend must be claude or codex.");
  if (input.reviewers.length !== 5) problems.push("Panel manifest requires exactly five reviewers.");
  const reviewerIds = input.reviewers.map((reviewer) => reviewer.reviewerId);
  if (new Set(reviewerIds).size !== reviewerIds.length || reviewerIds.some((id) => !isComponent(id))) {
    problems.push("Reviewer IDs must be unique safe path components.");
  }
  if (input.reviewers.some((reviewer) => reviewer.role !== "staff" && reviewer.role !== "principal")) {
    problems.push("Every reviewer role must be staff or principal.");
  }
  const kinds = input.sources.map((source) => source.kind);
  if (input.sources.length !== 3 || new Set(kinds).size !== 3
    || !harnessAuditPanelKinds.every((kind) => kinds.includes(kind))) {
    problems.push("Panel manifest requires one known-defects, clean, and seeded source.");
  }
  for (const source of input.sources) problems.push(...validateTruth(source));
  if (input.backend === "claude" && !positiveFinite(input.maxProviderCostUsdPerCall)) {
    problems.push("Claude panel proposals require a positive per-call provider-cost ceiling.");
  }
  if (input.backend === "codex" && input.maxProviderCostUsdPerCall !== undefined) {
    problems.push("Codex panels cannot claim the Claude-only provider-cost ceiling.");
  }
  if (input.backend === "codex" && !(input.accountBudgetEvidence ?? []).some(isNonBlank)) {
    problems.push("Codex panel proposals require recorded account-level budget evidence.");
  }
  if (problems.length) throw new Error(problems.join(" "));
}

function proposal(plans: HarnessAuditReviewPreflightPlan[]): HarnessAuditBudgetProposal {
  return {
    maxProviderCalls: plans.reduce((sum, item) => sum + item.plan.plannedModelCalls, 0),
    maxEstimatedInputTokens: plans.reduce((sum, item) => sum + item.plan.estimatedInputTokens, 0),
    maxProviderCostUsd: plans.reduce((sum, item) =>
      sum + item.plan.plannedModelCalls * (item.maxProviderCostUsdPerCall ?? 0), 0),
  };
}

function sumProposals(items: HarnessAuditBudgetProposal[]): HarnessAuditBudgetProposal {
  return {
    maxProviderCalls: items.reduce((sum, item) => sum + item.maxProviderCalls, 0),
    maxEstimatedInputTokens: items.reduce((sum, item) => sum + item.maxEstimatedInputTokens, 0),
    maxProviderCostUsd: items.reduce((sum, item) => sum + item.maxProviderCostUsd, 0),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function planRecord(
  alias: string,
  plan: HarnessAuditPlan,
  input: HarnessAuditPanelPacketInput,
): HarnessAuditReviewPreflightPlan {
  return {
    alias,
    plan,
    ...(input.backend === "claude" && plan.plannedModelCalls > 0
      ? { maxProviderCostUsdPerCall: input.maxProviderCostUsdPerCall }
      : {}),
  };
}

function reviewerAssignment(packet: HarnessAuditPanelReviewerPacket, input: HarnessAuditPanelPacketInput) {
  return {
    schemaVersion: 1,
    status: "awaiting-external-approval",
    reviewerId: packet.reviewerId,
    role: packet.role,
    farrierBuildId: input.farrierBuildId,
    backend: input.backend,
    model: input.model,
    paidRunsAuthorized: false,
    requiredAttestations: [
      "started-from-help",
      "used-without-coaching",
      "inspected-repository-files",
      "reports-unedited",
      "known-repository-unfamiliar",
      "ground-truth-hidden-until-submission",
      "other-reviews-hidden-until-submission",
      "same-backend-model-account",
    ],
    aliases: packet.aliases.map((item) => ({
      alias: item.alias,
      targetDir: item.targetDir,
      corpusDigest: item.corpusDigest,
      quickArgs: ["advise", "--dir", item.targetDir, "--mode", "quick", "--json"],
      baselinePlanFile: item.planFiles[0],
      deepPlanFile: item.planFiles[1],
    })),
  };
}

async function uniqueAlias(used: Set<string>, deps: HarnessAuditPanelPacketDeps): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const alias = deps.alias();
    if (/^[a-f0-9]{12,32}$/.test(alias) && !used.has(alias)) {
      used.add(alias);
      return alias;
    }
  }
  throw new Error("Could not generate a unique opaque repository alias.");
}

function uniqueKindOrder(
  used: Set<string>,
  deps: HarnessAuditPanelPacketDeps,
): HarnessAuditRepositoryKind[] {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const order = deps.shuffleKinds([...harnessAuditPanelKinds]);
    const key = order.join(",");
    if (order.length === 3 && new Set(order).size === 3
      && harnessAuditPanelKinds.every((kind) => order.includes(kind))
      && !used.has(key)) {
      used.add(key);
      return order;
    }
  }
  throw new Error("Could not assign a distinct blinded repository order to every reviewer.");
}

export async function buildHarnessAuditPanelPacket(
  input: HarnessAuditPanelPacketInput,
  requestedOutputDir: string,
  overrides: Partial<HarnessAuditPanelPacketDeps> = {},
): Promise<HarnessAuditPanelPacket> {
  validateInput(input);
  const deps = { ...defaultDeps, ...overrides };
  const outputDir = resolve(requestedOutputDir);
  if (await lstat(outputDir).then(() => true).catch(() => false)) {
    throw new Error("Panel packet output directory already exists.");
  }
  const inspections = new Map<HarnessAuditRepositoryKind, HarnessAuditPanelSourceInspection>();
  for (const source of input.sources) inspections.set(source.kind, await deps.inspectSource(source.sourceDir));
  const sourceRoots = [...inspections.values()].map((source) => source.sourceDir);
  if (new Set(sourceRoots).size !== sourceRoots.length) throw new Error("Panel sources must be three distinct repositories.");
  if (sourceRoots.some((source) => within(source, outputDir))) {
    throw new Error("Panel packet output cannot be inside a source repository.");
  }
  await mkdir(outputDir, { recursive: false, mode: 0o700 });
  const canonicalOutput = await realpath(outputDir);
  const sourceByKind = new Map(input.sources.map((source) => [source.kind, source]));
  const usedAliases = new Set<string>();
  const usedOrders = new Set<string>();
  try {
    const reviewerPackets: HarnessAuditPanelReviewerPacket[] = [];
    for (const reviewer of input.reviewers) {
      const reviewerDir = join(canonicalOutput, "reviewers", reviewer.reviewerId);
      const repositoryDir = join(reviewerDir, "repositories");
      const plansDir = join(reviewerDir, "plans");
      await mkdir(repositoryDir, { recursive: true, mode: 0o700 });
      await mkdir(plansDir, { recursive: true, mode: 0o700 });
      const aliases: HarnessAuditPanelAliasPacket[] = [];
      for (const kind of uniqueKindOrder(usedOrders, deps)) {
        const alias = await uniqueAlias(usedAliases, deps);
        const targetDir = join(repositoryDir, alias);
        const source = inspections.get(kind)!;
        const sourceInput = sourceByKind.get(kind)!;
        const snapshot = await deps.snapshotSource(source, targetDir);
        if (snapshot.contentDigest !== source.contentDigest) {
          throw new Error("Panel source changed after its committed content was frozen.");
        }
        const [baseline, deep] = await Promise.all([
          deps.plan({ targetDir, mode: "baseline" }),
          deps.plan({ targetDir, mode: "deep" }),
        ]);
        const plans = [planRecord(alias, baseline, input), planRecord(alias, deep, input)];
        const planFiles = [
          join(plansDir, `${alias}-baseline.json`),
          join(plansDir, `${alias}-deep.json`),
        ];
        await Promise.all([writeJson(planFiles[0]!, baseline), writeJson(planFiles[1]!, deep)]);
        aliases.push({
          alias,
          kind,
          targetDir,
          sourceDir: source.sourceDir,
          sourceCommit: source.commit,
          corpusDigest: baseline.corpus.digest,
          truth: sourceInput.truth,
          snapshot,
          plans,
          planFiles,
        });
      }
      const reviewerPlans = aliases.flatMap((item) => item.plans);
      const packet: HarnessAuditPanelReviewerPacket = {
        ...reviewer,
        aliases,
        budgetProposal: proposal(reviewerPlans),
        assignmentFile: join(reviewerDir, "assignment.json"),
        preflightProposalFile: join(reviewerDir, "preflight-proposal.json"),
      };
      await writeJson(packet.assignmentFile, reviewerAssignment(packet, input));
      await writeJson(packet.preflightProposalFile, {
        schemaVersion: 1,
        status: "awaiting-external-approval",
        externalApprovalReference: null,
        budgetProposal: packet.budgetProposal,
        plans: reviewerPlans,
      });
      reviewerPackets.push(packet);
    }
    const packet: HarnessAuditPanelPacket = {
      schemaVersion: 1,
      packetOnly: true,
      status: "awaiting-external-approval",
      farrierBuildId: input.farrierBuildId,
      backend: input.backend,
      model: input.model,
      providerCallsMade: 0,
      externalApprovalReference: null,
      outputDir: canonicalOutput,
      accountBudgetEvidence: (input.accountBudgetEvidence ?? []).filter(isNonBlank),
      reviewers: reviewerPackets,
      budgetProposal: sumProposals(reviewerPackets.map((item) => item.budgetProposal)),
    };
    const problems = await harnessAuditPanelPacketProblems(packet);
    if (problems.length) throw new Error(`Generated panel packet is invalid: ${problems.join(" ")}`);
    const hiddenDir = join(canonicalOutput, "hidden");
    await mkdir(hiddenDir, { recursive: true, mode: 0o700 });
    await writeJson(join(hiddenDir, "panel-packet.json"), packet);
    await writeFile(join(hiddenDir, "DO-NOT-SHARE.txt"),
      "This directory contains source identities and ground truth. Do not share it with reviewers.\n",
      { encoding: "utf8", mode: 0o600 });
    return packet;
  } catch (error) {
    await rm(canonicalOutput, { recursive: true, force: true });
    throw error;
  }
}
