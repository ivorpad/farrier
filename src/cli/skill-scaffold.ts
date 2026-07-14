import { mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scaffoldSkillDraft, type CreateAgent } from "../engine/create-skill";
import { applySkillPlacement, inspectSkillPlacement } from "../engine/skill-placement";
import { nativeSkillPath } from "../engine/skill-paths";

export type ScaffoldCliOptions = {
  description?: string;
  name?: string;
  authors: CreateAgent[];
  shared: boolean;
  force: boolean;
  yes: boolean;
  dryRun: boolean;
  json: boolean;
  warnings: string[];
};

function emit(options: ScaffoldCliOptions, result: Record<string, unknown>, lines: string[]): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const line of lines) console.log(line);
}

export async function runSkillScaffold(options: ScaffoldCliOptions, targetDir: string): Promise<number> {
  const draft = scaffoldSkillDraft({ description: options.description!, nameOverride: options.name });
  if (!options.yes && !options.dryRun) {
    console.error("farrier skill new: refusing to write without --yes. Use --dry-run to preview.");
    return 1;
  }
  const stagingRoots = options.authors.map((author) => ({ author, root: `.farrier-staging/authoring/${crypto.randomUUID().slice(0, 8)}` }));
  try {
    for (const staged of stagingRoots) {
      const skillDir = join(targetDir, staged.root, draft.name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), draft.files[0]!.content, "utf8");
    }
    const reviewed = await inspectSkillPlacement({
      targetDir,
      copies: stagingRoots.map(({ author, root }) => ({ author, name: draft.name, sourcePath: `${root}/${draft.name}` })),
      layout: options.shared ? "shared" : "native",
      force: options.force
    });
    const finalFiles = options.shared
      ? [`${nativeSkillPath("codex", draft.name)}/SKILL.md`, nativeSkillPath("claude", draft.name)]
      : options.authors.map((author) => `${nativeSkillPath(author, draft.name)}/SKILL.md`);
    const notes = [...draft.notes, ...reviewed.plan.notes, ...options.warnings];
    if (options.dryRun) {
      emit(options, {
        name: draft.name, authors: options.authors, layout: reviewed.plan.layout,
        agents: options.authors, mode: "scaffold", files: finalFiles, installed: false,
        notes, dryRun: true, operations: reviewed.plan.operations
      }, [`Would place ${finalFiles.join(", ")} (nothing written):`, "", draft.files[0]!.content]);
      return 0;
    }
    const placed = await applySkillPlacement(reviewed.plan, reviewed.inspection);
    emit(options, {
      name: draft.name, authors: options.authors, layout: placed.layout,
      agents: options.authors, mode: "scaffold", files: finalFiles, installed: true,
      notes, links: placed.links, backupDir: placed.backupDir
    }, [`✓ Scaffolded ${finalFiles.join(" and ")}.`, "  Edit the TODO sections before relying on it.", ...notes.map((note) => `  - ${note}`)]);
    return 0;
  } finally {
    await Promise.all(stagingRoots.map(({ root }) => rm(join(targetDir, root), { recursive: true, force: true })));
    await rmdir(join(targetDir, ".farrier-staging", "authoring")).catch(() => undefined);
    await rmdir(join(targetDir, ".farrier-staging")).catch(() => undefined);
  }
}
