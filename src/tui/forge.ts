import {
  createSkills,
  type CollisionDecision,
  type CreateAgent,
  type CreateSkillDeps,
  type SkillCreationOutcome,
  type SkillCreationRequest
} from "../engine/create-skill";
import { installSkills, type InstallSkillResult } from "../engine/skills";
import { writeRenderPlan, type RenderPlan } from "../engine/render";
import type { SkillRef } from "../packs/types";
import type { ResolvedModelSettings } from "../config/farrier-config";

export type ForgeWriteResult = {
  message: string;
  installResults: InstallSkillResult[];
  createOutcomes: SkillCreationOutcome[];
};

export type ForgeWriteDeps = {
  writeRenderPlan?: typeof writeRenderPlan;
  installSkills?: typeof installSkills;
  createSkills?: typeof createSkills;
};

export async function runForgeWrite(
  input: {
    reviewPlan: RenderPlan;
    selectedSkills: SkillRef[];
    createRequests: SkillCreationRequest[];
    targetDir: string;
    signal: AbortSignal;
    onCollision?: (info: { path: string; stagingPath: string }) => Promise<CollisionDecision>;
    modelSettings?: Partial<Record<CreateAgent, ResolvedModelSettings>>;
  },
  deps: ForgeWriteDeps = {}
): Promise<ForgeWriteResult> {
  const writePlan = deps.writeRenderPlan ?? writeRenderPlan;
  const install = deps.installSkills ?? installSkills;
  const create = deps.createSkills ?? createSkills;

  await writePlan(input.reviewPlan);

  const installResults = await install(input.selectedSkills, input.targetDir);
  const failedInstalls = installResults.filter((result) => !result.ok).length;
  const installed = installResults.length - failedInstalls;

  const installSummary =
    installResults.length === 0 ? "No skills selected for install." : `Installed ${installed} skill(s); ${failedInstalls} failed.`;

  // Concurrent authoring (staging roots isolate the runs); lock-touching
  // installs are serialized inside createSkills.
  const createDeps: CreateSkillDeps = {
    signal: input.signal,
    onCollision: input.onCollision,
    modelSettings: input.modelSettings
  };
  const createOutcomes = await create(input.createRequests, input.targetDir, createDeps);

  const failedCreates = createOutcomes.filter((outcome) => outcome.error).length;
  const createSummary =
    createOutcomes.length === 0
      ? ""
      : input.signal.aborted
        ? ` Skill authoring cancelled (${createOutcomes.length - failedCreates} finished before the abort).`
        : ` Created ${createOutcomes.length - failedCreates} skill(s); ${failedCreates} failed.`;

  return {
    message: `Wrote ${input.reviewPlan.files.length} farrier harness files. ${installSummary}${createSummary}`,
    installResults,
    createOutcomes
  };
}
