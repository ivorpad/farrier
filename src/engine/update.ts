import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { detectPacks, detectSecondary } from "./detect";
import {
  createRenderPlan,
  getFarrierVersion,
  hookCatalogVersions,
  type FarrierManifestInput,
  type RenderedFile
} from "./render";
import { resolvePack } from "../packs/index";
import type { HookId, PackHookRef, ResolvedPack, SecondaryDetectionFinding, SkillRef } from "../packs/types";

export const notFarrierProjectMessage = "not a farrier project; run farrier first";

export type InventoryOwnership = "farrier-owned" | "user-mutable" | "manifest";

export type UpdateInput = {
  targetDir: string;
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
  hookId: HookId;
  manifestVersion: number | null;
  currentVersion: number;
};

export type UpdateReport = {
  targetDir: string;
  manifestPath: string;
  currentPackId: string;
  currentPackIds: string[];
  farrierVersion: FarrierVersionDrift;
  stackDrift: StackDriftReport;
  unacknowledgedSecondaryFindings: SecondaryDetectionFinding[];
  hookDrift: HookDrift[];
  missingInventoryFiles: string[];
  outdatedOwnedFiles: string[];
  outdatedUserFiles: string[];
  suggestedSkills: SkillRef[];
  notes: string[];
};

export type UpdateApplyResult = {
  report: UpdateReport;
  repairedFiles: string[];
  acknowledgedSecondaryIds: string[];
  suggestedSkillsNotInstalled: SkillRef[];
};

export type NormalizedManifest = {
  farrierVersion: string | null;
  packIds: string[];
  currentPackId: string;
  hookIds: PackHookRef[];
  skills: SkillRef[];
  secondaryAcknowledged: string[];
  learn: {
    enabled: boolean;
  };
  judge?: unknown;
  quality?: unknown;
  versions: {
    farrierManifest: number | null;
    hooks: Record<string, number>;
    prompts?: unknown;
  };
};

const userMutableFiles = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "justfile",
  "konsistent.json",
  ".gitignore",
  ".claude/settings.json",
  ".claude/hooks/tool-policy-rules.json"
]);

const hookIds = Object.keys(hookCatalogVersions) as HookId[];
const hookIdSet = new Set<string>(hookIds);

function targetDirFromInput(input: UpdateInput | string): string {
  return typeof input === "string" ? input : input.targetDir;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  if (!value.every((item) => typeof item === "string")) {
    return undefined;
  }

  return [...value];
}

function requiredStringArray(value: unknown, field: string): string[] {
  const values = stringArray(value);

  if (!values || values.length === 0) {
    throw new Error(`invalid .farrier.json: ${field} must be a non-empty string array`);
  }

  return values;
}

function isHookId(value: string): value is HookId {
  return hookIdSet.has(value);
}

function parseHookIds(value: unknown, fallback: PackHookRef[]): PackHookRef[] {
  const values = value === undefined ? [...fallback] : stringArray(value);

  if (!values) {
    throw new Error("invalid .farrier.json: hookIds must be a string array");
  }

  const hookIds = values.filter(isHookId);
  if (hookIds.length !== values.length) {
    const invalid = values.find((hookId) => !isHookId(hookId));
    throw new Error(`invalid .farrier.json: unsupported hook id '${invalid}'`);
  }

  return hookIds;
}

function parseVersions(value: unknown): NormalizedManifest["versions"] {
  if (!isRecord(value)) {
    return {
      farrierManifest: null,
      hooks: {}
    };
  }

  const hooks: Record<string, number> = {};
  const rawHooks = value.hooks;

  if (isRecord(rawHooks)) {
    for (const [key, item] of Object.entries(rawHooks)) {
      if (typeof item === "number" && Number.isFinite(item)) {
        hooks[key] = item;
      }
    }
  }

  return {
    farrierManifest:
      typeof value.farrierManifest === "number" && Number.isFinite(value.farrierManifest)
        ? value.farrierManifest
        : null,
    hooks,
    prompts: value.prompts
  };
}

function parseLearn(value: unknown): { enabled: boolean } {
  if (!isRecord(value)) {
    return {
      enabled: false
    };
  }

  return {
    enabled: value.enabled === true
  };
}

function normalizeManifest(raw: unknown): NormalizedManifest {
  if (!isRecord(raw)) {
    throw new Error("invalid .farrier.json: root must be an object");
  }

  const packIds = requiredStringArray(raw.packIds, "packIds");
  const currentPackId = packIds[packIds.length - 1];

  if (!currentPackId) {
    throw new Error("invalid .farrier.json: packIds must be a non-empty string array");
  }

  const resolvedPack = resolvePack(currentPackId);
  const hookIds = parseHookIds(raw.hookIds, resolvedPack.hooks);
  const skills = stringArray(raw.skills) ?? [...resolvedPack.skills];
  const secondaryAcknowledged = stringArray(raw.secondaryAcknowledged) ?? [];

  return {
    farrierVersion: optionalString(raw.farrierVersion),
    packIds,
    currentPackId,
    hookIds,
    skills,
    secondaryAcknowledged,
    learn: parseLearn(raw.learn),
    judge: raw.judge,
    quality: raw.quality,
    versions: parseVersions(raw.versions)
  };
}

function toManifestInput(manifest: NormalizedManifest): FarrierManifestInput {
  return {
    farrierVersion: manifest.farrierVersion ?? undefined,
    packIds: [...manifest.packIds],
    hookIds: [...manifest.hookIds],
    skills: [...manifest.skills],
    secondaryAcknowledged: [...manifest.secondaryAcknowledged],
    learn: {
      enabled: manifest.learn.enabled
    },
    judge: manifest.judge,
    quality: manifest.quality,
    versions: {
      farrierManifest: manifest.versions.farrierManifest ?? undefined,
      hooks: { ...manifest.versions.hooks },
      prompts: manifest.versions.prompts
    }
  };
}

async function readProjectManifest(targetDir: string): Promise<NormalizedManifest> {
  const manifestPath = join(targetDir, ".farrier.json");

  let text: string;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new Error(notFarrierProjectMessage);
    }

    throw error;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid .farrier.json: ${message}`);
  }

  return normalizeManifest(raw);
}

export async function readManifest(input: UpdateInput | string): Promise<NormalizedManifest> {
  return readProjectManifest(targetDirFromInput(input));
}

function packForManifest(manifest: NormalizedManifest): ResolvedPack {
  const pack = resolvePack(manifest.currentPackId);

  return {
    ...pack,
    hooks: [...manifest.hookIds]
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

function hookDriftForManifest(manifest: NormalizedManifest): HookDrift[] {
  const drift: HookDrift[] = [];

  for (const hookId of manifest.hookIds) {
    if (!isHookId(hookId)) {
      continue;
    }

    const currentVersion = hookCatalogVersions[hookId];
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

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function suggestedSkillsFromFindings(findings: SecondaryDetectionFinding[]): SkillRef[] {
  return unique(findings.flatMap((finding) => finding.suggestSkills));
}

export function inventoryOwnership(path: string): InventoryOwnership {
  if (path === ".farrier.json") {
    return "manifest";
  }

  if (path === ".claude/skills/harness-advisor/SKILL.md") {
    return "farrier-owned";
  }

  if (path.startsWith(".claude/hooks/prompts/") && path.endsWith(".txt")) {
    return "farrier-owned";
  }

  if (path.startsWith(".claude/hooks/")) {
    const relative = path.slice(".claude/hooks/".length);
    if (!relative.includes("/") && relative.endsWith(".py")) {
      return "farrier-owned";
    }
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

async function fileContentMatches(path: string, expectedContent: string): Promise<boolean> {
  try {
    const current = await readFile(path, "utf8");
    return current === expectedContent;
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

    const contentMatches = await fileContentMatches(absolutePath, file.content);
    const executableMatches = await modeMatches(absolutePath, file.mode);

    if (contentMatches && executableMatches) {
      continue;
    }

    if (inventoryOwnership(file.path) === "farrier-owned") {
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

  if (input.missingInventoryFiles.length > 0 || input.outdatedOwnedFiles.length > 0) {
    notes.push("Run update with --yes to repair missing files and outdated Farrier-owned files.");
  }

  if (input.outdatedUserFiles.length > 0) {
    notes.push("Manual review required for outdated user-mutable files; update mode will not overwrite them.");
  }

  if (input.suggestedSkills.length > 0) {
    notes.push("Suggested skills are not installed by update mode; install them explicitly if desired.");
  }

  return notes;
}

export async function createUpdateReport(input: UpdateInput | string): Promise<UpdateReport> {
  const targetDir = targetDirFromInput(input);
  const manifest = await readProjectManifest(targetDir);
  const currentFarrierVersion = await getFarrierVersion();
  const currentPack = resolvePack(manifest.currentPackId);
  const renderPack = packForManifest(manifest);

  const detectedPackIds = await detectPacks(targetDir);
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
  const hookDrift = hookDriftForManifest(manifest);

  const expectedPlan = await createRenderPlan({
    targetDir,
    pack: renderPack,
    skills: manifest.skills,
    learnEnabled: manifest.learn.enabled,
    secondaryAcknowledged: manifest.secondaryAcknowledged,
    existingManifest: toManifestInput(manifest)
  });

  const inventoryDrift = await classifyInventoryDrift(targetDir, expectedPlan.files);

  const farrierVersion: FarrierVersionDrift = {
    manifest: manifest.farrierVersion,
    current: currentFarrierVersion,
    needsUpdate: manifest.farrierVersion !== currentFarrierVersion
  };

  const notes = reportNotes({
    stackDrift,
    unacknowledgedSecondaryFindings,
    hookDrift,
    missingInventoryFiles: inventoryDrift.missingInventoryFiles,
    outdatedOwnedFiles: inventoryDrift.outdatedOwnedFiles,
    outdatedUserFiles: inventoryDrift.outdatedUserFiles,
    suggestedSkills
  });

  return {
    targetDir,
    manifestPath: join(targetDir, ".farrier.json"),
    currentPackId: manifest.currentPackId,
    currentPackIds: [...manifest.packIds],
    farrierVersion,
    stackDrift,
    unacknowledgedSecondaryFindings,
    hookDrift,
    missingInventoryFiles: inventoryDrift.missingInventoryFiles,
    outdatedOwnedFiles: inventoryDrift.outdatedOwnedFiles,
    outdatedUserFiles: inventoryDrift.outdatedUserFiles,
    suggestedSkills,
    notes
  };
}

async function writeRenderedFile(targetDir: string, file: RenderedFile): Promise<void> {
  const absolutePath = join(targetDir, file.path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.content, "utf8");

  if (file.mode !== undefined) {
    await chmod(absolutePath, file.mode);
  }
}

async function manifestContentDiffers(targetDir: string, expectedManifestContent: string): Promise<boolean> {
  try {
    const current = await readFile(join(targetDir, ".farrier.json"), "utf8");
    return current !== expectedManifestContent;
  } catch {
    return true;
  }
}

export async function applyUpdate(input: UpdateInput | string): Promise<UpdateApplyResult> {
  const targetDir = targetDirFromInput(input);
  const report = await createUpdateReport({ targetDir });
  const manifest = await readProjectManifest(targetDir);
  const acknowledgedSecondaryIds = report.unacknowledgedSecondaryFindings.map((finding) => finding.id);
  const secondaryAcknowledged = unique([...manifest.secondaryAcknowledged, ...acknowledgedSecondaryIds]);

  const renderPack = packForManifest(manifest);
  const plan = await createRenderPlan({
    targetDir,
    pack: renderPack,
    skills: manifest.skills,
    learnEnabled: manifest.learn.enabled,
    secondaryAcknowledged,
    existingManifest: toManifestInput({
      ...manifest,
      secondaryAcknowledged
    })
  });

  const repairPaths = new Set<string>([
    ...report.missingInventoryFiles,
    ...report.outdatedOwnedFiles
  ]);

  const manifestFile = plan.files.find((file) => file.path === ".farrier.json");
  if (!manifestFile) {
    throw new Error("render plan did not include .farrier.json");
  }

  if (await manifestContentDiffers(targetDir, manifestFile.content)) {
    repairPaths.add(".farrier.json");
  }

  const repairedFiles: string[] = [];

  for (const file of plan.files) {
    if (!repairPaths.has(file.path)) {
      continue;
    }

    await writeRenderedFile(targetDir, file);
    repairedFiles.push(file.path);
  }

  return {
    report,
    repairedFiles,
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

export function formatUpdateReport(report: UpdateReport): string {
  const lines: string[] = [
    `Farrier update report for ${report.targetDir}`,
    "",
    `Current pack: ${report.currentPackId}`,
    `Pack lineage: ${report.currentPackIds.join(" -> ")}`,
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
    "Missing inventory files:",
    ...renderList(report.missingInventoryFiles, "none"),
    "",
    "Outdated Farrier-owned files:",
    ...renderList(report.outdatedOwnedFiles, "none"),
    "",
    "Outdated user-mutable files (manual review only):",
    ...renderList(report.outdatedUserFiles, "none"),
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
    "Acknowledged secondary detector ids:",
    ...renderList(result.acknowledgedSecondaryIds, "none"),
    "",
    "Suggested skills not installed:",
    ...renderList(result.suggestedSkillsNotInstalled, "none")
  ];

  return `${lines.join("\n")}\n`;
}
