import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { adviseSkills, detectAgentBackend, resolveContext, type AdviseBackend } from "../engine/advise";
import { probeAgents, type AgentAvailability } from "../engine/backend";
import { detectPacksWithEvidence, type DetectedPackEvidence } from "../engine/detect";
import { agentsHardRules } from "../engine/render";
import { HarnessApplyError } from "../engine/create-plan";
import { searchSkills, type SkillSearchResult } from "../engine/skills";
import { loadFarrierConfig, resolveModelSettings, type ModelsConfig } from "../config/farrier-config";
import { builtinCatalog, loadPackCatalog, type PackCatalog } from "../registry/catalog";
import { createQueuedCollisionHandler, type CollisionPrompt } from "./collision";
import { nextEvalPolicy, type SkillEvalPolicy } from "./create-eval";
import { runHarnessWrite } from "./harness-write";
import { generatorPresentation, selectedPackForWizard } from "./pack-presentation";
import { WizardDone } from "./wizard-done";
import { createInitialWizardState, wizardReducer, type PackDefaults, type WizardState } from "./machine";
import { StackStep } from "./StackStep";
import { SkillsStep } from "./SkillsStep";
import { WizardCreate } from "./wizard-create";
import { HooksStep } from "./HooksStep";
import { LearnStep } from "./LearnStep";
import { ReviewStep, WritingStep } from "./ReviewStep";
import { useHarnessReview } from "./use-harness-review";
import { idleExitBindings, resolveIntent } from "./keymap";

type WizardAppProps = {
  targetDir: string;
  detectedPacks: DetectedPackEvidence[];
  contextText?: string;
  contextSource?: string;
  adviseBackend?: AdviseBackend;
  adviseAutoStart?: boolean;
  catalog: PackCatalog;
  registryWarnings: string[];
  models: ModelsConfig;
  onExit: (code: number) => void;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function WizardApp(props: WizardAppProps) {
  const packIds = useMemo(() => props.catalog.packIds(), [props.catalog]);
  const defaultPackId = packIds.includes("python-fastapi") ? "python-fastapi" : (packIds[0] ?? "python-uv");

  const packDefaults = useMemo<PackDefaults>(() => {
    return Object.fromEntries(
      packIds.map((packId) => {
        const pack = props.catalog.resolvePack(packId);
        return [
          packId,
          {
            skills: pack.skills,
            hooks: pack.hooks,
          },
        ];
      }),
    );
  }, [packIds, props.catalog]);

  const initialState = useMemo(
    () =>
      createInitialWizardState({
        availablePackIds: packIds,
        fallbackPackId: defaultPackId,
        detectedPackId: props.detectedPacks[0]?.packId,
        packDefaults,
        contextText: props.contextText,
        contextSource: props.contextSource,
        adviseBackend: props.adviseBackend,
        adviseAutoStart: props.adviseAutoStart,
      }),
    [defaultPackId, packDefaults, packIds, props.adviseAutoStart, props.adviseBackend, props.contextSource, props.contextText, props.detectedPacks],
  );

  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const [agentAvailability, setAgentAvailability] = useState<AgentAvailability | undefined>(undefined);
  const [createCancelling, setCreateCancelling] = useState(false);
  const [collision, setCollision] = useState<CollisionPrompt | null>(null);
  const [evalPolicy, setEvalPolicy] = useState<SkillEvalPolicy>("ask");
  const createAbortRef = useRef<AbortController | null>(null);
  const collisionChainRef = useRef<Promise<void>>(Promise.resolve());

  // exitOnCtrlC is off (the default handler destroys the renderer and orphans
  // spawned agent runs), so ctrl+c is handled here: quit on ordinary steps,
  // abort-and-kill skill authoring while forging.
  useKeyboard((key) => {
    if (resolveIntent(idleExitBindings, key) !== "quit") {
      return;
    }

    if (state.step === "Writing") {
      setCreateCancelling(true);
      createAbortRef.current?.abort();
      collision?.resolve("keep");
    } else if (state.step === "Done") {
      // WizardDone owns ctrl+c: its eval screens cancel non-destructively and
      // the summary screen exits.
      return;
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

  const selectedPack = useMemo(() => selectedPackForWizard(props.catalog.resolvePack(state.packId), state.selectedHooks), [props.catalog, state.packId, state.selectedHooks]);
  const ruleCount = useMemo(() => agentsHardRules(selectedPack, state.agents).length, [selectedPack, state.agents]);
  const review = useHarnessReview({
    active: state.step === "Review",
    targetDir: props.targetDir,
    catalog: props.catalog,
    pack: selectedPack,
    packId: state.packId,
    selectedSkills: state.selectedSkills,
    selectedHooks: state.selectedHooks,
    agents: state.agents,
    learnEnabled: state.learnEnabled,
    ruleCount,
  });

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

          dispatch({
            type: "SKILL_SEARCH_FAILED",
            query,
            error: errorMessage(error),
          });
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

    const adviseBackend = state.adviseBackend ?? "claude";
    const adviseSettings = resolveModelSettings({
      models: props.models,
      backend: adviseBackend,
      role: "advise",
    });

    adviseSkills({
      targetDir: props.targetDir,
      packId: state.packId,
      contextText: state.contextText ?? "",
      backend: adviseBackend,
      model: adviseSettings.model,
      reasoningEffort: adviseSettings.reasoningEffort,
    })
      .then((result) => {
        if (!cancelled) {
          dispatch({
            type: "ADVISE_SUCCEEDED",
            recommendations: result.recommendations,
          });
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

  function selectPack(packId: string): void {
    const pack = props.catalog.resolvePack(packId);
    dispatch({
      type: "SELECT_PACK",
      packId,
      skills: pack.skills,
      hooks: pack.hooks,
    });
  }

  async function confirmWrite(forceReplace: boolean): Promise<void> {
    if (!review.plan || state.step !== "Review") {
      return;
    }

    dispatch({ type: "START_WRITING" });
    setCreateCancelling(false);
    setCollision(null);
    const controller = new AbortController();
    createAbortRef.current = controller;
    const onCollision = createQueuedCollisionHandler({
      signal: controller.signal,
      chainRef: collisionChainRef,
      setCollision,
    });

    try {
      const result = await runHarnessWrite({
        reviewPlan: review.plan,
        selectedSkills: state.selectedSkills,
        createRequests: state.createRequests,
        targetDir: props.targetDir,
        signal: controller.signal,
        forceReplace,
        onCollision,
        modelSettings: {
          claude: resolveModelSettings({
            models: props.models,
            backend: "claude",
            role: "skillCreation",
          }),
          codex: resolveModelSettings({
            models: props.models,
            backend: "codex",
            role: "skillCreation",
          }),
        },
      });

      dispatch({
        type: "WRITE_DONE",
        message: result.message,
        partial: result.partial,
        applyResult: result.applyResult,
        installResults: result.installResults,
        createOutcomes: result.createOutcomes,
      });
    } catch (error) {
      const applyError = error instanceof HarnessApplyError ? error : undefined;
      dispatch({
        type: "WRITE_FAILED",
        message: `Write failed: ${errorMessage(error)}`,
        mutationState: applyError?.mutationState ?? "not-started",
        recoveryPath: applyError?.backupDir ?? null,
        remediation: `Run \`farrier doctor --dir ${props.targetDir}\` before retrying.`,
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
          listings={props.catalog.listings()}
          warnings={props.registryWarnings}
          selectedPackId={state.packId}
          detectedPacks={props.detectedPacks}
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
          onQuit={() => props.onExit(1)}
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
          evalPolicy={evalPolicy}
          onCycleEvalPolicy={() => setEvalPolicy(nextEvalPolicy)}
          onAdd={(request) => dispatch({ type: "ADD_CREATE_REQUEST", request })}
          onRemove={(index) => dispatch({ type: "REMOVE_CREATE_REQUEST", index })}
          onNext={() => dispatch({ type: "NEXT" })}
          onBack={() => dispatch({ type: "BACK" })}
          onQuit={() => props.onExit(1)}
        />
      );

    case "Hooks":
      return (
        <HooksStep
          availableHooks={state.availableHooks}
          selectedHooks={state.selectedHooks}
          selectedAgents={state.agents}
          agentAvailability={agentAvailability}
          toolPolicyRules={selectedPack.toolPolicyRules}
          onToggleHook={(hook) => dispatch({ type: "TOGGLE_HOOK", hook })}
          onToggleAgent={(agent) => dispatch({ type: "TOGGLE_AGENT", agent })}
          onNext={() => dispatch({ type: "NEXT" })}
          onBack={() => dispatch({ type: "BACK" })}
          onQuit={() => props.onExit(1)}
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
          onQuit={() => props.onExit(1)}
        />
      );

    case "Review":
      return (
        <ReviewStep
          createRequests={state.createRequests}
          agents={state.agents}
          generator={generatorPresentation(selectedPack, props.catalog)}
          files={review.files}
          existingHarness={review.existingHarness}
          blockerCount={review.blockerCount}
          loading={!review.plan && !review.error}
          error={review.error}
          canConfirm={Boolean(review.plan && !review.error && !review.existingHarness && review.blockerCount === 0)}
          onConfirm={confirmWrite}
          onBack={() => dispatch({ type: "BACK" })}
          onQuit={() => props.onExit(1)}
        />
      );

    case "Writing":
      return (
        <WritingStep
          creatingCount={state.createRequests.length}
          cancelling={createCancelling}
          collision={collision}
          onCancel={() => {
            setCreateCancelling(true);
            createAbortRef.current?.abort();
            collision?.resolve("keep");
          }}
        />
      );

    case "Done":
      return (
        <WizardDone
          targetDir={props.targetDir}
          writeStatus={state.writeStatus}
          applyResult={state.applyResult}
          installResults={state.installResults}
          createOutcomes={state.createOutcomes}
          hookCount={state.selectedHooks.length}
          agents={state.agents}
          skillCount={state.selectedSkills.length}
          ruleCount={ruleCount}
          evalPolicy={evalPolicy}
          evalBackend={agentAvailability?.claude ? "claude" : agentAvailability?.codex ? "codex" : undefined}
          onExit={props.onExit}
        />
      );
  }
}

export async function runWizard(targetDir: string, options?: { context?: string }): Promise<number> {
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  let catalog: PackCatalog = builtinCatalog();
  let registryWarnings: string[] = [];
  let models: ModelsConfig = {};

  try {
    const config = await loadFarrierConfig({ projectDir: targetDir });
    models = config.config.models;
    if (Object.keys(config.config.registries).length > 0) {
      console.error("Loading registries...");
    }
    catalog = await loadPackCatalog({ config: config.config });
    registryWarnings = catalog.warnings.map((warning) => `${warning.namespace}: ${warning.message}`);
  } catch (error) {
    catalog = builtinCatalog();
    registryWarnings = [`Registry loading failed; showing built-in packs only: ${errorMessage(error)}`];
  }

  const detectedPacks = await detectPacksWithEvidence(targetDir, catalog).catch(() => []);

  const resolvedContext = await resolveContext({
    targetDir,
    context: options?.context,
  }).catch(() => undefined);
  const adviseBackend = (() => {
    try {
      return detectAgentBackend();
    } catch {
      return undefined;
    }
  })();

  try {
    // Default ctrl+c would destroy the renderer and orphan spawned agent
    // runs mid-write; WizardApp handles ctrl+c itself.
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
          detectedPacks={detectedPacks}
          contextText={resolvedContext?.text}
          contextSource={resolvedContext?.source}
          adviseBackend={adviseBackend}
          adviseAutoStart={options?.context !== undefined}
          catalog={catalog}
          registryWarnings={registryWarnings}
          models={models}
          onExit={finish}
        />,
      );
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier wizard: ${errorMessage(error)}`);
    return 1;
  }
}
