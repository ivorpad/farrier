import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { adviseSkills, detectAgentBackend, resolveContext, type AdviseBackend } from "../engine/advise";
import { detectPacks } from "../engine/detect";
import { createRenderPlan, writeRenderPlan, type RenderPlan } from "../engine/render";
import { installSkills, searchSkills } from "../engine/skills";
import { resolvePack, supportedPackIds } from "../packs/index";
import type { ResolvedPack } from "../packs/types";
import { createInitialWizardState, wizardReducer, type PackDefaults, type WizardState } from "./machine";
import { StackStep } from "./StackStep";
import { SkillsStep } from "./SkillsStep";
import { HooksStep } from "./HooksStep";
import { LearnStep } from "./LearnStep";
import { DoneStep, ReviewStep, WritingStep } from "./ReviewStep";

type WizardAppProps = {
  targetDir: string;
  detectedPackId?: string;
  contextText?: string;
  contextSource?: string;
  adviseBackend?: AdviseBackend;
  adviseAutoStart?: boolean;
  onExit: (code: number) => void;
};

function selectedPackFromState(state: WizardState): ResolvedPack {
  const pack = resolvePack(state.packId);
  return {
    ...pack,
    hooks: [...state.selectedHooks]
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function WizardApp(props: WizardAppProps) {
  const packIds = useMemo(() => supportedPackIds(), []);
  const defaultPackId = packIds.includes("python-fastapi") ? "python-fastapi" : packIds[0] ?? "python-uv";

  const packDefaults = useMemo<PackDefaults>(() => {
    return Object.fromEntries(
      packIds.map((packId) => {
        const pack = resolvePack(packId);
        return [
          packId,
          {
            skills: pack.skills,
            hooks: pack.hooks
          }
        ];
      })
    );
  }, [packIds]);

  const initialState = useMemo(
    () =>
      createInitialWizardState({
        availablePackIds: packIds,
        fallbackPackId: defaultPackId,
        detectedPackId: props.detectedPackId,
        packDefaults,
        contextText: props.contextText,
        contextSource: props.contextSource,
        adviseBackend: props.adviseBackend,
        adviseAutoStart: props.adviseAutoStart
      }),
    [defaultPackId, packDefaults, packIds, props.adviseAutoStart, props.adviseBackend, props.contextSource, props.contextText, props.detectedPackId]
  );

  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const [reviewPlan, setReviewPlan] = useState<RenderPlan | null>(null);
  const [reviewError, setReviewError] = useState<string | undefined>(undefined);

  const selectedPack = useMemo(() => selectedPackFromState(state), [state.packId, state.selectedHooks]);

  useEffect(() => {
    if (state.step !== "Skills") {
      return;
    }

    const query = state.skillQuery;

    if (query.trim().length === 0) {
      return;
    }

    const timeout = setTimeout(() => {
      dispatch({ type: "SKILL_SEARCH_STARTED", query });

      searchSkills(query)
        .then((results) => {
          dispatch({ type: "SKILL_SEARCH_SUCCEEDED", query, results });
        })
        .catch((error) => {
          dispatch({ type: "SKILL_SEARCH_FAILED", query, error: errorMessage(error) });
        });
    }, 300);

    return () => clearTimeout(timeout);
  }, [state.skillQuery, state.step]);

  useEffect(() => {
    // adviseStatus stays out of the deps: ADVISE_STARTED flips it to "running",
    // and re-running the effect on that change would cancel its own request.
    // No step gate: research starts at launch so results are ready by the Skills step.
    if (!state.adviseEnabled || state.adviseStatus === "ready" || state.adviseStatus === "error") {
      return;
    }

    let cancelled = false;

    dispatch({ type: "ADVISE_STARTED" });

    adviseSkills({
      targetDir: props.targetDir,
      packId: state.packId,
      contextText: state.contextText ?? "",
      backend: state.adviseBackend ?? "claude"
    })
      .then((result) => {
        if (!cancelled) {
          dispatch({ type: "ADVISE_SUCCEEDED", recommendations: result.recommendations });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          dispatch({ type: "ADVISE_FAILED", error: errorMessage(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.targetDir, state.adviseBackend, state.adviseEnabled, state.contextText, state.packId]);

  useEffect(() => {
    if (state.step !== "Review") {
      return;
    }

    let cancelled = false;

    setReviewPlan(null);
    setReviewError(undefined);

    createRenderPlan({
      targetDir: props.targetDir,
      pack: selectedPack,
      skills: state.selectedSkills,
      learnEnabled: state.learnEnabled
    })
      .then((plan) => {
        if (!cancelled) {
          setReviewPlan(plan);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setReviewError(errorMessage(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.targetDir, selectedPack, state.learnEnabled, state.selectedSkills, state.step]);

  function selectPack(packId: string): void {
    const pack = resolvePack(packId);
    dispatch({
      type: "SELECT_PACK",
      packId,
      skills: pack.skills,
      hooks: pack.hooks
    });
  }

  async function confirmWrite(): Promise<void> {
    if (!reviewPlan || state.step !== "Review") {
      return;
    }

    dispatch({ type: "START_WRITING" });

    try {
      await writeRenderPlan(reviewPlan);

      const installResults = await installSkills(state.selectedSkills, props.targetDir);
      const failedInstalls = installResults.filter((result) => !result.ok).length;
      const installed = installResults.length - failedInstalls;

      const installSummary =
        installResults.length === 0
          ? "No skills selected for install."
          : `Installed ${installed} skill(s); ${failedInstalls} failed.`;

      dispatch({
        type: "WRITE_DONE",
        message: `Wrote ${reviewPlan.files.length} farrier harness files. ${installSummary}`,
        installResults
      });
    } catch (error) {
      dispatch({
        type: "WRITE_FAILED",
        message: `Write failed: ${errorMessage(error)}`
      });
    }
  }

  switch (state.step) {
    case "Stack":
      return (
        <StackStep
          packIds={state.availablePackIds}
          selectedPackId={state.packId}
          detectedPackId={state.detectedPackId}
          onSelectPack={selectPack}
          onNext={() => dispatch({ type: "NEXT" })}
          onCancel={() => props.onExit(1)}
        />
      );

    case "Skills":
      return (
        <SkillsStep
          query={state.skillQuery}
          results={state.skillResults}
          selectedSkills={state.selectedSkills}
          status={state.skillSearchStatus}
          error={state.skillSearchError}
          onQueryChange={(query) => dispatch({ type: "SET_SKILL_QUERY", query })}
          onToggleSkill={(ref) => dispatch({ type: "TOGGLE_SKILL", ref })}
          onNext={() => dispatch({ type: "NEXT" })}
          onBack={() => dispatch({ type: "BACK" })}
          adviseAvailable={Boolean(state.contextText && state.adviseBackend)}
          adviseBackend={state.adviseBackend}
          adviseEnabled={state.adviseEnabled}
          adviseStatus={state.adviseStatus}
          adviseError={state.adviseError}
          recommendations={state.recommendations}
          onToggleAdvise={() => dispatch({ type: "TOGGLE_ADVISE" })}
        />
      );

    case "Hooks":
      return (
        <HooksStep
          availableHooks={state.availableHooks}
          selectedHooks={state.selectedHooks}
          onToggleHook={(hook) => dispatch({ type: "TOGGLE_HOOK", hook })}
          onNext={() => dispatch({ type: "NEXT" })}
          onBack={() => dispatch({ type: "BACK" })}
        />
      );

    case "Learn":
      return (
        <LearnStep
          learnEnabled={state.learnEnabled}
          onToggleLearn={() => dispatch({ type: "TOGGLE_LEARN" })}
          onNext={() => dispatch({ type: "NEXT" })}
          onBack={() => dispatch({ type: "BACK" })}
        />
      );

    case "Review":
      return (
        <ReviewStep
          targetDir={props.targetDir}
          packId={state.packId}
          selectedSkills={state.selectedSkills}
          selectedHooks={state.selectedHooks}
          learnEnabled={state.learnEnabled}
          files={reviewPlan?.files.map((file) => file.path) ?? []}
          loading={!reviewPlan && !reviewError}
          error={reviewError}
          canConfirm={Boolean(reviewPlan && !reviewError)}
          onConfirm={confirmWrite}
          onBack={() => dispatch({ type: "BACK" })}
        />
      );

    case "Writing":
      return <WritingStep />;

    case "Done":
      return <DoneStep writeStatus={state.writeStatus} installResults={state.installResults} onExit={() => props.onExit(0)} />;
  }
}

export async function runWizard(targetDir: string, options?: { context?: string }): Promise<number> {
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;

  const detectedPackId = await detectPacks(targetDir)
    .then((detected) => detected[0])
    .catch(() => undefined);

  const resolvedContext = await resolveContext({ targetDir, context: options?.context }).catch(() => undefined);
  const adviseBackend = (() => {
    try {
      return detectAgentBackend();
    } catch {
      return undefined;
    }
  })();

  try {
    renderer = await createCliRenderer();
    const cliRenderer = renderer;

    return await new Promise<number>((resolve) => {
      let settled = false;

      const finish = (code: number) => {
        if (settled) {
          return;
        }

        settled = true;
        cliRenderer.destroy();
        resolve(code);
      };

      createRoot(cliRenderer).render(
        <WizardApp
          targetDir={targetDir}
          detectedPackId={detectedPackId}
          contextText={resolvedContext?.text}
          contextSource={resolvedContext?.source}
          adviseBackend={adviseBackend}
          adviseAutoStart={options?.context !== undefined}
          onExit={finish}
        />
      );
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier wizard: ${errorMessage(error)}`);
    return 1;
  }
}
