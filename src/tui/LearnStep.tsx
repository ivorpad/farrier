import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { ToolPolicyRule } from "../packs/types";
import { adjacentButtonId, ButtonBar, type ButtonSpec } from "./ButtonBar";
import { DetailPane, palette, StepHeader, type PaneLine } from "./chrome";

type LearnStepProps = {
  learnEnabled: boolean;
  toolPolicyRules: ToolPolicyRule[];
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
    if (key.name === "escape" || key.name === "q") {
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

    if (key.name === "b" && zone === "content") {
      props.onBack();
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

    // Space is the sole toggle; enter always advances (one keymap everywhere).
    if (zone === "content" && isSpace(key)) {
      props.onToggleLearn();
      return;
    }

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed") {
      if (zone === "buttons" && focusedButtonId === "back") {
        props.onBack();
      } else {
        props.onNext();
      }
    }
  });

  const rule = props.toolPolicyRules[0];
  const paneLines: PaneLine[] | undefined = rule
    ? [
        { fg: palette.warn, text: `✗ ${rule.message}` },
        { fg: palette.gold, text: `→ ${rule.redirect}` }
      ]
    : undefined;

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Learn" subtitle="Corrections become iron — with your consent." />
      <text fg={props.learnEnabled ? palette.success : palette.faint}>
        {props.learnEnabled ? "[x] learn enabled" : "[ ] learn disabled"}
      </text>
      <text fg={palette.muted}>
        `farrier learn` reads your session transcripts. When you have corrected the agent the same way more than once,
        it proposes that correction as a rule — showing the count and the exact quote that justify it, as a deny hook or
        an AGENTS.md line.
      </text>
      {paneLines ? <DetailPane title={`what a mined correction becomes · ${rule!.id}`} lines={paneLines} /> : null}
      <text fg={palette.muted}>Nothing becomes a rule unless you check it.</text>
      <ButtonBar
        buttons={buttons}
        focusedId={zone === "buttons" ? focusedButtonId : undefined}
        hint="space toggle · enter continue · b back · q quit"
      />
    </box>
  );
}
