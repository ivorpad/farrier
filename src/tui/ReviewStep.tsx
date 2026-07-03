import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { InstallSkillResult } from "../engine/skills";
import type { HookId, SkillRef } from "../packs/types";
import { adjacentButtonId, ButtonBar, type ButtonSpec } from "./ButtonBar";
import { palette, StepHeader, useSpinner } from "./chrome";

type Zone = "content" | "buttons";

const reviewButtons: ButtonSpec[] = [
  { id: "back", label: "← Back" },
  { id: "confirm", label: "Write files" }
];

const doneButtons: ButtonSpec[] = [{ id: "exit", label: "Exit" }];

// Everything above this many file entries collapses into a "+N more" line so
// the step never overflows its box (overflowing children render overlapped).
const maxVisibleFiles = 10;

type ReviewStepProps = {
  targetDir: string;
  packId: string;
  selectedSkills: SkillRef[];
  selectedHooks: HookId[];
  learnEnabled: boolean;
  files: string[];
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
  onExit: () => void;
};

export function ReviewStep(props: ReviewStepProps) {
  const [zone, setZone] = useState<Zone>("content");
  const [focusedButtonId, setFocusedButtonId] = useState<string>(reviewButtons[0].id);

  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onBack();
      return;
    }

    if (key.name === "tab") {
      setZone((current) => (current === "content" ? "buttons" : "content"));
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

    if (key.name === "up" && zone === "buttons") {
      setZone("content");
      return;
    }

    if (key.name === "right" && zone === "buttons") {
      setFocusedButtonId((current) => adjacentButtonId(reviewButtons, current, 1) ?? current);
      return;
    }

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed") {
      if (zone === "buttons") {
        if (focusedButtonId === "back") {
          props.onBack();
        } else if (props.canConfirm) {
          props.onConfirm();
        }
        return;
      }

      if (props.canConfirm) {
        props.onConfirm();
      }
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Review" subtitle="Review the harness before writing." />
      <box style={{ flexDirection: "column", gap: 0 }}>
        <text>
          <span fg={palette.muted}>Target </span>
          {props.targetDir}
        </text>
        <text>
          <span fg={palette.muted}>Stack  </span>
          {props.packId}
        </text>
        <text>
          <span fg={palette.muted}>Hooks  </span>
          {props.selectedHooks.length === 0 ? "(none)" : `${props.selectedHooks.length} · ${props.selectedHooks.join(", ")}`}
        </text>
        <text>
          <span fg={palette.muted}>Skills </span>
          {props.selectedSkills.length === 0 ? "(none)" : `${props.selectedSkills.length} · ${props.selectedSkills.join(", ")}`}
        </text>
        <text>
          <span fg={palette.muted}>Learn  </span>
          {props.learnEnabled ? "enabled" : "disabled"}
        </text>
      </box>

      {props.loading ? <text fg={palette.muted}>Building render inventory…</text> : null}
      {props.error ? <text fg={palette.warn}>✗ Render plan failed: {props.error}</text> : null}

      {props.files.length > 0 ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={palette.accent}>{`Files to write (${props.files.length}):`}</text>
          {props.files.slice(0, maxVisibleFiles).map((file) => (
            <text key={file} fg={palette.text}>
              {`  • ${file}`}
            </text>
          ))}
          {props.files.length > maxVisibleFiles ? (
            <text fg={palette.faint}>{`  … +${props.files.length - maxVisibleFiles} more`}</text>
          ) : null}
        </box>
      ) : null}

      <ButtonBar
        buttons={reviewButtons}
        focusedId={zone === "buttons" ? focusedButtonId : undefined}
        hint="Tab: buttons · ←/→: buttons · Enter: activate (write) · Esc/←: back"
      />
    </box>
  );
}

export function WritingStep() {
  const spinner = useSpinner(true);

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Writing" subtitle="Writing the harness…" />
      <text fg={palette.accent}>{`${spinner} Writing harness files and installing skills…`}</text>
      <text fg={palette.muted}>Escape is ignored while writing.</text>
    </box>
  );
}

export function DoneStep(props: DoneStepProps) {
  const failedInstalls = props.installResults.filter((result) => !result.ok);

  useKeyboard((key) => {
    if (key.name === "enter" || key.name === "return" || key.name === "linefeed" || key.name === "escape") {
      props.onExit();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Done" subtitle="Harness written." />
      <text fg={props.writeStatus?.ok === false ? palette.warn : palette.success}>
        {`${props.writeStatus?.ok === false ? "✗" : "✓"} ${props.writeStatus?.message ?? "Done."}`}
      </text>

      {failedInstalls.length > 0 ? <text fg={palette.warn}>Some skill installs failed non-fatally:</text> : null}
      {failedInstalls.map((result) => (
        <text key={result.ref} fg={palette.muted}>
          {`  • ${result.ref}: ${result.error ?? result.stderr ?? "unknown failure"}`}
        </text>
      ))}

      <ButtonBar buttons={doneButtons} focusedId="exit" hint="Enter/Esc: exit" />
    </box>
  );
}
