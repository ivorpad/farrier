import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { ApplyHarnessChangePlanResult, HarnessChangePlan } from "../engine/create-plan";
import type { AdviceCreationPlan } from "../engine/advice-apply";
import type { AdviceRecommendation } from "../engine/advice-types";
import { DetailPane, KeyHints, palette, scrollWindow, truncateTo, useSpinner } from "./chrome";
import { binding, bindingsHint, defineBindings, destructiveConfirmationBindings, resolveIntent, runningCancellationBindings } from "./keymap";

type Phase = "planning" | "review" | "applying" | "done" | "error";

const previewWidth = 58;
const previewPageSize = 3;

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
  recommendation: AdviceRecommendation;
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
  const [previewOffset, setPreviewOffset] = useState(0);
  const [replacementArmed, setReplacementArmed] = useState(false);
  const [planAttempt, setPlanAttempt] = useState(0);
  const cancelAfterApplyRef = useRef(false);
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
  const applyingBindings = defineBindings(binding(["ctrl+c", "q"], "interrupt", "close after transaction"));
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
        binding("enter", "activate", "apply/review replacements"),
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
      setPreviewOffset(0);
    } else if (intent === "scroll" && key.name === "pageup") setPreviewOffset((current) => Math.max(0, current - previewPageSize));
    else if (intent === "scroll") {
      const focused = inspection.files[Math.min(focusedIndex, Math.max(inspection.files.length - 1, 0))];
      const content = plan?.files.find((file) => file.path === focused?.path)?.content ?? "";
      const maximum = Math.max(advicePlanPreviewLines(content).length - previewPageSize, 0);
      setPreviewOffset((current) => Math.min(maximum, current + previewPageSize));
    } else if (intent === "activate") {
      if (inspection.blockers.length > 0) return;
      if (inspection.replacementPaths.length > 0) setReplacementArmed(true);
      else apply(false);
    }
  });

  if (phase === "planning" || phase === "applying") {
    return (
      <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
        <text fg={palette.accent}>{`${spinner}  ${phase === "planning" ? "Building a constrained creation plan…" : "Applying the reviewed plan transactionally…"}`}</text>
        <text fg={palette.text}>{props.recommendation.id}</text>
        <text fg={palette.muted}>{phase === "planning" ? "The backend can propose data only; Farrier validates every path before review." : "Concurrent edits are detected; failures roll back completed writes."}</text>
        <KeyHints hint={bindingsHint(phase === "planning" ? planningBindings : applyingBindings)} />
      </box>
    );
  }

  if (phase === "error") {
    return (
      <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
        <text fg={palette.warn}>✗ Could not create this recommendation</text>
        <text fg={palette.text}>{error}</text>
        <KeyHints hint={bindingsHint(errorBindings)} />
      </box>
    );
  }

  if (phase === "done") {
    return (
      <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
        <text fg={palette.success}>✓ Recommendation created</text>
        <text fg={palette.text}>{props.recommendation.id}</text>
        <text fg={palette.muted}>{`${result?.written.length ?? 0} file(s) written · ${result?.unchanged.length ?? 0} unchanged`}</text>
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
  const replacements = inspection?.replacementPaths.length ?? 0;
  const blocked = inspection?.blockers.length ?? 0;
  const planFile = focused ? plan?.files.find((file) => file.path === focused.path) : undefined;
  const allPreviewLines = advicePlanPreviewLines(planFile?.content ?? "");
  const safePreviewOffset = Math.min(previewOffset, Math.max(allPreviewLines.length - previewPageSize, 0));
  const previewEnd = Math.min(safePreviewOffset + previewPageSize, allPreviewLines.length);
  const preview = allPreviewLines.slice(safePreviewOffset, previewEnd).map((text) => ({ fg: palette.muted, text }));
  const previewTitle = focused
    ? `${focused.path} · ${allPreviewLines.length === 0 ? "empty" : `${safePreviewOffset + 1}-${previewEnd}/${allPreviewLines.length}`}`
    : "";

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.accent}>Review recommendation creation</text>
      <text fg={palette.text}>{props.recommendation.id}</text>
      <text fg={palette.muted}>{plan?.summary}</text>
      <text fg={palette.gold}>{`${files.length} file(s) · ${replacements} replacement(s) · ${blocked} blocked · nothing written yet`}</text>
      {files.slice(window.start, window.end).map((file, offset) => {
        const index = window.start + offset;
        const marker = file.action === "create" ? "A" : file.action === "unchanged" ? "=" : file.action === "blocked" ? "!" : "R";
        return (
          <text key={file.path} bg={index === clampedIndex ? palette.selBg : undefined}>
            <span fg={palette.accent}>{index === clampedIndex ? "▸ " : "  "}</span>
            <span fg={file.action === "blocked" || file.action === "replace" ? palette.warn : palette.success}>{`${marker} `}</span>
            <span fg={palette.text}>{truncateTo(file.path, 55)}</span>
          </text>
        );
      })}
      {focused ? <DetailPane title={previewTitle} lines={[{ fg: palette.gold, text: focused.reason }, ...preview]} /> : null}
      {blocked > 0 ? <text fg={palette.warn}>Blocked paths must be fixed before this plan can be applied.</text> : replacements > 0 ? (
        <text fg={replacementArmed ? palette.warn : palette.gold}>
          {replacementArmed ? "Replacement armed. Press y to apply and retain backups; n or Escape disarms." : "Press Enter to review replacement risk, then y to apply."}
        </text>
      ) : <text fg={palette.gold}>Press Enter to apply this reviewed plan.</text>}
      <KeyHints hint={bindingsHint(reviewBindings)} />
    </box>
  );
}
