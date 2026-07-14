import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentBackend } from "./backend";
import {
  applyMutationPlan,
  inspectMutationPlan,
  type MutationApplyResult,
  type MutationInspection,
  type MutationOperation
} from "./mutation-transaction";
import {
  isNativeLocalSkillRef,
  nativeSkillPath,
  nativeSkillRef,
  sharedSkillLinkTarget
} from "./skill-paths";

export type SkillLayout = "native" | "shared";

export type StagedSkillCopy = {
  author: AgentBackend;
  name: string;
  sourcePath: string;
};

export type SkillPlacementInput = {
  targetDir: string;
  copies: StagedSkillCopy[];
  layout: SkillLayout;
  force?: boolean;
  removeManifestRefs?: string[];
  removePaths?: string[];
};

export type SkillPlacementPlan = {
  targetDir: string;
  layout: SkillLayout;
  operations: MutationOperation[];
  paths: string[];
  manifestRefs: string[];
  notes: string[];
};

export type SkillPlacementResult = MutationApplyResult & {
  layout: SkillLayout;
  installed: true;
  manifestRefs: string[];
  notes: string[];
};

function localRefOrder(left: string, right: string): number {
  const leftRoot = left.startsWith("./.claude/") ? 0 : 1;
  const rightRoot = right.startsWith("./.claude/") ? 0 : 1;
  return leftRoot - rightRoot || left.localeCompare(right);
}

async function manifestOperation(
  targetDir: string,
  addRefs: string[],
  removeRefs: string[]
): Promise<{ operation?: MutationOperation; refs: string[]; note?: string }> {
  const path = join(targetDir, ".farrier.json");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
    return {
      refs: addRefs,
      note: code === "ENOENT"
        ? "Skill placed but not recorded because .farrier.json is missing."
        : "Skill placed but not recorded because .farrier.json is invalid."
    };
  }
  if (!Array.isArray(parsed.skills) || parsed.skills.some((value) => typeof value !== "string")) {
    return { refs: addRefs, note: "Skill placed but not recorded because .farrier.json has no valid skills array." };
  }

  const removed = new Set(removeRefs);
  const values = (parsed.skills as string[]).filter((ref) => !removed.has(ref));
  for (const ref of addRefs) if (!values.includes(ref)) values.push(ref);
  const nonNative = values.filter((ref) => !isNativeLocalSkillRef(ref));
  const native = values.filter(isNativeLocalSkillRef).sort(localRefOrder);
  parsed.skills = [...nonNative, ...native];
  return {
    operation: { type: "replace-file", path: ".farrier.json", content: `${JSON.stringify(parsed, null, 2)}\n`, managedExisting: true },
    refs: addRefs
  };
}

function assertCopies(input: SkillPlacementInput): void {
  if (input.copies.length === 0) throw new Error("skill placement requires at least one staged copy");
  if (input.layout === "shared" && input.copies.length !== 1) throw new Error("shared skill placement requires exactly one author");
  const authors = new Set<AgentBackend>();
  for (const copy of input.copies) {
    if (authors.has(copy.author)) throw new Error(`skill placement repeats author '${copy.author}'`);
    authors.add(copy.author);
  }
}

export async function buildSkillPlacementPlan(input: SkillPlacementInput): Promise<SkillPlacementPlan> {
  assertCopies(input);
  const operations: MutationOperation[] = [];
  const paths: string[] = [];
  const refs: string[] = [];

  for (const path of input.removePaths ?? []) operations.push({ type: "remove", path });

  if (input.layout === "shared") {
    const copy = input.copies[0]!;
    const realPath = nativeSkillPath("codex", copy.name);
    const linkPath = nativeSkillPath("claude", copy.name);
    operations.push({ type: "replace-tree", path: realPath, sourcePath: copy.sourcePath });
    operations.push({ type: "link", path: linkPath, target: sharedSkillLinkTarget(copy.name) });
    paths.push(realPath, linkPath);
    refs.push(nativeSkillRef("claude", copy.name), nativeSkillRef("codex", copy.name));
  } else {
    for (const copy of input.copies) {
      const path = nativeSkillPath(copy.author, copy.name);
      operations.push({ type: "replace-tree", path, sourcePath: copy.sourcePath });
      paths.push(path);
      refs.push(nativeSkillRef(copy.author, copy.name));
    }
  }

  const manifest = await manifestOperation(input.targetDir, refs, input.removeManifestRefs ?? []);
  if (manifest.operation) operations.push(manifest.operation);
  return {
    targetDir: input.targetDir,
    layout: input.layout,
    operations,
    paths,
    manifestRefs: manifest.refs,
    notes: manifest.note ? [manifest.note] : ["Recorded native skill refs in .farrier.json skills."]
  };
}

export async function inspectSkillPlacement(
  input: SkillPlacementInput
): Promise<{ plan: SkillPlacementPlan; inspection: MutationInspection }> {
  const plan = await buildSkillPlacementPlan(input);
  const inspection = await inspectMutationPlan(input.targetDir, plan.operations, { force: input.force });
  return { plan, inspection };
}

export async function applySkillPlacement(
  plan: SkillPlacementPlan,
  inspection: MutationInspection
): Promise<SkillPlacementResult> {
  const result = await applyMutationPlan(inspection);
  return { ...result, layout: plan.layout, installed: true, manifestRefs: plan.manifestRefs, notes: plan.notes };
}

export async function placeSkillTrees(input: SkillPlacementInput): Promise<SkillPlacementResult> {
  const { plan, inspection } = await inspectSkillPlacement(input);
  return applySkillPlacement(plan, inspection);
}
