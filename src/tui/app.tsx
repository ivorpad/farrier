import { access } from "node:fs/promises";
import { join } from "node:path";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { adviseSkills, detectAgentBackend, resolveContext, type AdviseBackend } from "../engine/advise";
import { probeAgents, type AgentAvailability } from "../engine/backend";
import { detectPacks } from "../engine/detect";
import { agentsHardRules, createRenderPlan, type RenderPlan } from "../engine/render";
import { searchSkills, type SkillSearchResult } from "../engine/skills";
import { resolvePack, supportedPackIds } from "../packs/index";
import type { ResolvedPack } from "../packs/types";
import { createQueuedCollisionHandler, type CollisionPrompt } from "./collision";
import { runForgeWrite } from "./forge";
import { createInitialWizardState, wizardReducer, type PackDefaults, type WizardState } from "./machine";
import { StackStep } from "./StackStep";
import { SkillsStep } from "./SkillsStep";
import { WizardCreate } from "./wizard-create";
import { HooksStep } from "./HooksStep";
import { LearnStep } from "./LearnStep";
import { DoneStep, ReviewStep, WritingStep, type ReviewFile } from "./ReviewStep";

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
  const [reviewFiles, setReviewFiles] = useState<ReviewFile[]>([]);
  const [reviewError, setReviewError] = useState<string | undefined>(undefined);
  const [agentAvailability, setAgentAvailability] = useState<AgentAvailability | undefined>(undefined);
  const [createCancelling, setCreateCancelling] = useState(false);
  const [collision, setCollision] = useState<CollisionPrompt | null>(null);
  const createAbortRef = useRef<AbortController | null>(null);
  const collisionChainRef = useRef<Promise<void>>(Promise.resolve());

  // exitOnCtrlC is off (the default handler destroys the renderer and orphans
  // spawned agent runs), so ctrl+c is handled here: quit on ordinary steps,
  // abort-and-kill skill authoring while forging.
  useKeyboard((key) => {
    if (!(key.ctrl && key.name === "c")) {
      return;
    }

    if (state.step === "Writing") {
      setCreateCancelling(true);
      createAbortRef.current?.abort();
      collision?.resolve("keep");
    } else if (state.step === "Done") {
      props.onExit(state.writeStatus?.ok === false ? 1 : 0);
    } else {
      props.onExit(1);
    }
  });

  useEffect(() => {
    let cancelled = false;

    probeAgents()
      .then((availability) => {
        if (!cancelled) {
          setAgentAvailability(availability);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgentAvailability({ claude: false, codex: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPack = useMemo(() => selectedPackFromState(state), [state.packId, state.selectedHooks]);
  const ruleCount = useMemo(() => agentsHardRules(selectedPack).length, [selectedPack]);

  const searchCache = useRef(new Map<string, SkillSearchResult[]>());

  useEffect(() => {
    if (state.step !== "Skills") {
      return;
    }

    const query = state.skillQuery;
    const trimmed = query.trim();

    if (trimmed.length === 0) {
      return;
    }

    const cached = searchCache.current.get(trimmed);

    if (cached) {
      dispatch({ type: "SKILL_SEARCH_SUCCEEDED", query, results: cached });
      return;
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      dispatch({ type: "SKILL_SEARCH_STARTED", query });

      searchSkills(query, { signal: controller.signal })
        .then((results) => {
          searchCache.current.set(trimmed, results);
          dispatch({ type: "SKILL_SEARCH_SUCCEEDED", query, results });
        })
        .catch((error) => {
          if (controller.signal.aborted) {
            return;
          }

          dispatch({ type: "SKILL_SEARCH_FAILED", query, error: errorMessage(error) });
        });
    }, 300);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
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
    setReviewFiles([]);
    setReviewError(undefined);

    createRenderPlan({
      targetDir: props.targetDir,
      pack: selectedPack,
      skills: state.selectedSkills,
      learnEnabled: state.learnEnabled
    })
      .then(async (plan) => {
        // A/M markers for the manifest: A = new file, M = overwrites one
        // already on disk.
        const files = await Promise.all(
          plan.files.map(async (file) => ({
            path: file.path,
            content: file.content,
            exists: await access(join(plan.targetDir, file.path)).then(
              () => true,
              () => false
            )
          }))
        );

        if (!cancelled) {
          setReviewPlan(plan);
          setReviewFiles(files);
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
    setCreateCancelling(false);
    setCollision(null);
    const controller = new AbortController();
    createAbortRef.current = controller;
    const onCollision = createQueuedCollisionHandler({ signal: controller.signal, chainRef: collisionChainRef, setCollision });

    try {
      const result = await runForgeWrite({
        reviewPlan,
        selectedSkills: state.selectedSkills,
        createRequests: state.createRequests,
        targetDir: props.targetDir,
        signal: controller.signal,
        onCollision
      });

      dispatch({
        type: "WRITE_DONE",
        message: result.message,
        installResults: result.installResults,
        createOutcomes: result.createOutcomes
      });
    } catch (error) {
      dispatch({
        type: "WRITE_FAILED",
        message: `Write failed: ${errorMessage(error)}`
      });
    } finally {
      createAbortRef.current = null;
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
          packId={state.packId}
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

    case "Create":
      return (
        <WizardCreate
          requests={state.createRequests}
          availability={agentAvailability}
          targetDir={props.targetDir}
          packId={state.packId}
          onAdd={(request) => dispatch({ type: "ADD_CREATE_REQUEST", request })}
          onRemove={(index) => dispatch({ type: "REMOVE_CREATE_REQUEST", index })}
          onNext={() => dispatch({ type: "NEXT" })}
          onBack={() => dispatch({ type: "BACK" })}
        />
      );

    case "Hooks":
      return (
        <HooksStep
          availableHooks={state.availableHooks}
          selectedHooks={state.selectedHooks}
          toolPolicyRules={selectedPack.toolPolicyRules}
          onToggleHook={(hook) => dispatch({ type: "TOGGLE_HOOK", hook })}
          onNext={() => dispatch({ type: "NEXT" })}
          onBack={() => dispatch({ type: "BACK" })}
        />
      );

    case "Learn":
      return (
        <LearnStep
          learnEnabled={state.learnEnabled}
          toolPolicyRules={selectedPack.toolPolicyRules}
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
          verbs={selectedPack.verbs}
          ruleCount={ruleCount}
          selectedSkills={state.selectedSkills}
          selectedHooks={state.selectedHooks}
          createRequests={state.createRequests}
          learnEnabled={state.learnEnabled}
          files={reviewFiles}
          loading={!reviewPlan && !reviewError}
          error={reviewError}
          canConfirm={Boolean(reviewPlan && !reviewError)}
          onConfirm={confirmWrite}
          onBack={() => dispatch({ type: "BACK" })}
        />
      );

    case "Writing":
      return <WritingStep creatingCount={state.createRequests.length} cancelling={createCancelling} collision={collision} />;

    case "Done":
      return (
        <DoneStep
          writeStatus={state.writeStatus}
          installResults={state.installResults}
          createOutcomes={state.createOutcomes}
          fileCount={reviewPlan?.files.length ?? 0}
          hookCount={state.selectedHooks.length}
          skillCount={state.selectedSkills.length}
          ruleCount={ruleCount}
          onExit={() => props.onExit(0)}
        />
      );
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
    // Default ctrl+c would destroy the renderer and orphan spawned agent
    // runs mid-forge; WizardApp handles ctrl+c itself.
    renderer = await createCliRenderer({ exitOnCtrlC: false });
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
