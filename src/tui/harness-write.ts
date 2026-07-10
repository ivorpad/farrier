import { createSkills, type CollisionDecision, type CreateAgent, type CreateSkillDeps, type SkillCreationOutcome, type SkillCreationRequest } from "../engine/create-skill";
import { applyHarnessChangePlan, type ApplyHarnessChangePlanResult } from "../engine/create-plan";
import { installSkills, type InstallSkillResult } from "../engine/skills";
import type { RenderPlan } from "../engine/render";
import type { SkillRef } from "../packs/types";
import type { ResolvedModelSettings } from "../config/farrier-config";

export type HarnessWriteResult = {
  message: string;
  partial: boolean;
  applyResult: ApplyHarnessChangePlanResult;
  installResults: InstallSkillResult[];
  createOutcomes: SkillCreationOutcome[];
};

export type HarnessWriteDeps = {
  writeRenderPlan?: (plan: RenderPlan) => Promise<ApplyHarnessChangePlanResult | void>;
  installSkills?: typeof installSkills;
  createSkills?: typeof createSkills;
};

export async function runHarnessWrite(
  input: {
    reviewPlan: RenderPlan;
    selectedSkills: SkillRef[];
    createRequests: SkillCreationRequest[];
    targetDir: string;
    signal: AbortSignal;
    forceReplace?: boolean;
    onCollision?: (info: { path: string; stagingPath: string }) => Promise<CollisionDecision>;
    modelSettings?: Partial<Record<CreateAgent, ResolvedModelSettings>>;
  },
  deps: HarnessWriteDeps = {},
): Promise<HarnessWriteResult> {
  const writePlan = deps.writeRenderPlan ?? ((plan: RenderPlan) => applyHarnessChangePlan(plan, { force: input.forceReplace === true }));
  const install = deps.installSkills ?? installSkills;
  const create = deps.createSkills ?? createSkills;

  const applied = await writePlan(input.reviewPlan);
  const applyResult: ApplyHarnessChangePlanResult = applied ?? {
    written: [],
    unchanged: [],
    writtenFiles: [],
    unchangedFiles: [],
    backupDir: null,
  };

  const installResults = await install(input.selectedSkills, input.targetDir);
  const failedInstalls = installResults.filter((result) => !result.ok).length;
  const installed = installResults.length - failedInstalls;

  const installSummary =
    installResults.length === 0
      ? "No skills selected for install."
      : failedInstalls > 0
        ? `Partial result: installed ${installed} of ${installResults.length} selected skill(s); ${failedInstalls} failed.`
        : `Installed ${installed} skill(s).`;

  // Concurrent authoring (staging roots isolate the runs); lock-touching
  // installs are serialized inside createSkills.
  const createDeps: CreateSkillDeps = {
    signal: input.signal,
    onCollision: input.onCollision,
    modelSettings: input.modelSettings,
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
    message: `Applied ${applyResult.writtenFiles.length} file change(s); ${applyResult.unchangedFiles.length} unchanged. ${installSummary}${createSummary}`,
    partial: failedInstalls > 0 || failedCreates > 0 || input.signal.aborted,
    applyResult,
    installResults,
    createOutcomes,
  };
}
