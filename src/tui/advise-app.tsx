import { createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useReducer, useRef, useState } from "react";
import { loadFarrierConfig } from "../config/farrier-config";
import {
  listProjectSessions,
  createRecentSessionConsent,
  type SessionConsent,
  type SessionMetadataInventory,
} from "../engine/advice-sessions";
import type { AdviceBatchState } from "../engine/advice-batch";
import { adviceCreationSupport, applyAdviceCreationPlan, type AdviceCreationPlan } from "../engine/advice-apply";
import { adviceSessionLookbackLabel, type AdviceRecommendation, type AdviceReport, type AdviceSessionCountInventory, type AdviceSessionLookback } from "../engine/advice-types";
import { probeAgents, type AgentAvailability, type AgentBackend } from "../engine/backend";
import type { ApplyHarnessChangePlanResult, HarnessChangePlan } from "../engine/create-plan";
import type { SkillCreationRequest } from "../engine/create-skill";
import type { AdviceProgressEvent } from "../engine/project-advice";
import { AdviceApplyFlow } from "./AdviceApplyFlow";
import { AdviceBatchFlow } from "./AdviceBatchFlow";
import { AdviceRegistryInspection } from "./AdviceRegistryInspection";
import {
  adjacentAdviceRecommendationIndex,
  adviceBackendControlLabel,
  adviceBackendProductName,
  adviceSessionConsentNotice,
  adviceSessionCountsFromMetadata,
  backendName,
  sessionEntriesForLookback,
} from "./advice-presenter";
import { AdviceReportView, adviceReportBindings } from "./AdviceReportView";
import { adviceSkillCreationRequest, createAdviceWizardActions } from "./advice-actions";
import { adjacentAdviceLookback, adjacentAvailableAdviceBackend, adviceTuiReducer, adviceTuiScopes, createInitialAdviceTuiState, initialAdviceBackend, type AdviceTuiScope } from "./advise-machine";
import { KeyHints, palette, useSpinner } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent, runningCancellationBindings } from "./keymap";
export type AdviceWizardOutcome = "done" | "back" | "cancel" | { kind: "create-skill"; request: SkillCreationRequest };
export { adviceSkillCreationRequest, createAdviceWizardActions } from "./advice-actions";
export * from "./advice-presenter";
export const adviceSetupControls = ["backend", "sessions", "lookback", "scope", "analyze"] as const;
export function AdviceApp(props: {
  sessionCounts: AdviceSessionCountInventory;
  sessionInventory: SessionMetadataInventory;
  availability: AgentAvailability;
  onBack: () => void;
  onCancel: () => void;
  onRun: (
    backend: AgentBackend,
    sessionConsent: SessionConsent | undefined,
    lookback: AdviceSessionLookback,
    scope: AdviceTuiScope,
    onProgress: (event: AdviceProgressEvent) => void
  ) => Promise<AdviceReport>;
  onPlan: (report: AdviceReport, recommendation: AdviceRecommendation) => Promise<{ plan: AdviceCreationPlan; inspection: HarnessChangePlan }>;
  onPlanBatch: (
    report: AdviceReport,
    previous: AdviceBatchState | undefined,
    signal: AbortSignal,
    onProgress: (state: AdviceBatchState) => void
  ) => Promise<AdviceBatchState>;
  onApply: (plan: AdviceCreationPlan, force: boolean) => Promise<ApplyHarnessChangePlanResult>;
  onCreateSkill: (request: SkillCreationRequest) => void;
  registerBatchCancellation?: (cancel: (() => void) | undefined) => void;
  onDone: () => void;
}) {
  const initialSessionCount = props.sessionCounts["7d"].reduce((sum, item) => sum + item.count, 0);
  const [state, dispatch] = useReducer(adviceTuiReducer, createInitialAdviceTuiState(initialSessionCount, props.availability));
  const [selectedRecommendationIndex, setSelectedRecommendationIndex] = useState(0);
  const reportScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const [setupFocus, setSetupFocus] = useState(0);
  const [creatingRecommendation, setCreatingRecommendation] = useState<AdviceRecommendation>();
  const [inspectingRecommendation, setInspectingRecommendation] = useState<AdviceRecommendation>();
  const [creatingAll, setCreatingAll] = useState(false);
  const [reportActionIndex, setReportActionIndex] = useState(0);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [actionMessage, setActionMessage] = useState<string>();
  const [setupNotice, setSetupNotice] = useState<{
    text: string;
    tone: "success" | "warn";
  }>();
  const availableSessions = sessionEntriesForLookback(props.sessionInventory.entries, state.lookback)
    .filter((entry) => entry.provider === state.backend);
  const spinner = useSpinner(state.status === "running");
  useEffect(() => {
    if (state.status !== "running") {
      setElapsedSeconds(0);
      return;
    }
    const started = Date.now();
    const interval = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [state.status]);
  const runningBindings = defineBindings(...runningCancellationBindings, binding(["escape", "b"], "back", "cancel"), binding("q", "quit", "quit"));
  const errorBindings = defineBindings(binding("r", "retry", "options"), binding(["escape", "b"], "back", "launcher"), binding(["q", "ctrl+c"], "quit", "quit"));
  const setupBindings = defineBindings(
    binding(["up", "down", "tab", "shift+tab"], "focus", "focus control"),
    binding(["left", "right"], "adjust", "change value"),
    binding("space", "toggle", "toggle option"),
    binding("enter", "activate", "activate"),
    binding(["escape", "b"], "back", "launcher"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );

  const start = () => {
    if (state.status !== "ready") return;
    const request = {
      backend: state.backend,
      sessionConsent: state.includeSessions ? state.sessionConsent : undefined,
      lookback: state.lookback,
      scope: state.scope
    };
    dispatch({ type: "START" });
    setTimeout(() => {
      props.onRun(
        request.backend,
        request.sessionConsent,
        request.lookback,
        request.scope,
        (event) => dispatch({ type: "PROGRESS", message: event.message })
      )
        .then((report) => dispatch({ type: "SUCCEEDED", report }))
        .catch((error) => dispatch({ type: "FAILED", error: error instanceof Error ? error.message : String(error) }));
    }, 0);
  };

  const enableSessionContext = () => {
    if (!availableSessions.length) {
      setSetupNotice({
        text: `No ${backendName(state.backend)} sessions were found in ${adviceSessionLookbackLabel(state.lookback).toLowerCase()}.`,
        tone: "warn",
      });
      return;
    }
    const consent = createRecentSessionConsent({
      inventory: { ...props.sessionInventory, entries: availableSessions },
      provider: state.backend,
    });
    if (!consent) return;
    dispatch({ type: "SET_SESSION_CONSENT", consent });
    setSetupFocus(adviceSetupControls.indexOf("analyze"));
    setSetupNotice({
      text: `Enabled ${consent.selected.length} recent ${backendName(state.backend)} session(s). See what will be sent, then press Enter to analyze.`,
      tone: "success",
    });
  };

  useKeyboard((key) => {
    if (creatingRecommendation || inspectingRecommendation || creatingAll) return;
    if (state.status === "done" && state.report) {
      // "t" is not a shared keymap chord; toggle the technical-details section directly.
      if (key.name === "t" && !key.ctrl && !key.meta && !key.super) {
        setShowTechnicalDetails((current) => !current);
        return;
      }
      const intent = resolveIntent(adviceReportBindings(state.report), key);
      if (intent === "quit") props.onDone();
      else if (intent === "back") props.onBack();
      else if (intent === "retry") {
        setSelectedRecommendationIndex(0);
        reportScrollRef.current?.scrollTo(0);
        setReportActionIndex(0);
        setShowTechnicalDetails(false);
        setSetupFocus(0);
        dispatch({ type: "RESET" });
      }
      else if (intent === "move" && state.report) {
        const direction = key.name === "down" ? 1 : -1;
        setSelectedRecommendationIndex((current) => adjacentAdviceRecommendationIndex(current, state.report!.recommendations.length, direction));
        setActionMessage(undefined);
      } else if (intent === "action") {
        setReportActionIndex(key.name === "right" ? 1 : 0);
      } else if (intent === "scroll") {
        reportScrollRef.current?.scrollBy(key.name === "pagedown" ? 0.85 : -0.85, "viewport");
      } else if (intent === "activate" && state.report) {
        if (reportActionIndex === 1) {
          setCreatingAll(true);
          setActionMessage(undefined);
          return;
        }
        const recommendation = state.report.recommendations[selectedRecommendationIndex];
        if (!recommendation) {
          setActionMessage("There is no recommendation to create.");
          return;
        }
        const support = adviceCreationSupport(recommendation);
        if (support.kind === "files") setCreatingRecommendation(recommendation);
        else if (support.kind === "skill") {
          props.onCreateSkill(adviceSkillCreationRequest(state.report.backend, recommendation));
        } else if (support.kind === "inspect") setInspectingRecommendation(recommendation);
        else setActionMessage(support.description);
      }
      return;
    }
    if (state.status === "running") {
      const intent = resolveIntent(runningBindings, key);
      if (intent) props.onCancel();
      return;
    }
    if (state.status === "error") {
      const intent = resolveIntent(errorBindings, key);
      if (intent === "retry") {
        setSetupFocus(0);
        dispatch({ type: "RESET" });
      }
      else if (intent === "back") props.onBack();
      else if (intent === "quit") props.onCancel();
      return;
    }
    const intent = resolveIntent(setupBindings, key);
    const focusedControl = adviceSetupControls[setupFocus];
    if (intent === "back") props.onBack();
    else if (intent === "quit") props.onCancel();
    else if (intent === "focus") {
      const delta = key.name === "up" || key.shift ? -1 : 1;
      setSetupFocus((current) => (current + delta + adviceSetupControls.length) % adviceSetupControls.length);
    } else if (intent === "adjust" && focusedControl === "backend") {
      const backend = adjacentAvailableAdviceBackend(state.backend, state.availability, key.name === "right" ? 1 : -1);
      if (backend) {
        setSetupNotice(undefined);
        dispatch({ type: "SET_BACKEND", backend });
      }
    } else if (intent === "adjust" && focusedControl === "sessions") {
      if (key.name === "right" && !state.includeSessions) enableSessionContext();
      else if (key.name === "left" && state.includeSessions) {
        dispatch({ type: "TOGGLE_SESSIONS" });
        setSetupNotice({ text: "Sessions off: analysis will use your project files only.", tone: "success" });
      }
    } else if (intent === "toggle" && focusedControl === "sessions") {
      if (state.includeSessions) {
        dispatch({ type: "TOGGLE_SESSIONS" });
        setSetupNotice({ text: "Sessions off: analysis will use your project files only.", tone: "success" });
      } else enableSessionContext();
    }
    else if (intent === "adjust" && focusedControl === "lookback") {
      setSetupNotice(undefined);
      dispatch({ type: "SET_LOOKBACK", lookback: adjacentAdviceLookback(state.lookback, key.name === "right" ? 1 : -1) });
    }
    else if (intent === "adjust" && focusedControl === "scope") {
      const index = adviceTuiScopes.indexOf(state.scope);
      dispatch({ type: "SET_SCOPE", scope: adviceTuiScopes[(index + (key.name === "right" ? 1 : -1) + adviceTuiScopes.length) % adviceTuiScopes.length]! });
    } else if (intent === "activate" && focusedControl === "sessions") {
      if (state.includeSessions) {
        dispatch({ type: "TOGGLE_SESSIONS" });
        setSetupNotice({ text: "Sessions off: analysis will use your project files only.", tone: "success" });
      } else enableSessionContext();
    }
    else if (intent === "activate" && focusedControl === "analyze") start();
  });

  if (inspectingRecommendation && state.report) {
    return (
      <AdviceRegistryInspection
        report={state.report}
        recommendation={inspectingRecommendation}
        onBack={() => setInspectingRecommendation(undefined)}
        onClose={props.onDone}
      />
    );
  }

  if (creatingRecommendation && state.report) {
    return (
      <AdviceApplyFlow
        recommendation={creatingRecommendation}
        onPlan={() => props.onPlan(state.report!, creatingRecommendation)}
        onApply={props.onApply}
        onBack={() => setCreatingRecommendation(undefined)}
        onCancel={props.onCancel}
        onDone={props.onDone}
      />
    );
  }

  if (creatingAll && state.report) {
    return (
      <AdviceBatchFlow
        report={state.report}
        onPlan={(previous, signal, onProgress) => props.onPlanBatch(state.report!, previous, signal, onProgress)}
        onApply={props.onApply}
        onBack={() => setCreatingAll(false)}
        onDone={props.onDone}
        registerCancellation={props.registerBatchCancellation}
      />
    );
  }

  if (state.status === "done" && state.report) {
    return (
      <AdviceReportView
        report={state.report}
        selectedRecommendationIndex={selectedRecommendationIndex}
        reportActionIndex={reportActionIndex}
        actionMessage={actionMessage}
        showTechnicalDetails={showTechnicalDetails}
        scrollRef={reportScrollRef}
      />
    );
  }

  const setupLabels = [
    adviceBackendControlLabel(state.backend, state.availability),
    state.includeSessions && state.sessionConsent
      ? `[x] Use ${state.sessionConsent.selected.length} recent ${backendName(state.backend)} sessions`
      : `[ ] Use recent ${backendName(state.backend)} sessions · ${availableSessions.length} available`,
    `Session window: ‹ ${adviceSessionLookbackLabel(state.lookback)} ›`,
    `Recommendation scope: ${state.scope === "all" ? "all categories" : state.scope}`,
    "Analyze project"
  ];

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column" }}>
        <text fg={palette.accent}>✦ Advise this project</text>
        <text fg={palette.muted}>Read-only analysis of guidance, hooks, skills, subagents, plugins, and MCP.</text>
      </box>
      {setupLabels.map((label, index) => (
        <text key={adviceSetupControls[index]!} bg={setupFocus === index ? palette.selBg : undefined}>
          <span fg={palette.accent}>{setupFocus === index ? "▸ " : "  "}</span><span fg={palette.text}>{label}</span>
        </text>
      ))}
      <text fg={palette.faint}>Which AI reads your project and writes the suggestions.</text>
      {state.includeSessions && state.sessionConsent ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          {adviceSessionConsentNotice({ backend: state.backend, sessionCount: state.sessionConsent.selected.length }).map((line, index) => (
            <text key={`consent-${index}`} fg={index === 0 ? palette.warn : palette.muted}>{line}</text>
          ))}
        </box>
      ) : (
        <text fg={palette.faint}>Sessions off: analysis uses your project files only.</text>
      )}
      <text fg={palette.faint}>Recent work helps find repeated instructions, corrections, failed checks, and missing project automation.</text>
      <text fg={palette.faint}>Secrets are stripped on this computer before anything is sent. One selected category is one {backendName(state.backend)} call; all categories run six workers (three at a time) and usually one coordinator.</text>
      {setupNotice ? <text fg={setupNotice.tone === "success" ? palette.success : palette.warn}>{setupNotice.text}</text> : null}
      {state.status === "running" ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={palette.agent}>{`${spinner}  ${elapsedSeconds}s  Reading your project and asking ${adviceBackendProductName(state.backend)} for suggestions…`}</text>
          <text fg={palette.faint}>{`Usually takes 1–3 minutes and uses your ${backendName(state.backend)} account.`}</text>
          {state.progressHistory.slice(-7).map((message, index, visible) => (
            <text key={`${index}-${message}`} fg={index === visible.length - 1 ? palette.text : palette.success}>
              {`${index === visible.length - 1 ? "  ▸" : "  ✓"} ${message}`}
            </text>
          ))}
        </box>
      ) : null}
      {state.status === "error" ? <text fg={palette.warn}>Advice failed: {state.error}</text> : null}
      <text fg={palette.muted}>Analysis is read-only. Creating a recommendation requires a separate review and confirmation.</text>
      <KeyHints hint={bindingsHint(state.status === "error" ? errorBindings : state.status === "running" ? runningBindings : setupBindings)} />
    </box>
  );
}

export async function runAdviceWizard(
  targetDir: string,
  dependencies: Partial<{
    probeAvailability: () => Promise<AgentAvailability>;
    listSessions: typeof listProjectSessions;
    log: (message: string) => void;
  }> = {}
): Promise<AdviceWizardOutcome> {
  const log = dependencies.log ?? ((message: string) => console.error(message));
  const availability = await (dependencies.probeAvailability ?? probeAgents)();
  if (!initialAdviceBackend(availability)) {
    log("farrier advise: no agent backend found. Install claude or codex.");
    return "cancel";
  }
  log("farrier advise: Discovering exact-project session metadata…");
  const sessionInventory = await (dependencies.listSessions ?? listProjectSessions)({
    targetDir,
    targets: ["claude", "codex"],
    lookback: "all",
  });
  const sessionCounts = adviceSessionCountsFromMetadata(sessionInventory);
  const controller = new AbortController();
  const actions = createAdviceWizardActions({
    targetDir,
    signal: controller.signal,
    loadModels: () => loadFarrierConfig({ projectDir: targetDir }).then((loaded) => loaded.config.models).catch(() => ({}))
  });
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  let sigintHandler: (() => void) | undefined;
  try {
    renderer = await createCliRenderer({ exitOnCtrlC: false });
    const cliRenderer = renderer;
    return await new Promise<AdviceWizardOutcome>((done) => {
      let settled = false;
      let applyingFiles = false;
      let activeBatchCancel: (() => void) | undefined;
      const finish = (outcome: AdviceWizardOutcome) => {
        if (settled) return;
        settled = true;
        if (sigintHandler) process.off("SIGINT", sigintHandler);
        cliRenderer.destroy();
        done(outcome);
      };
      const cancel = () => {
        if (activeBatchCancel) {
          activeBatchCancel();
          if (sigintHandler) process.once("SIGINT", sigintHandler);
          return;
        }
        if (applyingFiles) {
          if (sigintHandler) process.once("SIGINT", sigintHandler);
          return;
        }
        controller.abort();
        finish("cancel");
      };
      sigintHandler = cancel;
      process.once("SIGINT", sigintHandler);
      createRoot(cliRenderer).render(
        <AdviceApp
          sessionCounts={sessionCounts}
          sessionInventory={sessionInventory}
          availability={availability}
          onBack={() => finish("back")}
          onCancel={cancel}
          onDone={() => finish("done")}
          onCreateSkill={(request) => finish({ kind: "create-skill", request })}
          onPlan={actions.onPlan}
          onPlanBatch={actions.onPlanBatch}
          registerBatchCancellation={(handler) => { activeBatchCancel = handler; }}
          onApply={async (plan, force) => {
            applyingFiles = true;
            try {
              return await applyAdviceCreationPlan(targetDir, plan, force);
            } finally {
              applyingFiles = false;
            }
          }}
          onRun={actions.onRun}
        />
      );
    });
  } catch (error) {
    controller.abort();
    if (sigintHandler) process.off("SIGINT", sigintHandler);
    renderer?.destroy();
    log(`farrier advise: ${error instanceof Error ? error.message : String(error)}`);
    return "cancel";
  }
}
