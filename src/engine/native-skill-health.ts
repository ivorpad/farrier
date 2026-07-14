import { lstat, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { nativeSkillPath, parseNativeLocalSkillRef, sharedSkillLinkTarget } from "./skill-paths";

export type NativeSkillHealthStatus =
  | "healthy-tree"
  | "healthy-shared-link"
  | "missing"
  | "missing-skill-md"
  | "wrong-link"
  | "broken-link"
  | "external-link"
  | "reverse-link"
  | "invalid-type";

export type NativeSkillHealth = {
  ref: string;
  author: "claude" | "codex";
  name: string;
  path: string;
  status: NativeSkillHealthStatus;
  message: string;
};

export type TrackedSkillHealth = {
  native: NativeSkillHealth[];
  duplicateRefs: string[];
  legacyRefs: string[];
};

function outside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

async function maybeLstat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function inspectNativeRef(targetDir: string, ref: string): Promise<NativeSkillHealth> {
  const parsed = parseNativeLocalSkillRef(ref)!;
  const path = nativeSkillPath(parsed.author, parsed.name);
  const absolute = resolve(targetDir, path);
  const info = await maybeLstat(absolute);
  const base = { ref, author: parsed.author, name: parsed.name, path };
  if (!info) return { ...base, status: "missing", message: "Tracked native skill path is missing." };
  if (info.isSymbolicLink()) {
    if (parsed.author === "codex") return { ...base, status: "reverse-link", message: "The .agents skill must be a real tree, not a link." };
    const target = await readlink(absolute);
    let real: string;
    try {
      real = await realpath(absolute);
    } catch {
      return { ...base, status: "broken-link", message: "Claude shared skill link is dangling." };
    }
    if (outside(await realpath(targetDir), real)) return { ...base, status: "external-link", message: "Claude shared skill link resolves outside the project." };
    if (target !== sharedSkillLinkTarget(parsed.name)) {
      return { ...base, status: "wrong-link", message: `Claude shared link target is '${target}', expected '${sharedSkillLinkTarget(parsed.name)}'.` };
    }
    const expected = await realpath(resolve(targetDir, nativeSkillPath("codex", parsed.name)));
    if (real !== expected) return { ...base, status: "wrong-link", message: "Claude shared skill link resolves to the wrong in-project tree." };
    const skill = await maybeLstat(join(real, "SKILL.md"));
    if (!skill?.isFile() || skill.isSymbolicLink()) return { ...base, status: "missing-skill-md", message: "Shared skill tree has no regular SKILL.md." };
    return { ...base, status: "healthy-shared-link", message: "Exact Claude link resolves to the canonical .agents tree." };
  }
  if (!info.isDirectory()) return { ...base, status: "invalid-type", message: "Tracked native skill path is not a directory." };
  const skill = await maybeLstat(join(absolute, "SKILL.md"));
  if (!skill?.isFile() || skill.isSymbolicLink()) return { ...base, status: "missing-skill-md", message: "Native skill tree has no regular SKILL.md." };
  return { ...base, status: "healthy-tree", message: "Native skill tree is present." };
}

export async function inspectTrackedSkillHealth(targetDir: string, refs: readonly string[]): Promise<TrackedSkillHealth> {
  const counts = new Map<string, number>();
  for (const ref of refs) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  const duplicateRefs = [...counts].filter(([, count]) => count > 1).map(([ref]) => ref);
  const nativeRefs = [...new Set(refs.filter((ref) => parseNativeLocalSkillRef(ref)))];
  return {
    native: await Promise.all(nativeRefs.map((ref) => inspectNativeRef(targetDir, ref))),
    duplicateRefs,
    legacyRefs: [...new Set(refs.filter((ref) => /^\.\/skills@[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ref)))]
  };
}
