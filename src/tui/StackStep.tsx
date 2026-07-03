import type { SelectOption } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { adjacentButtonId, ButtonBar, type ButtonSpec } from "./ButtonBar";
import { StepHeader } from "./chrome";

type StackStepProps = {
  packIds: string[];
  selectedPackId: string;
  detectedPackId?: string;
  onSelectPack: (packId: string) => void;
  onNext: () => void;
  onCancel: () => void;
};

type Zone = "list" | "buttons";

const buttons: ButtonSpec[] = [
  { id: "cancel", label: "Exit" },
  { id: "next", label: "Continue →" }
];

function optionDescription(packId: string, selectedPackId: string, detectedPackId: string | undefined): string {
  const selected = packId === selectedPackId;
  const detected = packId === detectedPackId;

  if (selected && detected) {
    return "Detected stack (selected)";
  }

  if (detected) {
    return "Detected stack";
  }

  if (selected) {
    return "Selected stack";
  }

  return "Available stack";
}

export function StackStep(props: StackStepProps) {
  const [zone, setZone] = useState<Zone>("list");
  const [focusedButtonId, setFocusedButtonId] = useState<string>(buttons[0].id);

  const options: SelectOption[] = props.packIds.map((packId) => ({
    name: `${packId === props.selectedPackId ? "◉" : "○"} ${packId}${packId === props.detectedPackId ? " ✓ detected" : ""}`,
    description: optionDescription(packId, props.selectedPackId, props.detectedPackId),
    value: packId
  }));

  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onCancel();
      return;
    }

    if (key.name === "tab") {
      setZone((current) => (current === "list" ? "buttons" : "list"));
      return;
    }

    if (key.name === "left") {
      if (zone === "buttons") {
        if (focusedButtonId === buttons[0].id) {
          setZone("list");
        } else {
          setFocusedButtonId((current) => adjacentButtonId(buttons, current, -1) ?? current);
        }
      }
      return;
    }

    if (key.name === "up" && zone === "buttons") {
      setZone("list");
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

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed") {
      if (zone === "buttons") {
        if (focusedButtonId === "cancel") {
          props.onCancel();
        } else {
          props.onNext();
        }
        return;
      }

      props.onNext();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Stack" subtitle="Choose the stack pack to render." />
      <select
        options={options}
        selectedIndex={Math.max(props.packIds.indexOf(props.selectedPackId), 0)}
        focused={zone === "list"}
        onChange={(_index, option) => option && props.onSelectPack(String(option.value))}
        style={{ height: Math.min(Math.max(props.packIds.length + 1, 3), 8) }}
      />
      <ButtonBar
        buttons={buttons}
        focusedId={zone === "buttons" ? focusedButtonId : undefined}
        hint="Enter: continue · Tab/↑: buttons · ←/→: choose button · Esc: exit"
      />
    </box>
  );
}
