import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { builtinCatalog, type PackCatalog } from "../registry/catalog";
import type { AdviceCreationFile, AdviceCreationPlan } from "./advice-apply";
import { formatAgents } from "./agent-selection";
import {
  applyHarnessChangePlan,
  filePurpose,
  inspectHarnessChangePlan,
  type ApplyHarnessChangePlanDeps,
  type ApplyHarnessChangePlanResult,
  type HarnessChangePlan
} from "./create-plan";
import { guardShapeProblems } from "./doctor";
import { routeFailureSignals, type PrimitiveProposal } from "./failure-router";
import { defaultTranscriptDir } from "./learn";
import type { FailureSignal } from "./learn-signals";
import { mineFailureSignalsFromSources } from "./learn-signals-codex";
import { manifestToInput, notFarrierProjectMessage, readManifest, type NormalizedManifest } from "./manifest";
import { createRenderPlan, hookCatalogVersions, hooksDirectory } from "./render";
import { extractRepoMapSection, repoMapBeginMarker, spliceRepoMapSection, stripRepoMapSection } from "./repo-map";
import { packForManifest } from "./update";

/**
 * Applies one confirmed failure→primitive proposal. Planning is read-only and
 * returns the exact files a review surface must show; writing goes through
 * applyHarnessChangePlan (staged writes, backups, rollback), so a mid-apply
 * failure leaves nothing half-written. Nothing here runs without an explicit
 * confirmed plan.
 */

export type PlannedProposal =
  | { kind: "files"; plan: AdviceCreationPlan; inspection: HarnessChangePlan }
  /** Skill suggestions install nothing; the query feeds the existing skill flow. */
  | { kind: "skill"; query: string; message: string };

export type ProposalMiningResult = {
  transcriptsDir: string;
  signals: FailureSignal[];
  proposals: PrimitiveProposal[];
  /**
   * False when the repo has no .farrier.json. Guard/hook proposals cannot be
   * applied without it; rules lines and skill suggestions still can.
   */
  harnessPresent: boolean;
  /**
   * Agent files found when no manifest exists (e.g. "AGENTS.md", "71 installed
   * skill(s)"). A repo can be thoroughly harnessed by hand — or by farrier's
   * own skills/distill installs — without farrier managing it; the TUI must
   * not tell such a user they have "no harness".
   */
  existingAgentFiles: string[];
  notes: string[];
};

type GuardInstanceProposal = Extract<PrimitiveProposal, { kind: "guard-instance" }>;
type RulesLineProposal = Extract<PrimitiveProposal, { kind: "rules-line" }>;

const agentsFilePath = "AGENTS.md";
const hardRulesHeading = "## Hard Rules";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deterministic, local-only mining: counting over transcripts, routed against
 * the installed manifest. No LLM call and no prose leaves the machine.
 */
export async function minePrimitiveProposals(input: {
  targetDir: string;
  transcriptsDir?: string;
  /** Override for the codex rollout directory; defaults to ~/.codex/sessions. */
  codexSessionsDir?: string;
  catalog?: PackCatalog;
}): Promise<ProposalMiningResult> {
  const targetDir = resolve(input.targetDir);
  // Mining needs no harness (the bare repo is the growth model's entry case);
  // only applying a GUARD proposal does, and planProposal refuses that one.
  let installedHookIds: NormalizedManifest["hookIds"] = [];
  let guards: unknown;
  // The missing-harness case is a structured flag, not a note string: the TUI
  // gates the apply action on it up front instead of letting the user walk
  // into planProposal's refusal.
  let harnessPresent = true;
  let existingAgentFiles: string[] = [];
  try {
    const manifest = await readManifest({ targetDir, catalog: input.catalog ?? builtinCatalog() });
    installedHookIds = manifest.hookIds;
    guards = manifest.guards;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== notFarrierProjectMessage) {
      throw error;
    }
    harnessPresent = false;
    existingAgentFiles = await summarizeExistingAgentFiles(targetDir);
  }
  const transcriptsDir = input.transcriptsDir ? resolve(input.transcriptsDir) : defaultTranscriptDir(targetDir);
  const scan = await mineFailureSignalsFromSources({
    claudeTranscriptsDir: transcriptsDir,
    codexProjectDir: targetDir,
    codexSessionsDir: input.codexSessionsDir
  });
  const proposals = routeFailureSignals({
    signals: scan.signals,
    installedHookIds,
    guards
  });
  return { transcriptsDir, signals: scan.signals, proposals, harnessPresent, existingAgentFiles, notes: scan.notes };
}

/**
 * What a manifest-less repo already has in the way of agent files. Skill
 * directories are deduplicated by name across the shared and Claude roots so
 * a skill installed in both counts once.
 */
async function summarizeExistingAgentFiles(targetDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const stats = await stat(join(targetDir, name)).catch(() => undefined);
    if (stats?.isFile()) found.push(name);
  }
  const skillNames = new Set<string>();
  for (const root of [".agents/skills", ".claude/skills"]) {
    const entries = await readdir(join(targetDir, root), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) skillNames.add(entry.name);
    }
  }
  if (skillNames.size > 0) found.push(`${skillNames.size} installed skill(s)`);
  return found;
}

/**
 * Merge a proposal's guards patch into the user-owned guards record: records
 * recurse, string arrays union (user entries always kept), and a scalar
 * conflict takes the reviewed proposal value. Keys only the user has are
 * never touched, so nothing the user configured is deleted.
 */
export function mergeGuardsRecord(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};
  for (const [key, patchValue] of Object.entries(patch)) {
    const current = merged[key];
    if (isRecord(current) && isRecord(patchValue)) {
      merged[key] = mergeGuardsRecord(current, patchValue);
    } else if (Array.isArray(current) && Array.isArray(patchValue)) {
      merged[key] = [
        ...current,
        ...patchValue.filter((item) => !current.some((existingItem) => JSON.stringify(existingItem) === JSON.stringify(item)))
      ];
    } else {
      merged[key] = patchValue;
    }
  }
  return merged;
}

/**
 * Append one declarative line to the AGENTS.md "## Hard Rules" bullet list.
 * AGENTS.md Hard Rules is the default destination (over quality.rules in the
 * manifest) because both agents read it at the start of every session —
 * CLAUDE.md imports it and Codex reads it directly — while quality.rules only
 * feeds the judge hooks, which ship disabled by default. Idempotent: an
 * already-present line returns the content unchanged. The generated repo-map
 * region stays the final marked block update expects to splice.
 */
export function appendHardRulesLine(content: string, line: string): string {
  const bullet = `- ${line}`;
  const lines = content.split("\n");
  if (lines.some((existing) => existing.trim() === bullet)) {
    return content;
  }

  const headingIndex = lines.findIndex((existing) => existing.trim() === hardRulesHeading);
  if (headingIndex === -1) {
    const section = `${hardRulesHeading}\n\n${bullet}\n`;
    const region = extractRepoMapSection(content);
    const base = (region === null ? content : stripRepoMapSection(content)).trimEnd();
    const withSection = base.length > 0 ? `${base}\n\n${section}` : section;
    return region === null ? withSection : spliceRepoMapSection(withSection, region);
  }

  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    if (trimmed.startsWith("## ") || trimmed.startsWith(repoMapBeginMarker)) {
      sectionEnd = index;
      break;
    }
  }

  let insertAt = headingIndex + 1;
  for (let index = headingIndex + 1; index < sectionEnd; index += 1) {
    if (lines[index]!.trim().length > 0) {
      insertAt = index + 1;
    }
  }
  lines.splice(insertAt, 0, bullet);
  return lines.join("\n");
}

function formatMaxBytes(value: unknown): string {
  const mebibyte = 1024 * 1024;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value % mebibyte === 0 ? `${value / mebibyte} MiB` : `${value} bytes`;
  }
  return "the configured limit";
}

function guardOutcome(proposal: GuardInstanceProposal, mergedGuards: Record<string, unknown>): string {
  if (proposal.hookId === "large-file-commit-guard") {
    const config = mergedGuards.largeFileCommit;
    const maxBytes = isRecord(config) ? config.maxBytes : undefined;
    return `Agents will be denied committing files over ${formatMaxBytes(maxBytes)}.`;
  }
  if (proposal.hookId === "process-teardown-audit") {
    return "Agents will be told once at stop time which leftover test/automation processes to shut down.";
  }
  return proposal.title;
}

/**
 * Restore the recorded versions of hooks this apply does not touch. Builtin
 * hook files are refreshed alongside the manifest, so their rendered current
 * versions are accurate; remote hook trees are left alone, so their recorded
 * versions must survive.
 */
function patchManifestVersions(renderedManifest: string, manifest: NormalizedManifest): string {
  const parsed = JSON.parse(renderedManifest) as Record<string, unknown>;
  const versions = isRecord(parsed.versions) ? { ...parsed.versions } : {};
  const hooks: Record<string, unknown> = isRecord(versions.hooks) ? { ...versions.hooks } : {};
  for (const [hookId, version] of Object.entries(manifest.versions.hooks)) {
    if (!(hookId in hookCatalogVersions)) {
      hooks[hookId] = version;
    }
  }
  versions.hooks = hooks;
  parsed.versions = versions;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

async function guardInstancePlan(
  targetDir: string,
  manifest: NormalizedManifest,
  proposal: GuardInstanceProposal,
  catalog: PackCatalog
): Promise<{ files: AdviceCreationFile[]; summary: string }> {
  const mergedHookIds = manifest.hookIds.includes(proposal.hookId)
    ? [...manifest.hookIds]
    : [...manifest.hookIds, proposal.hookId];
  const mergedGuards = mergeGuardsRecord(manifest.guards, proposal.guardsPatch);
  const problems = guardShapeProblems(mergedGuards);
  if (problems.length > 0) {
    throw new Error(`Refusing to apply: the merged guards record would fail doctor: ${problems.map((problem) => problem.message).join("; ")}`);
  }

  const modified: NormalizedManifest = { ...manifest, hookIds: mergedHookIds, guards: mergedGuards };
  const renderPlan = await createRenderPlan({
    targetDir,
    pack: packForManifest(modified, catalog),
    skills: modified.skills,
    learnEnabled: modified.learn.enabled,
    advisors: modified.advisors,
    secondaryAcknowledged: modified.secondaryAcknowledged,
    existingManifest: manifestToInput(modified),
    agents: modified.agents,
    registryPins: modified.registry.items,
    // AGENTS.md is not part of this apply; skip the git-backed map generation.
    repoMapSection: null
  });

  // The manifest, the builtin hooks tree, and both agent bindings must stay
  // coherent (bindings reference every hook file by path), so all three are
  // planned together; files already current show as unchanged and are not
  // rewritten. User-owned tool-policy-rules.json and remote hook trees are
  // excluded — this apply never touches them.
  const hooksPrefix = `${hooksDirectory}/`;
  const bindingPaths = new Set([".claude/settings.json", ".codex/hooks.json"]);
  const files = renderPlan.files
    .filter((file) =>
      file.path === ".farrier.json" ||
      bindingPaths.has(file.path) ||
      (file.path.startsWith(hooksPrefix) &&
        !file.path.startsWith(`${hooksPrefix}@`) &&
        file.path !== `${hooksPrefix}tool-policy-rules.json`)
    )
    .map((file): AdviceCreationFile => ({
      ...file,
      content: file.path === ".farrier.json" ? patchManifestVersions(file.content, manifest) : file.content,
      purpose: file.path === ".farrier.json"
        ? "Records the hook and its guard settings in .farrier.json."
        : filePurpose(file.path)
    }));

  const summary = `${guardOutcome(proposal, mergedGuards)} Installs the hook for ${formatAgents(modified.agents)} and records its settings in .farrier.json.`;
  return { files, summary };
}

async function rulesLinePlan(
  targetDir: string,
  proposal: RulesLineProposal
): Promise<{ files: AdviceCreationFile[]; summary: string }> {
  let current = "";
  try {
    current = await readFile(join(targetDir, agentsFilePath), "utf8");
  } catch {
    current = "";
  }
  const content = appendHardRulesLine(current, proposal.line);
  return {
    files: [{
      path: agentsFilePath,
      content,
      purpose: "Adds one Hard Rules line to AGENTS.md; agents read it at the start of every session."
    }],
    summary: "Agents will follow one new AGENTS.md Hard Rules line from the start of every session."
  };
}

/**
 * Plan one confirmed proposal into reviewable files. Read-only: the caller
 * shows the inspection and applies only after explicit confirmation. Only a
 * guard instance requires .farrier.json (it rewrites the manifest and hook
 * bindings); a rules line writes AGENTS.md and applies to a repo harnessed
 * by hand — sessions exist regardless of farrier's bookkeeping. Refuses when
 * a guard merge would fail doctor validation.
 */
export async function planPrimitiveProposal(input: {
  targetDir: string;
  proposal: PrimitiveProposal;
  catalog?: PackCatalog;
}): Promise<PlannedProposal> {
  const targetDir = resolve(input.targetDir);
  const catalog = input.catalog ?? builtinCatalog();

  if (input.proposal.kind === "skill-suggestion") {
    return { kind: "skill", query: input.proposal.query, message: input.proposal.message };
  }

  const planned = input.proposal.kind === "guard-instance"
    ? await guardInstancePlan(targetDir, await readManifest({ targetDir, catalog }), input.proposal, catalog)
    : await rulesLinePlan(targetDir, input.proposal);
  const plan: AdviceCreationPlan = {
    recommendationId: input.proposal.id,
    summary: planned.summary,
    files: planned.files
  };
  const inspection = await inspectHarnessChangePlan({ targetDir, files: planned.files });
  return { kind: "files", plan, inspection };
}

/**
 * Write a reviewed proposal plan through the shared harness transaction:
 * staged writes, backups for replacements, and rollback on any failure.
 * File modes (executable hook scripts) come from the render plan.
 */
export function applyProposalPlan(
  targetDir: string,
  plan: AdviceCreationPlan,
  force: boolean,
  deps: ApplyHarnessChangePlanDeps = {}
): Promise<ApplyHarnessChangePlanResult> {
  return applyHarnessChangePlan(
    { targetDir: resolve(targetDir), files: plan.files },
    { force, allowExistingHarness: true },
    deps
  );
}
