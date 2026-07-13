import { useKeyboard } from "@opentui/react";
import type { ToolPolicyRule } from "../packs/types";
import { ButtonBar } from "./ButtonBar";
import { DetailPane, palette, StepHeader, type PaneLine } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

type LearnStepProps = {
  learnEnabled: boolean;
  toolPolicyRules: ToolPolicyRule[];
  onToggleLearn: () => void;
  onNext: () => void;
  onBack: () => void;
  onQuit: () => void;
};

const learnBindings = defineBindings(
  binding("space", "toggle", "toggle"),
  binding("enter", "continue", "continue"),
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);

export function LearnStep(props: LearnStepProps) {
  useKeyboard((key) => {
    const intent = resolveIntent(learnBindings, key);
    if (intent === "back") {
      props.onBack();
      return;
    }
    if (intent === "quit") {
      props.onQuit();
      return;
    }
    if (intent === "toggle") {
      props.onToggleLearn();
      return;
    }
    if (intent === "continue") props.onNext();
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
      <ButtonBar hint={bindingsHint(learnBindings)} />
    </box>
  );
}
