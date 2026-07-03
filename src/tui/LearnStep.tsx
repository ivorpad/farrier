import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { adjacentButtonId, ButtonBar, type ButtonSpec } from "./ButtonBar";
import { palette, StepHeader } from "./chrome";

type LearnStepProps = {
  learnEnabled: boolean;
  onToggleLearn: () => void;
  onNext: () => void;
  onBack: () => void;
};

type Zone = "content" | "buttons";

const buttons: ButtonSpec[] = [
  { id: "back", label: "← Back" },
  { id: "next", label: "Next →" }
];

function isSpace(key: unknown): boolean {
  const candidate = key as { name?: string; sequence?: string };
  return candidate.name === "space" || candidate.sequence === " ";
}

export function LearnStep(props: LearnStepProps) {
  const [zone, setZone] = useState<Zone>("content");
  const [focusedButtonId, setFocusedButtonId] = useState<string>(buttons[0].id);

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
        if (focusedButtonId === buttons[0].id) {
          setZone("content");
        } else {
          setFocusedButtonId((current) => adjacentButtonId(buttons, current, -1) ?? current);
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

    if (key.name === "n") {
      props.onNext();
      return;
    }

    if (key.name === "right") {
      if (zone === "buttons") {
        setFocusedButtonId((current) => adjacentButtonId(buttons, current, 1) ?? current);
      } else {
        props.onNext();
      }
      return;
    }

    if (zone === "buttons" && (key.name === "enter" || key.name === "return" || key.name === "linefeed")) {
      if (focusedButtonId === "back") {
        props.onBack();
      } else {
        props.onNext();
      }
      return;
    }

    if (zone === "content" && (key.name === "enter" || key.name === "return" || key.name === "linefeed" || isSpace(key))) {
      props.onToggleLearn();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Learn" subtitle="Enable the self-learning loop?" />
      <text fg={props.learnEnabled ? palette.success : palette.faint}>
        {props.learnEnabled ? "◉ Learn enabled" : "○ Learn disabled"}
      </text>
      <text fg={palette.muted}>
        This toggle is persisted in .farrier.json. Run `farrier learn` later to mine transcripts and propose declarative tool-policy rules.
      </text>
      <ButtonBar
        buttons={buttons}
        focusedId={zone === "buttons" ? focusedButtonId : undefined}
        hint="Tab: buttons · Space/Enter: toggle · ←/→: buttons · Enter: activate · Esc/←: back"
      />
    </box>
  );
}
