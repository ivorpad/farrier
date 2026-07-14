import { useEffect, useState } from "react";
import { inspectHarnessChangePlan } from "../engine/create-plan";
import { createRenderPlan, type RenderPlan } from "../engine/render";
import type { EnforcementAgent } from "../engine/agent-selection";
import type { PackHookRef, ResolvedPack, SkillRef } from "../packs/types";
import type { PackCatalog } from "../registry/catalog";
import type { ReviewFile } from "./ReviewStep";

export type HarnessReviewInput = {
  active: boolean;
  targetDir: string;
  catalog: PackCatalog;
  pack: ResolvedPack;
  packId: string;
  selectedSkills: SkillRef[];
  selectedHooks: PackHookRef[];
  agents: EnforcementAgent[];
  learnEnabled: boolean;
  ruleCount: number;
};

export type HarnessReview = {
  plan: RenderPlan | null;
  files: ReviewFile[];
  existingHarness: boolean;
  blockerCount: number;
  error?: string;
};

export type StoredHarnessReview = HarnessReview & { input?: HarnessReviewInput };

function isCurrentReview(stored: StoredHarnessReview, input: HarnessReviewInput): boolean {
  const reviewed = stored.input;
  return Boolean(
    input.active &&
      reviewed &&
      reviewed.targetDir === input.targetDir &&
      reviewed.catalog === input.catalog &&
      reviewed.pack === input.pack &&
      reviewed.packId === input.packId &&
      reviewed.selectedSkills === input.selectedSkills &&
      reviewed.selectedHooks === input.selectedHooks &&
      reviewed.agents === input.agents &&
      reviewed.learnEnabled === input.learnEnabled &&
      reviewed.ruleCount === input.ruleCount
  );
}

export function currentHarnessReview(stored: StoredHarnessReview, input: HarnessReviewInput): HarnessReview {
  return isCurrentReview(stored, input)
    ? stored
    : { plan: null, files: [], existingHarness: false, blockerCount: 0 };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Builds the same filesystem-aware plan that headless dry-run and apply use. */
export function useHarnessReview(input: HarnessReviewInput): HarnessReview {
  const [review, setReview] = useState<StoredHarnessReview>({
    plan: null,
    files: [],
    existingHarness: false,
    blockerCount: 0,
  });

  useEffect(() => {
    if (!input.active) return;

    let cancelled = false;
    setReview({ plan: null, files: [], existingHarness: false, blockerCount: 0, input });

    createRenderPlan({
      targetDir: input.targetDir,
      pack: input.pack,
      skills: input.selectedSkills,
      learnEnabled: input.learnEnabled,
      agents: input.agents,
      registryPins: input.catalog.registryPins(),
    })
      .then(async (plan) => {
        const changePlan = await inspectHarnessChangePlan(plan, {
          hookCount: input.selectedHooks.length,
          skillCount: input.selectedSkills.length,
          ruleCount: input.ruleCount,
          packId: input.packId,
          konsistentTool: input.pack.konsistentTool,
          verbs: input.pack.verbs,
        });
        const renderedByPath = new Map(plan.files.map((file) => [file.path, file]));
        const files: ReviewFile[] = changePlan.files.map((file) => ({
          ...file,
          content: renderedByPath.get(file.path)?.content ?? "",
        }));

        if (!cancelled) {
          setReview({
            plan,
            files,
            existingHarness: changePlan.existingHarness,
            blockerCount: changePlan.blockers.length,
            input,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setReview({
            plan: null,
            files: [],
            existingHarness: false,
            blockerCount: 0,
            error: errorMessage(error),
            input,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.active, input.agents, input.catalog, input.learnEnabled, input.pack, input.packId, input.ruleCount, input.selectedHooks, input.selectedSkills, input.targetDir]);

  return currentHarnessReview(review, input);
}
