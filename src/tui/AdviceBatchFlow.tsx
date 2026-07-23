import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import {
  adviceBatchCounts,
  adviceBatchRetryableCount,
  completeAdviceBatch,
  createInitialAdviceBatchState,
  defaultAdviceBatchConcurrency,
  type AdviceBatchItemStatus,
  type AdviceBatchState
} from "../engine/advice-batch";
import type { AdviceCreationPlan } from "../engine/advice-apply";
import type { AdviceReport } from "../engine/advice-types";
import type { ApplyHarnessChangePlanResult } from "../engine/create-plan";
import { advicePlanPreviewLines } from "./AdviceApplyFlow";
import { adviceBatchRow, applyConfirmLine, manifestOutcomeSummary, retryableSummary } from "./advice-manifest";
import { KeyHints, palette, scrollWindow, truncateTo, useSpinner } from "./chrome";
import { fileActionWord } from "./file-action-markers";
import {
  adviceBatchCancellationBindings,
  binding,
  bindingsHint,
  defineBindings,
  destructiveConfirmationBindings,
  resolveIntent
} from "./keymap";

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
  const [cancellationRequested, setCancellationRequested] = useState(false);
  const [result, setResult] = useState<ApplyHarnessChangePlanResult>();
  const previousRef = useRef<AdviceBatchState | undefined>(undefined);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const cancelDuringApplyRef = useRef(false);
  const bodyScrollRef = useRef<ScrollBoxRenderable | null>(null);
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
    binding("q", "interrupt", "finish saving, then stop")
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
        binding("enter", "activate", "save/review overwrites"),
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
      } else if (intent === "scroll") {
        // Page the whole review body (file list + full preview) by a viewport page.
        bodyScrollRef.current?.scrollBy(key.name === "pagedown" ? 0.85 : -0.85, "viewport");
      } else if (intent === "activate" && state.inspection.blockers.length === 0) {
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
  const creatable = state.items.filter((item) => item.route === "files" || item.route === "skill").length;
  const skipped = state.items.filter((item) => item.status === "skipped").length;
  const statusTitle = state.phase === "planning"
    ? `${spinner}  Preparing your changes…`
    : state.phase === "applying"
      ? `${spinner}  Saving your files…`
      : state.phase === "review"
        ? "Review what will be saved"
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
  const confirm = state.inspection ? applyConfirmLine({ inspection: state.inspection, replacementArmed }) : undefined;
  const backendLabel = state.backend === "claude" ? "Claude" : "Codex";
  const isRetryRun = attempt > 0;
  const retryLead = state.phase === "done" || state.phase === "cancelled" || state.phase === "error"
    ? retryableSummary(state)
    : undefined;

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <box style={{ flexDirection: "row", width: "100%" }}>
          <text fg={palette.accent}>{statusTitle}</text>
          <box style={{ flexGrow: 1 }} />
          <text fg={palette.gold}>{`Active backend: ${state.backend === "claude" ? "Claude" : "Codex"}`}</text>
        </box>
        {state.phase === "review" && state.inspection ? (
          <>
            <text fg={palette.gold}>{manifestOutcomeSummary(state.inspection)}</text>
            <text fg={palette.faint}>Nothing is saved to your project yet.</text>
          </>
        ) : state.phase === "planning" ? (
          isRetryRun ? (
            <text fg={palette.gold}>Retrying the items that didn't finish. Anything already Ready is kept.</text>
          ) : (
            <text fg={palette.gold}>{`Creating ${creatable} ${creatable === 1 ? "change" : "changes"}, up to ${defaultAdviceBatchConcurrency} at a time. Nothing is saved until you confirm.`}</text>
          )
        ) : null}
        {skipped > 0 && state.phase === "planning" ? (
          <text fg={palette.faint}>{`${skipped} can't be created automatically (listed below).`}</text>
        ) : null}
      </box>
      {/*
        The roster + review detail is a bounded scroll region with flexShrink:0
        children; on a short terminal opentui otherwise shrinks flex siblings
        while their text keeps its rows, and lines overwrite one another.
      */}
      <scrollbox
        ref={bodyScrollRef}
        focused={false}
        scrollX={false}
        scrollY
        stickyScroll
        stickyStart={state.phase === "done" ? "bottom" : "top"}
        viewportCulling
        style={{ flexGrow: 1, flexShrink: 1, width: "100%" }}
        contentOptions={{ flexDirection: "column", gap: 1, width: "100%" }}
      >
        <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
          <text style={{ flexShrink: 0 }} fg={palette.muted}>{`${counts.completed} done · ${counts.running} working · ${counts.queued} waiting`}</text>
          {state.items.map((item) => {
            const row = adviceBatchRow(item, { backendLabel, retry: isRetryRun });
            const showId = item.status !== "skipped" && item.status !== "failed";
            return (
              <box key={item.recommendation.id} style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
                <text style={{ flexShrink: 0 }}>
                  <span fg={statusColor(item.status)}>{`${statusMarker[item.status]} ${row.statusWord.padEnd(8)} `}</span>
                  <span fg={palette.text}>{truncateTo(row.text, 82)}</span>
                  {showId ? <span fg={palette.faint}>{`  ${item.recommendation.id}`}</span> : null}
                </text>
                {row.detail ? (
                  <text style={{ flexShrink: 0 }} fg={palette.faint}>{`           ${truncateTo(row.detail, 78)}`}</text>
                ) : null}
              </box>
            );
          })}
          {retryLead ? (
            <text style={{ flexShrink: 0 }}>
              <span fg={palette.warn}>{retryLead}</span>
              <span fg={palette.faint}>{" · press "}</span>
              <span fg={palette.gold}>r</span>
              <span fg={palette.faint}>{" to retry just those"}</span>
            </text>
          ) : null}
        </box>
        {cancellationRequested ? (
          <text style={{ flexShrink: 0 }} fg={palette.warn}>{state.phase === "applying"
            ? "Cancellation requested while saving; farrier finishes or undoes the save first, so nothing is left half-done."
            : "Cancelling: no new jobs will start; waiting for running work to stop…"}</text>
        ) : null}
        {state.error ? <text style={{ flexShrink: 0 }} fg={palette.warn}>{state.error}</text> : null}
        {state.phase === "review" && state.inspection ? (
          <box style={{ flexDirection: "column", gap: 0, flexShrink: 0 }}>
            {files.slice(window.start, window.end).map((file, offset) => {
              const index = window.start + offset;
              const destructive = file.action === "replace" || file.action === "blocked";
              return (
                <text key={file.path} style={{ flexShrink: 0 }} bg={index === clampedIndex ? palette.selBg : undefined}>
                  <span fg={palette.accent}>{index === clampedIndex ? "▸ " : "  "}</span>
                  <span fg={destructive ? palette.warn : palette.success}>{`${fileActionWord(file.action).padEnd(11)} `}</span>
                  <span fg={palette.text}>{truncateTo(file.path, 55)}</span>
                </text>
              );
            })}
            {focused ? (
              <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
                <text style={{ flexShrink: 0 }} fg={palette.faint}>{`${focused.path} · full content${previewLines.length ? ` (${previewLines.length} ${previewLines.length === 1 ? "line" : "lines"})` : " (empty)"}`}</text>
                <text style={{ flexShrink: 0 }} fg={palette.gold}>{focused.reason}</text>
                {previewLines.map((line, index) => (
                  <text key={`${index}-${line}`} style={{ flexShrink: 0 }} fg={palette.muted}>{line}</text>
                ))}
              </box>
            ) : null}
          </box>
        ) : null}
        {state.phase === "done" && result ? (
          <text style={{ flexShrink: 0 }} fg={palette.success}>{`Saved ${result.written.length} ${result.written.length === 1 ? "file" : "files"}${result.unchanged.length ? ` · ${result.unchanged.length} already matched` : ""}${result.backupDir ? ` · backups: ${result.backupDir}` : ""}`}</text>
        ) : null}
        {state.phase === "done" && cancelDuringApplyRef.current ? <text style={{ flexShrink: 0 }} fg={palette.gold}>The cancellation arrived while saving; the save completed safely before stopping.</text> : null}
      </scrollbox>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        {state.phase === "review" && confirm ? (
          <text style={{ flexShrink: 0 }} fg={confirm.tone === "warn" ? palette.warn : palette.gold}>{confirm.text}</text>
        ) : null}
        <KeyHints hint={bindingsHint(state.phase === "planning" ? runningBindings : state.phase === "applying" ? applyingBindings : state.phase === "review" ? reviewBindings : finishedBindings)} />
      </box>
    </box>
  );
}
