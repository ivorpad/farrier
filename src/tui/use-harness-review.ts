import { useEffect, useState } from "react";
import { inspectHarnessChangePlan } from "../engine/create-plan";
import { createRenderPlan, type RenderPlan } from "../engine/render";
import type { PackHookRef, ResolvedPack, SkillRef } from "../packs/types";
import type { PackCatalog } from "../registry/catalog";
import type { ReviewFile } from "./ReviewStep";

type HarnessReviewInput = {
  active: boolean;
  targetDir: string;
  catalog: PackCatalog;
  pack: ResolvedPack;
  packId: string;
  selectedSkills: SkillRef[];
  selectedHooks: PackHookRef[];
  learnEnabled: boolean;
  ruleCount: number;
};

type HarnessReview = {
  plan: RenderPlan | null;
  files: ReviewFile[];
  existingHarness: boolean;
  blockerCount: number;
  error?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Builds the same filesystem-aware plan that headless dry-run and apply use. */
export function useHarnessReview(input: HarnessReviewInput): HarnessReview {
  const [review, setReview] = useState<HarnessReview>({
    plan: null,
    files: [],
    existingHarness: false,
    blockerCount: 0,
  });

  useEffect(() => {
    if (!input.active) return;

    let cancelled = false;
    setReview({ plan: null, files: [], existingHarness: false, blockerCount: 0 });

    createRenderPlan({
      targetDir: input.targetDir,
      pack: input.pack,
      skills: input.selectedSkills,
      learnEnabled: input.learnEnabled,
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
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.active, input.catalog, input.learnEnabled, input.pack, input.packId, input.ruleCount, input.selectedHooks, input.selectedSkills, input.targetDir]);

  return review;
}
