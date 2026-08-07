import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackHookRef, ResolvedPack, SkillRef, ToolPolicyRule } from "../packs/types";
import { builtinCatalog, type PackCatalog, type RegistryPin } from "../registry/catalog";
import { normalizeAgents, type EnforcementAgent } from "./agent-selection";
import { detectPacks, detectPacksWithEvidenceInputs } from "./detect";
import { filePurpose } from "./create-plan";
import { inventoryProjectSkills } from "./skill-inventory";
import { manifestToInput, readManifest } from "./manifest";
import {
  applyMutationPlan,
  inspectMutationPlan,
  type MutationApplyDeps,
  type MutationPlan,
  type MutationResult,
  type PathFingerprint,
} from "./mutation-transaction";
import { createRenderPlan, type RenderPlan, type RenderedFile } from "./render";
import { createUpdateReport, packForManifest, type UpdateReport } from "./update";

export type StackMigrationAction =
  | "create"
  | "unchanged"
  | "merge"
  | "update"
  | "replace"
  | "remove"
  | "blocked";

export type StackMigrationChange = {
  path: string;
  content: string;
  previousContent?: string;
  action: StackMigrationAction;
  purpose: string;
  reason: string;
  requiresForce: boolean;
};

export type StackMigrationBlocker = { path: string; reason: string };

export type StackMigrationPlan = {
  targetDir: string;
  currentPackId: string;
  targetPackId: string;
  agents: EnforcementAgent[];
  changes: StackMigrationChange[];
  blockers: StackMigrationBlocker[];
  mutationPlan: MutationPlan;
  removedDefaultSkills: SkillRef[];
  preservedSkills: SkillRef[];
  detectionEvidencePaths: string[];
  notes: string[];
};

export type StackMigrationResult = {
  transaction: MutationResult;
  report: UpdateReport;
};

export type StackMigrationInput = {
  targetDir: string;
  catalog?: PackCatalog;
  agents?: readonly EnforcementAgent[];
};

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function hash(content: string | Buffer): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex");
}

function skillName(ref: string): string | undefined {
  const separator = ref.lastIndexOf("@");
  if (separator <= 0 || separator === ref.length - 1) return undefined;
  return ref.slice(separator + 1);
}

function targetPackWithPreservedHooks(input: {
  currentPack: ResolvedPack;
  currentDefaults: ResolvedPack;
  targetPack: ResolvedPack;
  catalog: PackCatalog;
}): ResolvedPack {
  const oldDefaults = new Set<PackHookRef>(input.currentDefaults.hooks);
  const custom = input.currentPack.hooks.filter((hook) => !oldDefaults.has(hook));
  const hooks = unique<PackHookRef>([...input.targetPack.hooks, ...custom]);
  const remoteHooks = hooks
    .map((hook) => input.catalog.remoteHook(hook))
    .filter((hook): hook is NonNullable<typeof hook> => hook !== undefined);
  return { ...input.targetPack, hooks, remoteHooks };
}

function registryPinsForTarget(
  catalog: PackCatalog,
  target: ResolvedPack,
  selectedSkills: readonly SkillRef[],
): Record<string, RegistryPin> {
  const pins = catalog.registryPins();
  const selected = new Set<string>([...target.packIds, ...target.hooks, ...selectedSkills]);
  for (const packId of target.packIds) {
    for (const skill of catalog.getPack(packId)?.skills ?? []) selected.add(skill);
  }
  return Object.fromEntries(Object.entries(pins).filter(([id]) => selected.has(id)));
}

type ToolPolicyDocument = { version: number; rules: ToolPolicyRule[] };

function parseToolPolicyDocument(text: string): ToolPolicyDocument | undefined {
  try {
    const value = JSON.parse(text) as { version?: unknown; rules?: unknown };
    if (typeof value.version !== "number" || !Array.isArray(value.rules)) return undefined;
    if (!value.rules.every((rule) => rule && typeof rule === "object" && typeof (rule as { id?: unknown }).id === "string")) {
      return undefined;
    }
    return { version: value.version, rules: value.rules as ToolPolicyRule[] };
  } catch {
    return undefined;
  }
}

async function carryLearnedToolPolicyRules(input: {
  targetDir: string;
  oldPlan: RenderPlan;
  newPlan: RenderPlan;
  oldPack: ResolvedPack;
  newPack: ResolvedPack;
}): Promise<string[]> {
  const path = ".farrier/hooks/tool-policy-rules.json";
  const oldFile = input.oldPlan.files.find((file) => file.path === path);
  const newFile = input.newPlan.files.find((file) => file.path === path);
  const current = await currentText(input.targetDir, path);
  if (!oldFile || !newFile || current === undefined || current === oldFile.content) return [];
  const oldDocument = parseToolPolicyDocument(oldFile.content);
  const newDocument = parseToolPolicyDocument(newFile.content);
  const currentDocument = parseToolPolicyDocument(current);
  if (!oldDocument || !newDocument || !currentDocument) {
    throw new Error(`Cannot safely migrate ${path}: current or generated rules are malformed.`);
  }
  const packRuleIds = (pack: ResolvedPack) => [
    ...pack.toolPolicyRules,
    ...pack.ruleBlocks.flatMap((block) => block.toolPolicyRules ?? []),
  ].map((rule) => rule.id);
  const oldIds = new Set([...packRuleIds(input.oldPack), ...oldDocument.rules.map((rule) => rule.id)]);
  const newIds = new Set([...packRuleIds(input.newPack), ...newDocument.rules.map((rule) => rule.id)]);
  const carried = currentDocument.rules.filter((rule) => !oldIds.has(rule.id) && !newIds.has(rule.id));
  if (carried.length === 0) return [];
  newFile.content = `${JSON.stringify({
    version: newDocument.version,
    rules: [...newDocument.rules, ...carried],
  }, null, 2)}\n`;
  return [`Carried ${carried.length} learned tool-policy rule(s): ${carried.map((rule) => rule.id).join(", ")}.`];
}

async function currentText(targetDir: string, path: string): Promise<string | undefined> {
  try {
    return await readFile(join(targetDir, path), "utf8");
  } catch {
    return undefined;
  }
}

async function obsoleteOperations(input: {
  targetDir: string;
  oldPlan: RenderPlan;
  newPlan: RenderPlan;
}): Promise<{
  operations: Array<{ kind: "remove-file"; path: string }>;
  changes: StackMigrationChange[];
  blockers: StackMigrationBlocker[];
}> {
  const nextPaths = new Set(input.newPlan.files.map((file) => file.path));
  const operations: Array<{ kind: "remove-file"; path: string }> = [];
  const changes: StackMigrationChange[] = [];
  const blockers: StackMigrationBlocker[] = [];

  for (const oldFile of input.oldPlan.files.filter((file) => !nextPaths.has(file.path))) {
    const absolute = join(input.targetDir, oldFile.path);
    const info = await lstat(absolute).catch(() => undefined);
    if (!info) continue;
    const previous = info.isFile() ? await currentText(input.targetDir, oldFile.path) : undefined;
    if (info.isFile() && previous === oldFile.content) {
      operations.push({ kind: "remove-file", path: oldFile.path });
      changes.push({
        path: oldFile.path,
        content: "",
        previousContent: previous,
        action: "remove",
        purpose: "Retires a generated file from the old stack pack.",
        reason: "The target pack no longer emits this byte-exact generated file.",
        requiresForce: true,
      });
      continue;
    }
    const reason = info.isFile()
      ? "Old-pack path has local edits and cannot be pruned automatically."
      : "Old-pack path is not a regular file and cannot be pruned automatically.";
    blockers.push({ path: oldFile.path, reason });
    changes.push({
      path: oldFile.path,
      content: previous ?? "",
      ...(previous !== undefined ? { previousContent: previous } : {}),
      action: "blocked",
      purpose: "Old-stack path requires manual review.",
      reason,
      requiresForce: false,
    });
  }
  return { operations, changes, blockers };
}

async function exactPreviousContent(
  targetDir: string,
  path: string,
  expected: PathFingerprint,
): Promise<string | undefined> {
  if (expected.kind === "absent") return undefined;
  if (expected.kind !== "file") throw new Error(`${path} is not a regular file and cannot enter a byte review`);
  const content = await readFile(join(targetDir, path));
  if (hash(content) !== expected.sha256) throw new Error(`${path} changed while the migration review was built`);
  const text = content.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(content)) throw new Error(`${path} is not UTF-8 text and cannot enter an exact text review`);
  return text;
}

function writeAction(input: {
  path: string;
  content: string;
  previous?: string;
  expected: PathFingerprint;
  mode?: number;
}): StackMigrationAction {
  if (input.expected.kind === "absent") return "create";
  if (input.expected.kind !== "file") return "blocked";
  const sameContent = input.expected.sha256 === hash(input.content);
  const sameMode = input.mode === undefined || input.expected.mode === input.mode;
  if (sameContent && sameMode) return "unchanged";
  if (sameContent) return "update";
  if (input.path === ".gitignore" && input.previous !== undefined && input.content.startsWith(input.previous)) {
    return "merge";
  }
  return "replace";
}

async function renderedChanges(input: {
  targetDir: string;
  renderPlan: RenderPlan;
  mutationPlan: MutationPlan;
  targetPack: ResolvedPack;
  skillCount: number;
}): Promise<{ changes: StackMigrationChange[]; blockers: StackMigrationBlocker[] }> {
  const rendered = new Map(input.renderPlan.files.map((file) => [file.path, file]));
  const changes: StackMigrationChange[] = [];
  const blockers: StackMigrationBlocker[] = [];
  const purposeContext = {
    hookCount: input.targetPack.hooks.length,
    skillCount: input.skillCount,
    ruleCount: input.renderPlan.rules?.agentsRules.length,
    packId: input.targetPack.id,
    verbs: input.renderPlan.verbs?.verbs,
  };

  for (const operation of input.mutationPlan.operations) {
    if (operation.kind !== "write-file") continue;
    const file = rendered.get(operation.path) as RenderedFile | undefined;
    if (!file || typeof operation.content !== "string") continue;
    let previous: string | undefined;
    try {
      previous = await exactPreviousContent(input.targetDir, operation.path, operation.expected);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      blockers.push({ path: operation.path, reason });
      changes.push({
        path: operation.path,
        content: "",
        action: "blocked",
        purpose: filePurpose(operation.path, purposeContext),
        reason,
        requiresForce: false,
      });
      continue;
    }
    const action = writeAction({
      path: operation.path,
      content: operation.content,
      previous,
      expected: operation.expected,
      mode: operation.mode,
    });
    changes.push({
      path: operation.path,
      content: operation.content,
      ...(previous !== undefined ? { previousContent: previous } : {}),
      action,
      purpose: filePurpose(operation.path, purposeContext),
      reason: action === "unchanged" ? "Existing bytes already match." : "Reviewed stack migration output.",
      requiresForce: action === "replace",
    });
  }
  return { changes, blockers };
}

async function installedSkillBlockers(input: {
  targetDir: string;
  removedRefs: SkillRef[];
  manifest: Awaited<ReturnType<typeof readManifest>>;
}): Promise<{ changes: StackMigrationChange[]; blockers: StackMigrationBlocker[] }> {
  const removedNames = new Set(input.removedRefs.map(skillName).filter((name): name is string => Boolean(name)));
  if (removedNames.size === 0) return { changes: [], blockers: [] };
  const inventory = await inventoryProjectSkills({ targetDir: input.targetDir, manifest: input.manifest });
  const changes: StackMigrationChange[] = [];
  const blockers: StackMigrationBlocker[] = [];
  for (const entry of inventory.entries.filter((candidate) => removedNames.has(candidate.name))) {
    for (const location of entry.locations) {
      const reason = `Installed old-pack skill '${entry.name}' must be removed with the skills workflow before migration.`;
      blockers.push({ path: location.path, reason });
      changes.push({
        path: location.path,
        content: "",
        action: "blocked",
        purpose: "Active skill from the old stack pack.",
        reason,
        requiresForce: false,
      });
    }
  }
  return { changes, blockers };
}

async function staleLockNote(targetDir: string, removedRefs: SkillRef[]): Promise<string[]> {
  const names = new Set(removedRefs.map(skillName).filter((name): name is string => Boolean(name)));
  try {
    const parsed = JSON.parse(await readFile(join(targetDir, "skills-lock.json"), "utf8")) as {
      skills?: Record<string, unknown>;
    };
    const retained = Object.keys(parsed.skills ?? {}).filter((name) => names.has(name)).sort();
    return retained.length === 0
      ? []
      : [`skills-lock.json retains old-pack metadata for: ${retained.join(", ")}. This migration does not rewrite the external skills CLI lock.`];
  } catch {
    return [];
  }
}

export async function createStackMigrationPlan(input: StackMigrationInput): Promise<StackMigrationPlan> {
  const catalog = input.catalog ?? builtinCatalog();
  const report = await createUpdateReport({ targetDir: input.targetDir, catalog });
  const targetPackId = report.stackDrift.suggestedPackId;
  if (!report.stackDrift.hasDrift || !targetPackId) throw new Error("No deterministic stack drift is available to migrate.");
  const detected = await detectPacksWithEvidenceInputs(input.targetDir, catalog);
  if (detected[0]?.packId !== targetPackId) {
    throw new Error("Detected stack changed while the migration review was built; retry.");
  }
  const detectionEvidencePaths = detected[0].evidencePaths;

  const manifest = await readManifest({ targetDir: input.targetDir, catalog });
  const agents = input.agents ? normalizeAgents(input.agents) : manifest.agents;
  const currentDefaults = catalog.resolvePack(manifest.currentPackId);
  const currentPack = packForManifest(manifest, catalog);
  const targetPack = targetPackWithPreservedHooks({
    currentPack,
    currentDefaults,
    targetPack: catalog.resolvePack(targetPackId),
    catalog,
  });
  const oldDefaults = new Set(currentDefaults.skills);
  const preservedSkills = manifest.skills.filter((skill) => !oldDefaults.has(skill));
  const selectedSkills = unique([...targetPack.skills, ...preservedSkills]);
  const removedDefaultSkills = manifest.skills.filter((skill) => oldDefaults.has(skill) && !selectedSkills.includes(skill));
  const renderOptions = {
    targetDir: input.targetDir,
    learnEnabled: manifest.learn.enabled,
    advisors: manifest.advisors,
    secondaryAcknowledged: manifest.secondaryAcknowledged,
    existingManifest: manifestToInput(manifest),
    agents,
  };
  const [oldPlan, newPlan] = await Promise.all([
    createRenderPlan({ ...renderOptions, pack: currentPack, skills: manifest.skills, registryPins: manifest.registry.items }),
    createRenderPlan({
      ...renderOptions,
      pack: targetPack,
      skills: selectedSkills,
      registryPins: registryPinsForTarget(catalog, targetPack, selectedSkills),
    }),
  ]);
  const policyNotes = await carryLearnedToolPolicyRules({
    targetDir: input.targetDir,
    oldPlan,
    newPlan,
    oldPack: currentDefaults,
    newPack: targetPack,
  });
  const obsolete = await obsoleteOperations({ targetDir: input.targetDir, oldPlan, newPlan });
  const operations = [
    ...newPlan.files.map((file) => ({ kind: "write-file" as const, path: file.path, content: file.content, mode: file.mode })),
    ...obsolete.operations,
  ];
  const mutationPlan = await inspectMutationPlan(input.targetDir, operations, detectionEvidencePaths);
  const rendered = await renderedChanges({
    targetDir: input.targetDir,
    renderPlan: newPlan,
    mutationPlan,
    targetPack,
    skillCount: selectedSkills.length,
  });
  const skills = await installedSkillBlockers({ targetDir: input.targetDir, removedRefs: removedDefaultSkills, manifest });
  const notes = [...policyNotes, ...await staleLockNote(input.targetDir, removedDefaultSkills)];
  return {
    targetDir: input.targetDir,
    currentPackId: manifest.currentPackId,
    targetPackId,
    agents,
    changes: [...rendered.changes, ...obsolete.changes, ...skills.changes],
    blockers: [...rendered.blockers, ...obsolete.blockers, ...skills.blockers],
    mutationPlan,
    removedDefaultSkills,
    preservedSkills,
    detectionEvidencePaths,
    notes,
  };
}

export async function applyStackMigrationPlan(
  plan: StackMigrationPlan,
  input: { catalog?: PackCatalog; transaction?: MutationApplyDeps } = {},
): Promise<StackMigrationResult> {
  if (plan.blockers.length > 0) throw new Error("Stack migration is blocked; resolve every reviewed blocker before applying.");
  const catalog = input.catalog ?? builtinCatalog();
  const manifest = await readManifest({ targetDir: plan.targetDir, catalog });
  if (manifest.currentPackId !== plan.currentPackId) throw new Error("Manifest pack changed after review; rebuild the migration plan.");
  const detected = await detectPacks(plan.targetDir, catalog);
  if (detected[0] !== plan.targetPackId) throw new Error("Detected stack changed after review; rebuild the migration plan.");
  const transaction = await applyMutationPlan(plan.mutationPlan, input.transaction);
  const report = await createUpdateReport({ targetDir: plan.targetDir, catalog });
  return { transaction, report };
}
