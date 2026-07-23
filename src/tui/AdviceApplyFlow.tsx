import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { ApplyHarnessChangePlanResult, HarnessChangePlan } from "../engine/create-plan";
import type { AdviceCreationPlan } from "../engine/advice-apply";
import { applyConfirmLine, manifestOutcomeSummary } from "./advice-manifest";
import { KeyHints, palette, scrollWindow, truncateTo, useSpinner } from "./chrome";
import { fileActionWord } from "./file-action-markers";
import { binding, bindingsHint, defineBindings, destructiveConfirmationBindings, resolveIntent, runningCancellationBindings } from "./keymap";

type Phase = "planning" | "review" | "applying" | "done" | "error";

const previewWidth = 58;

export function advicePlanPreviewLines(content: string, width = previewWidth): string[] {
  const safeWidth = Math.max(1, width);
  return content.split(/\r?\n/).flatMap((line) => {
    if (line === "") return [" "];
    const chunks: string[] = [];
    for (let offset = 0; offset < line.length; offset += safeWidth) chunks.push(line.slice(offset, offset + safeWidth));
    return chunks;
  });
}

export function AdviceApplyFlow(props: {
  /** Only the display id is needed; learn proposals reuse this flow with a title. */
  recommendation: { id: string };
  onPlan: () => Promise<{ plan: AdviceCreationPlan; inspection: HarnessChangePlan }>;
  onApply: (plan: AdviceCreationPlan, force: boolean) => Promise<ApplyHarnessChangePlanResult>;
  onBack: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("planning");
  const [plan, setPlan] = useState<AdviceCreationPlan>();
  const [inspection, setInspection] = useState<HarnessChangePlan>();
  const [result, setResult] = useState<ApplyHarnessChangePlanResult>();
  const [error, setError] = useState<string>();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [replacementArmed, setReplacementArmed] = useState(false);
  const [planAttempt, setPlanAttempt] = useState(0);
  const cancelAfterApplyRef = useRef(false);
  const previewScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const spinner = useSpinner(phase === "planning" || phase === "applying");

  useEffect(() => {
    let active = true;
    props.onPlan()
      .then((value) => {
        if (!active) return;
        setPlan(value.plan);
        setInspection(value.inspection);
        setPhase("review");
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("error");
      });
    return () => { active = false; };
  }, [planAttempt]);

  const apply = (force: boolean) => {
    if (!plan || phase !== "review") return;
    setPhase("applying");
    props.onApply(plan, force)
      .then((value) => {
        if (cancelAfterApplyRef.current) props.onDone();
        else {
          setResult(value);
          setPhase("done");
        }
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("error");
      });
  };

  const planningBindings = defineBindings(...runningCancellationBindings, binding(["escape", "b"], "back", "cancel plan"), binding("q", "quit", "quit"));
  const applyingBindings = defineBindings(binding(["ctrl+c", "q"], "interrupt", "close after saving"));
  const errorBindings = defineBindings(binding("r", "retry", "retry"), binding(["escape", "b"], "back", "report"), binding(["q", "ctrl+c"], "quit", "close"));
  const doneBindings = defineBindings(binding(["enter", "escape", "b"], "back", "report"), binding(["q", "ctrl+c"], "quit", "close"));
  const reviewBindings = replacementArmed
    ? defineBindings(
        ...destructiveConfirmationBindings,
        binding("b", "reject", "disarm"),
        binding("q", "quit", "abandon"),
        binding(["up", "down"], "move", "files"),
        binding(["pageup", "pagedown"], "scroll", "preview")
      )
    : defineBindings(
        binding(["up", "down"], "move", "files"),
        binding(["pageup", "pagedown"], "scroll", "preview"),
        binding("enter", "activate", "save/review overwrites"),
        binding(["escape", "b"], "back", "report"),
        binding("q", "quit", "abandon")
      );

  useKeyboard((key) => {
    if (phase === "planning") {
      if (resolveIntent(planningBindings, key)) props.onCancel();
      return;
    }
    if (phase === "applying") {
      if (resolveIntent(applyingBindings, key)) cancelAfterApplyRef.current = true;
      return;
    }
    if (phase === "done") {
      const intent = resolveIntent(doneBindings, key);
      if (intent === "back") props.onBack();
      else if (intent === "quit") props.onDone();
      return;
    }
    if (phase === "error") {
      const intent = resolveIntent(errorBindings, key);
      if (intent === "retry") {
        setError(undefined);
        setPhase("planning");
        setPlanAttempt((current) => current + 1);
      } else if (intent === "back") props.onBack();
      else if (intent === "quit") props.onDone();
      return;
    }
    if (phase !== "review" || !inspection) return;
    const intent = resolveIntent(reviewBindings, key);
    if (intent === "back") props.onBack();
    else if (intent === "quit") props.onCancel();
    else if (intent === "reject") setReplacementArmed(false);
    else if (intent === "confirm") apply(true);
    else if (intent === "move") {
      setFocusedIndex((current) => Math.min(Math.max(0, current + (key.name === "down" ? 1 : -1)), inspection.files.length - 1));
      // A new file means a new preview; jump back to its top.
      previewScrollRef.current?.scrollTo({ x: 0, y: 0 });
    } else if (intent === "scroll") {
      // Page by the actual visible height of the preview viewport, not a constant.
      previewScrollRef.current?.scrollBy(key.name === "pagedown" ? 0.85 : -0.85, "viewport");
    } else if (intent === "activate") {
      if (inspection.blockers.length > 0) return;
      if (inspection.replacementPaths.length > 0) setReplacementArmed(true);
      else apply(false);
    }
  });

  if (phase === "planning" || phase === "applying") {
    return (
      <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
        <text fg={palette.accent}>{`${spinner}  ${phase === "planning" ? "Preparing the exact files…" : "Saving your files…"}`}</text>
        <text fg={palette.text}>{props.recommendation.id}</text>
        <text fg={palette.muted}>{phase === "planning" ? "Farrier checks every file location before showing you the plan." : "If anything fails, farrier undoes all of it so nothing is left half-done."}</text>
        <KeyHints hint={bindingsHint(phase === "planning" ? planningBindings : applyingBindings)} />
      </box>
    );
  }

  if (phase === "error") {
    return (
      <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
        <text fg={palette.warn}>✗ Could not create this recommendation. Nothing on your computer was changed.</text>
        <text fg={palette.faint}>{error}</text>
        <KeyHints hint={bindingsHint(errorBindings)} />
      </box>
    );
  }

  if (phase === "done") {
    return (
      <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
        <text fg={palette.success}>✓ Recommendation created</text>
        <text fg={palette.text}>{props.recommendation.id}</text>
        <text fg={palette.muted}>{`Saved ${result?.written.length ?? 0} ${(result?.written.length ?? 0) === 1 ? "file" : "files"}${result?.unchanged.length ? ` · ${result.unchanged.length} already matched` : ""}`}</text>
        {result?.written.map((path) => <text key={path} fg={palette.text}>{`  ${path}`}</text>)}
        {result?.backupDir ? <text fg={palette.gold}>{`Backups: ${result.backupDir}`}</text> : null}
        <KeyHints hint={bindingsHint(doneBindings)} />
      </box>
    );
  }

  const files = inspection?.files ?? [];
  const clampedIndex = Math.min(focusedIndex, Math.max(files.length - 1, 0));
  const focused = files[clampedIndex];
  const window = scrollWindow(clampedIndex, files.length, 6);
  const planFile = focused ? plan?.files.find((file) => file.path === focused.path) : undefined;
  const allPreviewLines = advicePlanPreviewLines(planFile?.content ?? "");
  const previewTitle = focused
    ? `${focused.path} · full content${allPreviewLines.length ? ` (${allPreviewLines.length} ${allPreviewLines.length === 1 ? "line" : "lines"})` : " (empty)"}`
    : "";
  const confirm = inspection ? applyConfirmLine({ inspection, replacementArmed }) : undefined;

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text style={{ flexShrink: 0 }} fg={palette.accent}>Review recommendation creation</text>
        <text style={{ flexShrink: 0 }} fg={palette.text}>{props.recommendation.id}</text>
        <text style={{ flexShrink: 0 }} fg={palette.gold}>{inspection ? manifestOutcomeSummary(inspection) : plan?.summary}</text>
        <text style={{ flexShrink: 0 }} fg={palette.faint}>Nothing is saved to your project yet.</text>
        {files.slice(window.start, window.end).map((file, offset) => {
          const index = window.start + offset;
          const destructive = file.action === "blocked" || file.action === "replace";
          return (
            <text key={file.path} style={{ flexShrink: 0 }} bg={index === clampedIndex ? palette.selBg : undefined}>
              <span fg={palette.accent}>{index === clampedIndex ? "▸ " : "  "}</span>
              <span fg={destructive ? palette.warn : palette.success}>{`${fileActionWord(file.action).padEnd(11)} `}</span>
              <span fg={palette.text}>{truncateTo(file.path, 55)}</span>
            </text>
          );
        })}
      </box>
      {/*
        The preview fills the leftover height and scrolls, instead of a fixed
        3-line window. A bounded scrollbox with flexShrink:0 text children keeps
        every line intact on a short terminal (opentui otherwise overlaps
        shrinking flex siblings); pageup/pagedown scroll it by a viewport page.
      */}
      {focused ? (
        <box style={{ border: true, flexDirection: "column", flexGrow: 1, flexShrink: 1, width: "100%" }}>
          <text style={{ flexShrink: 0 }} fg={palette.faint}>{previewTitle}</text>
          <scrollbox
            ref={previewScrollRef}
            focused={false}
            scrollX={false}
            scrollY
            viewportCulling
            style={{ flexGrow: 1, flexShrink: 1, width: "100%" }}
            contentOptions={{ flexDirection: "column", gap: 0, width: "100%" }}
          >
            <text style={{ flexShrink: 0 }} fg={palette.gold}>{focused.reason}</text>
            {allPreviewLines.map((line, index) => (
              <text key={`${index}-${line}`} style={{ flexShrink: 0 }} fg={palette.muted}>{line}</text>
            ))}
          </scrollbox>
        </box>
      ) : null}
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        {confirm ? <text style={{ flexShrink: 0 }} fg={confirm.tone === "warn" ? palette.warn : palette.gold}>{confirm.text}</text> : null}
        <KeyHints hint={bindingsHint(reviewBindings)} />
      </box>
    </box>
  );
}
