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
const protectHooks: readonly HookId[] = ["secret-shield", "tool-policy", "write-guard", "large-file-commit-guard"];

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
  "secret-shield": "agents are refused reads of .env files and private keys",
  "tool-policy": "denies shell commands you blacklist and points to the approved one",
  "write-guard": "denies edits to lockfiles and other generated files",
  "verb-runner": "runs `just check` after edits and before the agent finishes",
  "quality-judge": "experimental AI review of each edit (ships off)",
  "stop-judge": "experimental AI review of the full diff (ships off)",
  "large-file-commit-guard": "denies git add/commit of files over a size limit you set",
  "process-teardown-audit": "flags leftover test/automation processes before the agent finishes"
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
        { fg: palette.success, text: "reviews each edit against quality.rules and the repo map" },
        { fg: palette.muted, text: "catches recreated helpers/types; LOC budget from quality.maxFileLines" }
      ];

    case "stop-judge":
      return [
        { fg: palette.success, text: "full-diff review against your rules before the agent yields" },
        { fg: palette.muted, text: "the last gate between “done” and “actually done”" }
      ];

    case "large-file-commit-guard":
      return [
        { fg: palette.warn, text: "✗ Blocked: git add — big.bin (12.4 MiB) is over the 5.0 MiB limit." },
        { fg: palette.gold, text: "→ Add it to .gitignore or use Git LFS; the limit lives in .farrier.json." }
      ];

    case "process-teardown-audit":
      return [
        { fg: palette.warn, text: "✗ Before finishing: 2 leftover processes match your teardown patterns." },
        { fg: palette.gold, text: "→ kill 4211 4230 — or say why they must stay. Asks once, then allows." }
      ];

    default:
      return [
        { fg: palette.gold, text: "registry hook payload" },
        { fg: palette.muted, text: "review the rendered hook files before applying" }
      ];
  }
}

const groupHeaders: Record<"protect" | "verify" | "registry", { title: string; tagline: string }> = {
  protect: { title: "Protect", tagline: ": actions agents are refused, with the right move pointed out" },
  verify: { title: "Verify", tagline: ": checks that run automatically after edits" },
  registry: { title: "Registry", tagline: ": hooks from your private registry" }
};

export function HooksStep(props: HooksStepProps) {
  const orderedHooks = useMemo<PackHookRef[]>(() => {
    const protect = props.availableHooks.filter((hook) => hookGroup(hook) === "protect");
    const verify = props.availableHooks.filter((hook) => hookGroup(hook) === "verify");
    const registry = props.availableHooks.filter((hook) => hookGroup(hook) === "registry");
    return [...protect, ...verify, ...registry];
  }, [props.availableHooks]);

  const nameWidth = orderedHooks.reduce((width, hook) => Math.max(width, hook.length), 0);
  const focusCount = orderedHooks.length;

  const [focusedIndex, setFocusedIndex] = useState<number>(0);

  useEffect(() => {
    if (focusedIndex > focusCount - 1) {
      setFocusedIndex(Math.max(focusCount - 1, 0));
    }
  }, [focusCount, focusedIndex]);

  const focusedHook = orderedHooks[focusedIndex];

  function moveFocus(delta: -1 | 1): void {
    setFocusedIndex((current) => Math.min(Math.max(current + delta, 0), focusCount - 1));
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

  const groups: Array<"protect" | "verify" | "registry"> = ["protect", "verify", "registry"];

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Hooks" subtitle="Choose what agents are blocked from doing, and what gets checked. Hooks apply no matter what the agent decides." />
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
      <text fg={palette.faint}>
        {"AI review hooks (quality-judge, stop-judge) ship disabled while under evaluation."}
      </text>
      {focusedHook
        ? <DetailPane title={`agent sees · ${focusedHook}`} lines={agentSeesLines(focusedHook, props.toolPolicyRules)} />
        : null}
      <ButtonBar hint={bindingsHint(hooksBindings)} />
    </box>
  );
}
