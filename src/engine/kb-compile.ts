import { join, resolve } from "node:path";
import type { AdviceCreationFile } from "./advice-apply";
import { applyHarnessChangePlan, inspectHarnessChangePlan, type ApplyHarnessChangePlanDeps, type ApplyHarnessChangePlanResult, type HarnessChangePlan } from "./create-plan";
import { readIfFile } from "./improve-authoring";
import type { PreferenceKb, PreferenceRule } from "./preference-kb";
import { agentsFilePath, appendHardRulesLine } from "./proposal-apply";
import { escapeTomlMultiline, unescapeTomlMultiline } from "./render-playbook";

/**
 * The KB compile step: routes each reviewed preference rule in
 * .farrier/preferences.json to the runtime primitive its tier calls for, so a
 * rule that was only recorded actually reaches the agents. Deterministic and
 * read-only to plan; writing goes through the shared harness transaction
 * (staged writes, backups, rollback) like every other apply path.
 *
 * The routing (the repo's routing principle, one rung per tier):
 *   declarative + owner  -> a scoped "## Rules" line in the owner subagent
 *                           (Claude .md and Codex .toml), idempotent by ruleId.
 *   declarative, no owner -> one AGENTS.md Hard Rules line every agent reads.
 *   judgment + owner     -> a "## Review checklist" item in the owner subagent.
 *   judgment, no owner   -> skipped: judgment needs a reviewer to own it.
 *   lintable + patterns  -> the taste-guard hook enforces it (patterns live in
 *                           guards.tasteGuard.rules) AND its rule text mirrors
 *                           into AGENTS.md, the dependable words layer for codex.
 *   lintable, no patterns -> skipped: author patterns first (kb-taste-authoring).
 */

export type KbCompileTarget =
  | { kind: "subagent-rule"; owner: string; ruleId: string; line: string }
  | { kind: "agents-md-rule"; ruleId: string; line: string }
  | { kind: "reviewer-checklist"; owner: string; ruleId: string; item: string }
  | { kind: "taste-guard"; ruleId: string };

export type KbCompileSkip = { ruleId: string; reason: string };

export type KbCompilePlan = {
  targets: KbCompileTarget[];
  skipped: KbCompileSkip[];
};

const rulesHeading = "## Rules";
const reviewChecklistHeading = "## Review checklist";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function claudeSubagentPath(owner: string): string {
  return `.claude/agents/${owner}.md`;
}

function codexSubagentPath(owner: string): string {
  return `.codex/agents/${owner}.toml`;
}

async function subagentExists(targetDir: string, owner: string): Promise<boolean> {
  const claude = await readIfFile(join(targetDir, claudeSubagentPath(owner)));
  if (claude !== undefined) return true;
  const codex = await readIfFile(join(targetDir, codexSubagentPath(owner)));
  return codex !== undefined;
}

/**
 * ruleIds that already have at least one reviewed taste-guard pattern in
 * guards.tasteGuard.rules. Reading is defensive: a hand-edited or absent
 * manifest yields the empty set, so a lintable rule without patterns is simply
 * skipped rather than throwing here.
 */
async function reviewedTasteGuardRuleIds(targetDir: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const raw = await readIfFile(join(targetDir, ".farrier.json"));
  if (raw === undefined) return ids;
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return ids;
  }
  const guards = isRecord(manifest) ? manifest.guards : undefined;
  const tasteGuard = isRecord(guards) ? guards.tasteGuard : undefined;
  const rules = isRecord(tasteGuard) ? tasteGuard.rules : undefined;
  if (!Array.isArray(rules)) return ids;
  for (const rule of rules) {
    if (!isRecord(rule) || typeof rule.ruleId !== "string") continue;
    const patterns = rule.patterns;
    if (Array.isArray(patterns) && patterns.some((pattern) => typeof pattern === "string" && pattern.trim().length > 0)) {
      ids.add(rule.ruleId);
    }
  }
  return ids;
}

async function routeRule(
  targetDir: string,
  rule: PreferenceRule,
  tasteGuardRuleIds: Set<string>
): Promise<{ target: KbCompileTarget } | { skip: string }> {
  if (rule.tier === "lintable") {
    if (tasteGuardRuleIds.has(rule.id)) return { target: { kind: "taste-guard", ruleId: rule.id } };
    return { skip: "no reviewed patterns yet — author patterns first" };
  }

  if (rule.tier === "judgment") {
    if (!rule.owner) return { skip: "judgment rule needs a reviewer subagent owner" };
    if (!(await subagentExists(targetDir, rule.owner))) {
      return { skip: `owner subagent "${rule.owner}" does not exist — create it first` };
    }
    return { target: { kind: "reviewer-checklist", owner: rule.owner, ruleId: rule.id, item: rule.rule } };
  }

  // declarative
  if (!rule.owner) return { target: { kind: "agents-md-rule", ruleId: rule.id, line: rule.rule } };
  if (!(await subagentExists(targetDir, rule.owner))) {
    return { skip: `owner subagent "${rule.owner}" does not exist — create it first` };
  }
  return { target: { kind: "subagent-rule", owner: rule.owner, ruleId: rule.id, line: rule.rule } };
}

/**
 * Route every reviewed rule to its primitive. Read-only: reads the manifest
 * (for reviewed taste-guard patterns) and the subagent files (to confirm an
 * owner exists) but writes nothing. A KB whose version is not 1 fails loud —
 * greenfield, no compatibility shims.
 */
export async function compileKbPlan(input: { kb: PreferenceKb; targetDir: string }): Promise<KbCompilePlan> {
  if (input.kb.version !== 1) {
    throw new Error(`Unsupported preference KB version ${JSON.stringify((input.kb as { version: unknown }).version)}; the compiler only understands version 1.`);
  }
  const targetDir = resolve(input.targetDir);
  const tasteGuardRuleIds = await reviewedTasteGuardRuleIds(targetDir);

  const targets: KbCompileTarget[] = [];
  const skipped: KbCompileSkip[] = [];
  for (const rule of input.kb.rules) {
    const routed = await routeRule(targetDir, rule, tasteGuardRuleIds);
    if ("skip" in routed) skipped.push({ ruleId: rule.id, reason: routed.skip });
    else targets.push(routed.target);
  }
  return { targets, skipped };
}

/** Marker that makes a compiled subagent line idempotent by ruleId; invisible in markdown. */
function ruleMarker(ruleId: string): string {
  return `<!-- kb:${ruleId} -->`;
}

/**
 * Insert or replace one marked bullet under a "## <heading>" section. Recompiling
 * the same ruleId replaces its line in place (never duplicates); a changed line
 * updates it. Works on any plain-text instruction body (a Claude .md, or a Codex
 * developer_instructions string).
 */
export function upsertMarkedLine(text: string, heading: string, ruleId: string, line: string): string {
  const marker = ruleMarker(ruleId);
  const bullet = `- ${line} ${marker}`;
  const lines = text.split("\n");

  const existing = lines.findIndex((existingLine) => existingLine.trimEnd().endsWith(marker));
  if (existing >= 0) {
    if (lines[existing] === bullet) return text;
    lines[existing] = bullet;
    return lines.join("\n");
  }

  const headingIndex = lines.findIndex((existingLine) => existingLine.trim() === heading);
  if (headingIndex === -1) {
    const base = text.replace(/\s+$/, "");
    const section = `${heading}\n\n${bullet}`;
    return base.length > 0 ? `${base}\n\n${section}\n` : `${section}\n`;
  }

  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (lines[index]!.trim().startsWith("## ")) {
      sectionEnd = index;
      break;
    }
  }
  let insertAt = headingIndex + 1;
  for (let index = headingIndex + 1; index < sectionEnd; index += 1) {
    if (lines[index]!.trim().length > 0) insertAt = index + 1;
  }
  lines.splice(insertAt, 0, bullet);
  return lines.join("\n");
}

const developerInstructionsBlock = /developer_instructions = """\n([\s\S]*?)\n"""/;

/**
 * Apply a transform to the developer_instructions body of a rendered Codex
 * subagent TOML, preserving the rest of the file byte-for-byte. Escaping is the
 * shared render-playbook pair, so reading a block back and re-rendering it is a
 * round-trip. Returns undefined when the file carries no developer_instructions
 * block, so the caller can fail loud instead of silently dropping the mirror.
 */
export function withTomlInstructions(toml: string, transform: (body: string) => string): string | undefined {
  const match = developerInstructionsBlock.exec(toml);
  if (!match || match.index === undefined) return undefined;
  const body = unescapeTomlMultiline(match[1]!);
  const nextBody = escapeTomlMultiline(transform(body).trim());
  const start = match.index;
  const end = start + match[0].length;
  return `${toml.slice(0, start)}developer_instructions = """\n${nextBody}\n"""${toml.slice(end)}`;
}

type FileAccumulator = {
  working: Map<string, string>;
  present: Map<string, boolean>;
  touched: Set<string>;
};

async function ensureLoaded(targetDir: string, accumulator: FileAccumulator, path: string): Promise<void> {
  if (accumulator.working.has(path)) return;
  const content = await readIfFile(join(targetDir, path));
  accumulator.present.set(path, content !== undefined);
  accumulator.working.set(path, content ?? "");
}

async function applyRuleToSubagent(
  targetDir: string,
  accumulator: FileAccumulator,
  owner: string,
  heading: string,
  ruleId: string,
  line: string
): Promise<void> {
  const mdPath = claudeSubagentPath(owner);
  await ensureLoaded(targetDir, accumulator, mdPath);
  if (accumulator.present.get(mdPath)) {
    accumulator.working.set(mdPath, upsertMarkedLine(accumulator.working.get(mdPath)!, heading, ruleId, line));
    accumulator.touched.add(mdPath);
  }

  const tomlPath = codexSubagentPath(owner);
  await ensureLoaded(targetDir, accumulator, tomlPath);
  if (accumulator.present.get(tomlPath)) {
    const next = withTomlInstructions(accumulator.working.get(tomlPath)!, (body) => upsertMarkedLine(body, heading, ruleId, line));
    if (next === undefined) {
      throw new Error(`${tomlPath} has no developer_instructions block to mirror the rule into; fix the subagent file first.`);
    }
    accumulator.working.set(tomlPath, next);
    accumulator.touched.add(tomlPath);
  }
}

function filePurpose(path: string): string {
  if (path === agentsFilePath) return "Records reviewed preference rules as AGENTS.md Hard Rules lines (the dependable words layer, read every session).";
  if (path.startsWith(".claude/agents/")) return "Adds reviewed rules to the subagent's scoped Claude instructions.";
  return "Mirrors reviewed rules into the subagent's Codex developer_instructions.";
}

/**
 * Turn a compile plan into the exact files it would write, applied on top of the
 * current on-disk content. Multiple targets for one file compose in plan order;
 * a file whose content already matches shows as unchanged at apply time. A
 * taste-guard target contributes only its AGENTS.md mirror line — its patterns
 * already live in guards.tasteGuard.rules (that is the precondition for the
 * target), so the enforcement half needs no file write here.
 */
export async function buildKbCompileFiles(input: {
  targetDir: string;
  kb: PreferenceKb;
  plan: KbCompilePlan;
}): Promise<AdviceCreationFile[]> {
  const targetDir = resolve(input.targetDir);
  const ruleText = new Map(input.kb.rules.map((rule) => [rule.id, rule.rule]));
  const accumulator: FileAccumulator = { working: new Map(), present: new Map(), touched: new Set() };

  for (const target of input.plan.targets) {
    if (target.kind === "agents-md-rule" || target.kind === "taste-guard") {
      const line = target.kind === "agents-md-rule" ? target.line : ruleText.get(target.ruleId);
      if (line === undefined) continue;
      await ensureLoaded(targetDir, accumulator, agentsFilePath);
      accumulator.working.set(agentsFilePath, appendHardRulesLine(accumulator.working.get(agentsFilePath)!, line));
      accumulator.touched.add(agentsFilePath);
    } else if (target.kind === "subagent-rule") {
      await applyRuleToSubagent(targetDir, accumulator, target.owner, rulesHeading, target.ruleId, target.line);
    } else {
      await applyRuleToSubagent(targetDir, accumulator, target.owner, reviewChecklistHeading, target.ruleId, target.item);
    }
  }

  return Array.from(accumulator.touched)
    .sort()
    .map((path) => ({ path, content: accumulator.working.get(path)!, purpose: filePurpose(path) }));
}

/**
 * Write a compile plan through the shared harness transaction: staged writes,
 * backups for replacements, rollback on any failure. Read-only planning happened
 * in compileKbPlan; this is the confirmed apply. Existing files (AGENTS.md, the
 * subagent instructions) are replacements, so force must be set once reviewed.
 */
export async function applyKbCompilePlan(input: {
  targetDir: string;
  kb: PreferenceKb;
  plan: KbCompilePlan;
  force?: boolean;
  deps?: ApplyHarnessChangePlanDeps;
}): Promise<ApplyHarnessChangePlanResult> {
  const targetDir = resolve(input.targetDir);
  const files = await buildKbCompileFiles({ targetDir, kb: input.kb, plan: input.plan });
  return applyHarnessChangePlan(
    { targetDir, files },
    { force: input.force ?? false, allowExistingHarness: true },
    input.deps ?? {}
  );
}

/** Read-only inspection of the files a compile plan would write, for a review surface. */
export async function inspectKbCompilePlan(input: {
  targetDir: string;
  kb: PreferenceKb;
  plan: KbCompilePlan;
}): Promise<HarnessChangePlan> {
  const targetDir = resolve(input.targetDir);
  const files = await buildKbCompileFiles({ targetDir, kb: input.kb, plan: input.plan });
  return inspectHarnessChangePlan({ targetDir, files });
}
