import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ReasoningEffort } from "../config/farrier-config";
import type { HookId } from "../packs/types";
import { parseBackendJson, type AgentBackend, type BackendCommandRunner } from "./backend";
import { kebabCasePattern, validIndexes } from "./export-harness";
import { runIsolatedBackendText } from "./isolated-backend";
import { notFarrierProjectMessage, readManifest } from "./manifest";
import { preferenceTiers, type PreferenceTier } from "./preference-kb";
import { stripRepoMapSection } from "./repo-map";
import { sessionProjectRoot } from "./advice-session-index";
import { readReviewDecisions, type ReviewDecision } from "./review-ledger";
import { installedSkillDirs, prepareSessionEvidence, type SessionEvidence, type SessionSelection } from "./session-evidence";
import { maxDescriptionLength, parseFrontmatter, skillNamePattern } from "./skill-validate";

/**
 * The Improve LLM pass: a DIFF over the distance between what the current
 * harness declares (AGENTS.md, installed skills and their descriptions,
 * subagents, hooks) and what the selected sessions show (steers, failure
 * clusters, per-skill invocation counts) — never a blank-slate classification.
 * Declared but still corrected → escalate the tier; installed but never
 * invoked → re-scope or prune; a repeated steer nothing covers → new rule or
 * skill; a rule with no evidence → deletion candidate; a rule complied with
 * unenforced → soften to judgment phrasing; contradictions → one resolving
 * replace; restating the discoverable → delete (the softening arrows follow
 * Anthropic's Claude-5 context-engineering guidance and are gated on
 * compliance evidence from the selected sessions).
 *
 * Every proposal is typed and cited; validation rejects uncited proposals —
 * except AGENTS.md replace/delete edits, grounded by their verbatim unique
 * anchor — and anything outside the mechanical bounds (validate-or-drop,
 * mirroring the export classifier). The deterministic layer routes and
 * redacts, never vetoes judgment; applying is review-gated in the TUI.
 */

export const maxImproveProposals = 20;
const maxPromptSteers = 120;
const maxPromptClusters = 40;
const maxPromptActivity = 30;
const maxPromptReviewed = 30;
const maxTitleChars = 90;
const maxRationaleChars = 500;
const maxAnchorChars = 400;
const maxEditTextChars = 600;
const maxRuleChars = 300;
const maxInstructionChars = 4_000;
const minInstructionChars = 50;
const maxSubagentSkills = 10;
const maxAgentsMdPromptChars = 20_000;
const maxClaudeMdPromptChars = 4_000;

/** Engine-owned hook templates the model may instantiate; the patch key must match. */
export const improveGuardHooks: Partial<Record<HookId, string>> = {
  "large-file-commit-guard": "largeFileCommit",
  "process-teardown-audit": "processTeardown"
};

export type HarnessSubagentInfo = { name: string; description: string };

export type HarnessSnapshot = {
  /** AGENTS.md with the generated repo-map region stripped, bounded. */
  agentsMd?: string;
  claudeMd?: string;
  /** SKILL.md frontmatter description per installed skill (when readable). */
  skillDescriptions: Record<string, string>;
  subagents: HarnessSubagentInfo[];
  hookIds: string[];
  /** Prior accept/reject decisions from the review ledger, in file order. */
  reviewedDecisions?: ReviewDecision[];
};

export type ImproveCitations = {
  steerIndexes: number[];
  clusterIndexes: number[];
  /** Names from the skill usage table (re-scoping, pruning, ownership). */
  skillNames: string[];
};

type ImproveProposalBase = {
  id: string;
  title: string;
  rationale: string;
  citations: ImproveCitations;
  /** Deterministic prevalence line computed from the cited evidence. */
  evidence: string;
};

export type AgentsMdEdit =
  | { op: "replace"; anchor: string; text: string }
  | { op: "delete"; anchor: string }
  | { op: "add-rule"; text: string };

export type ImproveProposal =
  | (ImproveProposalBase & { kind: "new-skill"; name: string; description: string })
  | (ImproveProposalBase & { kind: "kb-rule"; ruleId: string; rule: string; tier: PreferenceTier; owner?: string })
  | (ImproveProposalBase & { kind: "agents-md-edit"; edit: AgentsMdEdit })
  | (ImproveProposalBase & { kind: "guard-instance"; hookId: HookId; guardsPatch: Record<string, unknown> })
  | (ImproveProposalBase & { kind: "subagent"; name: string; description: string; instructions: string; skills: string[] })
  | (ImproveProposalBase & { kind: "skill-rescope"; skill: string; description: string })
  | (ImproveProposalBase & { kind: "prune-skill"; skill: string });

export type DroppedImproveProposal = { id?: string; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Shared with improve-apply: both sides read the same harness files. */
export async function readIfFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function tomlField(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m"));
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]!}"`) as string;
  } catch {
    return match[1];
  }
}

async function snapshotSubagents(projectDir: string): Promise<HarnessSubagentInfo[]> {
  const byName = new Map<string, HarnessSubagentInfo>();
  const claudeDir = join(projectDir, ".claude", "agents");
  for (const entry of (await readdir(claudeDir).catch(() => [])).filter((name) => name.endsWith(".md")).sort()) {
    const content = await readIfFile(join(claudeDir, entry));
    if (content === undefined) continue;
    const frontmatter = parseFrontmatter(content);
    const name = frontmatter?.name ?? entry.replace(/\.md$/, "");
    byName.set(name, { name, description: frontmatter?.description ?? "" });
  }
  const codexDir = join(projectDir, ".codex", "agents");
  for (const entry of (await readdir(codexDir).catch(() => [])).filter((name) => name.endsWith(".toml")).sort()) {
    const content = await readIfFile(join(codexDir, entry));
    if (content === undefined) continue;
    const name = tomlField(content, "name") ?? entry.replace(/\.toml$/, "");
    if (byName.has(name)) continue;
    byName.set(name, { name, description: tomlField(content, "description") ?? "" });
  }
  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * What the current harness declares, read locally. Sent to the backend only
 * with the same explicit consent that covers the session evidence — the
 * snapshot includes project file contents (AGENTS.md, skill descriptions).
 */
export async function snapshotHarness(projectDir: string): Promise<HarnessSnapshot> {
  const targetDir = resolve(projectDir);

  // Full stripped text, not the prompt-bounded slice: anchor validation must
  // count occurrences over the same text the apply step will (the prompt
  // bounds are applied at render time in buildImprovePrompt).
  const agentsMdRaw = await readIfFile(join(targetDir, "AGENTS.md"));
  const claudeMd = await readIfFile(join(targetDir, "CLAUDE.md"));
  const agentsMd = agentsMdRaw === undefined ? undefined : stripRepoMapSection(agentsMdRaw);

  const skillDescriptions: Record<string, string> = {};
  for (const [name, info] of await installedSkillDirs(targetDir)) {
    if (!info.skillMdPath) continue;
    const content = await readIfFile(info.skillMdPath);
    const description = content === undefined ? undefined : parseFrontmatter(content)?.description;
    if (description) skillDescriptions[name] = description;
  }

  // A repo without farrier's manifest is still improvable; it just has no
  // engine-installed hooks to diff against.
  let hookIds: string[] = [];
  try {
    const manifest = await readManifest({ targetDir });
    hookIds = [...manifest.hookIds];
  } catch (error) {
    if (!(error instanceof Error) || error.message !== notFarrierProjectMessage) throw error;
  }

  // Prior review decisions feed the model's "don't re-propose a rejection"
  // rule. readReviewDecisions stays strict (a corrupt line fails loud), but
  // this is an advisory hint, not a gate: a broken ledger must never abort the
  // whole Improve pass (snapshotHarness runs inside mineImproveEvidence's
  // Promise.all), so a read error degrades to no prior-decision context.
  let reviewedDecisions: ReviewDecision[] = [];
  try {
    reviewedDecisions = await readReviewDecisions(targetDir);
  } catch {
    reviewedDecisions = [];
  }

  return {
    ...(agentsMd !== undefined ? { agentsMd } : {}),
    ...(claudeMd !== undefined ? { claudeMd } : {}),
    skillDescriptions,
    subagents: await snapshotSubagents(targetDir),
    hookIds,
    ...(reviewedDecisions.length > 0 ? { reviewedDecisions } : {})
  };
}

/**
 * The local, consent-free half of Improve: mines the (optionally selected)
 * sessions and snapshots the harness in one call, owning the mining bound —
 * Improve reads one project's history, so learn's counting cap is lifted.
 */
export async function mineImproveEvidence(input: {
  targetDir: string;
  selection?: SessionSelection;
  codexSessionsDir?: string;
  claudeTranscriptsDir?: string;
}): Promise<{ evidence: SessionEvidence; snapshot: HarnessSnapshot }> {
  // The same realpath'd root the session lister used: the Claude transcript
  // directory encodes the full project path, so a symlinked component would
  // otherwise make the miner look in a different directory than the picker.
  const projectDir = (await sessionProjectRoot(input.targetDir)).root;
  const [evidence, snapshot] = await Promise.all([
    prepareSessionEvidence({
      projectDir,
      maxFiles: 1_000,
      ...(input.selection ? { selection: input.selection } : {}),
      ...(input.codexSessionsDir ? { codexSessionsDir: input.codexSessionsDir } : {}),
      ...(input.claudeTranscriptsDir ? { claudeTranscriptsDir: input.claudeTranscriptsDir } : {})
    }),
    snapshotHarness(projectDir)
  ]);
  return { evidence, snapshot };
}

/** Distinct sessions and counts behind the cited evidence — computed, never model-authored. */
export function improveEvidenceSummary(proposal: ImproveProposalDraft, evidence: SessionEvidence): string {
  const citations = proposal.citations;
  const sessions = new Set<string>();
  let failureCount = 0;
  for (const index of citations.steerIndexes) {
    const steer = evidence.steers[index];
    if (steer) sessions.add(steer.sessionRef);
  }
  for (const index of citations.clusterIndexes) {
    const cluster = evidence.failureClusters[index];
    if (!cluster) continue;
    failureCount += cluster.count;
    for (const ref of cluster.sessionRefs) sessions.add(ref);
  }
  const parts: string[] = [];
  if (citations.steerIndexes.length > 0) parts.push(`${citations.steerIndexes.length} steer(s)`);
  if (citations.clusterIndexes.length > 0) {
    parts.push(`${citations.clusterIndexes.length} failure cluster(s), ${failureCount} occurrence(s)`);
  }
  if (parts.length > 0 && sessions.size > 0) {
    parts.push(`across ${sessions.size} session(s)`);
  }
  for (const name of citations.skillNames) {
    const usage = evidence.skillUsage.find((skill) => skill.name === name);
    if (usage) parts.push(`skill ${name}: ${usage.invocations} invocation(s) in ${usage.sessions} session(s)`);
  }
  if (parts.length > 0) return `Cites ${parts.join("; ")}`;
  // Only anchor-grounded AGENTS.md edits survive validation uncited; for
  // those the absence is the finding. The kind check keeps this line
  // truthful if the citation exemption ever widens.
  return proposal.kind === "agents-md-edit"
    ? "No session evidence cites this rule — that absence is the finding; anchored verbatim to the current AGENTS.md"
    : "No evidence cited";
}

export type ImproveValidationContext = {
  steerCount: number;
  clusterCount: number;
  /** Every name in the usage table (installed ∪ invoked). */
  skillNames: Set<string>;
  installedSkillNames: Set<string>;
  agentsMd: string;
  existingSubagentNames: Set<string>;
  seenIds: Set<string>;
};

/** Omit that distributes over the proposal union instead of collapsing it. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ImproveProposalDraft = DistributiveOmit<ImproveProposal, "evidence">;

export type ImproveValidationResult =
  | { ok: true; proposal: ImproveProposalDraft }
  | { ok: false; reason: string; id?: string };

/** Shared with improve-apply: the apply-time anchor recheck must count the same way. */
export function occurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function textProblem(value: unknown, field: string, max: number, options: { min?: number; singleLine?: boolean } = {}): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return `${field} must be a non-empty string`;
  if (value.length > max) return `${field} exceeds ${max} characters`;
  if ((options.min ?? 0) > value.trim().length) return `${field} must be at least ${options.min} characters`;
  if (options.singleLine && /[\r\n]/.test(value)) return `${field} must not contain newlines`;
  if (value.includes("```")) return `${field} contains a markdown code fence`;
  return undefined;
}

/** The one edit op with no anchor; every other op validatedEdit accepts is grounded by one (improve-apply's AnchoredEdit). */
function isAddRuleEdit(value: unknown): boolean {
  return isRecord(value) && value.op === "add-rule";
}

function validatedEdit(value: unknown, agentsMd: string): { edit: AgentsMdEdit } | { reason: string } {
  if (!isRecord(value)) return { reason: "edit must be an object" };
  const op = value.op;
  if (op === "add-rule") {
    const problem = textProblem(value.text, "edit.text", maxRuleChars, { singleLine: true });
    if (problem) return { reason: problem };
    return { edit: { op, text: (value.text as string).trim() } };
  }
  if (op !== "replace" && op !== "delete") {
    return { reason: 'edit.op must be "replace", "delete", or "add-rule"' };
  }
  const anchorProblem = textProblem(value.anchor, "edit.anchor", maxAnchorChars);
  if (anchorProblem) return { reason: anchorProblem };
  const anchor = value.anchor as string;
  const found = occurrences(agentsMd, anchor);
  if (found === 0) return { reason: "edit.anchor is not verbatim text from the current AGENTS.md" };
  if (found > 1) return { reason: `edit.anchor occurs ${found} times in AGENTS.md; it must be unique` };
  if (op === "delete") return { edit: { op, anchor } };
  const textProblemFound = textProblem(value.text, "edit.text", maxEditTextChars);
  if (textProblemFound) return { reason: textProblemFound };
  return { edit: { op, anchor, text: value.text as string } };
}

export function validateImproveProposal(value: unknown, context: ImproveValidationContext): ImproveValidationResult {
  if (!isRecord(value)) return { ok: false, reason: "proposal must be an object" };

  const id = typeof value.id === "string" ? value.id : undefined;
  if (!id || !kebabCasePattern.test(id) || id.length > 64) {
    return { ok: false, id, reason: "id must be kebab-case (at most 64 characters)" };
  }
  if (context.seenIds.has(id)) return { ok: false, id, reason: "duplicate proposal id" };

  const titleProblem = textProblem(value.title, "title", maxTitleChars, { singleLine: true });
  if (titleProblem) return { ok: false, id, reason: titleProblem };
  const title = value.title as string;
  const rationale = typeof value.rationale === "string" ? value.rationale.slice(0, maxRationaleChars) : "";

  const steerIndexes = validIndexes(value.steerIndexes, context.steerCount);
  const clusterIndexes = validIndexes(value.clusterIndexes, context.clusterCount);
  if (!steerIndexes || !clusterIndexes) {
    return { ok: false, id, reason: "evidence indexes must be integers within the evidence range" };
  }
  const skillNames = value.skillNames === undefined ? [] : value.skillNames;
  if (!Array.isArray(skillNames) || !skillNames.every((name) => typeof name === "string")) {
    return { ok: false, id, reason: "skillNames must be an array of strings" };
  }
  const unknownSkill = (skillNames as string[]).find((name) => !context.skillNames.has(name));
  if (unknownSkill !== undefined) {
    return { ok: false, id, reason: `skillNames cites "${unknownSkill}", which is not in the skill usage table` };
  }
  const citations: ImproveCitations = {
    steerIndexes,
    clusterIndexes,
    skillNames: Array.from(new Set(skillNames as string[]))
  };
  const kind = value.kind;
  // An anchored edit (replace/delete) is grounded by its anchor — verbatim,
  // unique text from the current AGENTS.md — and its finding may be the
  // ABSENCE of evidence (the no-evidence-deletion and over-constraint
  // arrows), so the citation requirement would make those proposals
  // unexpressible. add-rule and every other kind must still cite sessions;
  // malformed edits fall through to validatedEdit's precise rejection.
  const anchorGrounded = kind === "agents-md-edit" && !isAddRuleEdit(value.edit);
  if (citations.steerIndexes.length + citations.clusterIndexes.length + citations.skillNames.length === 0 && !anchorGrounded) {
    return { ok: false, id, reason: "proposal cites no evidence" };
  }

  const base = { id, title, rationale, citations };

  if (kind === "new-skill") {
    const name = typeof value.name === "string" ? value.name : "";
    if (!skillNamePattern.test(name)) return { ok: false, id, reason: "new-skill name must be kebab-case" };
    if (context.installedSkillNames.has(name)) {
      return { ok: false, id, reason: `a skill named "${name}" is already installed` };
    }
    const problem = textProblem(value.description, "description", maxDescriptionLength, { min: 20 });
    if (problem) return { ok: false, id, reason: problem };
    return { ok: true, proposal: { ...base, kind, name, description: value.description as string } };
  }

  if (kind === "kb-rule") {
    const ruleId = typeof value.ruleId === "string" ? value.ruleId : "";
    if (!kebabCasePattern.test(ruleId)) return { ok: false, id, reason: "kb-rule ruleId must be kebab-case" };
    const problem = textProblem(value.rule, "rule", maxRuleChars, { singleLine: true });
    if (problem) return { ok: false, id, reason: problem };
    const tier = value.tier;
    if (!preferenceTiers.includes(tier as PreferenceTier)) {
      return { ok: false, id, reason: `tier must be one of ${preferenceTiers.join(", ")}` };
    }
    const owner = value.owner;
    if (owner !== undefined && (typeof owner !== "string" || !kebabCasePattern.test(owner))) {
      return { ok: false, id, reason: "owner must be a kebab-case subagent name" };
    }
    return {
      ok: true,
      proposal: {
        ...base,
        kind,
        ruleId,
        rule: value.rule as string,
        tier: tier as PreferenceTier,
        ...(owner !== undefined ? { owner } : {})
      }
    };
  }

  if (kind === "agents-md-edit") {
    if (context.agentsMd.length === 0 && !isAddRuleEdit(value.edit)) {
      return { ok: false, id, reason: "the project has no AGENTS.md content to edit; only add-rule applies" };
    }
    const result = validatedEdit(value.edit, context.agentsMd);
    if ("reason" in result) return { ok: false, id, reason: result.reason };
    return { ok: true, proposal: { ...base, kind, edit: result.edit } };
  }

  if (kind === "guard-instance") {
    const hookId = typeof value.hookId === "string" ? (value.hookId as HookId) : ("" as HookId);
    const patchKey = improveGuardHooks[hookId];
    if (!patchKey) {
      return { ok: false, id, reason: `hookId must be one of: ${Object.keys(improveGuardHooks).join(", ")}` };
    }
    const patch = value.guardsPatch;
    if (!isRecord(patch) || Object.keys(patch).length !== 1 || !isRecord(patch[patchKey])) {
      return { ok: false, id, reason: `guardsPatch must contain exactly the "${patchKey}" record` };
    }
    return { ok: true, proposal: { ...base, kind, hookId, guardsPatch: patch } };
  }

  if (kind === "subagent") {
    const name = typeof value.name === "string" ? value.name : "";
    if (!kebabCasePattern.test(name) || name.length > 64) {
      return { ok: false, id, reason: "subagent name must be kebab-case (at most 64 characters)" };
    }
    if (context.existingSubagentNames.has(name)) {
      return { ok: false, id, reason: `a subagent named "${name}" already exists` };
    }
    const descriptionProblem = textProblem(value.description, "description", maxDescriptionLength, { min: 20 });
    if (descriptionProblem) return { ok: false, id, reason: descriptionProblem };
    const instructionsProblem = textProblem(value.instructions, "instructions", maxInstructionChars, { min: minInstructionChars });
    if (instructionsProblem) return { ok: false, id, reason: instructionsProblem };
    const skills = value.skills === undefined ? [] : value.skills;
    if (!Array.isArray(skills) || !skills.every((skill) => typeof skill === "string")) {
      return { ok: false, id, reason: "skills must be an array of strings" };
    }
    if (skills.length > maxSubagentSkills) {
      return { ok: false, id, reason: `a subagent may name at most ${maxSubagentSkills} skills` };
    }
    const missing = (skills as string[]).find((skill) => !context.installedSkillNames.has(skill));
    if (missing !== undefined) {
      return { ok: false, id, reason: `subagent names skill "${missing}", which is not installed` };
    }
    return {
      ok: true,
      proposal: {
        ...base,
        kind,
        name,
        description: value.description as string,
        instructions: value.instructions as string,
        skills: Array.from(new Set(skills as string[]))
      }
    };
  }

  if (kind === "skill-rescope" || kind === "prune-skill") {
    const skill = typeof value.skill === "string" ? value.skill : "";
    if (!context.installedSkillNames.has(skill)) {
      return { ok: false, id, reason: `skill "${skill}" is not installed` };
    }
    if (kind === "prune-skill") return { ok: true, proposal: { ...base, kind, skill } };
    const problem = textProblem(value.description, "description", maxDescriptionLength, { min: 20 });
    if (problem) return { ok: false, id, reason: problem };
    return { ok: true, proposal: { ...base, kind, skill, description: value.description as string } };
  }

  return { ok: false, id, reason: `unknown proposal kind ${JSON.stringify(kind)}` };
}

export function buildImprovePrompt(input: {
  evidence: SessionEvidence;
  snapshot: HarnessSnapshot;
  /** Optional user curation focus; steers attention, never excludes evidence. */
  focus?: string;
}): string {
  const steers = input.evidence.steers.slice(0, maxPromptSteers).map((steer, index) => ({
    index,
    ...(steer.date ? { date: steer.date } : {}),
    ...(steer.context ? { context: steer.context } : {}),
    text: steer.text
  }));
  const clusters = input.evidence.failureClusters.slice(0, maxPromptClusters).map((cluster, index) => ({
    index,
    key: cluster.key,
    class: cluster.class,
    count: cluster.count,
    sessionCount: cluster.sessionCount,
    samples: cluster.samples
  }));
  const skills = input.evidence.skillUsage.map((skill) => ({
    name: skill.name,
    installed: skill.installed,
    invocations: skill.invocations,
    sessions: skill.sessions,
    ...(skill.missingSkillMd ? { missingSkillMd: true } : {}),
    ...(input.snapshot.skillDescriptions[skill.name] ? { description: input.snapshot.skillDescriptions[skill.name] } : {})
  }));
  const subagents = input.snapshot.subagents.map((subagent) => ({ name: subagent.name, description: subagent.description }));

  // Anonymized per-session activity: the provider and counts, never the
  // session id (the consent screen promises ids are not sent).
  const sessionActivity = (input.evidence.sessionActivity ?? []).slice(0, maxPromptActivity).map((entry) => ({
    provider: entry.ref.startsWith("codex:") ? "codex" : entry.ref.startsWith("claude:") ? "claude" : "session",
    steers: entry.steerCount,
    edits: entry.editCount,
    commands: entry.commandCount,
    ...(entry.topDirs.length > 0 ? { topDirs: entry.topDirs } : {})
  }));
  const reviewedDecisions = (input.snapshot.reviewedDecisions ?? [])
    .slice(-maxPromptReviewed)
    .map((decision) => ({ decision: decision.decision, kind: decision.kind, title: decision.title }));

  return `You are Farrier's harness-improvement analyst. Compare what this project's CURRENT harness declares against what its agent sessions actually show, and propose the smallest set of harness changes that closes the distance.

Reason over the diff, not from a blank slate:
- A rule that is declared in the harness but still corrected in the steers needs a stronger tier (a deterministic check or a reviewer), not another sentence.
- A skill that is installed but never invoked needs a sharper trigger description (skill-rescope), an owning subagent, or pruning.
- A repeated steer with nothing in the harness covering it needs a new rule, skill, or subagent.
- A harness rule with no supporting evidence across these sessions is a deletion candidate (agents-md-edit delete).
- A hard rule the selected sessions show is followed without any steer enforcing it is an over-constraint candidate: propose an agents-md-edit replace that converts it to a judgment-phrased principle, or a delete. Softening requires that compliance evidence; never soften a rule the steers still have to defend.
- Two harness statements that contradict each other (or a harness statement the steers contradict) get ONE replace that resolves the conflict; never leave both.
- Harness text that restates what any agent sees from the file system, lockfiles, or the code itself is a deletion candidate: the file should spend its length on gotchas, not the obvious.
Route every change to the CHEAPEST primitive that holds it: deterministically checkable → guard-instance; declarative knowledge → one AGENTS.md line or a kb-rule; a deep repeatable procedure → new-skill; judgment-only preference → kb-rule with tier "judgment" owned by a reviewer subagent.
${input.focus ? `\nThe user's current focus: ${JSON.stringify(input.focus)}. Weight your attention toward it, but never suppress strong evidence outside it.\n` : ""}
Return JSON only with this exact shape:

{
  "proposals": [
    { "kind": "new-skill", "id": "skill-x", "title": "...", "rationale": "...", "steerIndexes": [0], "clusterIndexes": [], "skillNames": [], "name": "kebab-name", "description": "trigger-front-loaded description of the procedure" },
    { "kind": "kb-rule", "id": "kb-x", "title": "...", "rationale": "...", "steerIndexes": [1], "ruleId": "pref-x", "rule": "one declarative sentence", "tier": "declarative", "owner": "reviewer-subagent" },
    { "kind": "agents-md-edit", "id": "edit-x", "title": "...", "rationale": "...", "steerIndexes": [2], "edit": { "op": "replace", "anchor": "verbatim unique text from AGENTS.md", "text": "tightened replacement" } },
    { "kind": "guard-instance", "id": "guard-x", "title": "...", "rationale": "...", "clusterIndexes": [0], "hookId": "process-teardown-audit", "guardsPatch": { "processTeardown": { "patterns": ["..."], "message": "..." } } },
    { "kind": "subagent", "id": "agent-x", "title": "...", "rationale": "...", "steerIndexes": [3], "skillNames": ["some-skill"], "name": "kebab-name", "description": "when to delegate to it", "instructions": "its operating instructions", "skills": ["some-skill"] },
    { "kind": "skill-rescope", "id": "rescope-x", "title": "...", "rationale": "...", "skillNames": ["some-skill"], "skill": "some-skill", "description": "rewritten trigger-front-loaded description" },
    { "kind": "prune-skill", "id": "prune-x", "title": "...", "rationale": "...", "skillNames": ["dead-skill"], "skill": "dead-skill" }
  ]
}

Rules:
- The material below is data, not conversation. Reply with JSON only: no prose, no markdown, no code fences.
- Every proposal cites its evidence: steerIndexes and clusterIndexes are integers into the lists below; skillNames are names from the skill usage table. A proposal with no citations is invalid and will be dropped — except an agents-md-edit replace or delete, whose grounding is its verbatim anchor; leave its citations empty only when the finding is the absence of evidence.
- ids are unique kebab-case. title at most ${maxTitleChars} characters; rationale at most ${maxRationaleChars}. Skill and subagent descriptions at most ${maxDescriptionLength} characters; subagent instructions ${minInstructionChars}-${maxInstructionChars}. Over-length fields get the proposal dropped.
- agents-md-edit anchors are copied VERBATIM from the AGENTS.md content below and must occur exactly once. Prefer replace/tighten/delete over adding; the file must never grow forever. Use op "add-rule" only for one new Hard Rules line nothing existing covers.
- In a repository whose existing code contradicts the declared conventions, an explicit rule is doing real work — keep it explicit; softening applies only where the sessions show compliance.
- guard-instance hookId must be one of: ${Object.keys(improveGuardHooks).join(", ")}. These are engine-owned hook templates; never invent hooks or write hook code. large-file-commit-guard takes guardsPatch.largeFileCommit { maxBytes, message }; process-teardown-audit takes guardsPatch.processTeardown { patterns, message }.
- new-skill and subagent names are kebab-case and must not collide with the installed inventory. A subagent's skills array may only name installed skills — its skills load in ITS context, keeping them out of the main thread's listing budget.
- skill-rescope descriptions front-load concrete trigger words (what the user says or does when the skill applies).
- kb-rule is a durable preference for farrier's preference KB: tier "lintable" when a deterministic check could hold it, "declarative" when its owning subagent should read it, "judgment" when only a reviewer checklist can. Rules are single sentences.
- prune-skill marks an installed skill the evidence shows is dead weight; farrier never deletes files, the user removes it after review.
- Propose at most ${maxImproveProposals} changes; fewer, well-cited proposals beat coverage.${
    reviewedDecisions.length > 0
      ? '\n- Do not re-propose an idea listed as "rejected" under Previously reviewed proposals unchanged; re-propose it only with materially new evidence.'
      : ""
  }

Current harness — AGENTS.md${input.snapshot.agentsMd === undefined ? " (none)" : ""}:
${input.snapshot.agentsMd?.slice(0, maxAgentsMdPromptChars) ?? "(missing)"}

Current harness — CLAUDE.md${input.snapshot.claudeMd === undefined ? " (none)" : ""}:
${input.snapshot.claudeMd?.slice(0, maxClaudeMdPromptChars) ?? "(missing)"}

Installed hooks: ${JSON.stringify(input.snapshot.hookIds)}

Subagents:
${JSON.stringify(subagents, null, 2)}

Skill usage (installed ∪ invoked, with per-skill invocation counts from the selected sessions):
${JSON.stringify(skills, null, 2)}

Steers (user messages from the selected sessions, redacted and bounded; cite by index). Each may carry a "context": the assistant action it immediately followed, i.e. what provoked the correction:
${JSON.stringify(steers, null, 2)}

Failure clusters (deterministic counts; cite by index):
${JSON.stringify(clusters, null, 2)}

Session activity (deterministic per-session counts from the selected sessions). A session with real edits/commands and zero steers is compliance evidence: it is exactly what the over-constraint arrow requires before a followed rule may be softened:
${JSON.stringify(sessionActivity, null, 2)}

Previously reviewed proposals (what the user already accepted or rejected here; do not re-propose a rejection unchanged):
${JSON.stringify(reviewedDecisions, null, 2)}
`;
}

function proposalsFromBackendOutput(stdout: string): unknown[] {
  const parsed = parseBackendJson(stdout);
  if (!isRecord(parsed) || !Array.isArray(parsed.proposals)) {
    throw new Error('backend JSON must have shape {"proposals":[...]}');
  }
  return parsed.proposals;
}

export function improveValidationContext(evidence: SessionEvidence, snapshot: HarnessSnapshot): ImproveValidationContext {
  return {
    steerCount: Math.min(evidence.steers.length, maxPromptSteers),
    clusterCount: Math.min(evidence.failureClusters.length, maxPromptClusters),
    skillNames: new Set(evidence.skillUsage.map((skill) => skill.name)),
    installedSkillNames: new Set(evidence.skillUsage.filter((skill) => skill.installed).map((skill) => skill.name)),
    agentsMd: snapshot.agentsMd ?? "",
    existingSubagentNames: new Set(snapshot.subagents.map((subagent) => subagent.name)),
    seenIds: new Set()
  };
}

export function validateImproveProposals(
  raw: readonly unknown[],
  evidence: SessionEvidence,
  snapshot: HarnessSnapshot
): { proposals: ImproveProposal[]; dropped: DroppedImproveProposal[] } {
  const context = improveValidationContext(evidence, snapshot);
  const proposals: ImproveProposal[] = [];
  const dropped: DroppedImproveProposal[] = [];
  for (const value of raw) {
    if (proposals.length >= maxImproveProposals) {
      dropped.push({ reason: `proposals are capped at ${maxImproveProposals}; the rest were dropped` });
      break;
    }
    const result = validateImproveProposal(value, context);
    if (result.ok) {
      context.seenIds.add(result.proposal.id);
      proposals.push({
        ...result.proposal,
        evidence: improveEvidenceSummary(result.proposal, evidence)
      } as ImproveProposal);
    } else {
      dropped.push({ ...(result.id ? { id: result.id } : {}), reason: result.reason });
    }
  }
  return { proposals, dropped };
}

/**
 * The consent-gated LLM pass. Redacted steer excerpts, failure counts, skill
 * usage, and the harness snapshot (project file contents) are sent to the
 * selected backend; the caller collects that consent explicitly before
 * calling. Output is validated-or-dropped; nothing here writes files.
 */
export async function authorImproveProposals(input: {
  targetDir: string;
  evidence: SessionEvidence;
  snapshot: HarnessSnapshot;
  focus?: string;
  backend: AgentBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner: BackendCommandRunner;
}): Promise<{ proposals: ImproveProposal[]; dropped: DroppedImproveProposal[] }> {
  const model = input.model ?? (input.backend === "claude" ? "sonnet" : "gpt-5.5");
  const stdout = await runIsolatedBackendText({
    targetDir: input.targetDir,
    backend: input.backend,
    prompt: buildImprovePrompt({
      evidence: input.evidence,
      snapshot: input.snapshot,
      ...(input.focus ? { focus: input.focus } : {})
    }),
    model,
    reasoningEffort: input.reasoningEffort,
    runner: input.runner,
    // The source project's agent sessions may still be open; nothing is read
    // from or staged into it.
    concurrentTargetWrites: "tolerate"
  });
  return validateImproveProposals(proposalsFromBackendOutput(stdout), input.evidence, input.snapshot);
}
