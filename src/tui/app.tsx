import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { adviseSkills, type AdviseBackend } from "../engine/advise";
import { probeAgents, type AgentAvailability } from "../engine/backend";
import type { DetectedPackEvidence } from "../engine/detect";
import { agentsHardRules } from "../engine/render";
import { HarnessApplyError } from "../engine/create-plan";
import { searchSkills, type SkillSearchResult } from "../engine/skills";
import { resolveModelSettings, type ModelsConfig } from "../config/farrier-config";
import type { PackCatalog } from "../registry/catalog";
import { createQueuedCollisionHandler, type CollisionPrompt } from "./collision";
import { nextEvalPolicy, type SkillEvalPolicy } from "./create-eval";
import { runHarnessWrite } from "./harness-write";
import { generatorPresentation, selectedPackForWizard } from "./pack-presentation";
import { WizardDone } from "./wizard-done";
import { createInitialWizardState, wizardReducer, type PackDefaults, type WizardState } from "./machine";
import { skillInstallAgentIds } from "../engine/skill-paths";
import { AgentStep } from "./AgentStep";
import { StackStep } from "./StackStep";
import { SkillsStep } from "./SkillsStep";
import { WizardCreate } from "./wizard-create";
import { HooksStep } from "./HooksStep";
import { LearnStep } from "./LearnStep";
import { ReviewStep, WritingStep } from "./ReviewStep";
import { useHarnessReview } from "./use-harness-review";
import { idleExitBindings, resolveIntent } from "./keymap";
import type { SessionAgentContext } from "./session-context";
import { loadWizardBootstrap } from "./wizard-bootstrap";

type WizardAppProps = {
  targetDir: string;
  detectedPacks: DetectedPackEvidence[];
  contextText?: string;
  contextSource?: string;
  adviseBackend?: AdviseBackend;
  skillQueries: string[];
  catalog: PackCatalog;
  registryWarnings: string[];
  models: ModelsConfig;
  /** Startup pick: seeds the Agent step default and model overrides; never locks them. */
  session?: SessionAgentContext;
  onExit: (code: number) => void;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function WizardApp(props: WizardAppProps) {
  const packIds = useMemo(() => props.catalog.packIds(), [props.catalog]);
  // Only guarantees the available list is non-empty; it is not a preselection.
  // Zero-detection leaves the stack unselected (see createInitialWizardState).
  const defaultPackId = packIds[0] ?? "python-uv";

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
        defaultAgents: props.session && props.session.agents.length > 0 ? props.session.agents : undefined,
      }),
    [defaultPackId, packDefaults, packIds, props.adviseBackend, props.contextSource, props.contextText, props.detectedPacks, props.session],
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
  // abort-and-kill skill authoring while the harness is being created.
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

  // Before a stack is picked (Agent/Stack steps) packId is "" and would not
  // resolve; fall back to any available pack so the memo never throws. The value
  // is unused until a pack is selected, at which point packId drives it.
  const selectedPack = useMemo(() => selectedPackForWizard(props.catalog.resolvePack(state.packId || state.availablePackIds[0] || defaultPackId), state.selectedHooks), [defaultPackId, props.catalog, state.availablePackIds, state.packId, state.selectedHooks]);
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
    const queries = trimmed ? [trimmed] : props.skillQueries;
    if (queries.length === 0) return;
    const cacheKey = queries.join("\0");
    const cached = searchCache.current.get(cacheKey);

    if (cached) {
      dispatch({ type: "SKILL_SEARCH_SUCCEEDED", query, results: cached });
      return;
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      dispatch({ type: "SKILL_SEARCH_STARTED", query });

      Promise.allSettled(queries.map((item) => searchSkills(item, { signal: controller.signal })))
        .then((outcomes) => {
          if (controller.signal.aborted) return;
          const results = Array.from(new Map(outcomes.flatMap((outcome) =>
            outcome.status === "fulfilled"
              ? outcome.value.map((item) => [`${item.source}@${item.skillId}`, item] as const)
              : [])).values()).sort((left, right) => right.installs - left.installs);
          const failures = outcomes.filter((outcome) => outcome.status === "rejected");
          if (results.length === 0 && failures.length === outcomes.length) {
            const first = failures[0] as PromiseRejectedResult | undefined;
            throw first?.reason ?? new Error("skills.sh search failed");
          }
          searchCache.current.set(cacheKey, results);
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
  }, [props.skillQueries, state.skillQuery, state.step]);

  useEffect(() => {
    // adviseStatus stays out of the deps: ADVISE_STARTED flips it to "running",
    // and re-running the effect on that change would cancel its own request.
    if (state.step !== "Skills" || !state.adviseEnabled || state.adviseStatus === "ready" || state.adviseStatus === "error") {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    dispatch({ type: "ADVISE_STARTED" });

    const adviseBackend = state.adviseBackend ?? "claude";
    const adviseSettings = resolveModelSettings({
      models: props.models,
      backend: adviseBackend,
      role: "advise",
      explicitModel: props.session?.models[adviseBackend],
      explicitReasoningEffort: props.session?.efforts[adviseBackend],
    });

    adviseSkills({
      targetDir: props.targetDir,
      packId: state.packId,
      contextText: state.contextText ?? "",
      backend: adviseBackend,
      model: adviseSettings.model,
      reasoningEffort: adviseSettings.reasoningEffort,
      signal: controller.signal,
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
      controller.abort(new Error("Skill research was cancelled."));
    };
  }, [props.targetDir, state.adviseBackend, state.adviseEnabled, state.contextText, state.packId, state.step]);

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
        installAgents: skillInstallAgentIds(state.agents, state.shareSkillsWithOtherAgent),
        modelSettings: {
          claude: resolveModelSettings({
            models: props.models,
            backend: "claude",
            role: "skillCreation",
            explicitModel: props.session?.models.claude,
            explicitReasoningEffort: props.session?.efforts.claude,
          }),
          codex: resolveModelSettings({
            models: props.models,
            backend: "codex",
            role: "skillCreation",
            explicitModel: props.session?.models.codex,
            explicitReasoningEffort: props.session?.efforts.codex,
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
    case "Agent":
      return (
        <AgentStep
          selectedAgents={state.agents}
          onSelectAgents={(agents) => dispatch({ type: "SELECT_AGENTS", agents })}
          onNext={() => dispatch({ type: "NEXT" })}
          onCancel={() => props.onExit(1)}
        />
      );

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
          adviseContextSource={state.contextSource}
          adviseBackend={state.adviseBackend}
          adviseEnabled={state.adviseEnabled}
          adviseStatus={state.adviseStatus}
          adviseError={state.adviseError}
          recommendations={state.recommendations}
          onToggleAdvise={() => dispatch({ type: "TOGGLE_ADVISE" })}
          agents={state.agents}
          shareSkillsWithOtherAgent={state.shareSkillsWithOtherAgent}
          onToggleShareSkills={() => dispatch({ type: "TOGGLE_SHARE_SKILLS" })}
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
          toolPolicyRules={selectedPack.toolPolicyRules}
          onToggleHook={(hook) => dispatch({ type: "TOGGLE_HOOK", hook })}
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

export async function runWizard(targetDir: string, options?: { context?: string; session?: SessionAgentContext }): Promise<number> {
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  const bootstrap = await loadWizardBootstrap(targetDir, options?.context);

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
          detectedPacks={bootstrap.detectedPacks}
          contextText={bootstrap.context?.text}
          contextSource={bootstrap.context?.source}
          adviseBackend={options?.session?.backend ?? bootstrap.adviseBackend}
          skillQueries={bootstrap.skillQueries}
          catalog={bootstrap.catalog}
          registryWarnings={bootstrap.registryWarnings}
          models={bootstrap.models}
          session={options?.session}
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
