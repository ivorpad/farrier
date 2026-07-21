import { readFile, readdir, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { detectPacks, detectSecondary } from "./detect";
import {
  createRenderPlan,
  getFarrierVersion,
  hookCatalogVersions,
  hooksDirectory,
  type RenderedFile
} from "./render";
import { classifyStalePaths, type StalePathReport } from "./update-migration";
import type { HookId, PackHookRef, ResolvedPack, SecondaryDetectionFinding, SkillRef } from "../packs/types";
import { builtinCatalog, type PackCatalog, type RegistryPin } from "../registry/catalog";
import type { EnforcementAgent } from "./agent-selection";
import {
  manifestToInput,
  readManifest,
  type NormalizedManifest
} from "./manifest";
import { applyMutationPlan, fingerprintPath, inspectMutationPlan, type MutationOperation, type PathFingerprint } from "./mutation-transaction";
import { extractRepoMapSection, spliceRepoMapSection, stripRepoMapSection } from "./repo-map";

export {
  notFarrierProjectMessage,
  readManifest,
  type NormalizedManifest
} from "./manifest";

export type InventoryOwnership = "farrier-owned" | "user-mutable" | "manifest";

export type UpdateInput = {
  targetDir: string;
  catalog?: PackCatalog;
};

export type UpdateApplyDeps = {
  beforeTransaction?: () => void | Promise<void>;
};

export type FarrierVersionDrift = {
  manifest: string | null;
  current: string;
  needsUpdate: boolean;
};

export type StackDriftReport = {
  currentPackId: string;
  detectedPackIds: string[];
  hasDrift: boolean;
  suggestedPackId: string | null;
  message: string;
};

export type HookDrift = {
  hookId: PackHookRef;
  manifestVersion: number | null;
  currentVersion: number;
};

export type RegistryPinDrift = {
  id: string;
  type: RegistryPin["type"];
  manifestVersion: string | null;
  currentVersion: string;
  manifestSha256: string | null;
  currentSha256: string;
};

export type UpdateReport = {
  targetDir: string;
  manifestPath: string;
  currentPackId: string;
  currentPackIds: string[];
  agents: EnforcementAgent[];
  farrierVersion: FarrierVersionDrift;
  stackDrift: StackDriftReport;
  unacknowledgedSecondaryFindings: SecondaryDetectionFinding[];
  hookDrift: HookDrift[];
  registryPinDrift: RegistryPinDrift[];
  missingInventoryFiles: string[];
  outdatedOwnedFiles: string[];
  outdatedUserFiles: string[];
  /** Legacy generated files/trees that apply will remove (backups kept). */
  stalePaths: string[];
  /** Legacy paths with local edits; never removed automatically. */
  staleBlockedPaths: string[];
  /** User-mutable files whose content is exactly legacy-generated; apply rewrites them. */
  migratableUserFiles: string[];
  suggestedSkills: SkillRef[];
  notes: string[];
};

export type UpdateApplyResult = {
  report: UpdateReport;
  repairedFiles: string[];
  prunedPaths: string[];
  acknowledgedSecondaryIds: string[];
  suggestedSkillsNotInstalled: SkillRef[];
};

const userMutableFiles = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "justfile",
  "konsistent.json",
  "konpy.json",
  ".gitignore",
  ".claude/settings.json",
  ".codex/hooks.json",
  `${hooksDirectory}/tool-policy-rules.json`
]);

const hookIds = Object.keys(hookCatalogVersions) as HookId[];
const hookIdSet = new Set<string>(hookIds);

function targetDirFromInput(input: UpdateInput | string): string {
  return typeof input === "string" ? input : input.targetDir;
}

function isHookId(value: string): value is HookId {
  return hookIdSet.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function judgeConfigEnabled(judge: unknown): boolean {
  if (!isRecord(judge)) {
    return false;
  }

  return (
    (isRecord(judge.perEdit) && judge.perEdit.enabled === true) ||
    (isRecord(judge.stop) && judge.stop.enabled === true)
  );
}

/**
 * v2 manifests listed the judge hooks by default while the judge config
 * shipped disabled. Disabled judges now emit zero files, so migration drops
 * them from the hook set unless the user actually enabled a judge.
 */
function migratedHookIds(manifest: NormalizedManifest): PackHookRef[] {
  if (judgeConfigEnabled(manifest.judge)) {
    return [...manifest.hookIds];
  }

  return manifest.hookIds.filter((hookId) => hookId !== "quality-judge" && hookId !== "stop-judge");
}

function packForManifest(manifest: NormalizedManifest, catalog: PackCatalog): ResolvedPack {
  const pack = catalog.resolvePack(manifest.currentPackId);

  return {
    ...pack,
    hooks: migratedHookIds(manifest)
  };
}

function stackDriftMessage(currentPackId: string, detectedPackIds: string[]): string {
  if (detectedPackIds.length === 0) {
    return "No stack detected; keeping current manifest pack.";
  }

  if (detectedPackIds[0] === currentPackId) {
    return `Detected stack matches current manifest pack '${currentPackId}'.`;
  }

  return `Detected '${detectedPackIds[0]}' but manifest uses '${currentPackId}'. Update will not switch packs automatically.`;
}

function hookDriftForManifestWithCatalog(manifest: NormalizedManifest, catalog: PackCatalog): HookDrift[] {
  const drift: HookDrift[] = [];

  for (const hookId of manifest.hookIds) {
    const currentVersion = isHookId(hookId)
      ? hookCatalogVersions[hookId]
      : catalog.remoteHook(hookId)?.hookVersion;

    if (currentVersion === undefined) {
      continue;
    }

    const manifestVersion = manifest.versions.hooks[hookId] ?? null;

    if (manifestVersion === null || manifestVersion < currentVersion) {
      drift.push({
        hookId,
        manifestVersion,
        currentVersion
      });
    }
  }

  return drift;
}

function registryPinsForManifest(manifest: NormalizedManifest, catalog: PackCatalog): Record<string, RegistryPin> {
  const currentPins = catalog.registryPins();
  return Object.fromEntries(
    Object.keys(manifest.registry.items)
      .map((id) => [id, currentPins[id]])
      .filter((entry): entry is [string, RegistryPin] => entry[1] !== undefined)
  );
}

function registryPinDriftForManifest(manifest: NormalizedManifest, catalog: PackCatalog): RegistryPinDrift[] {
  const currentPins = catalog.latestRegistryPins?.() ?? catalog.registryPins();
  const drift: RegistryPinDrift[] = [];

  for (const [id, manifestPin] of Object.entries(manifest.registry.items)) {
    const currentPin = currentPins[id];
    if (!currentPin) {
      continue;
    }

    if (manifestPin.version !== currentPin.version || manifestPin.sha256 !== currentPin.sha256) {
      drift.push({
        id,
        type: currentPin.type,
        manifestVersion: manifestPin.version,
        currentVersion: currentPin.version,
        manifestSha256: manifestPin.sha256,
        currentSha256: currentPin.sha256
      });
    }
  }

  return drift;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function suggestedSkillsFromFindings(findings: SecondaryDetectionFinding[]): SkillRef[] {
  return unique(findings.flatMap((finding) => finding.suggestSkills));
}

function hooksTreeOwnership(path: string, hooksRoot: string): InventoryOwnership | undefined {
  const prefix = `${hooksRoot}/`;

  if (!path.startsWith(prefix)) {
    return undefined;
  }

  if (path === `${prefix}tool-policy-rules.json`) {
    return "user-mutable";
  }

  if (path.startsWith(`${prefix}prompts/`) && path.endsWith(".txt")) {
    return "farrier-owned";
  }

  if (path.startsWith(`${prefix}@`)) {
    return "farrier-owned";
  }

  const relative = path.slice(prefix.length);
  if (!relative.includes("/") && relative.endsWith(".py")) {
    return "farrier-owned";
  }

  return undefined;
}

export function inventoryOwnership(path: string): InventoryOwnership {
  if (path === ".farrier.json") {
    return "manifest";
  }

  if (
    path.startsWith(".claude/skills/harness-advisor/") ||
    path.startsWith(".claude/skills/claude-automation-recommender/") ||
    path.startsWith(".agents/skills/codex-automation-recommender/") ||
    path.startsWith(".agents/skills/farrier-project-advisor/")
  ) {
    return "farrier-owned";
  }

  // Current provider-neutral location plus the pre-v3 layout, so migration can
  // classify files it is about to prune.
  const owned = hooksTreeOwnership(path, hooksDirectory) ?? hooksTreeOwnership(path, ".claude/hooks");
  if (owned) {
    return owned;
  }

  if (userMutableFiles.has(path)) {
    return "user-mutable";
  }

  return "user-mutable";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function modeMatches(path: string, mode: number | undefined): Promise<boolean> {
  if (mode === undefined) {
    return true;
  }

  try {
    const info = await stat(path);
    return (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

async function classifyInventoryDrift(
  targetDir: string,
  files: RenderedFile[]
): Promise<{
  missingInventoryFiles: string[];
  outdatedOwnedFiles: string[];
  outdatedUserFiles: string[];
}> {
  const missingInventoryFiles: string[] = [];
  const outdatedOwnedFiles: string[] = [];
  const outdatedUserFiles: string[] = [];

  for (const file of files) {
    if (file.path === ".farrier.json") {
      continue;
    }

    const absolutePath = join(targetDir, file.path);

    if (!(await fileExists(absolutePath))) {
      missingInventoryFiles.push(file.path);
      continue;
    }

    let current: string | null;
    try {
      current = await readFile(absolutePath, "utf8");
    } catch {
      current = null;
    }
    const contentMatches = current === file.content;
    const executableMatches = await modeMatches(absolutePath, file.mode);

    if (contentMatches && executableMatches) {
      continue;
    }

    if (inventoryOwnership(file.path) === "farrier-owned") {
      outdatedOwnedFiles.push(file.path);
    } else if (
      current !== null &&
      executableMatches &&
      stripRepoMapSection(current) === stripRepoMapSection(file.content)
    ) {
      // Only a generated marked region (the repository map) is stale; every
      // user-editable byte is identical, so rewriting is safe. Files without
      // a marked region can never take this branch: strip is the identity for
      // them, and plain equality already passed above.
      outdatedOwnedFiles.push(file.path);
    } else {
      outdatedUserFiles.push(file.path);
    }
  }

  return {
    missingInventoryFiles,
    outdatedOwnedFiles,
    outdatedUserFiles
  };
}

function reportNotes(input: {
  stackDrift: StackDriftReport;
  unacknowledgedSecondaryFindings: SecondaryDetectionFinding[];
  hookDrift: HookDrift[];
  registryPinDrift: RegistryPinDrift[];
  missingInventoryFiles: string[];
  outdatedOwnedFiles: string[];
  outdatedUserFiles: string[];
  suggestedSkills: SkillRef[];
}): string[] {
  const notes: string[] = [];

  if (input.stackDrift.hasDrift) {
    notes.push("Stack drift is report-only; update mode will not switch manifest packs automatically.");
  }

  if (input.unacknowledgedSecondaryFindings.length > 0) {
    notes.push("Run update with --yes to acknowledge secondary detector findings in .farrier.json.");
  }

  if (input.hookDrift.length > 0) {
    notes.push("Hook catalog versions differ from manifest metadata; update with --yes refreshes manifest metadata.");
  }

  if (input.registryPinDrift.length > 0) {
    notes.push("Registry item pins differ from the current registry catalog; update with --yes refreshes registry pins.");
  }

  if (input.missingInventoryFiles.length > 0 || input.outdatedOwnedFiles.length > 0) {
    notes.push("Run update with --yes to repair missing files and outdated Farrier-owned files.");
  }

  if (input.outdatedUserFiles.length > 0) {
    notes.push("Manual review required for outdated user-mutable files; update mode will not overwrite them.");
  }

  if (input.outdatedUserFiles.includes("AGENTS.md")) {
    notes.push(
      "AGENTS.md has user edits; update with --yes still refreshes only its generated repository-map region and leaves everything else untouched."
    );
  }

  if (input.suggestedSkills.length > 0) {
    notes.push("Suggested skills are not installed by update mode; install them explicitly if desired.");
  }

  return notes;
}

export async function createUpdateReport(input: UpdateInput | string): Promise<UpdateReport> {
  const targetDir = targetDirFromInput(input);
  const catalog = typeof input === "string" ? builtinCatalog() : input.catalog ?? builtinCatalog();
  const manifest = await readManifest({ targetDir, catalog });
  const currentFarrierVersion = await getFarrierVersion();
  const currentPack = catalog.resolvePack(manifest.currentPackId);
  const renderPack = packForManifest(manifest, catalog);

  const detectedPackIds = await detectPacks(targetDir, catalog);
  const stackDrift: StackDriftReport = {
    currentPackId: manifest.currentPackId,
    detectedPackIds,
    hasDrift: detectedPackIds.length > 0 && detectedPackIds[0] !== manifest.currentPackId,
    suggestedPackId: detectedPackIds[0] ?? null,
    message: stackDriftMessage(manifest.currentPackId, detectedPackIds)
  };

  const secondaryFindings = await detectSecondary(targetDir, currentPack);
  const acknowledged = new Set(manifest.secondaryAcknowledged);
  const unacknowledgedSecondaryFindings = secondaryFindings.filter((finding) => !acknowledged.has(finding.id));
  const suggestedSkills = suggestedSkillsFromFindings(unacknowledgedSecondaryFindings);
  const hookDrift = hookDriftForManifestWithCatalog(manifest, catalog);
  const registryPinDrift = registryPinDriftForManifest(manifest, catalog);

  const expectedPlan = await createRenderPlan({
    targetDir,
    pack: renderPack,
    skills: manifest.skills,
    learnEnabled: manifest.learn.enabled,
    secondaryAcknowledged: manifest.secondaryAcknowledged,
    existingManifest: manifestToInput(manifest),
    agents: manifest.agents,
    registryPins: registryPinsForManifest(manifest, catalog)
  });

  const inventoryDrift = await classifyInventoryDrift(targetDir, expectedPlan.files);
  const stale = await classifyStalePaths({
    targetDir,
    planFiles: expectedPlan.files,
    pack: renderPack,
    legacyPack: { ...renderPack, hooks: [...manifest.hookIds] }
  });
  const outdatedUserFiles = inventoryDrift.outdatedUserFiles.filter(
    (path) => !stale.repairUserFiles.includes(path) && !stale.pruneFiles.includes(path)
  );

  const farrierVersion: FarrierVersionDrift = {
    manifest: manifest.farrierVersion,
    current: currentFarrierVersion,
    needsUpdate: manifest.farrierVersion !== currentFarrierVersion
  };

  const notes = reportNotes({
    stackDrift,
    unacknowledgedSecondaryFindings,
    hookDrift,
    registryPinDrift,
    missingInventoryFiles: inventoryDrift.missingInventoryFiles,
    outdatedOwnedFiles: inventoryDrift.outdatedOwnedFiles,
    outdatedUserFiles,
    suggestedSkills
  });
  if (stale.pruneFiles.length > 0 || stale.pruneTrees.length > 0) {
    notes.push("Stale legacy files from an earlier layout were found; update with --yes removes them and keeps backups.");
  }
  if (stale.blockedPaths.length > 0) {
    notes.push("Some legacy paths have local edits and were left in place; review them manually.");
  }
  notes.push(...stale.notes);
  notes.push(...catalog.warnings.map((warning) => `${warning.namespace}: ${warning.message}`));

  return {
    targetDir,
    manifestPath: join(targetDir, ".farrier.json"),
    currentPackId: manifest.currentPackId,
    currentPackIds: [...manifest.packIds],
    agents: [...manifest.agents],
    farrierVersion,
    stackDrift,
    unacknowledgedSecondaryFindings,
    hookDrift,
    registryPinDrift,
    missingInventoryFiles: inventoryDrift.missingInventoryFiles,
    outdatedOwnedFiles: inventoryDrift.outdatedOwnedFiles,
    outdatedUserFiles,
    stalePaths: [...stale.pruneFiles, ...stale.pruneTrees],
    staleBlockedPaths: stale.blockedPaths,
    migratableUserFiles: stale.repairUserFiles,
    suggestedSkills,
    notes
  };
}

async function manifestContentDiffers(targetDir: string, expectedManifestContent: string): Promise<boolean> {
  try {
    const current = await readFile(join(targetDir, ".farrier.json"), "utf8");
    return current !== expectedManifestContent;
  } catch {
    return true;
  }
}

async function removeEmptyDirectories(targetDir: string, roots: string[]): Promise<void> {
  const removeEmpty = async (path: string): Promise<boolean> => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return false;
    }

    let empty = true;
    for (const entry of entries) {
      if (entry.isDirectory() && (await removeEmpty(join(path, entry.name)))) {
        continue;
      }
      empty = false;
    }

    if (!empty) {
      return false;
    }

    try {
      await rmdir(path);
      return true;
    } catch {
      return false;
    }
  };

  for (const root of roots) {
    await removeEmpty(join(targetDir, root));
  }
}

/**
 * A write that refreshes only the marked repository-map region of AGENTS.md,
 * preserving every byte outside the markers. Null when AGENTS.md is unreadable,
 * the plan carries no AGENTS.md, or the region is already current.
 */
async function spliceAgentsMapOperation(
  targetDir: string,
  planFiles: readonly RenderedFile[]
): Promise<MutationOperation | null> {
  const planAgents = planFiles.find((file) => file.path === "AGENTS.md");
  if (!planAgents) {
    return null;
  }

  let current: string;
  try {
    current = await readFile(join(targetDir, "AGENTS.md"), "utf8");
  } catch {
    return null;
  }

  const section = extractRepoMapSection(planAgents.content);
  const spliced = section === null ? stripRepoMapSection(current) : spliceRepoMapSection(current, section);
  if (spliced === current) {
    return null;
  }

  return { kind: "write-file", path: "AGENTS.md", content: spliced, mode: planAgents.mode };
}

export async function applyUpdate(input: UpdateInput | string, deps: UpdateApplyDeps = {}): Promise<UpdateApplyResult> {
  const targetDir = targetDirFromInput(input);
  const catalog = typeof input === "string" ? builtinCatalog() : input.catalog ?? builtinCatalog();
  const report = await createUpdateReport({ targetDir, catalog });
  const reviewedFingerprints = new Map<string, PathFingerprint>();
  const initiallyRepairable = new Set([
    ...report.missingInventoryFiles,
    ...report.outdatedOwnedFiles,
    ...report.migratableUserFiles,
    ...report.stalePaths,
    ".farrier.json",
    // The repository-map region of AGENTS.md may be refreshed in place even
    // when the surrounding prose has user edits.
    "AGENTS.md"
  ]);
  await Promise.all([...initiallyRepairable].map(async (path) => {
    reviewedFingerprints.set(path, await fingerprintPath(join(targetDir, path)));
  }));
  const manifest = await readManifest({ targetDir, catalog });
  const acknowledgedSecondaryIds = report.unacknowledgedSecondaryFindings.map((finding) => finding.id);
  const secondaryAcknowledged = unique([...manifest.secondaryAcknowledged, ...acknowledgedSecondaryIds]);

  const renderPack = packForManifest(manifest, catalog);
  const plan = await createRenderPlan({
    targetDir,
    pack: renderPack,
    skills: manifest.skills,
    learnEnabled: manifest.learn.enabled,
    secondaryAcknowledged,
    existingManifest: manifestToInput({
      ...manifest,
      secondaryAcknowledged
    }),
    agents: manifest.agents,
    registryPins: registryPinsForManifest(manifest, catalog)
  });
  const stale = await classifyStalePaths({
    targetDir,
    planFiles: plan.files,
    pack: renderPack,
    legacyPack: { ...renderPack, hooks: [...manifest.hookIds] }
  });

  const repairPaths = new Set<string>([
    ...report.missingInventoryFiles,
    ...report.outdatedOwnedFiles,
    ...stale.repairUserFiles
  ]);

  const manifestFile = plan.files.find((file) => file.path === ".farrier.json");
  if (!manifestFile) {
    throw new Error("render plan did not include .farrier.json");
  }

  if (await manifestContentDiffers(targetDir, manifestFile.content)) {
    repairPaths.add(".farrier.json");
  }

  const override = stale.toolPolicyRulesOverride;
  if (override) {
    repairPaths.add(override.path);
  }

  // The repository-map region of AGENTS.md is farrier-owned even when the
  // surrounding prose has user edits, so it is refreshed by splicing into the
  // current file rather than overwriting with plan content. Whole-file writes
  // still apply when the file is missing or is a byte-exact legacy render.
  const agentsMapOperation =
    stale.repairUserFiles.includes("AGENTS.md") || report.missingInventoryFiles.includes("AGENTS.md")
      ? null
      : await spliceAgentsMapOperation(targetDir, plan.files);

  const pruneSet = new Set([...stale.pruneFiles, ...stale.pruneTrees]);
  const operations: MutationOperation[] = [
    ...plan.files
      .filter((file) => repairPaths.has(file.path) && !(file.path === "AGENTS.md" && agentsMapOperation))
      .map((file): MutationOperation => ({
        kind: "write-file",
        path: file.path,
        content: override && file.path === override.path ? override.content : file.content,
        mode: file.mode
      })),
    ...(agentsMapOperation ? [agentsMapOperation] : []),
    ...stale.pruneFiles.map((path): MutationOperation => ({ kind: "remove-file", path })),
    ...stale.pruneTrees.map((path): MutationOperation => ({ kind: "remove-tree", path }))
  ];
  const mutationPlan = await inspectMutationPlan(targetDir, operations);
  for (const operation of mutationPlan.operations) {
    const expected = reviewedFingerprints.get(operation.path);
    if (expected) operation.expected = expected;
  }
  await deps.beforeTransaction?.();
  const transaction = await applyMutationPlan(mutationPlan);
  const repairedFiles = transaction.written.filter((path) => !pruneSet.has(path));
  const prunedPaths = transaction.written.filter((path) => pruneSet.has(path));

  if (prunedPaths.length > 0) {
    await removeEmptyDirectories(targetDir, [".claude", ".agents"]);
  }

  return {
    report,
    repairedFiles,
    prunedPaths,
    acknowledgedSecondaryIds,
    suggestedSkillsNotInstalled: [...report.suggestedSkills]
  };
}

function renderList(values: string[], empty: string): string[] {
  if (values.length === 0) {
    return [`  ${empty}`];
  }

  return values.map((value) => `  - ${value}`);
}

function shortSha(value: string | null): string {
  return value ? value.slice(0, 12) : "(missing)";
}

export function formatUpdateReport(report: UpdateReport): string {
  const lines: string[] = [
    `Farrier update report for ${report.targetDir}`,
    "",
    `Current pack: ${report.currentPackId}`,
    `Pack lineage: ${report.currentPackIds.join(" -> ")}`,
    `Enforcement targets: ${report.agents.join(", ")}`,
    `Farrier version: ${report.farrierVersion.manifest ?? "(missing)"} -> ${report.farrierVersion.current}${
      report.farrierVersion.needsUpdate ? " (update needed)" : ""
    }`,
    "",
    "Stack drift:",
    `  ${report.stackDrift.message}`,
    "",
    "Unacknowledged secondary findings:",
    ...renderList(
      report.unacknowledgedSecondaryFindings.map((finding) => `${finding.id}: ${finding.description}`),
      "none"
    ),
    "",
    "Hook drift:",
    ...renderList(
      report.hookDrift.map(
        (drift) =>
          `${drift.hookId}: manifest ${drift.manifestVersion ?? "(missing)"} -> catalog ${drift.currentVersion}`
      ),
      "none"
    ),
    "",
    "Registry pin drift:",
    ...renderList(
      report.registryPinDrift.map(
        (drift) =>
          `${drift.id}: manifest ${drift.manifestVersion ?? "(missing)"} ${shortSha(drift.manifestSha256)} -> catalog ${drift.currentVersion} ${shortSha(drift.currentSha256)}`
      ),
      "none"
    ),
    "",
    "Missing inventory files:",
    ...renderList(report.missingInventoryFiles, "none"),
    "",
    "Outdated Farrier-owned files:",
    ...renderList(report.outdatedOwnedFiles, "none"),
    "",
    "Outdated user-mutable files (manual review only):",
    ...renderList(report.outdatedUserFiles, "none"),
    "",
    "Stale legacy files (removed by --yes, backups kept):",
    ...renderList(report.stalePaths, "none"),
    "",
    "Legacy files with local edits (manual review only):",
    ...renderList(report.staleBlockedPaths, "none"),
    "",
    "Legacy-generated files migrated in place by --yes:",
    ...renderList(report.migratableUserFiles, "none"),
    "",
    "Suggested skills (not installed):",
    ...renderList(report.suggestedSkills, "none")
  ];

  if (report.notes.length > 0) {
    lines.push("", "Notes:", ...renderList(report.notes, "none"));
  }

  return `${lines.join("\n")}\n`;
}

export function formatUpdateApplyResult(result: UpdateApplyResult): string {
  const lines = [
    formatUpdateReport(result.report).trimEnd(),
    "",
    "Applied repairs:",
    ...renderList(result.repairedFiles, "none"),
    "",
    "Pruned legacy paths:",
    ...renderList(result.prunedPaths, "none"),
    "",
    "Acknowledged secondary detector ids:",
    ...renderList(result.acknowledgedSecondaryIds, "none"),
    "",
    "Suggested skills not installed:",
    ...renderList(result.suggestedSkillsNotInstalled, "none")
  ];

  return `${lines.join("\n")}\n`;
}
