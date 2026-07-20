import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type {
  HarnessAuditBudgetProposal,
  HarnessAuditPanelAliasPacket,
  HarnessAuditPanelPacket,
} from "./harness-audit-panel-packet";
import { harnessAuditPanelKinds } from "./harness-audit-panel-packet";
import { digestHarnessAuditPanelSnapshot } from "./harness-audit-panel-source";

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function proposal(aliases: HarnessAuditPanelAliasPacket[]): HarnessAuditBudgetProposal {
  const plans = aliases.flatMap((alias) => alias.plans);
  return {
    maxProviderCalls: plans.reduce((sum, item) => sum + item.plan.plannedModelCalls, 0),
    maxEstimatedInputTokens: plans.reduce((sum, item) => sum + item.plan.estimatedInputTokens, 0),
    maxProviderCostUsd: plans.reduce((sum, item) =>
      sum + item.plan.plannedModelCalls * (item.maxProviderCostUsdPerCall ?? 0), 0),
  };
}

function sumsEqual(left: HarnessAuditBudgetProposal, right: HarnessAuditBudgetProposal): boolean {
  return left.maxProviderCalls === right.maxProviderCalls
    && left.maxEstimatedInputTokens === right.maxEstimatedInputTokens
    && left.maxProviderCostUsd === right.maxProviderCostUsd;
}

async function savedPlanProblem(
  packet: HarnessAuditPanelPacket,
  alias: HarnessAuditPanelAliasPacket,
  index: number,
): Promise<string | undefined> {
  const path = alias.planFiles[index];
  if (!path || !within(packet.outputDir, path)) return `Alias ${alias.alias} has an unsafe saved plan path.`;
  const stats = await lstat(path).catch(() => undefined);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.size > 2_000_000) {
    return `Alias ${alias.alias} has a missing, linked, or oversized saved plan.`;
  }
  const canonical = await realpath(path);
  if (canonical !== path) return `Alias ${alias.alias} saved plan path is not canonical.`;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (JSON.stringify(parsed) !== JSON.stringify(alias.plans[index]!.plan)) {
      return `Alias ${alias.alias} saved plan differs from the hidden packet.`;
    }
  } catch {
    return `Alias ${alias.alias} saved plan is not valid JSON.`;
  }
  return undefined;
}

async function physicalAliasProblems(
  packet: HarnessAuditPanelPacket,
  alias: HarnessAuditPanelAliasPacket,
  physicalOwners: Map<string, string>,
): Promise<string[]> {
  const problems: string[] = [];
  if (!within(packet.outputDir, alias.targetDir)) {
    return [`Alias ${alias.alias} target is outside the packet.`];
  }
  const stats = await lstat(alias.targetDir).catch(() => undefined);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    return [`Alias ${alias.alias} target is not a physical directory.`];
  }
  const canonical = await realpath(alias.targetDir);
  if (canonical !== alias.targetDir) problems.push(`Alias ${alias.alias} target is not canonical.`);
  const physicalId = `${stats.dev}:${stats.ino}`;
  const previous = physicalOwners.get(physicalId);
  if (previous) problems.push(`Aliases ${previous} and ${alias.alias} reuse one physical directory.`);
  else physicalOwners.set(physicalId, alias.alias);
  if (await lstat(join(alias.targetDir, ".git")).then(() => true).catch(() => false)) {
    problems.push(`Alias ${alias.alias} exposes Git repository metadata.`);
  }
  try {
    const digest = await digestHarnessAuditPanelSnapshot(alias.targetDir);
    if (digest !== alias.snapshot.contentDigest) {
      problems.push(`Alias ${alias.alias} snapshot differs from its prepared content digest.`);
    }
  } catch {
    problems.push(`Alias ${alias.alias} snapshot content cannot be verified.`);
  }
  return problems;
}

function aliasPlanProblems(packet: HarnessAuditPanelPacket, alias: HarnessAuditPanelAliasPacket): string[] {
  const problems: string[] = [];
  const modes = alias.plans.map((item) => item.plan.mode);
  if (alias.plans.length !== 2 || new Set(modes).size !== 2
    || !modes.includes("baseline") || !modes.includes("deep")) {
    problems.push(`Alias ${alias.alias} must have one baseline and one deep plan.`);
  }
  for (const item of alias.plans) {
    if (item.alias !== alias.alias) problems.push(`Alias ${alias.alias} plan uses another alias.`);
    if (item.plan.targetDir !== alias.targetDir) problems.push(`Alias ${alias.alias} plan targets another directory.`);
    if (item.plan.corpus.digest !== alias.corpusDigest) problems.push(`Alias ${alias.alias} plan uses another corpus digest.`);
    if (item.plan.mode === "baseline" && item.plan.plannedModelCalls !== 1) {
      problems.push(`Alias ${alias.alias} baseline is not exactly one call.`);
    }
    if (packet.backend === "claude" && item.plan.plannedModelCalls > 0
      && !(typeof item.maxProviderCostUsdPerCall === "number"
        && Number.isFinite(item.maxProviderCostUsdPerCall)
        && item.maxProviderCostUsdPerCall > 0)) {
      problems.push(`Alias ${alias.alias} paid Claude plan lacks a positive cost ceiling.`);
    }
    if (packet.backend !== "claude" && item.maxProviderCostUsdPerCall !== undefined) {
      problems.push(`Alias ${alias.alias} assigns a Claude cost ceiling to another backend.`);
    }
  }
  return problems;
}

async function reviewerVisibleProblems(
  packet: HarnessAuditPanelPacket,
  reviewer: HarnessAuditPanelPacket["reviewers"][number],
): Promise<string[]> {
  const problems: string[] = [];
  for (const path of [reviewer.assignmentFile, reviewer.preflightProposalFile]) {
    if (!within(packet.outputDir, path)) {
      problems.push(`Reviewer ${reviewer.reviewerId} has an unsafe visible packet path.`);
      continue;
    }
    const stats = await lstat(path).catch(() => undefined);
    if (!stats?.isFile() || stats.isSymbolicLink() || stats.size > 2_000_000) {
      problems.push(`Reviewer ${reviewer.reviewerId} visible packet file is missing, linked, or oversized.`);
      continue;
    }
    const text = await readFile(path, "utf8");
    const leakedSource = reviewer.aliases.some((alias) => text.includes(alias.sourceDir)
      || text.includes(alias.sourceCommit)
      || alias.truth.issues.some((issue) => text.includes(issue.id)));
    if (leakedSource || text.includes('"kind"') || text.includes('"truth"')) {
      problems.push(`Reviewer ${reviewer.reviewerId} visible packet leaks hidden source or ground truth.`);
    }
  }
  return problems;
}

export async function harnessAuditPanelPacketProblems(
  packet: HarnessAuditPanelPacket,
): Promise<string[]> {
  const problems: string[] = [];
  if (packet.schemaVersion !== 1 || packet.packetOnly !== true
    || packet.status !== "awaiting-external-approval") {
    problems.push("Panel packet is not a schema-version-1 unapproved packet.");
  }
  if (packet.providerCallsMade !== 0 || packet.externalApprovalReference !== null) {
    problems.push("Prepared panel packet must record zero provider calls and no external approval.");
  }
  if (packet.reviewers.length !== 5) problems.push("Panel packet must contain five reviewers.");
  const reviewerIds = packet.reviewers.map((reviewer) => reviewer.reviewerId);
  if (new Set(reviewerIds).size !== reviewerIds.length) problems.push("Panel packet reviewer IDs are not unique.");
  const aliases = packet.reviewers.flatMap((reviewer) => reviewer.aliases);
  if (aliases.length !== 15 || new Set(aliases.map((alias) => alias.alias)).size !== aliases.length) {
    problems.push("Panel packet must contain 15 unique opaque aliases.");
  }
  const physicalOwners = new Map<string, string>();
  const repositoryOrders = new Set<string>();
  for (const reviewer of packet.reviewers) {
    const kinds = reviewer.aliases.map((alias) => alias.kind);
    if (reviewer.aliases.length !== 3 || new Set(kinds).size !== 3
      || !harnessAuditPanelKinds.every((kind) => kinds.includes(kind))) {
      problems.push(`Reviewer ${reviewer.reviewerId} does not have all three repository kinds.`);
    }
    const order = kinds.join(",");
    if (repositoryOrders.has(order)) problems.push(`Reviewer ${reviewer.reviewerId} reuses another repository order.`);
    else repositoryOrders.add(order);
    if (!reviewer.aliases.some((alias) => alias.plans.some((item) =>
      item.plan.mode === "deep" && item.plan.plannedModelCalls >= 2))) {
      problems.push(`Reviewer ${reviewer.reviewerId} has no multi-worker deep plan.`);
    }
    if (!sumsEqual(reviewer.budgetProposal, proposal(reviewer.aliases))) {
      problems.push(`Reviewer ${reviewer.reviewerId} budget proposal does not equal its plans.`);
    }
    problems.push(...await reviewerVisibleProblems(packet, reviewer));
    for (const alias of reviewer.aliases) {
      problems.push(...await physicalAliasProblems(packet, alias, physicalOwners));
      problems.push(...aliasPlanProblems(packet, alias));
      if (alias.planFiles.length !== 2) problems.push(`Alias ${alias.alias} does not have two saved plan files.`);
      for (let index = 0; index < alias.planFiles.length; index += 1) {
        const problem = await savedPlanProblem(packet, alias, index);
        if (problem) problems.push(problem);
      }
    }
  }
  const panelProposal = packet.reviewers.reduce<HarnessAuditBudgetProposal>((sum, reviewer) => ({
    maxProviderCalls: sum.maxProviderCalls + reviewer.budgetProposal.maxProviderCalls,
    maxEstimatedInputTokens: sum.maxEstimatedInputTokens + reviewer.budgetProposal.maxEstimatedInputTokens,
    maxProviderCostUsd: sum.maxProviderCostUsd + reviewer.budgetProposal.maxProviderCostUsd,
  }), { maxProviderCalls: 0, maxEstimatedInputTokens: 0, maxProviderCostUsd: 0 });
  if (!sumsEqual(packet.budgetProposal, panelProposal)) {
    problems.push("Panel budget proposal does not equal all five reviewer proposals.");
  }
  for (const kind of harnessAuditPanelKinds) {
    const selected = aliases.filter((alias) => alias.kind === kind);
    if (new Set(selected.map((alias) => alias.sourceCommit)).size !== 1
      || new Set(selected.map((alias) => alias.corpusDigest)).size !== 1
      || new Set(selected.map((alias) => alias.snapshot.contentDigest)).size !== 1) {
      problems.push(`${kind} aliases do not share one frozen source commit, snapshot, and corpus digest.`);
    }
  }
  return problems;
}
