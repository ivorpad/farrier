import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { HookId, PackHookRef, ToolPolicyRule } from "../packs/types";
import { ButtonBar } from "./ButtonBar";
import { DetailPane, palette, StepHeader, type PaneLine } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

type HooksStepProps = {
  availableHooks: PackHookRef[];
  selectedHooks: PackHookRef[];
  toolPolicyRules: ToolPolicyRule[];
  onToggleHook: (hook: PackHookRef) => void;
  onNext: () => void;
  onBack: () => void;
  onQuit: () => void;
};

const hooksBindings = defineBindings(
  binding(["up", "down"], "move", "move"),
  binding("space", "toggle", "toggle"),
  binding("enter", "continue", "continue"),
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);

/**
 * Two hook families mirror farrier's two hook jobs: Protect blocks the move
 * and teaches the right one; Verify runs checks the tested engine wrote.
 */
const protectHooks: readonly HookId[] = ["secret-shield", "tool-policy", "write-guard"];

function isBuiltinHook(hook: PackHookRef): hook is HookId {
  return !hook.startsWith("@");
}

function hookGroup(hook: PackHookRef): "protect" | "verify" | "registry" {
  if (!isBuiltinHook(hook)) {
    return "registry";
  }

  return protectHooks.includes(hook) ? "protect" : "verify";
}

const hookDescriptions: Record<HookId, string> = {
  "secret-shield": "blocks reads of .env* and private keys",
  "tool-policy": "redirects banned shell tools to stack-approved ones",
  "write-guard": "blocks direct writes to protected/generated files",
  "verb-runner": "`just check` after edits; structure check at Stop",
  "quality-judge": "warns on LOC and optional per-edit review",
  "stop-judge": "optional full-diff semantic review before yield"
};

/**
 * The deny text is the product — the agent reads it — so the picker shows it
 * while you decide, exactly in the shape the engine will render it.
 */
function describeHook(hook: PackHookRef): string {
  if (!isBuiltinHook(hook)) {
    return "registry hook payload";
  }

  return hookDescriptions[hook];
}

function agentSeesLines(hook: PackHookRef, rules: ToolPolicyRule[]): PaneLine[] {
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
        { fg: palette.success, text: "runs `just check` after edits, structure check at Stop" },
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

    default:
      return [
        { fg: palette.gold, text: "registry hook payload" },
        { fg: palette.muted, text: "review the rendered hook files before forging" }
      ];
  }
}

const groupHeaders: Record<"protect" | "verify" | "registry", { title: string; tagline: string }> = {
  protect: { title: "Protect", tagline: " — block the move, teach the right one" },
  verify: { title: "Verify", tagline: " — runs the engine wrote, not the LLM" },
  registry: { title: "Registry", tagline: " — private executable hook payloads" }
};

export function HooksStep(props: HooksStepProps) {
  const orderedHooks = useMemo<PackHookRef[]>(() => {
    const protect = props.availableHooks.filter((hook) => hookGroup(hook) === "protect");
    const verify = props.availableHooks.filter((hook) => hookGroup(hook) === "verify");
    const registry = props.availableHooks.filter((hook) => hookGroup(hook) === "registry");
    return [...protect, ...verify, ...registry];
  }, [props.availableHooks]);

  const nameWidth = orderedHooks.reduce((width, hook) => Math.max(width, hook.length), 0);

  const [focusedIndex, setFocusedIndex] = useState<number>(0);

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
    const intent = resolveIntent(hooksBindings, key);
    if (intent === "back") {
      props.onBack();
      return;
    }
    if (intent === "quit") {
      props.onQuit();
      return;
    }
    if (intent === "move" && key.name === "down") {
      moveFocus(1);
      return;
    }
    if (intent === "move") {
      moveFocus(-1);
      return;
    }
    if (intent === "toggle" && focusedHook) {
      props.onToggleHook(focusedHook);
      return;
    }
    if (intent === "continue") props.onNext();
  });

  const paneHook = focusedHook ?? orderedHooks[0];

  const groups: Array<"protect" | "verify" | "registry"> = ["protect", "verify", "registry"];

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
                const bg = focused ? palette.selBg : undefined;
                const cursor = focused ? "▸ " : "  ";

                return (
                  <text key={hook} bg={bg}>
                    <span fg={palette.accent}>{cursor}</span>
                    <span fg={selected ? palette.success : palette.faint}>{selected ? "[x] " : "[ ] "}</span>
                    <span fg={palette.text}>{hook.padEnd(nameWidth + 2)}</span>
                    <span fg={palette.faint}>{describeHook(hook)}</span>
                  </text>
                );
              })}
            </box>
          );
        })}
      </box>
      {paneHook ? <DetailPane title={`agent sees · ${paneHook}`} lines={agentSeesLines(paneHook, props.toolPolicyRules)} /> : null}
      <ButtonBar hint={bindingsHint(hooksBindings)} />
    </box>
  );
}
