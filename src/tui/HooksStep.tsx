import type { SelectOption } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { HookId } from "../packs/types";
import { adjacentButtonId, ButtonBar, type ButtonSpec } from "./ButtonBar";
import { palette, StepHeader } from "./chrome";

type HooksStepProps = {
  availableHooks: HookId[];
  selectedHooks: HookId[];
  onToggleHook: (hook: HookId) => void;
  onNext: () => void;
  onBack: () => void;
};

type Zone = "list" | "buttons";

const buttons: ButtonSpec[] = [
  { id: "back", label: "← Back" },
  { id: "next", label: "Next →" }
];

const hookDescriptions: Record<HookId, string> = {
  "secret-shield": "Blocks secret/env/private-key reads",
  "tool-policy": "Redirects banned shell tools to stack-approved commands",
  "write-guard": "Blocks direct writes to protected generated/owned files",
  "verb-runner": "Runs just check and just konsistent",
  "quality-judge": "Warns on LOC and optional per-edit semantic issues",
  "stop-judge": "Optional full-diff semantic Stop review"
};

function isSpace(key: unknown): boolean {
  const candidate = key as { name?: string; sequence?: string };
  return candidate.name === "space" || candidate.sequence === " ";
}

export function HooksStep(props: HooksStepProps) {
  const [focusedHook, setFocusedHook] = useState<HookId | undefined>(props.availableHooks[0]);
  const [zone, setZone] = useState<Zone>("list");
  const [focusedButtonId, setFocusedButtonId] = useState<string>(buttons[0].id);

  const options = useMemo<SelectOption[]>(
    () =>
      props.availableHooks.map((hook) => ({
        name: `${props.selectedHooks.includes(hook) ? "◉" : "○"} ${hook}`,
        description: hookDescriptions[hook],
        value: hook
      })),
    [props.availableHooks, props.selectedHooks]
  );

  useEffect(() => {
    if (!focusedHook && props.availableHooks.length > 0) {
      setFocusedHook(props.availableHooks[0]);
    }
  }, [focusedHook, props.availableHooks]);

  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onBack();
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
      } else {
        props.onBack();
      }
      return;
    }

    if (key.name === "up" && zone === "buttons") {
      setZone("list");
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

    if (zone === "list" && focusedHook && (key.name === "enter" || key.name === "return" || key.name === "linefeed" || isSpace(key))) {
      props.onToggleHook(focusedHook);
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Hooks" subtitle="Choose Claude hook templates to copy into the harness." />
      <select
        options={options}
        focused={zone === "list"}
        onChange={(_index, option) => option && setFocusedHook(String(option.value) as HookId)}
        style={{ height: Math.min(Math.max(options.length + 1, 4), 10) }}
      />
      <text fg={palette.faint}>{`${props.selectedHooks.length}/${props.availableHooks.length} hooks enabled`}</text>
      <ButtonBar
        buttons={buttons}
        focusedId={zone === "buttons" ? focusedButtonId : undefined}
        hint="Tab: buttons · Space/Enter: toggle · ←/→: buttons · Enter: activate · Esc/←: back"
      />
    </box>
  );
}
