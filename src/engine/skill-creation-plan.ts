import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stageSkill, type CreateAgent, type CreateSkillDeps, type SkillCreationRequest } from "./create-skill";
import type { RenderedFile } from "./render";

export type SkillCreationFilePlan = {
  name: string;
  files: RenderedFile[];
  notes: string[];
};

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
}): Promise<SkillCreationFilePlan> {
  if (input.request.mode === "per-agent") throw new Error("Advice batch skill authoring requires one report backend.");
  if (!input.outputRoot || input.outputRoot.startsWith("/") || input.outputRoot.split(/[\\/]/).includes("..")) {
    throw new Error("Advice batch skill output root must stay inside the target directory.");
  }
  const agent: CreateAgent = input.request.mode === "author-claude" ? "claude" : "codex";
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
    const sourcePrefix = `.farrier-output/${staged.validated.name}/`;
    const destinationPrefix = `${input.outputRoot}/${staged.validated.name}/`;
    const files = await Promise.all(staged.validated.files.map(async (path): Promise<RenderedFile> => {
      const bytes = await readFile(join(dirname(staged!.stagingRoot), path));
      const content = bytes.toString("utf8");
      if (!Buffer.from(content, "utf8").equals(bytes)) {
        throw new Error(`Advice batch review does not support binary skill asset '${path}'.`);
      }
      return { path: `${destinationPrefix}${path.slice(sourcePrefix.length)}`, content };
    }));
    return { name: staged.validated.name, files, notes: staged.validated.notes };
  } finally {
    if (staged) await rm(dirname(staged.stagingRoot), { recursive: true, force: true });
  }
}
