import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PackCatalog } from "../registry/catalog";
import type { AdviceCreationFile, AdviceCreationPlan } from "./advice-apply";
import { inspectHarnessChangePlan, type HarnessChangePlan } from "./create-plan";
import type { PrimitiveProposal } from "./failure-router";
import { occurrences, readIfFile, type AgentsMdEdit, type ImproveProposal } from "./improve-authoring";
import { mergePreferenceRule, preferenceKbPath, type PreferenceRule } from "./preference-kb";
import { agentsFilePath, planPrimitiveProposal } from "./proposal-apply";
import { renderClaudeSubagentMd, renderSubagentToml } from "./render-playbook";
import { extractRepoMapSection } from "./repo-map";
import { projectSkillRoots } from "./skill-paths";
import { parseFrontmatter, yamlScalar } from "./skill-validate";

export { applyProposalPlan as applyImprovePlan } from "./proposal-apply";

/**
 * Plans one reviewed Improve proposal into exact files (or a hand-off).
 * Read-only, mirroring planPrimitiveProposal: the TUI shows the inspection
 * and applies only after explicit confirmation, through the shared staged
 * write/backup/rollback transaction. Pruning never deletes — farrier writes
 * files, the user removes them.
 */

export type PlannedImprove =
  | { kind: "files"; plan: AdviceCreationPlan; inspection: HarnessChangePlan }
  /** New skills install nothing here; the query feeds the existing skill flow. */
  | { kind: "skill"; query: string; message: string }
  /** Pruning advice: evidence plus locations, no writes. */
  | { kind: "advisory"; message: string };

/** Anchored ops; add-rule routes through the shared rules-line planner instead. */
type AnchoredEdit = Exclude<AgentsMdEdit, { op: "add-rule" }>;

/** Remove the anchor; when it spanned whole lines, collapse the gap it leaves. */
export function deleteAnchoredText(content: string, anchor: string): string {
  return content.replace(anchor, "").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
}

/** Marker for masking the generated repo-map region; NUL cannot occur in a validated anchor. */
const repoMapPlaceholder = "\u0000farrier-repo-map-region\u0000";

/**
 * Anchored edits match with the generated repo-map region masked out — the
 * validation prompt never saw it — so an anchor that happens to repeat
 * inside that region cannot flip a validated edit into an ambiguous one. The
 * region stays byte-identical and in place. Replacements go through a
 * replacer function so `$`-patterns in model-authored text stay literal.
 */
export function applyAgentsMdEdit(content: string, edit: AnchoredEdit): string {
  const region = extractRepoMapSection(content);
  const working = region === null ? content : content.replace(region, repoMapPlaceholder);
  const found = occurrences(working, edit.anchor);
  if (found !== 1) {
    throw new Error(
      found === 0
        ? "AGENTS.md changed since the analysis: the anchor text is no longer present. Re-run the analysis."
        : "AGENTS.md changed since the analysis: the anchor text is no longer unique. Re-run the analysis."
    );
  }
  const edited = edit.op === "delete" ? deleteAnchoredText(working, edit.anchor) : working.replace(edit.anchor, () => edit.text);
  return region === null ? edited : edited.replace(repoMapPlaceholder, () => region);
}

/**
 * Replace (or insert) the single-line description in a SKILL.md frontmatter
 * block. Block-scalar continuation lines under the old description are
 * removed so a folded description cannot leave orphan lines behind.
 */
export function withSkillDescription(content: string, description: string): string | undefined {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return undefined;
  const lines = frontmatter.raw.split("\n");
  const line = `description: ${yamlScalar(description.replace(/\s+/g, " ").trim())}`;
  const start = lines.findIndex((existing) => /^description:/.test(existing));
  if (start < 0) {
    lines.push(line);
  } else {
    let end = start + 1;
    while (end < lines.length && /^[ \t]/.test(lines[end]!)) end += 1;
    lines.splice(start, end - start, line);
  }
  return `---\n${lines.join("\n")}\n---\n${frontmatter.body}`;
}

function citationStrings(proposal: ImproveProposal): string[] {
  return [
    ...proposal.citations.steerIndexes.map((index) => `steer ${index}`),
    ...proposal.citations.clusterIndexes.map((index) => `cluster ${index}`),
    ...proposal.citations.skillNames.map((name) => `skill ${name}`),
    proposal.evidence
  ];
}

async function kbRulePlan(
  targetDir: string,
  proposal: Extract<ImproveProposal, { kind: "kb-rule" }>,
  now: Date
): Promise<{ files: AdviceCreationFile[]; summary: string }> {
  const current = await readIfFile(join(targetDir, preferenceKbPath));
  const rule: PreferenceRule = {
    id: proposal.ruleId,
    rule: proposal.rule,
    tier: proposal.tier,
    ...(proposal.owner ? { owner: proposal.owner } : {}),
    evidence: citationStrings(proposal),
    addedAt: now.toISOString().slice(0, 10)
  };
  return {
    files: [{
      path: preferenceKbPath,
      content: mergePreferenceRule(current, rule),
      purpose: "Records the reviewed preference rule in farrier's preference KB with its evidence and enforcement tier."
    }],
    summary: `Adds preference rule ${proposal.ruleId} (tier: ${proposal.tier}${proposal.owner ? `, owner: ${proposal.owner}` : ""}) to ${preferenceKbPath}.`
  };
}

async function agentsMdEditPlan(
  targetDir: string,
  edit: AnchoredEdit
): Promise<{ files: AdviceCreationFile[]; summary: string }> {
  const current = (await readIfFile(join(targetDir, agentsFilePath))) ?? "";
  const content = applyAgentsMdEdit(current, edit);
  const verb = edit.op === "delete" ? "Deletes text from" : "Tightens text in";
  return {
    files: [{
      path: agentsFilePath,
      content,
      purpose: `${verb} AGENTS.md; agents read it at the start of every session.`
    }],
    summary: `${verb} AGENTS.md.`
  };
}

function subagentPlan(
  proposal: Extract<ImproveProposal, { kind: "subagent" }>
): { files: AdviceCreationFile[]; summary: string } {
  const subagent = {
    name: proposal.name,
    description: proposal.description,
    developerInstructions: proposal.instructions,
    ...(proposal.skills.length > 0 ? { skills: proposal.skills } : {})
  };
  return {
    files: [
      {
        path: `.claude/agents/${proposal.name}.md`,
        content: renderClaudeSubagentMd(subagent),
        purpose: "Claude Code subagent; its scoped skills load in its own context, not the main thread's listing."
      },
      {
        path: `.codex/agents/${proposal.name}.toml`,
        content: renderSubagentToml(subagent),
        purpose: "Codex subagent definition with its scoped skills."
      }
    ],
    summary: `Creates the ${proposal.name} subagent for both agents (read-only sandbox)${proposal.skills.length > 0 ? ` with ${proposal.skills.length} scoped skill(s)` : ""}.`
  };
}

async function skillRescopePlan(
  targetDir: string,
  proposal: Extract<ImproveProposal, { kind: "skill-rescope" }>
): Promise<{ files: AdviceCreationFile[]; summary: string }> {
  const files: AdviceCreationFile[] = [];
  for (const root of projectSkillRoots) {
    const path = join(root, proposal.skill, "SKILL.md");
    const current = await readIfFile(join(targetDir, path));
    if (current === undefined) continue;
    const content = withSkillDescription(current, proposal.description);
    if (content === undefined) {
      throw new Error(`${path} has no frontmatter block; fix the skill before re-scoping it.`);
    }
    if (content !== current) {
      files.push({
        path,
        content,
        purpose: "Rewrites the skill's trigger description so agents invoke it when it applies."
      });
    }
  }
  if (files.length === 0) {
    throw new Error(`No SKILL.md found for "${proposal.skill}" under ${projectSkillRoots.join(", ")}, or the description already matches.`);
  }
  return {
    files,
    summary: `Rewrites the ${proposal.skill} description in ${files.length} installed location(s).`
  };
}

async function pruneAdvisory(targetDir: string, skill: string, evidence: string): Promise<string> {
  const locations: string[] = [];
  for (const root of projectSkillRoots) {
    const present = await stat(join(targetDir, root, skill)).then((stats) => stats.isDirectory()).catch(() => false);
    if (present) locations.push(`${root}/${skill}`);
  }
  return `${evidence}. Farrier never deletes files: after reviewing, remove ${locations.length > 0 ? locations.join(" and ") : `the ${skill} skill directory`} yourself (and its manifest entry if farrier manages it).`;
}

/** Route through the engine-owned primitive planner (manifest + hook bindings stay coherent). */
async function primitivePlan(targetDir: string, proposal: PrimitiveProposal, catalog?: PackCatalog): Promise<PlannedImprove> {
  const planned = await planPrimitiveProposal({ targetDir, proposal, ...(catalog ? { catalog } : {}) });
  if (planned.kind !== "files") {
    throw new Error("primitive planning unexpectedly produced no files");
  }
  return planned;
}

export async function planImproveProposal(input: {
  targetDir: string;
  proposal: ImproveProposal;
  catalog?: PackCatalog;
  now?: Date;
}): Promise<PlannedImprove> {
  const targetDir = resolve(input.targetDir);
  const proposal = input.proposal;

  if (proposal.kind === "new-skill") {
    return {
      kind: "skill",
      query: `${proposal.name}: ${proposal.description}`,
      message: `${proposal.evidence}. Author it through the skill flow; nothing is installed from here.`
    };
  }

  if (proposal.kind === "prune-skill") {
    return { kind: "advisory", message: await pruneAdvisory(targetDir, proposal.skill, proposal.evidence) };
  }

  if (proposal.kind === "guard-instance") {
    return primitivePlan(targetDir, {
      kind: "guard-instance",
      id: proposal.id,
      title: proposal.title,
      hookId: proposal.hookId,
      guardsPatch: proposal.guardsPatch,
      message: proposal.rationale,
      evidence: []
    }, input.catalog);
  }

  if (proposal.kind === "agents-md-edit" && proposal.edit.op === "add-rule") {
    return primitivePlan(targetDir, {
      kind: "rules-line",
      id: proposal.id,
      title: proposal.title,
      line: proposal.edit.text,
      message: proposal.rationale,
      evidence: []
    }, input.catalog);
  }

  let planned: { files: AdviceCreationFile[]; summary: string };
  if (proposal.kind === "kb-rule") {
    planned = await kbRulePlan(targetDir, proposal, input.now ?? new Date());
  } else if (proposal.kind === "agents-md-edit") {
    planned = await agentsMdEditPlan(targetDir, proposal.edit as AnchoredEdit);
  } else if (proposal.kind === "subagent") {
    planned = subagentPlan(proposal);
  } else {
    planned = await skillRescopePlan(targetDir, proposal);
  }

  const plan: AdviceCreationPlan = {
    recommendationId: proposal.id,
    summary: `${planned.summary} ${proposal.evidence}.`,
    files: planned.files
  };
  const inspection = await inspectHarnessChangePlan({ targetDir, files: planned.files });
  return { kind: "files", plan, inspection };
}
