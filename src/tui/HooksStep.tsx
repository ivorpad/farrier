import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { HookId, ToolPolicyRule } from "../packs/types";
import { adjacentButtonId, ButtonBar, type ButtonSpec } from "./ButtonBar";
import { DetailPane, palette, StepHeader, type PaneLine } from "./chrome";

type HooksStepProps = {
  availableHooks: HookId[];
  selectedHooks: HookId[];
  toolPolicyRules: ToolPolicyRule[];
  onToggleHook: (hook: HookId) => void;
  onNext: () => void;
  onBack: () => void;
};

type Zone = "list" | "buttons";

const buttons: ButtonSpec[] = [
  { id: "back", label: "← Back" },
  { id: "next", label: "Next →" }
];

/**
 * Two hook families mirror farrier's two hook jobs: Protect blocks the move
 * and teaches the right one; Verify runs checks the tested engine wrote.
 */
const protectHooks: readonly HookId[] = ["secret-shield", "tool-policy", "write-guard"];

function hookGroup(hook: HookId): "protect" | "verify" {
  return protectHooks.includes(hook) ? "protect" : "verify";
}

const hookDescriptions: Record<HookId, string> = {
  "secret-shield": "blocks reads of .env* and private keys",
  "tool-policy": "redirects banned shell tools to stack-approved ones",
  "write-guard": "blocks direct writes to protected/generated files",
  "verb-runner": "`just check` + `just konsistent` after edits",
  "quality-judge": "warns on LOC and optional per-edit review",
  "stop-judge": "optional full-diff semantic review before yield"
};

/**
 * The deny text is the product — the agent reads it — so the picker shows it
 * while you decide, exactly in the shape the engine will render it.
 */
function agentSeesLines(hook: HookId, rules: ToolPolicyRule[]): PaneLine[] {
  switch (hook) {
    case "secret-shield":
      return [
        { fg: palette.warn, text: "✗ Blocked: read of .env — secrets never enter the transcript." },
        { fg: palette.gold, text: "→ Ask the human, or read .env.example for the variable name." }
      ];

    case "tool-policy": {
      const rule = rules[0];

      if (!rule) {
        return [{ fg: palette.faint, text: "No tool-policy rules in this pack yet — `farrier learn` can add them." }];
      }

      return [
        { fg: palette.warn, text: `✗ ${rule.message}` },
        { fg: palette.gold, text: `→ ${rule.redirect}` },
        { fg: palette.faint, text: `rule 1 of ${rules.length} in this pack` }
      ];
    }

    case "write-guard":
      return [
        { fg: palette.warn, text: "✗ Blocked: write to a protected file (lockfiles, .git/, skills-lock.json)." },
        { fg: palette.gold, text: "→ Change the source that generates it instead." }
      ];

    case "verb-runner":
      return [
        { fg: palette.success, text: "runs `just check` and `just konsistent` after edits" },
        { fg: palette.muted, text: "failures return to the agent as feedback, not to you as surprises" }
      ];

    case "quality-judge":
      return [
        { fg: palette.success, text: "warns when an edit balloons past the LOC budget" },
        { fg: palette.muted, text: "optional per-edit semantic review" }
      ];

    case "stop-judge":
      return [
        { fg: palette.success, text: "full-diff semantic review before the agent yields" },
        { fg: palette.muted, text: "the last gate between “done” and “actually done”" }
      ];
  }
}

function isSpace(key: unknown): boolean {
  const candidate = key as { name?: string; sequence?: string };
  return candidate.name === "space" || candidate.sequence === " ";
}

const groupHeaders: Record<"protect" | "verify", { title: string; tagline: string }> = {
  protect: { title: "Protect", tagline: " — block the move, teach the right one" },
  verify: { title: "Verify", tagline: " — runs the engine wrote, not the LLM" }
};

export function HooksStep(props: HooksStepProps) {
  const orderedHooks = useMemo<HookId[]>(() => {
    const protect = props.availableHooks.filter((hook) => hookGroup(hook) === "protect");
    const verify = props.availableHooks.filter((hook) => hookGroup(hook) === "verify");
    return [...protect, ...verify];
  }, [props.availableHooks]);

  const nameWidth = orderedHooks.reduce((width, hook) => Math.max(width, hook.length), 0);

  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [zone, setZone] = useState<Zone>("list");
  const [focusedButtonId, setFocusedButtonId] = useState<string>(buttons[0].id);

  useEffect(() => {
    if (focusedIndex > orderedHooks.length - 1) {
      setFocusedIndex(Math.max(orderedHooks.length - 1, 0));
    }
  }, [focusedIndex, orderedHooks.length]);

  const focusedHook = orderedHooks[Math.min(focusedIndex, orderedHooks.length - 1)];

  function moveFocus(delta: -1 | 1): void {
    setFocusedIndex((current) => Math.min(Math.max(current + delta, 0), orderedHooks.length - 1));
  }

  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onBack();
      return;
    }

    if (key.name === "q") {
      props.onBack();
      return;
    }

    if (key.name === "tab") {
      setZone((current) => (current === "list" ? "buttons" : "list"));
      return;
    }

    if (key.name === "down") {
      if (zone === "list") {
        moveFocus(1);
      }
      return;
    }

    if (key.name === "up") {
      if (zone === "buttons") {
        setZone("list");
      } else {
        moveFocus(-1);
      }
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

    if (key.name === "n") {
      props.onNext();
      return;
    }

    if (key.name === "b" && zone === "list") {
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
    if (zone === "list" && focusedHook && isSpace(key)) {
      props.onToggleHook(focusedHook);
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

  const paneHook = focusedHook ?? orderedHooks[0];

  const groups: Array<"protect" | "verify"> = ["protect", "verify"];

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Hooks" subtitle="The deny message is the interface — the agent reads it." />
      <box style={{ flexDirection: "column", gap: 0 }}>
        {groups.map((group, groupIndex) => {
          const groupHooks = orderedHooks.filter((hook) => hookGroup(hook) === group);
          if (groupHooks.length === 0) {
            return null;
          }

          const header = groupHeaders[group];

          return (
            <box key={group} style={{ flexDirection: "column", gap: 0 }}>
              {groupIndex > 0 ? <text> </text> : null}
              <text>
                <span fg={palette.gold}>{header.title}</span>
                <span fg={palette.faint}>{header.tagline}</span>
              </text>
              {groupHooks.map((hook) => {
                const index = orderedHooks.indexOf(hook);
                const selected = props.selectedHooks.includes(hook);
                const focused = index === focusedIndex;
                const bg = focused && zone === "list" ? palette.selBg : undefined;
                const cursor = focused ? "▸ " : "  ";

                return (
                  <text key={hook} bg={bg}>
                    <span fg={palette.accent}>{cursor}</span>
                    <span fg={selected ? palette.success : palette.faint}>{selected ? "[x] " : "[ ] "}</span>
                    <span fg={palette.text}>{hook.padEnd(nameWidth + 2)}</span>
                    <span fg={palette.faint}>{hookDescriptions[hook]}</span>
                  </text>
                );
              })}
            </box>
          );
        })}
      </box>
      {paneHook ? <DetailPane title={`agent sees · ${paneHook}`} lines={agentSeesLines(paneHook, props.toolPolicyRules)} /> : null}
      <ButtonBar
        buttons={buttons}
        focusedId={zone === "buttons" ? focusedButtonId : undefined}
        hint="space toggle · ↑↓ move · enter continue · b back · q quit"
      />
    </box>
  );
}
