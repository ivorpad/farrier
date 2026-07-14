import { existsSync } from "node:fs";
import { readFile, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { normalizeSkillCreationRequest, stageSkill, type CreateSkillDeps, type SkillCreationRequest } from "./create-skill";
import type { RenderedFile } from "./render";

export type SkillCreationFilePlan = {
  name: string;
  files: RenderedFile[];
  notes: string[];
  stagedTree?: { sourcePath: string; stagingRoot: string };
};

const planningStaging = new Map<string, { users: number; existed: boolean }>();

function acquirePlanningStaging(targetDir: string): () => Promise<void> {
  const current = planningStaging.get(targetDir);
  if (current) current.users += 1;
  else planningStaging.set(targetDir, { users: 1, existed: existsSync(join(targetDir, ".farrier-staging")) });
  return async () => {
    const entry = planningStaging.get(targetDir);
    if (!entry) return;
    entry.users -= 1;
    if (entry.users > 0) return;
    planningStaging.delete(targetDir);
    if (!entry.existed) await rmdir(join(targetDir, ".farrier-staging")).catch(() => undefined);
  };
}

/**
 * Uses the normal skill-creator authoring and validation pipeline, but turns
 * the disposable staging output into reviewable files instead of installing
 * or moving anything into the project before confirmation.
 */
export async function authorSkillCreationPlan(input: {
  request: SkillCreationRequest;
  targetDir: string;
  outputRoot: string;
  deps?: CreateSkillDeps;
  creatorReady?: boolean;
  retainStaging?: boolean;
}): Promise<SkillCreationFilePlan> {
  const request = normalizeSkillCreationRequest(input.request);
  if (request.authors.length !== 1) throw new Error("Advice batch skill authoring requires one report author.");
  if (!input.outputRoot || input.outputRoot.startsWith("/") || input.outputRoot.split(/[\\/]/).includes("..")) {
    throw new Error("Advice batch skill output root must stay inside the target directory.");
  }
  const agent = request.authors[0]!;
  const releaseStaging = acquirePlanningStaging(input.targetDir);
  let staged: Awaited<ReturnType<typeof stageSkill>> | undefined;
  try {
    staged = await stageSkill({
      agent,
      description: input.request.description,
      targetDir: input.targetDir,
      model: input.request.model,
      nameOverride: input.request.nameOverride,
      deps: input.deps ?? {},
      creatorReady: input.creatorReady,
      cleanupOnFailure: true
    });
    const sourcePrefix = `${staged.stagingRoot}/${staged.validated.name}/`;
    const destinationPrefix = `${input.outputRoot}/${staged.validated.name}/`;
    const files = await Promise.all(staged.validated.files.map(async (path): Promise<RenderedFile> => {
      const bytes = await readFile(join(input.targetDir, path));
      const content = bytes.toString("utf8");
      if (!Buffer.from(content, "utf8").equals(bytes)) {
        throw new Error(`Advice batch review does not support binary skill asset '${path}'.`);
      }
      return { path: `${destinationPrefix}${path.slice(sourcePrefix.length)}`, content };
    }));
    return {
      name: staged.validated.name,
      files,
      notes: staged.validated.notes,
      ...(input.retainStaging ? {
        stagedTree: {
          sourcePath: `${staged.stagingRoot}/${staged.validated.name}`,
          stagingRoot: staged.stagingRoot
        }
      } : {})
    };
  } finally {
    if (staged && !input.retainStaging) await rm(join(input.targetDir, staged.stagingRoot), { recursive: true, force: true });
    await releaseStaging();
  }
}
