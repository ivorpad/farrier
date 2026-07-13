import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import {
  adviceBatchCounts,
  adviceBatchRetryableCount,
  completeAdviceBatch,
  createInitialAdviceBatchState,
  type AdviceBatchItemStatus,
  type AdviceBatchState
} from "../engine/advice-batch";
import type { AdviceCreationPlan } from "../engine/advice-apply";
import type { AdviceReport } from "../engine/advice-types";
import type { ApplyHarnessChangePlanResult } from "../engine/create-plan";
import { advicePlanPreviewLines } from "./AdviceApplyFlow";
import { DetailPane, KeyHints, palette, scrollWindow, truncateTo, useSpinner } from "./chrome";
import {
  adviceBatchCancellationBindings,
  binding,
  bindingsHint,
  defineBindings,
  destructiveConfirmationBindings,
  resolveIntent
} from "./keymap";

const previewPageSize = 3;

const statusMarker: Record<AdviceBatchItemStatus, string> = {
  queued: "○",
  running: "◌",
  planned: "◇",
  created: "✓",
  skipped: "–",
  failed: "✗",
  cancelled: "×"
};

function statusColor(status: AdviceBatchItemStatus): string {
  if (status === "created" || status === "planned") return palette.success;
  if (status === "failed" || status === "cancelled") return palette.warn;
  if (status === "running") return palette.agent;
  return palette.muted;
}

export function AdviceBatchFlow(props: {
  report: AdviceReport;
  onPlan: (
    previous: AdviceBatchState | undefined,
    signal: AbortSignal,
    onProgress: (state: AdviceBatchState) => void
  ) => Promise<AdviceBatchState>;
  onApply: (plan: AdviceCreationPlan, force: boolean) => Promise<ApplyHarnessChangePlanResult>;
  onBack: () => void;
  onDone: () => void;
  registerCancellation?: (cancel: (() => void) | undefined) => void;
}) {
  const [state, setState] = useState(() => createInitialAdviceBatchState(props.report));
  const [attempt, setAttempt] = useState(0);
  const [replacementArmed, setReplacementArmed] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [cancellationRequested, setCancellationRequested] = useState(false);
  const [result, setResult] = useState<ApplyHarnessChangePlanResult>();
  const previousRef = useRef<AdviceBatchState | undefined>(undefined);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const cancelDuringApplyRef = useRef(false);
  const spinner = useSpinner(state.phase === "planning" || state.phase === "applying");

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setCancellationRequested(false);
    let active = true;
    props.onPlan(previousRef.current, controller.signal, (progress) => {
      if (active) setState(progress);
    }).then((planned) => {
      if (active) setState(planned);
    }).catch((error) => {
      if (!active) return;
      setState((current) => ({
        ...current,
        phase: controller.signal.aborted ? "cancelled" : "error",
        error: controller.signal.aborted ? undefined : (error instanceof Error ? error.message : String(error))
      }));
    });
    return () => { active = false; };
  }, [attempt]);

  const cancel = () => {
    if (state.phase === "applying") {
      cancelDuringApplyRef.current = true;
      setCancellationRequested(true);
      return;
    }
    if (state.phase !== "planning") return;
    const controller = controllerRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    setCancellationRequested(true);
  };

  useEffect(() => {
    const active = state.phase === "planning" || state.phase === "applying";
    props.registerCancellation?.(active ? cancel : undefined);
    return () => props.registerCancellation?.(undefined);
  }, [state.phase]);

  const retry = () => {
    previousRef.current = state;
    cancelDuringApplyRef.current = false;
    setResult(undefined);
    setReplacementArmed(false);
    setFocusedIndex(0);
    setPreviewOffset(0);
    setAttempt((current) => current + 1);
  };

  const apply = (force: boolean) => {
    if (state.phase !== "review" || !state.plan) return;
    setState((current) => ({ ...current, phase: "applying", error: undefined }));
    props.onApply(state.plan, force).then((value) => {
      setResult(value);
      setState((current) => completeAdviceBatch(current));
    }).catch((error) => {
      setState((current) => ({ ...current, phase: "error", error: error instanceof Error ? error.message : String(error) }));
    });
  };

  const runningBindings = defineBindings(
    ...adviceBatchCancellationBindings,
    binding(["escape", "b", "q"], "interrupt", "cancel batch")
  );
  const applyingBindings = defineBindings(
    ...adviceBatchCancellationBindings,
    binding("q", "interrupt", "finish transaction, then stop")
  );
  const retryable = adviceBatchRetryableCount(state);
  const finishedBindings = defineBindings(
    ...(retryable > 0 || state.phase === "error" ? [binding("r", "retry", "retry unfinished")] : []),
    binding(["enter", "escape", "b"], "back", "report"),
    binding(["q", "ctrl+c"], "quit", "close")
  );
  const reviewBindings = replacementArmed
    ? defineBindings(
        ...destructiveConfirmationBindings,
        binding("b", "reject", "disarm"),
        binding(["up", "down"], "move", "files"),
        binding(["pageup", "pagedown"], "scroll", "preview"),
        binding("q", "quit", "abandon")
      )
    : defineBindings(
        binding(["up", "down"], "move", "files"),
        binding(["pageup", "pagedown"], "scroll", "preview"),
        binding("enter", "activate", "apply/review replacements"),
        binding(["escape", "b"], "back", "report"),
        binding("q", "quit", "abandon")
      );

  useKeyboard((key) => {
    if (state.phase === "planning") {
      if (resolveIntent(runningBindings, key)) cancel();
      return;
    }
    if (state.phase === "applying") {
      if (resolveIntent(applyingBindings, key)) cancel();
      return;
    }
    if (state.phase === "review" && state.inspection) {
      const intent = resolveIntent(reviewBindings, key);
      if (intent === "back") props.onBack();
      else if (intent === "quit") props.onDone();
      else if (intent === "reject") setReplacementArmed(false);
      else if (intent === "confirm") apply(true);
      else if (intent === "move") {
        setFocusedIndex((current) => Math.min(Math.max(0, current + (key.name === "down" ? 1 : -1)), state.inspection!.files.length - 1));
        setPreviewOffset(0);
      } else if (intent === "scroll" && key.name === "pageup") setPreviewOffset((current) => Math.max(0, current - previewPageSize));
      else if (intent === "scroll") setPreviewOffset((current) => current + previewPageSize);
      else if (intent === "activate" && state.inspection.blockers.length === 0) {
        if (state.inspection.replacementPaths.length > 0) setReplacementArmed(true);
        else apply(false);
      }
      return;
    }
    const intent = resolveIntent(finishedBindings, key);
    if (intent === "retry") retry();
    else if (intent === "back") props.onBack();
    else if (intent === "quit") props.onDone();
  });

  const counts = adviceBatchCounts(state);
  const statusTitle = state.phase === "planning"
    ? `${spinner}  Planning and authoring recommendation batch…`
    : state.phase === "applying"
      ? `${spinner}  Applying the reviewed manifest transactionally…`
      : state.phase === "review"
        ? "Review Create all manifest"
        : state.phase === "done"
          ? "Create all complete"
          : state.phase === "cancelled"
            ? "Create all cancelled"
            : "Create all needs attention";
  const files = state.inspection?.files ?? [];
  const clampedIndex = Math.min(focusedIndex, Math.max(files.length - 1, 0));
  const focused = files[clampedIndex];
  const window = scrollWindow(clampedIndex, files.length, 5);
  const planFile = focused ? state.plan?.files.find((file) => file.path === focused.path) : undefined;
  const previewLines = advicePlanPreviewLines(planFile?.content ?? "");
  const safePreviewOffset = Math.min(previewOffset, Math.max(previewLines.length - previewPageSize, 0));

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "row", width: "100%" }}>
        <text fg={palette.accent}>{statusTitle}</text>
        <box style={{ flexGrow: 1 }} />
        <text fg={palette.gold}>{`Active backend: ${state.backend === "claude" ? "Claude" : "Codex"}`}</text>
      </box>
      <text fg={palette.muted}>{`${counts.completed} completed · ${counts.running} running · ${counts.queued} queued`}</text>
      {state.items.map((item) => (
        <text key={item.recommendation.id}>
          <span fg={statusColor(item.status)}>{`${statusMarker[item.status]} ${item.status.padEnd(9)} `}</span>
          <span fg={palette.text}>{`${item.recommendation.id} — `}</span>
          <span fg={palette.muted}>{truncateTo(item.detail, 75)}</span>
        </text>
      ))}
      {cancellationRequested ? (
        <text fg={palette.warn}>{state.phase === "applying"
          ? "Cancellation requested after commit started; the atomic transaction will finish or roll back first."
          : "Cancelling: no new jobs will start; waiting for running backends to terminate and settle…"}</text>
      ) : null}
      {state.error ? <text fg={palette.warn}>{state.error}</text> : null}
      {state.phase === "review" && state.inspection ? (
        <box style={{ flexDirection: "column", gap: 0, flexGrow: 1 }}>
          <text fg={palette.gold}>{`${files.length} exact file(s) · ${state.inspection.replacementPaths.length} replacement(s) · ${state.inspection.blockers.length} blocked · nothing written yet`}</text>
          {files.slice(window.start, window.end).map((file, offset) => {
            const index = window.start + offset;
            return <text key={file.path} bg={index === clampedIndex ? palette.selBg : undefined}>{`${index === clampedIndex ? "▸" : " "} ${file.action.padEnd(9)} ${file.path}`}</text>;
          })}
          {focused ? <DetailPane
            title={`${focused.path} · complete content preview`}
            lines={[{ fg: palette.gold, text: focused.reason }, ...previewLines.slice(safePreviewOffset, safePreviewOffset + previewPageSize).map((text) => ({ fg: palette.muted, text }))]}
          /> : null}
          {state.inspection.blockers.length > 0
            ? <text fg={palette.warn}>Blocked paths must be resolved before apply.</text>
            : state.inspection.replacementPaths.length > 0
              ? <text fg={replacementArmed ? palette.warn : palette.gold}>{replacementArmed ? "Replacement armed. Press y to apply with backups; n or Escape disarms." : "Press Enter to review replacement risk, then y to apply."}</text>
              : <text fg={palette.gold}>Press Enter to apply this complete reviewed manifest.</text>}
        </box>
      ) : null}
      {state.phase === "done" && result ? <text fg={palette.success}>{`${result.written.length} written · ${result.unchanged.length} unchanged${result.backupDir ? ` · backups: ${result.backupDir}` : ""}`}</text> : null}
      {state.phase === "done" && cancelDuringApplyRef.current ? <text fg={palette.gold}>The cancellation arrived during the atomic transaction; it completed safely before stopping.</text> : null}
      <KeyHints hint={bindingsHint(state.phase === "planning" ? runningBindings : state.phase === "applying" ? applyingBindings : state.phase === "review" ? reviewBindings : finishedBindings)} />
    </box>
  );
}
