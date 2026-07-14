import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { ApplyHarnessChangePlanResult } from "../engine/create-plan";
import type { ExecutableProvenance } from "../engine/render";
import { formatAgents, type EnforcementAgent } from "../engine/agent-selection";
import type { SkillCreationOutcome, SkillCreationRequest } from "../engine/create-skill";
import type { InstallSkillResult } from "../engine/skills";
import { ButtonBar } from "./ButtonBar";
import { DetailPane, KeyHints, palette, scrollWindow, StepHeader, truncateTo, useSpinner, type PaneLine } from "./chrome";
import { collisionBindings, CollisionPromptView, type CollisionPrompt } from "./collision";
import type { PendingSkillEval } from "./create-eval";
import { binding, bindingsHint, defineBindings, destructiveConfirmationBindings, resolveIntent, runningCancellationBindings } from "./keymap";
import type { WizardWriteStatus } from "./machine";
import { SkillInstallFailureDetails } from "./skill-install-failures";
import { pickHarnessVerb } from "./verbs";

// One verb per process so the writing spinner, escape hint, and done line
// all speak the same word within a run.
const runVerb = pickHarnessVerb();

// The manifest scrolls: at most this many rows render at once so header +
// manifest + preview pane + keymap always fit inside an 80×24 terminal, while
// every file past the window stays reachable by cursoring down to it. A real
// render plan is ~23 files (each hook ships an impl + a test_ file), so the
// window is the only thing that keeps the box bounded without hiding files.
const maxVisibleFiles = 6;

const previewLineCount = 4;
const previewScrollAmount = 3;

// Usable inner width inside the step's border+padding on an 80-col terminal.
// Rows are truncated to this so a long path + note never wraps onto a second
// line (a wrap would silently blow the height budget).
const manifestInnerWidth = 74;

// Cap the path column so the widest real path (a hook prompt template, ~42
// cols) can't starve the note column into wrapping.
const maxPathColWidth = 44;
const reviewPaneWidth = 56;

export type ReviewFile = {
  path: string;
  content: string;
  previousContent?: string;
  action: "create" | "unchanged" | "merge" | "update" | "replace" | "blocked";
  purpose: string;
  reason?: string;
  requiresForce: boolean;
  executableProvenance?: ExecutableProvenance;
};

type ReviewStepProps = {
  createRequests: SkillCreationRequest[];
  agents: EnforcementAgent[];
  generator?: {
    source: string;
    command: string;
  };
  files: ReviewFile[];
  existingHarness: boolean;
  blockerCount: number;
  loading: boolean;
  error?: string;
  canConfirm: boolean;
  onConfirm: (forceReplace: boolean) => void;
  onBack: () => void;
  onQuit: () => void;
};

type DoneStepProps = {
  writeStatus?: WizardWriteStatus;
  applyResult?: ApplyHarnessChangePlanResult;
  installResults: InstallSkillResult[];
  createOutcomes: SkillCreationOutcome[];
  agents: EnforcementAgent[];
  hookCount: number;
  skillCount: number;
  ruleCount: number;
  evalCandidate?: PendingSkillEval;
  onEvaluate?: () => void;
  onExit: () => void;
};

function actionView(action: ReviewFile["action"]): {
  marker: string;
  label: string;
  fg: string;
} {
  switch (action) {
    case "create":
      return { marker: "A ", label: "create", fg: palette.success };
    case "unchanged":
      return { marker: "= ", label: "unchanged", fg: palette.faint };
    case "merge":
      return { marker: "M ", label: "merge safely", fg: palette.success };
    case "update":
      return {
        marker: "U ",
        label: "restore executable permission",
        fg: palette.gold,
      };
    case "replace":
      return { marker: "R ", label: "replace existing file", fg: palette.warn };
    case "blocked":
      return { marker: "! ", label: "blocked", fg: palette.warn };
  }
}

function allPreviewLines(file: ReviewFile): PaneLine[] {
  const action = actionView(file.action);
  const reasonFg = file.action === "replace" || file.action === "blocked" ? palette.warn : palette.muted;
  const provenance = file.executableProvenance;
  const provenanceLines: PaneLine[] = [
    ...(provenance
      ? [
          { fg: palette.gold, text: `registry ${provenance.registryRef} v${provenance.version}` },
          { fg: palette.muted, text: `source ${provenance.sourceIdentity ?? "legacy-unbound"}` },
          { fg: palette.muted, text: `item sha256 ${provenance.itemSha256}` },
          { fg: palette.muted, text: `content sha256 ${provenance.contentSha256}` }
        ]
      : [])
  ];
  const descriptiveLines: PaneLine[] = [
    { fg: action.fg, text: `${action.label} — ${file.purpose}` },
    ...(file.reason ? [{ fg: reasonFg, text: file.reason }] : [])
  ];
  const contentLines = (value: string) =>
    value.split("\n").map((line, index) => ({
      fg: palette.muted,
      text: `${index + 1}: ${JSON.stringify(line)}`
    }));
  const changed = file.previousContent !== undefined && file.previousContent !== file.content;
  const content = changed
    ? [
        { fg: palette.warn, text: "--- previous bytes" },
        ...contentLines(file.previousContent!),
        { fg: palette.success, text: "+++ reviewed bytes" },
        ...contentLines(file.content)
      ]
    : contentLines(file.content);
  const orderedLines = provenance ? [...provenanceLines, ...content, ...descriptiveLines] : [...descriptiveLines, ...content];
  const allLines = orderedLines.flatMap((line) => {
    if (line.text.length === 0) return [line];
    const chunks: PaneLine[] = [];
    for (let index = 0; index < line.text.length; index += reviewPaneWidth) {
      chunks.push({ fg: line.fg, text: line.text.slice(index, index + reviewPaneWidth) });
    }
    return chunks;
  });
  return allLines.length > 0 ? allLines : [{ fg: palette.faint, text: "(empty file)" }];
}

export function reviewPreviewOffset(file: ReviewFile, current: number, delta: number): number {
  const maximum = Math.max(allPreviewLines(file).length - previewLineCount, 0);
  return Math.min(maximum, Math.max(0, current + delta));
}

function previewLines(file: ReviewFile, offset: number): PaneLine[] {
  const allLines = allPreviewLines(file);
  const start = Math.min(offset, Math.max(allLines.length - previewLineCount, 0));
  return allLines.slice(start, start + previewLineCount);
}

export function ReviewStep(props: ReviewStepProps) {
  const [focusedFileIndex, setFocusedFileIndex] = useState<number>(0);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [replaceConfirmationArmed, setReplaceConfirmationArmed] = useState(false);
  const replacements = props.files.filter((file) => file.requiresForce);
  const hasReplacements = replacements.length > 0;

  function backOrDisarm(): void {
    if (replaceConfirmationArmed) {
      setReplaceConfirmationArmed(false);
      return;
    }

    props.onBack();
  }

  function moveFile(delta: -1 | 1): void {
    setFocusedFileIndex((current) => Math.min(Math.max(current + delta, 0), Math.max(props.files.length - 1, 0)));
    setPreviewOffset(0);
  }

  const reviewBindings = replaceConfirmationArmed
    ? defineBindings(
        ...destructiveConfirmationBindings,
        binding("b", "back", "disarm"),
        binding(["q", "ctrl+c"], "quit", "quit"),
        binding(["up", "down"], "move", "inspect file"),
        binding(["pageup", "pagedown"], "scroll", "scroll preview")
      )
    : defineBindings(
        binding(["up", "down"], "move", "inspect file"),
        binding(["pageup", "pagedown"], "scroll", "scroll preview"),
        binding("enter", "activate", hasReplacements ? "review replacements" : "create harness"),
        binding(["escape", "b"], "back", "back"),
        binding(["q", "ctrl+c"], "quit", "quit")
      );

  useKeyboard((key) => {
    const intent = resolveIntent(reviewBindings, key);
    if (intent === "reject") {
      setReplaceConfirmationArmed(false);
      return;
    }
    if (intent === "back") {
      backOrDisarm();
      return;
    }
    if (intent === "quit") {
      props.onQuit();
      return;
    }
    if (intent === "confirm" && props.canConfirm && hasReplacements) {
      props.onConfirm(true);
      return;
    }
    if (intent === "move") {
      moveFile(key.name === "down" ? 1 : -1);
      return;
    }
    if (intent === "scroll") {
      const focused = props.files[Math.min(focusedFileIndex, Math.max(props.files.length - 1, 0))];
      if (focused) {
        setPreviewOffset((current) => reviewPreviewOffset(focused, current, key.name === "pagedown" ? previewScrollAmount : -previewScrollAmount));
      }
      return;
    }
    if (intent === "activate") {
      if (props.canConfirm) {
        if (hasReplacements) {
          setReplaceConfirmationArmed(true);
        } else {
          props.onConfirm(false);
        }
      }
    }
  });

  const pathWidth = Math.min(
    props.files.reduce((width, file) => Math.max(width, file.path.length), 0),
    maxPathColWidth,
  );
  // What's left for "   note" after the cursor (2) + action flag (2) + path column.
  const noteBudget = manifestInnerWidth - 4 - pathWidth - 3;
  const clampedIndex = Math.min(focusedFileIndex, Math.max(props.files.length - 1, 0));
  const focusedFile = props.files[clampedIndex];
  const fileWindow = scrollWindow(clampedIndex, props.files.length, maxVisibleFiles);
  const visibleFiles = props.files.slice(fileWindow.start, fileWindow.end);
  const unchangedCount = props.files.filter((file) => file.action === "unchanged").length;
  const blockedCount = Math.max(props.blockerCount, props.files.filter((file) => file.action === "blocked").length);
  const changedCount = props.files.filter((file) => file.action !== "unchanged" && file.action !== "blocked").length;

  return (
    <box
      style={{
        border: true,
        padding: 1,
        flexDirection: "column",
        gap: 1,
        width: "100%",
        height: "100%",
      }}
    >
      <StepHeader current="Review" subtitle="The full manifest before the strike." />

      {props.loading ? <text fg={palette.muted}>Building the manifest…</text> : null}
      {props.error ? <text fg={palette.warn}>✗ Render plan failed: {props.error}</text> : null}
      {props.existingHarness ? <text fg={palette.warn}>✗ This project already has a Farrier harness. Use `farrier update`; create is disabled.</text> : null}
      {!props.existingHarness && blockedCount > 0 ? (
        <text fg={palette.warn}>{`✗ ${blockedCount} unsafe path${blockedCount === 1 ? " is" : "s are"} blocked. Inspect the ! rows; create is disabled.`}</text>
      ) : null}
      {!props.existingHarness && blockedCount === 0 && hasReplacements ? (
        <text fg={replaceConfirmationArmed ? palette.warn : palette.gold}>
          {replaceConfirmationArmed
            ? `Replacement armed for ${replacements.length} file(s). Press y to replace and create; n or esc cancels.`
            : `${replacements.length} existing file(s) require replacement. Backups stay in .farrier-staging/backups/. Press Enter, then y.`}
        </text>
      ) : null}

      <text>
        <span fg={palette.gold}>Enforcement: </span>
        <span fg={palette.text}>{formatAgents(props.agents)}</span>
      </text>

      {props.files.length > 0 ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text>
            <span fg={palette.muted}>{"Plan: "}</span>
            <span fg={palette.gold}>{String(changedCount)}</span>
            <span fg={palette.muted}>{changedCount === 1 ? " change · " : " changes · "}</span>
            <span fg={palette.faint}>{String(unchangedCount)}</span>
            <span fg={palette.muted}>{" unchanged"}</span>
            {blockedCount > 0 ? (
              <>
                <span fg={palette.muted}>{" · "}</span>
                <span fg={palette.warn}>{String(blockedCount)}</span>
                <span fg={palette.muted}>{" blocked"}</span>
              </>
            ) : null}
            <span fg={palette.muted}>{". Nothing has been written yet."}</span>
          </text>
          {visibleFiles.map((file, offset) => {
            const index = fileWindow.start + offset;
            const note = file.reason ? `${file.purpose} · ${file.reason}` : file.purpose;
            const action = actionView(file.action);
            const focused = index === clampedIndex;
            const bg = focused ? palette.selBg : undefined;
            const cursor = index === clampedIndex ? "▸ " : "  ";

            const showNote = note && noteBudget >= 6;

            return (
              <text key={file.path} bg={bg}>
                <span fg={palette.accent}>{cursor}</span>
                <span fg={action.fg}>{action.marker}</span>
                <span fg={palette.text}>{truncateTo(file.path, pathWidth).padEnd(pathWidth)}</span>
                {showNote ? <span fg={palette.faint}>{`   ${truncateTo(note, noteBudget)}`}</span> : null}
              </text>
            );
          })}
          {props.files.length > maxVisibleFiles ? <text fg={palette.faint}>{`      showing ${fileWindow.start + 1}–${fileWindow.end} of ${props.files.length} · ↑↓ scrolls`}</text> : null}
        </box>
      ) : null}

      {props.createRequests.length > 0 ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text>
            <span fg={palette.gold}>{String(props.createRequests.length)}</span>
            <span fg={palette.muted}>{" skill(s) will be authored when the harness is created (agent runs — this takes minutes):"}</span>
          </text>
          {props.createRequests.map((request, index) => (
            <text key={`${request.description}-${index}`}>
              <span fg={palette.accent}>{"  ⚒ "}</span>
              <span fg={palette.text}>{truncateTo(request.description, 42).padEnd(44)}</span>
              <span fg={palette.faint}>{`${request.agents.join("+")} · ${request.mode}`}</span>
            </text>
          ))}
        </box>
      ) : null}

      {props.generator ? (
        <text>
          <span fg={palette.gold}>{"Declared project generator: "}</span>
          <span fg={palette.text}>{truncateTo(props.generator.command, 42)}</span>
          <span fg={palette.faint}>{` (from ${props.generator.source}) · not run by harness creation`}</span>
        </text>
      ) : null}

      {focusedFile ? <DetailPane title={focusedFile.path} lines={previewLines(focusedFile, previewOffset)} /> : null}

      <ButtonBar
        hint={bindingsHint(reviewBindings)}
        emberActions={replaceConfirmationArmed ? ["replace & create"] : hasReplacements ? ["review replacements"] : ["create harness"]}
      />
    </box>
  );
}

export function WritingStep(props: { creatingCount?: number; cancelling?: boolean; collision?: CollisionPrompt | null; onCancel: () => void }) {
  const spinner = useSpinner(true);
  const creating = props.creatingCount ?? 0;
  const bindings = defineBindings(...runningCancellationBindings, binding("q", "interrupt", "cancel and stop child processes"));

  useKeyboard((key) => {
    if (resolveIntent(bindings, key) === "interrupt") {
      props.onCancel();
      return;
    }
    if (!props.collision) return;
    const intent = resolveIntent(collisionBindings, key);
    if (intent === "replace") {
      props.collision.resolve("replace");
    } else if (intent === "keep") {
      props.collision.resolve("keep");
    }
  });

  return (
    <box
      style={{
        border: true,
        padding: 1,
        flexDirection: "column",
        gap: 1,
        width: "100%",
        height: "100%",
      }}
    >
      {props.cancelling ? (
        <text fg={palette.warn}>{`${spinner}  Cancelling skill authoring — killing the agent runs… (files already written stay on disk)`}</text>
      ) : (
        <text fg={palette.accent}>{`${spinner}  ${runVerb.gerund} the harness — writing files, installing skills${creating > 0 ? `, authoring ${creating} skill(s)` : ""}…`}</text>
      )}
      {creating > 0 ? <text fg={palette.muted}>Skill authoring runs a full agent per skill — expect minutes, not seconds.</text> : null}
      {props.collision ? <CollisionPromptView collision={props.collision} /> : null}
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}

export function DoneStep(props: DoneStepProps) {
  const failedInstalls = props.installResults.filter((result) => !result.ok);
  const installed = props.installResults.length - failedInstalls.length;
  const ok = props.writeStatus?.ok !== false;
  const partial = props.writeStatus?.partial === true;
  const writtenCount = props.applyResult?.writtenFiles.length ?? 0;
  const unchangedCount = props.applyResult?.unchangedFiles.length ?? 0;
  const [choice, setChoice] = useState(0);
  const choices = props.evalCandidate && props.onEvaluate ? (["evaluate", "close"] as const) : (["close"] as const);
  const bindings = defineBindings(
    binding(["up", "down"], "move", "move"),
    binding("enter", "activate", "activate"),
    binding(["escape", "b"], "close", "close"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );

  useKeyboard((key) => {
    const intent = resolveIntent(bindings, key);
    if (intent === "move") {
      setChoice((current) => Math.min(Math.max(current + (key.name === "down" ? 1 : -1), 0), choices.length - 1));
      return;
    }
    if (intent === "activate" && choices[choice] === "evaluate") props.onEvaluate?.();
    else if (intent === "activate" || intent === "close" || intent === "quit") {
      props.onExit();
    }
  });

  return (
    <box
      style={{
        border: true,
        padding: 1,
        flexDirection: "column",
        gap: 1,
        width: "100%",
        height: "100%",
      }}
    >
      {ok || partial ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={partial ? palette.warn : palette.accent}>{partial ? "  ⚠  Harness files applied; skill installation needs attention." : `  ⚒  Harness ${runVerb.past}.`}</text>
          <text> </text>
          <text>
            <span fg={palette.gold}>{String(writtenCount)}</span>
            <span fg={palette.muted}>{" file changes · "}</span>
            <span fg={palette.gold}>{String(unchangedCount)}</span>
            <span fg={palette.muted}>{" unchanged · "}</span>
            <span fg={palette.gold}>{String(props.hookCount)}</span>
            <span fg={palette.muted}>{" hooks · "}</span>
            <span fg={palette.gold}>{formatAgents(props.agents)}</span>
            <span fg={palette.muted}>{" enforcement · "}</span>
            <span fg={palette.gold}>{String(props.skillCount)}</span>
            <span fg={palette.muted}>{" skills pinned · "}</span>
            <span fg={palette.gold}>{String(props.ruleCount)}</span>
            <span fg={palette.muted}>{" rules"}</span>
          </text>
          <text>
            <span fg={palette.success}>{"✓ "}</span>
            <span fg={palette.muted}>{`${writtenCount} file change(s) written; ${unchangedCount} left unchanged`}</span>
          </text>
          {props.applyResult?.backupDir ? <text fg={palette.gold}>{`Backups: ${props.applyResult.backupDir}`}</text> : null}
          {partial ? <text fg={palette.warn}>{props.writeStatus?.message}</text> : null}
          {props.installResults.length > 0 ? (
            <text>
              <span fg={installed > 0 ? palette.success : palette.warn}>{installed > 0 ? "✓ " : "✗ "}</span>
              <span fg={palette.muted}>{`${installed} of ${props.installResults.length} skills installed`}</span>
            </text>
          ) : null}
          {props.createOutcomes.map((outcome, index) => (
            <text key={`${outcome.name ?? outcome.request.description}-${index}`}>
              <span fg={outcome.error ? palette.warn : palette.success}>{outcome.error ? "✗ " : "✓ "}</span>
              <span fg={palette.muted}>
                {outcome.error ? `skill creation failed: ${outcome.error}` : `created ${outcome.name}${outcome.installed ? " (installed)" : ""} — ${outcome.files.length} file(s)`}
              </span>
            </text>
          ))}
        </box>
      ) : (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={palette.warn}>{`✗ ${props.writeStatus?.message ?? "Write failed."}`}</text>
          {props.writeStatus?.mutationState ? <text fg={palette.gold}>{`Transaction: ${props.writeStatus.mutationState}`}</text> : null}
          {props.writeStatus?.recoveryPath ? <text fg={palette.warn}>{`Recovery material: ${props.writeStatus.recoveryPath}`}</text> : null}
          {props.writeStatus?.remediation ? <text fg={palette.muted}>{props.writeStatus.remediation}</text> : null}
        </box>
      )}

      {ok ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={palette.faint}>{"─".repeat(60)}</text>
          <text fg={palette.muted}>{"Ride it:"}</text>
          {props.agents.map((agent) => (
            <text key={agent}>
              <span fg={palette.muted}>{"  "}</span>
              <span fg={palette.gold}>{agent}</span>
              <span fg={palette.muted}>{" “add a feature”   the harness keeps it honest"}</span>
            </text>
          ))}
          <text> </text>
          <text fg={palette.muted}>{"Later:"}</text>
          <text>
            <span fg={palette.muted}>{"  "}</span>
            <span fg={palette.gold}>{"farrier doctor"}</span>
            <span fg={palette.muted}>{"   detect drift, repair the shoe"}</span>
          </text>
          <text>
            <span fg={palette.muted}>{"  "}</span>
            <span fg={palette.gold}>{"farrier learn"}</span>
            <span fg={palette.muted}>{"    mine new transcripts for rules"}</span>
          </text>
        </box>
      ) : null}

      <SkillInstallFailureDetails results={props.installResults} />

      <box style={{ flexDirection: "column", gap: 0 }}>
        {props.evalCandidate ? (
          <text bg={choice === 0 ? palette.selBg : undefined}>
            <span fg={palette.accent}>{choice === 0 ? "▸ " : "  "}</span>
            <span fg={palette.text}>{`Evaluate ${props.evalCandidate.skillName} copies`}</span>
          </text>
        ) : null}
        <text bg={choice === choices.length - 1 ? palette.selBg : undefined}>
          <span fg={palette.accent}>{choice === choices.length - 1 ? "▸ " : "  "}</span>
          <span fg={palette.text}>Close</span>
        </text>
      </box>
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}
