import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { SkillCreationOutcome, SkillCreationRequest } from "../engine/create-skill";
import type { InstallSkillResult } from "../engine/skills";
import type { PackHookRef, PackVerbs, SkillRef } from "../packs/types";
import { adjacentButtonId, ButtonBar, type ButtonSpec } from "./ButtonBar";
import { DetailPane, palette, scrollWindow, StepHeader, truncateTo, useSpinner, type PaneLine } from "./chrome";
import { CollisionPromptView, type CollisionPrompt } from "./collision";
import type { PendingSkillEval } from "./create-eval";

type Zone = "content" | "buttons";

const reviewButtons: ButtonSpec[] = [
  { id: "back", label: "← Back" },
  { id: "confirm", label: "⚒ Forge" }
];

// The manifest scrolls: at most this many rows render at once so header +
// manifest + preview pane + keymap always fit inside an 80×24 terminal, while
// every file past the window stays reachable by cursoring down to it. A real
// render plan is ~23 files (each hook ships an impl + a test_ file), so the
// window is the only thing that keeps the box bounded without hiding files.
const maxVisibleFiles = 6;

const previewLineCount = 3;

// Usable inner width inside the step's border+padding on an 80-col terminal.
// Rows are truncated to this so a long path + note never wraps onto a second
// line (a wrap would silently blow the height budget).
const manifestInnerWidth = 74;

// Cap the path column so the widest real path (a hook prompt template, ~42
// cols) can't starve the note column into wrapping.
const maxPathColWidth = 44;

export type ReviewFile = {
  path: string;
  exists: boolean;
  content: string;
};

type ReviewStepProps = {
  targetDir: string;
  packId: string;
  verbs: PackVerbs;
  ruleCount: number;
  selectedSkills: SkillRef[];
  selectedHooks: PackHookRef[];
  createRequests: SkillCreationRequest[];
  learnEnabled: boolean;
  files: ReviewFile[];
  loading: boolean;
  error?: string;
  canConfirm: boolean;
  onConfirm: () => void;
  onBack: () => void;
};

type DoneStepProps = {
  writeStatus?: {
    ok: boolean;
    message: string;
  };
  installResults: InstallSkillResult[];
  createOutcomes: SkillCreationOutcome[];
  fileCount: number;
  hookCount: number;
  skillCount: number;
  ruleCount: number;
  evalCandidate?: PendingSkillEval;
  onEvaluate?: () => void;
  onExit: () => void;
};

type NoteContext = {
  hookCount: number;
  skillCount: number;
  ruleCount: number;
  verbs: PackVerbs;
};

/**
 * One-line reason for each manifest entry — evidence-first, carrying the real
 * count or the concrete verbs, so the manifest reads as an argument, not an
 * inventory.
 */
function fileNote(path: string, ctx: NoteContext): string {
  const base = path.split("/").pop() ?? path;

  if (base === "AGENTS.md") return `${ctx.ruleCount} rules · source of truth`;
  if (base === "CLAUDE.md") return "one line → see AGENTS.md";
  if (base === "settings.json") return `${ctx.hookCount} hooks wired`;
  if (base === "justfile") {
    const verbs = [ctx.verbs.check ? "check" : null, ctx.verbs.test ? "test" : null, ctx.verbs.fmt ? "fmt" : null, ctx.verbs.konsistent ? "konsistent" : null].filter(Boolean);
    return verbs.join(" · ");
  }
  if (base === "skills-lock.json") return `${ctx.skillCount} skills pinned`;
  if (base === "tool-policy-rules.json") return "deny rules the agent reads";
  if (base === ".farrier.json") return `the plan itself · ${ctx.skillCount} skills pinned`;
  if (base === "konsistent.json") return "structure conventions";
  if (base === ".gitignore") return "keeps .env* out of git";
  if (base === "SKILL.md") return "harness advisor skill";
  if (base.endsWith(".txt") && path.includes("prompts/")) return "judge prompt (disabled by default)";
  if (path.includes("hooks/")) return "rendered from tested template";

  return "";
}

function previewLines(content: string): PaneLine[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const shown = lines.slice(0, previewLineCount);

  if (shown.length === 0) {
    return [{ fg: palette.faint, text: "(empty file)" }];
  }

  return shown.map((line) => ({ fg: palette.muted, text: line.trimEnd() }));
}

export function ReviewStep(props: ReviewStepProps) {
  const [zone, setZone] = useState<Zone>("content");
  const [focusedButtonId, setFocusedButtonId] = useState<string>(reviewButtons[0].id);
  const [focusedFileIndex, setFocusedFileIndex] = useState<number>(0);

  function moveFile(delta: -1 | 1): void {
    setFocusedFileIndex((current) => Math.min(Math.max(current + delta, 0), Math.max(props.files.length - 1, 0)));
  }

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q") {
      props.onBack();
      return;
    }

    if (key.name === "tab") {
      setZone((current) => (current === "content" ? "buttons" : "content"));
      return;
    }

    if (key.name === "down") {
      if (zone === "content") {
        moveFile(1);
      }
      return;
    }

    if (key.name === "up") {
      if (zone === "buttons") {
        setZone("content");
      } else {
        moveFile(-1);
      }
      return;
    }

    if (key.name === "left") {
      if (zone === "buttons") {
        if (focusedButtonId === reviewButtons[0].id) {
          setZone("content");
        } else {
          setFocusedButtonId((current) => adjacentButtonId(reviewButtons, current, -1) ?? current);
        }
      } else {
        props.onBack();
      }
      return;
    }

    if (key.name === "b" && zone === "content") {
      props.onBack();
      return;
    }

    if (key.name === "right" && zone === "buttons") {
      setFocusedButtonId((current) => adjacentButtonId(reviewButtons, current, 1) ?? current);
      return;
    }

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed") {
      if (zone === "buttons" && focusedButtonId === "back") {
        props.onBack();
        return;
      }

      if (props.canConfirm) {
        props.onConfirm();
      }
    }
  });

  const pathWidth = Math.min(
    props.files.reduce((width, file) => Math.max(width, file.path.length), 0),
    maxPathColWidth
  );
  // What's left for "   note" after the cursor (2) + A/M flag (2) + path column.
  const noteBudget = manifestInnerWidth - 4 - pathWidth - 3;
  const noteContext: NoteContext = {
    hookCount: props.selectedHooks.length,
    skillCount: props.selectedSkills.length,
    ruleCount: props.ruleCount,
    verbs: props.verbs
  };
  const clampedIndex = Math.min(focusedFileIndex, Math.max(props.files.length - 1, 0));
  const focusedFile = props.files[clampedIndex];
  const fileWindow = scrollWindow(clampedIndex, props.files.length, maxVisibleFiles);
  const visibleFiles = props.files.slice(fileWindow.start, fileWindow.end);

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Review" subtitle="The full manifest before the strike." />

      {props.loading ? <text fg={palette.muted}>Building the manifest…</text> : null}
      {props.error ? <text fg={palette.warn}>✗ Render plan failed: {props.error}</text> : null}

      {props.files.length > 0 ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text>
            <span fg={palette.muted}>{"farrier will write "}</span>
            <span fg={palette.gold}>{String(props.files.length)}</span>
            <span fg={palette.muted}>{" files. Nothing has been written yet."}</span>
          </text>
          {visibleFiles.map((file, offset) => {
            const index = fileWindow.start + offset;
            const note = fileNote(file.path, noteContext);
            const focused = index === clampedIndex && zone === "content";
            const bg = focused ? palette.selBg : undefined;
            const cursor = index === clampedIndex ? "▸ " : "  ";

            const showNote = note && noteBudget >= 6;

            return (
              <text key={file.path} bg={bg}>
                <span fg={palette.accent}>{cursor}</span>
                <span fg={file.exists ? palette.gold : palette.success}>{file.exists ? "M " : "A "}</span>
                <span fg={palette.text}>{truncateTo(file.path, pathWidth).padEnd(pathWidth)}</span>
                {showNote ? <span fg={palette.faint}>{`   ${truncateTo(note, noteBudget)}`}</span> : null}
              </text>
            );
          })}
          {props.files.length > maxVisibleFiles ? (
            <text fg={palette.faint}>
              {`      showing ${fileWindow.start + 1}–${fileWindow.end} of ${props.files.length} · ↑↓ scrolls`}
            </text>
          ) : null}
        </box>
      ) : null}

      {props.createRequests.length > 0 ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text>
            <span fg={palette.gold}>{String(props.createRequests.length)}</span>
            <span fg={palette.muted}>{" skill(s) will be authored at forge time (agent runs — this takes minutes):"}</span>
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

      {focusedFile ? <DetailPane title={focusedFile.path} lines={previewLines(focusedFile.content)} /> : null}

      <ButtonBar
        buttons={reviewButtons}
        focusedId={zone === "buttons" ? focusedButtonId : undefined}
        hint="enter forge it · ↑↓ inspect file · b back · q abandon"
        emberActions={["forge it"]}
      />
    </box>
  );
}

export function WritingStep(props: { creatingCount?: number; cancelling?: boolean; collision?: CollisionPrompt | null }) {
  const spinner = useSpinner(true);
  const creating = props.creatingCount ?? 0;

  useKeyboard((key) => {
    if (!props.collision) {
      return;
    }

    if (key.name === "r") {
      props.collision.resolve("replace");
    } else if (key.name === "k" || key.name === "escape") {
      props.collision.resolve("keep");
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      {props.cancelling ? (
        <text fg={palette.warn}>{`${spinner}  Cancelling skill authoring — killing the agent runs… (files already written stay on disk)`}</text>
      ) : (
        <text fg={palette.accent}>{`${spinner}  Forging the harness — writing files, installing skills${creating > 0 ? `, authoring ${creating} skill(s)` : ""}…`}</text>
      )}
      {creating > 0 ? <text fg={palette.muted}>Skill authoring runs a full agent per skill — expect minutes, not seconds.</text> : null}
      {props.collision ? <CollisionPromptView collision={props.collision} /> : null}
      <text fg={palette.muted}>{creating > 0 ? "ctrl+c cancels skill authoring and kills the agent runs." : "Escape is ignored while forging."}</text>
    </box>
  );
}

export function DoneStep(props: DoneStepProps) {
  const failedInstalls = props.installResults.filter((result) => !result.ok);
  const installed = props.installResults.length - failedInstalls.length;
  const ok = props.writeStatus?.ok !== false;

  useKeyboard((key) => {
    if (key.name === "e" && props.evalCandidate && props.onEvaluate) {
      props.onEvaluate();
      return;
    }

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed" || key.name === "escape" || key.name === "q") {
      props.onExit();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      {ok ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={palette.accent}>{"  ⚒  Harness forged."}</text>
          <text> </text>
          <text>
            <span fg={palette.gold}>{String(props.fileCount)}</span>
            <span fg={palette.muted}>{" files written · "}</span>
            <span fg={palette.gold}>{String(props.hookCount)}</span>
            <span fg={palette.muted}>{" hooks · "}</span>
            <span fg={palette.gold}>{String(props.skillCount)}</span>
            <span fg={palette.muted}>{" skills pinned · "}</span>
            <span fg={palette.gold}>{String(props.ruleCount)}</span>
            <span fg={palette.muted}>{" rules"}</span>
          </text>
          <text>
            <span fg={palette.success}>{"✓ "}</span>
            <span fg={palette.muted}>{`${props.fileCount} files written to disk`}</span>
          </text>
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
                {outcome.error
                  ? `skill creation failed: ${outcome.error}`
                  : `created ${outcome.name}${outcome.installed ? " (installed)" : ""} — ${outcome.files.length} file(s)`}
              </span>
            </text>
          ))}
        </box>
      ) : (
        <text fg={palette.warn}>{`✗ ${props.writeStatus?.message ?? "Write failed."}`}</text>
      )}

      {ok ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={palette.faint}>{"─".repeat(60)}</text>
          <text fg={palette.muted}>{"Ride it:"}</text>
          <text>
            <span fg={palette.muted}>{"  "}</span>
            <span fg={palette.gold}>{"claude"}</span>
            <span fg={palette.muted}>{" “add a feature”   the harness keeps it honest"}</span>
          </text>
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

      {failedInstalls.length > 0 ? <text fg={palette.warn}>Some skill installs failed non-fatally:</text> : null}
      {failedInstalls.map((result) => (
        <text key={result.ref} fg={palette.muted}>
          {`  • ${result.ref}: ${result.error ?? result.stderr ?? "unknown failure"}`}
        </text>
      ))}

      {props.evalCandidate ? (
        <text fg={palette.gold}>
          {"e "}
          <span fg={palette.muted}>{`evaluate ${props.evalCandidate.skillName} copies & pick a winner · enter close`}</span>
        </text>
      ) : (
        <text fg={palette.gold}>
          {"enter "}
          <span fg={palette.muted}>close</span>
        </text>
      )}
    </box>
  );
}
