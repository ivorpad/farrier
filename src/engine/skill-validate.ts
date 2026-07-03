import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentBackend } from "./backend";
import type { RenderedFile } from "./render";

export const skillNamePattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const maxSkillNameLength = 64;
export const maxDescriptionLength = 500;

export function slugifySkillName(text: string): string | undefined {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxSkillNameLength)
    .replace(/-+$/, "");

  return skillNamePattern.test(slug) ? slug : undefined;
}

export function yamlScalar(value: string): string {
  return /[:#"\n]|^[-[{]/.test(value) ? JSON.stringify(value) : value;
}

export function collapseDescription(text: string): { description: string; truncated: boolean } {
  const collapsed = text.replace(/\s+/g, " ").trim();

  if (collapsed.length <= maxDescriptionLength) {
    return { description: collapsed, truncated: false };
  }

  return { description: collapsed.slice(0, maxDescriptionLength).trimEnd(), truncated: true };
}

export type SkillDraft = {
  name: string;
  files: RenderedFile[];
  notes: string[];
};

/** Offline (--no-llm) fallback: a deterministic SKILL.md skeleton in skills/. */
export function scaffoldSkillDraft(input: { description: string; nameOverride?: string }): SkillDraft {
  const name = input.nameOverride ?? slugifySkillName(input.description);

  if (!name) {
    throw new Error("Could not derive a skill name from the description. Pass an explicit kebab-case name.");
  }

  if (!skillNamePattern.test(name) || name.length > maxSkillNameLength) {
    throw new Error(`Skill name '${name}' must be kebab-case ([a-z0-9] and single hyphens), at most ${maxSkillNameLength} chars.`);
  }

  const { description, truncated } = collapseDescription(input.description);
  const notes = truncated ? [`Description truncated to ${maxDescriptionLength} characters for the frontmatter.`] : [];

  const content = `---
name: ${name}
description: ${yamlScalar(description)}
---

${input.description.trim()}

## When to use

TODO: describe the situations and trigger phrases for this skill.

## Steps

TODO: numbered, concrete steps with exact commands.

## Examples

TODO: at least one worked example.
`;

  return {
    name,
    files: [{ path: `skills/${name}/SKILL.md`, content }],
    notes
  };
}

export type SkillRootSnapshot = {
  dirs: Set<string>;
  files: Set<string>;
};

export async function snapshotSkillRoot(root: string): Promise<SkillRootSnapshot> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return {
      dirs: new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)),
      files: new Set(entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name))
    };
  } catch {
    return { dirs: new Set(), files: new Set() };
  }
}

async function listFilesRecursive(dir: string, prefix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relative = `${prefix}/${entry.name}`;

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(join(dir, entry.name), relative)));
    } else {
      files.push(relative);
    }
  }

  return files.sort();
}

type Frontmatter = {
  raw: string;
  body: string;
  name?: string;
  description?: string;
};

function parseFrontmatter(content: string): Frontmatter | undefined {
  if (!content.startsWith("---\n")) {
    return undefined;
  }

  const end = content.indexOf("\n---", 4);

  if (end < 0) {
    return undefined;
  }

  const raw = content.slice(4, end);
  const body = content.slice(content.indexOf("\n", end + 1) + 1);

  const field = (key: string): string | undefined => {
    const match = raw.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));

    if (!match) {
      return undefined;
    }

    const value = match[1]!.trim();

    if (value.startsWith('"')) {
      try {
        return JSON.parse(value) as string;
      } catch {
        return value;
      }
    }

    return value || undefined;
  };

  return { raw, body, name: field("name"), description: field("description") };
}

export type ValidateCreatedSkillInput = {
  targetDir: string;
  root: string;
  before: SkillRootSnapshot;
  backend: AgentBackend;
  nameOverride?: string;
};

export type ValidatedSkill = {
  name: string;
  files: string[];
  notes: string[];
};

/**
 * Deterministic post-hoc validation of a delegated authoring run: diff the
 * skill root, demand exactly one new well-named directory with a parseable
 * SKILL.md, and repair only what farrier can repair mechanically (frontmatter
 * name to match the directory, oversize description). Everything else is a
 * hard error that leaves the files on disk for inspection.
 */
export async function validateCreatedSkill(input: ValidateCreatedSkillInput): Promise<ValidatedSkill> {
  const rootPath = join(input.targetDir, input.root);
  const after = await snapshotSkillRoot(rootPath);
  const newDirs = Array.from(after.dirs).filter((name) => !input.before.dirs.has(name));
  const strayFiles = Array.from(after.files).filter((name) => !input.before.files.has(name));

  if (strayFiles.length > 0) {
    throw new Error(
      `${input.backend} backend wrote loose files under ${input.root}/: ${strayFiles.sort().join(", ")}. ` +
        "Expected a single skill directory. Inspect and clean up before retrying."
    );
  }

  if (newDirs.length === 0) {
    throw new Error(`${input.backend} backend did not create a skill directory under ${input.root}/.`);
  }

  if (newDirs.length > 1) {
    throw new Error(
      `${input.backend} backend created more than one directory under ${input.root}/: ${newDirs.sort().join(", ")}. ` +
        "Expected exactly one skill. Inspect and clean up before retrying."
    );
  }

  const name = newDirs[0]!;

  if (input.nameOverride && name !== input.nameOverride) {
    throw new Error(
      `${input.backend} backend created '${input.root}/${name}' but the requested name was '${input.nameOverride}'. ` +
        "Inspect and clean up before retrying."
    );
  }

  if (!skillNamePattern.test(name) || name.length > maxSkillNameLength) {
    throw new Error(
      `${input.backend} backend created '${input.root}/${name}', which is not a kebab-case skill name. ` +
        "Inspect and clean up before retrying."
    );
  }

  const skillDir = join(rootPath, name);
  const skillMdPath = join(skillDir, "SKILL.md");
  let content: string;

  try {
    content = await readFile(skillMdPath, "utf8");
  } catch {
    throw new Error(`${input.backend} backend did not write ${input.root}/${name}/SKILL.md.`);
  }

  const frontmatter = parseFrontmatter(content);

  if (!frontmatter || !frontmatter.description) {
    throw new Error(
      `${input.root}/${name}/SKILL.md is missing YAML frontmatter with name and description. ` +
        "Fix the file or delete the directory and retry."
    );
  }

  const notes: string[] = [];
  const { description, truncated } = collapseDescription(frontmatter.description);
  let repairedName = frontmatter.name;

  if (frontmatter.name !== name) {
    repairedName = name;
    notes.push(`Repaired frontmatter name '${frontmatter.name ?? ""}' to match the directory '${name}'.`);
  }

  if (truncated) {
    notes.push(`Description truncated to ${maxDescriptionLength} characters.`);
  }

  if (repairedName !== frontmatter.name || truncated) {
    const rebuilt = `---\nname: ${repairedName}\ndescription: ${yamlScalar(description)}\n---\n${frontmatter.body}`;
    await writeFile(skillMdPath, rebuilt, "utf8");
  }

  return {
    name,
    files: await listFilesRecursive(skillDir, `${input.root}/${name}`),
    notes
  };
}
