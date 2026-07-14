import { lstat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExecutableProvenance, RenderedFile, RenderPlan } from "./render";
import { snapshotRegularFile, type FileFingerprint, type FileSnapshot } from "./create-plan-fs";

export const harnessChangeActions = ["create", "unchanged", "merge", "update", "replace", "blocked"] as const;

export type HarnessChangeAction = (typeof harnessChangeActions)[number];
export type HarnessFileAction = HarnessChangeAction;

export type FilePurposeContext = {
  hookCount?: number;
  skillCount?: number;
  ruleCount?: number;
  packId?: string;
  konsistentTool?: string;
  verbs?: { check?: string; test?: string; fmt?: string; konsistent?: string };
};

export type HarnessFileChange = {
  path: string;
  action: HarnessChangeAction;
  purpose: string;
  reason: string;
  requiresForce: boolean;
  exists: boolean;
  reviewedContent?: string;
  previousContent?: string;
  inspection?: FileFingerprint;
  executableProvenance?: ExecutableProvenance;
};

export type HarnessChangeBlocker = { path: string; reason: string };

export type HarnessChangeCounts = Record<HarnessChangeAction, number>;

export type HarnessChangePlan = {
  targetDir: string;
  existingHarness: boolean;
  files: HarnessFileChange[];
  counts: HarnessChangeCounts;
  replacementPaths: string[];
  replacements: string[];
  blockers: HarnessChangeBlocker[];
};

export type ApplyHarnessChangePlanOptions = {
  force: boolean;
  /** A reviewed advice plan may update an existing Farrier project. */
  allowExistingHarness?: boolean;
  now?: Date | (() => Date);
};

export type ApplyHarnessChangePlanDeps = {
  beforeWrite?: (input: { file: RenderedFile; change: HarnessFileChange; index: number }) => void | Promise<void>;
};

export type ApplyHarnessChangePlanResult = {
  written: string[];
  unchanged: string[];
  writtenFiles: string[];
  unchangedFiles: string[];
  backupDir: string | null;
};

type FileInfo = Stats;

function withCount(value: number | undefined, singular: string, plural: string): string | undefined {
  if (value === undefined) return undefined;
  return `${value} ${value === 1 ? singular : plural}`;
}

/** A concise explanation of why a generated file exists, shared by human-facing surfaces. */
export function filePurpose(path: string, context: FilePurposeContext = {}): string {
  const base = path.split("/").at(-1) ?? path;

  if (path === "AGENTS.md") {
    const count = withCount(context.ruleCount, "agent rule", "agent rules");
    return count ? `Shared agent instructions and source of truth with ${count}.` : "Agent instructions and project commands.";
  }
  if (path === "CLAUDE.md") return "Loads AGENTS.md into Claude Code.";
  if (path === ".claude/settings.json") {
    const count = withCount(context.hookCount, "hook", "hooks");
    return count ? `Wires ${count} into Claude Code.` : "Wires generated hooks into Claude Code.";
  }
  if (path === ".codex/hooks.json") {
    const count = withCount(context.hookCount, "shared hook", "shared hooks");
    return count ? `Wires ${count} into Codex.` : "Wires generated shared hooks into Codex.";
  }
  if (path === ".claude/skills/harness-advisor/SKILL.md") return "Teaches agents how to maintain the harness.";
  if (path.startsWith(".claude/skills/claude-automation-recommender/")) return "Pinned Claude project-advice skill and its attributed upstream references.";
  if (path.startsWith(".agents/skills/codex-automation-recommender/")) return "Codex-native automation recommender and official-surface references.";
  if (path === ".agents/skills/farrier-project-advisor/SKILL.md") return "Compatibility wrapper for Farrier's Codex automation recommender.";
  if (path.startsWith(".claude/hooks/@")) return "Executable hook supplied by a configured registry.";
  if (path.includes("/hooks/prompts/") && base.endsWith(".txt")) return "Versioned semantic-judge prompt.";
  if (base === "tool-policy-rules.json") return "Declarative command-denial rules.";
  if (path.includes("/hooks/test_")) return "Tests the adjacent generated hook.";
  if (path.includes("/hooks/")) return "Generated hook implementation.";
  if (path === "justfile") return "Stable project verification commands.";
  if (base === "konsistent.json" || base === "konpy.json") {
    return `${context.konsistentTool ?? base.replace(".json", "")} structure conventions.`;
  }
  if (path === ".farrier.json") {
    const skills = withCount(context.skillCount, "skill", "skills");
    const pack = context.packId ? ` for ${context.packId}` : "";
    return skills ? `Farrier manifest${pack}, including ${skills}.` : `Farrier manifest${pack}.`;
  }
  if (path === ".gitignore") return "Keeps local secrets and Farrier staging out of version control.";

  return "Generated harness file.";
}

function emptyCounts(): HarnessChangeCounts {
  return {
    create: 0,
    unchanged: 0,
    merge: 0,
    update: 0,
    replace: 0,
    blocked: 0,
  };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

async function maybeLstat(path: string): Promise<FileInfo | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function unsafeRelativePath(path: string, targetRoot: string): string | undefined {
  if (!path || path.includes("\0") || isAbsolute(path)) {
    return "Generated path must be a non-empty relative path.";
  }

  if (path.split(/[\\/]/).includes("..")) {
    return "Generated path may not contain '..' components.";
  }

  const absolutePath = resolve(targetRoot, path);
  const fromRoot = relative(targetRoot, absolutePath);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    return "Generated path must stay inside the target directory.";
  }

  return undefined;
}

async function parentBlocker(targetRoot: string, absolutePath: string): Promise<string | undefined> {
  const parent = dirname(absolutePath);
  const fromRoot = relative(targetRoot, parent);
  if (!fromRoot) {
    return undefined;
  }

  let current = targetRoot;
  for (const component of fromRoot.split(sep).filter(Boolean)) {
    current = join(current, component);
    const info = await maybeLstat(current);
    if (!info) {
      return undefined;
    }
    if (info.isSymbolicLink()) {
      return `Parent path '${relative(targetRoot, current)}' is a symbolic link.`;
    }
    if (!info.isDirectory()) {
      return `Parent path '${relative(targetRoot, current)}' is not a directory.`;
    }
  }

  return undefined;
}

function describedChange(
  file: RenderedFile,
  action: HarnessChangeAction,
  purpose: string,
  reason: string,
  exists = false,
  inspection?: FileFingerprint,
  previousContent?: string
): HarnessFileChange {
  return {
    path: file.path,
    action,
    purpose,
    reason,
    requiresForce: action === "replace",
    exists,
    reviewedContent: file.content,
    inspection,
    ...(previousContent !== undefined ? { previousContent } : {}),
    ...(file.executableProvenance ? { executableProvenance: file.executableProvenance } : {})
  };
}

function blockedChange(file: RenderedFile, purpose: string, reason: string, exists = false): HarnessFileChange {
  return describedChange(file, "blocked", purpose, reason, exists);
}

async function inspectFile(targetRoot: string, file: RenderedFile, purpose: string): Promise<HarnessFileChange> {
  const unsafe = unsafeRelativePath(file.path, targetRoot);
  if (unsafe) {
    return blockedChange(file, purpose, unsafe);
  }

  const absolutePath = resolve(targetRoot, file.path);
  const badParent = await parentBlocker(targetRoot, absolutePath);
  if (badParent) {
    return blockedChange(file, purpose, badParent);
  }

  const info = await maybeLstat(absolutePath);
  if (!info) {
    return describedChange(file, "create", purpose, "File does not exist.");
  }
  if (info.isSymbolicLink()) return blockedChange(file, purpose, "Target path is a symbolic link.", true);
  if (info.isDirectory()) return blockedChange(file, purpose, "Target path is a directory.", true);
  if (!info.isFile()) return blockedChange(file, purpose, "Target path is not a regular file.", true);

  let snapshot: FileSnapshot;
  try {
    snapshot = await snapshotRegularFile(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return blockedChange(file, purpose, `Existing file cannot be read: ${message}`, true);
  }
  const current = snapshot.content.toString("utf8");

  if (current === file.content) {
    if (file.mode !== undefined && (file.mode & 0o7777) !== snapshot.fingerprint.mode) {
      return describedChange(file, "update", purpose, `Content matches, but permissions must be normalized to ${file.mode.toString(8)}.`, true, snapshot.fingerprint, current);
    }
    return describedChange(file, "unchanged", purpose, "Existing content and permissions already match.", true, snapshot.fingerprint, current);
  }

  if (file.path === ".gitignore" && file.content.startsWith(current)) {
    return describedChange(file, "merge", purpose, "Planned content only appends missing Farrier ignore entries.", true, snapshot.fingerprint, current);
  }

  return describedChange(file, "replace", purpose, "Existing content differs from the planned content.", true, snapshot.fingerprint, current);
}

function targetRootBlocker(info: FileInfo | undefined): string | undefined {
  if (!info) return undefined;
  if (info.isSymbolicLink()) return "Target directory is a symbolic link.";
  if (!info.isDirectory()) return "Target directory is not a directory.";
  return undefined;
}

export async function inspectHarnessChangePlan(renderPlan: RenderPlan, purposeContext?: FilePurposeContext): Promise<HarnessChangePlan> {
  const targetRoot = resolve(renderPlan.targetDir);
  const rootBlocker = targetRootBlocker(await maybeLstat(targetRoot));
  const existingHarness = rootBlocker ? false : (await maybeLstat(join(targetRoot, ".farrier.json"))) !== undefined;
  const seen = new Set<string>();

  const files = await Promise.all(
    renderPlan.files.map(async (file) => {
      const purpose = filePurpose(file.path, purposeContext);
      if (rootBlocker) return blockedChange(file, purpose, rootBlocker);
      if (seen.has(file.path)) {
        return blockedChange(file, purpose, "Render plan contains this path more than once.");
      }
      seen.add(file.path);
      return inspectFile(targetRoot, file, purpose);
    }),
  );

  const counts = emptyCounts();
  for (const file of files) {
    counts[file.action] += 1;
  }
  const replacementPaths = files.filter((file) => file.action === "replace").map((file) => file.path);

  return {
    targetDir: renderPlan.targetDir,
    existingHarness,
    files,
    counts,
    replacementPaths,
    replacements: replacementPaths,
    blockers: files.filter((file) => file.action === "blocked").map((file) => ({ path: file.path, reason: file.reason })),
  };
}

export function assertHarnessChangePlanWritable(plan: HarnessChangePlan, options: { force: boolean; allowExistingHarness?: boolean }): void {
  if (plan.existingHarness && !options.allowExistingHarness) {
    throw new Error(`Refusing to create: ${plan.targetDir} is already a Farrier project. Run 'farrier update --dir ${plan.targetDir}' instead.`);
  }

  if (plan.blockers.length > 0) {
    const details = plan.blockers.map((blocker) => `${blocker.path}: ${blocker.reason}`).join("; ");
    throw new Error(`Refusing to write blocked harness paths (force cannot bypass this): ${details}`);
  }

  if (plan.replacementPaths.length > 0 && !options.force) {
    throw new Error(`Refusing to replace existing files without --force: ${plan.replacementPaths.join(", ")}. Review the changes before retrying with --force.`);
  }
}

export { applyHarnessChangePlan, HarnessApplyError } from "./create-plan-apply";
