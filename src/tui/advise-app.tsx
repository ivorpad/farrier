import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useReducer, useState } from "react";
import { formatAdviceReport } from "../cli/advise";
import { loadFarrierConfig } from "../config/farrier-config";
import { discoverProjectSessionCounts } from "../engine/advice-sessions";
import type { AdviceBatchState } from "../engine/advice-batch";
import { adviceCreationSupport, applyAdviceCreationPlan, type AdviceCreationPlan } from "../engine/advice-apply";
import { adviceSessionLookbackLabel, type AdviceRecommendation, type AdviceReport, type AdviceSessionCountInventory, type AdviceSessionLookback, type AdviceSessionSourceSummary } from "../engine/advice-types";
import { probeAgents, type AgentAvailability, type AgentBackend } from "../engine/backend";
import type { ApplyHarnessChangePlanResult, HarnessChangePlan } from "../engine/create-plan";
import type { SkillCreationRequest } from "../engine/create-skill";
import type { AdviceProgressEvent } from "../engine/project-advice";
import { AdviceApplyFlow } from "./AdviceApplyFlow";
import { AdviceBatchFlow } from "./AdviceBatchFlow";
import { adviceSkillCreationRequest, createAdviceWizardActions } from "./advice-actions";
import { adjacentAdviceLookback, adjacentAvailableAdviceBackend, adviceTuiReducer, adviceTuiScopes, createInitialAdviceTuiState, initialAdviceBackend, type AdviceTuiScope } from "./advise-machine";
import { KeyHints, palette, useSpinner } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent, runningCancellationBindings } from "./keymap";

export type AdviceWizardOutcome = "done" | "back" | "cancel" | { kind: "create-skill"; request: SkillCreationRequest };
export { adviceSkillCreationRequest, createAdviceWizardActions } from "./advice-actions";

const reportPageSize = 5;
export const adviceSetupControls = ["backend", "sessions", "lookback", "scope", "analyze"] as const;

function backendName(backend: AgentBackend): "Claude" | "Codex" {
  return backend === "claude" ? "Claude" : "Codex";
}

export function adviceBackendControlLabel(backend: AgentBackend, availability: AgentAvailability): string {
  const availabilityLabel = availability.claude && availability.codex
    ? "Claude and Codex available"
    : `${availability.claude ? "Codex" : "Claude"} unavailable`;
  return `Reasoning backend: ‹ ${backendName(backend)} › · ${availabilityLabel}`;
}

const adviceCancelBindings = defineBindings(
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);

export function isAdviceCancelKey(key: { name: string; ctrl?: boolean }): boolean {
  return resolveIntent(adviceCancelBindings, key) !== undefined;
}

export function adjacentAdviceRecommendationIndex(current: number, total: number, direction: -1 | 1): number {
  return Math.min(Math.max(current + direction, 0), Math.max(total - 1, 0));
}

function sourceLabel(sources: AdviceSessionSourceSummary[]): string {
  return sources.map((item) => `${item.source}: ${item.count}`).join(" · ") || "none";
}

export function formatAdviceTuiReportLines(report: AdviceReport): string[] {
  return formatAdviceReport(report).trimEnd().split("\n");
}

function reportLineColor(line: string): string {
  if (line === "Farrier project advice — report only") return palette.accent;
  if (["Codebase profile", "Recommendations", "Weak leads", "Coverage", "Evidence diagnostics", "Notes"].includes(line) || /^[A-Z]+$/.test(line)) return palette.gold;
  if (line.startsWith("  - ")) return palette.muted;
  return palette.text;
}

export type AdviceDecisionSummary = {
  why: string;
  benefit: string;
  evidence: string;
  creates: string;
};

export function adviceDecisionSummary(report: AdviceReport, recommendation: AdviceRecommendation): AdviceDecisionSummary {
  const evidenceById = new Map([...report.profile.evidence, ...report.sessions.evidence].map((item) => [item.id, item]));
  const matched = recommendation.evidence.flatMap((id) => evidenceById.get(id) ?? []);
  const primary = matched[0];
  const signalCount = matched.length || recommendation.evidence.length;
  const more = signalCount > 1 ? ` · +${signalCount - 1} more` : "";
  const evidence = primary
    ? `${primary.source}${primary.path ? ` · ${primary.path}` : ""}: ${primary.summary}${more}`
    : recommendation.evidence.join(", ");
  return {
    why: recommendation.reason,
    benefit: recommendation.benefit,
    evidence,
    creates: recommendation.implementationRoute.description
  };
}

export function AdviceApp(props: {
  sessionCounts: AdviceSessionCountInventory;
  availability: AgentAvailability;
  onBack: () => void;
  onCancel: () => void;
  onRun: (
    backend: AgentBackend,
    includeSessions: boolean,
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
  const [reportOffset, setReportOffset] = useState(0);
  const [setupFocus, setSetupFocus] = useState(0);
  const [creatingRecommendation, setCreatingRecommendation] = useState<AdviceRecommendation>();
  const [creatingAll, setCreatingAll] = useState(false);
  const [reportActionIndex, setReportActionIndex] = useState(0);
  const [actionMessage, setActionMessage] = useState<string>();
  const sources = props.sessionCounts[state.lookback];
  const sessionCount = sources.reduce((sum, item) => sum + item.count, 0);
  const spinner = useSpinner(state.status === "running");
  const reportBindings = defineBindings(
    binding(["up", "down"], "move", "select recommendation"),
    binding(["left", "right"], "action", "focus report action"),
    binding(["pageup", "pagedown"], "scroll", "scroll report"),
    binding("enter", "activate", "activate report action"),
    binding("r", "retry", "options/rerun"),
    binding(["escape", "b"], "back", "launcher"),
    binding(["q", "ctrl+c"], "quit", "close")
  );
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
    const request = { backend: state.backend, includeSessions: state.includeSessions, lookback: state.lookback, scope: state.scope };
    dispatch({ type: "START" });
    setTimeout(() => {
      props.onRun(request.backend, request.includeSessions, request.lookback, request.scope, (event) => dispatch({ type: "PROGRESS", message: event.message }))
        .then((report) => dispatch({ type: "SUCCEEDED", report }))
        .catch((error) => dispatch({ type: "FAILED", error: error instanceof Error ? error.message : String(error) }));
    }, 0);
  };

  useKeyboard((key) => {
    if (creatingRecommendation || creatingAll) return;
    if (state.status === "done") {
      const intent = resolveIntent(reportBindings, key);
      if (intent === "quit") props.onDone();
      else if (intent === "back") props.onBack();
      else if (intent === "retry") {
        setSelectedRecommendationIndex(0);
        setReportOffset(0);
        setReportActionIndex(0);
        setSetupFocus(0);
        dispatch({ type: "RESET" });
      }
      else if (intent === "move" && state.report) {
        const direction = key.name === "down" ? 1 : -1;
        setSelectedRecommendationIndex((current) => adjacentAdviceRecommendationIndex(current, state.report!.recommendations.length, direction));
        setActionMessage(undefined);
      } else if (intent === "action") {
        setReportActionIndex(key.name === "right" ? 1 : 0);
      } else if (intent === "scroll" && state.report) {
        const maximum = Math.max(formatAdviceTuiReportLines(state.report).length - reportPageSize, 0);
        setReportOffset((current) => Math.min(maximum, Math.max(0, current + (key.name === "pagedown" ? reportPageSize : -reportPageSize))));
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
        } else setActionMessage(support.description);
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
      if (backend) dispatch({ type: "SET_BACKEND", backend });
    } else if (intent === "toggle" && focusedControl === "sessions") dispatch({ type: "TOGGLE_SESSIONS" });
    else if (intent === "adjust" && focusedControl === "lookback") dispatch({ type: "SET_LOOKBACK", lookback: adjacentAdviceLookback(state.lookback, key.name === "right" ? 1 : -1) });
    else if (intent === "adjust" && focusedControl === "scope") {
      const index = adviceTuiScopes.indexOf(state.scope);
      dispatch({ type: "SET_SCOPE", scope: adviceTuiScopes[(index + (key.name === "right" ? 1 : -1) + adviceTuiScopes.length) % adviceTuiScopes.length]! });
    } else if (intent === "activate" && focusedControl === "sessions") dispatch({ type: "TOGGLE_SESSIONS" });
    else if (intent === "activate" && focusedControl === "analyze") start();
  });

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
    const lines = formatAdviceTuiReportLines(state.report);
    const selected = state.report.recommendations[selectedRecommendationIndex];
    const support = selected ? adviceCreationSupport(selected) : undefined;
    const decision = selected ? adviceDecisionSummary(state.report, selected) : undefined;
    const safeReportOffset = Math.min(reportOffset, Math.max(lines.length - reportPageSize, 0));
    const visibleReportLines = lines.slice(safeReportOffset, safeReportOffset + reportPageSize);
    const creatableCount = state.report.recommendations.filter((recommendation) => adviceCreationSupport(recommendation).kind !== "unsupported").length;
    return (
      <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
        <box style={{ flexDirection: "row", flexShrink: 0, width: "100%" }}>
          <text fg={palette.accent}>✦ Advice report</text>
          <box style={{ flexGrow: 1 }} />
          <text fg={palette.success}>{`${backendName(state.report.backend)} · ${state.report.recommendations.length} validated recommendation(s)`}</text>
        </box>
        {selected && decision ? (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            <text bg={palette.selBg}>
              <span fg={palette.accent}>{`▸ ${selectedRecommendationIndex + 1}/${state.report.recommendations.length} `}</span>
              <span fg={palette.text}>{selected.id}</span>
              <span fg={palette.gold}>{` · ${selected.confidence} confidence`}</span>
              <span fg={support?.kind === "unsupported" ? palette.warn : palette.success}>{` · ${support?.kind === "skill" ? "open skill creator" : support?.kind === "files" ? "review & create" : "manual only"}`}</span>
            </text>
            <text><span fg={palette.gold}>Why: </span><span fg={palette.text}>{decision.why}</span></text>
            <text><span fg={palette.gold}>Value: </span><span fg={palette.success}>{decision.benefit}</span></text>
            <text><span fg={palette.gold}>Evidence: </span><span fg={palette.muted}>{decision.evidence}</span></text>
            <text><span fg={palette.gold}>Creates: </span><span fg={palette.text}>{decision.creates}</span></text>
          </box>
        ) : null}
        <box style={{ flexDirection: "row", flexShrink: 0, gap: 2 }}>
          <text bg={reportActionIndex === 0 ? palette.selBg : undefined} fg={palette.text}>{`${reportActionIndex === 0 ? "▸ " : "  "}Create selected`}</text>
          <text bg={reportActionIndex === 1 ? palette.selBg : undefined} fg={palette.text}>{`${reportActionIndex === 1 ? "▸ " : "  "}Create all (${creatableCount})`}</text>
        </box>
        {actionMessage ? <text style={{ flexShrink: 0 }} fg={palette.warn}>{actionMessage}</text> : null}
        <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden", width: "100%" }}>
          <text style={{ flexShrink: 0 }} fg={palette.gold}>{`Full report · lines ${safeReportOffset + 1}–${safeReportOffset + visibleReportLines.length} of ${lines.length}`}</text>
          {visibleReportLines.map((line, index) => <text key={`${safeReportOffset + index}-${line}`} style={{ flexShrink: 0 }} fg={reportLineColor(line)}>{line || " "}</text>)}
        </box>
        <text style={{ flexShrink: 0 }} fg={palette.muted}>Analysis is read-only. Creation always opens a separate review and confirmation step.</text>
        <box style={{ flexShrink: 0 }}><KeyHints hint={bindingsHint(reportBindings)} /></box>
      </box>
    );
  }

  const setupLabels = [
    adviceBackendControlLabel(state.backend, state.availability),
    `${state.includeSessions ? "[x]" : "[ ]"} Include project sessions`,
    `Session window: ‹ ${adviceSessionLookbackLabel(state.lookback)} › (${sessionCount}; ${sourceLabel(sources)})`,
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
      <text fg={palette.faint}>The selected reasoning backend determines its isolated session evidence and recommendation target.</text>
      <text fg={palette.faint}>Only sessions whose resolved project directory matches exactly are eligible.</text>
      {state.status === "running" ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={palette.agent}>{`${spinner}  ${state.progress ?? "Analyzing bounded codebase and session evidence…"}`}</text>
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
    log: (message: string) => void;
  }> = {}
): Promise<AdviceWizardOutcome> {
  const log = dependencies.log ?? ((message: string) => console.error(message));
  const availability = await (dependencies.probeAvailability ?? probeAgents)();
  if (!initialAdviceBackend(availability)) {
    log("farrier advise: no agent backend found. Install claude or codex.");
    return "cancel";
  }
  log("farrier advise: Discovering exact-project session counts…");
  const sessionCounts = await discoverProjectSessionCounts({ targetDir, targets: ["claude", "codex"] });
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
