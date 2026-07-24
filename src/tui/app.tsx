import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { adviseSkills, type AdviseBackend } from "../engine/advise";
import { probeAgents, type AgentAvailability } from "../engine/backend";
import type { DetectedPackEvidence } from "../engine/detect";
import { agentsHardRules } from "../engine/render";
import { HarnessApplyError } from "../engine/create-plan";
import { searchSkills, type SkillSearchResult } from "../engine/skills";
import type { ModelsConfig } from "../config/farrier-config";
import type { PackCatalog } from "../registry/catalog";
import { createQueuedCollisionHandler, type CollisionPrompt } from "./collision";
import { nextEvalPolicy, type SkillEvalPolicy } from "./create-eval";
import { runHarnessWrite } from "./harness-write";
import { generatorPresentation, selectedPackForWizard } from "./pack-presentation";
import { WizardDone } from "./wizard-done";
import { createInitialWizardState, cycleAgents, isFirstWizardStep, wizardReducer, type PackDefaults, type WizardState } from "./machine";
import { skillInstallAgentIds } from "../engine/skill-paths";
import { AgentStep } from "./AgentStep";
import { StackStep } from "./StackStep";
import { SkillsStep } from "./SkillsStep";
import { WizardCreate } from "./wizard-create";
import { HooksStep } from "./HooksStep";
import { LearnStep } from "./LearnStep";
import { ReviewStep, WritingStep } from "./ReviewStep";
import { useHarnessReview } from "./use-harness-review";
import { KeyHints, palette, useSpinner } from "./chrome";
import { binding, bindingsHint, defineBindings, idleExitBindings, resolveIntent } from "./keymap";
import { sessionModelSettings, type SessionAgentContext } from "./session-context";
import { loadWizardBootstrap, resolveWizardContext, type WizardBootstrap } from "./wizard-bootstrap";

type WizardAppProps = {
  targetDir: string;
  detectedPacks: DetectedPackEvidence[];
  /** Languages the deterministic profile saw; shown on the Stack step when no pack matched. */
  profileLanguages?: string[];
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
  /** esc at the first step: return to the launcher instead of exiting farrier. */
  onLauncher: () => void;
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

  const initialState = useMemo(() => {
    // The startup screen already asked which agent; an unambiguous pick seeds
    // the default and skips the Agent step (Review keeps it editable via `a`).
    const startupAgents = props.session && props.session.agents.length > 0 ? props.session.agents : undefined;

    return createInitialWizardState({
      availablePackIds: packIds,
      fallbackPackId: defaultPackId,
      detectedPackId: props.detectedPacks[0]?.packId,
      packDefaults,
      contextText: props.contextText,
      contextSource: props.contextSource,
      adviseBackend: props.adviseBackend,
      defaultAgents: startupAgents,
      skipAgentStep: startupAgents !== undefined,
    });
  }, [defaultPackId, packDefaults, packIds, props.adviseBackend, props.contextSource, props.contextText, props.detectedPacks, props.session]);

  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const [agentAvailability, setAgentAvailability] = useState<AgentAvailability | undefined>(undefined);
  const [contextResolving, setContextResolving] = useState(false);
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
    const adviseSettings = sessionModelSettings({ session: props.session, models: props.models, backend: adviseBackend, role: "advise" });

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

  function submitContext(value: string): void {
    setContextResolving(true);
    // resolveWizardContext reads a path when the value names one, treats it as
    // the brief text otherwise, and appends the deterministic project profile.
    resolveWizardContext(props.targetDir, value)
      .then((resolved) => dispatch({ type: "SET_CONTEXT", text: resolved.text, source: resolved.source }))
      .catch(() => dispatch({ type: "SET_CONTEXT", text: value, source: "text" }))
      .finally(() => setContextResolving(false));
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
          claude: sessionModelSettings({ session: props.session, models: props.models, backend: "claude", role: "skillCreation" }),
          codex: sessionModelSettings({ session: props.session, models: props.models, backend: "codex", role: "skillCreation" }),
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
          onBack={props.onLauncher}
          onQuit={() => props.onExit(1)}
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
          profileLanguages={props.profileLanguages}
          onSelectPack={selectPack}
          onNext={() => dispatch({ type: "NEXT" })}
          onBack={() => (isFirstWizardStep(state) ? props.onLauncher() : dispatch({ type: "BACK" }))}
          onQuit={() => props.onExit(1)}
          contextSource={state.contextSource}
          contextPending={contextResolving}
          onContextSubmit={submitContext}
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
          models={props.models}
          session={props.session}
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
          onCycleAgents={() => dispatch({ type: "SELECT_AGENTS", agents: cycleAgents(state.agents) })}
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

const bootBindings = defineBindings(
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);

/**
 * The frame shown while loadWizardBootstrap scans the repo. Keyboard handling
 * lives here rather than in WizardBoot so the bindings unmount the moment the
 * wizard takes over — otherwise b/q would keep firing on every wizard step.
 */
function WizardBootFrame(props: { error?: string; onBack: () => void; onQuit: () => void }) {
  const spinner = useSpinner(!props.error);

  useKeyboard((key) => {
    const intent = resolveIntent(bootBindings, key);
    if (intent === "back") props.onBack();
    else if (intent === "quit") props.onQuit();
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", gap: 0 }}>
        <text fg={palette.accent}>{"🐴 farrier"}</text>
        {props.error ? (
          <text fg={palette.warn}>{`Repo inspection failed: ${props.error}`}</text>
        ) : (
          <text fg={palette.muted}>{`${spinner}  Inspecting the repo: detecting stacks, loading registries…`}</text>
        )}
      </box>
      <KeyHints hint={bindingsHint(bootBindings)} />
    </box>
  );
}

type WizardBootProps = {
  targetDir: string;
  context?: string;
  session?: SessionAgentContext;
  /** Injectable for tests; the default scans the repo and loads registries. */
  load?: typeof loadWizardBootstrap;
  onExit: (code: number) => void;
  onLauncher: () => void;
};

/**
 * Runs the bootstrap scan behind a visible loading frame instead of before the
 * renderer exists: awaiting loadWizardBootstrap first left the terminal on the
 * normal buffer for the whole scan — a flash of shell scrollback, then a blank
 * screen until the wizard painted. A scan failure renders in-frame (esc backs
 * out to the launcher) rather than tearing the TUI down to stderr.
 */
export function WizardBoot(props: WizardBootProps) {
  const [outcome, setOutcome] = useState<{ bootstrap?: WizardBootstrap; error?: string }>({});
  const load = props.load ?? loadWizardBootstrap;

  useEffect(() => {
    let cancelled = false;

    load(props.targetDir, props.context).then(
      (bootstrap) => {
        if (!cancelled) setOutcome({ bootstrap });
      },
      (cause) => {
        if (!cancelled) setOutcome({ error: errorMessage(cause) });
      }
    );

    return () => {
      cancelled = true;
    };
  }, [load, props.context, props.targetDir]);

  const bootstrap = outcome.bootstrap;
  if (!bootstrap) {
    return <WizardBootFrame error={outcome.error} onBack={props.onLauncher} onQuit={() => props.onExit(1)} />;
  }

  return (
    <WizardApp
      targetDir={props.targetDir}
      detectedPacks={bootstrap.detectedPacks}
      profileLanguages={bootstrap.profileLanguages}
      contextText={bootstrap.context?.text}
      contextSource={bootstrap.context?.source}
      adviseBackend={props.session?.backend ?? bootstrap.adviseBackend}
      skillQueries={bootstrap.skillQueries}
      catalog={bootstrap.catalog}
      registryWarnings={bootstrap.registryWarnings}
      models={bootstrap.models}
      session={props.session}
      onExit={props.onExit}
      onLauncher={props.onLauncher}
    />
  );
}

export async function runWizard(
  targetDir: string,
  options?: { context?: string; session?: SessionAgentContext }
): Promise<number | "back"> {
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;

  try {
    // Default ctrl+c would destroy the renderer and orphan spawned agent
    // runs mid-write; WizardApp handles ctrl+c itself.
    renderer = await createCliRenderer({ exitOnCtrlC: false });
    const cliRenderer = renderer;

    return await new Promise<number | "back">((resolve) => {
      let settled = false;

      const finish = (result: number | "back") => {
        if (settled) {
          return;
        }

        settled = true;
        cliRenderer.destroy();
        resolve(result);
      };

      createRoot(cliRenderer).render(
        <WizardBoot
          targetDir={targetDir}
          context={options?.context}
          session={options?.session}
          onExit={finish}
          onLauncher={() => finish("back")}
        />,
      );
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier wizard: ${errorMessage(error)}`);
    return 1;
  }
}
