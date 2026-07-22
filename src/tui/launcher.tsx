import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useState } from "react";
import { KeyHints, palette } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

export type LaunchChoice = "harness" | "create" | "advise" | "doctor" | "cancel";
export type LauncherState = { index: number };
export type LauncherEvent = { type: "up" | "down" | "choose" | "cancel" };

// No per-row glyphs: the dingbats (⚒ ✚ ✦ ⟳) have ambiguous terminal width —
// some render double-wide while opentui advances one column, so they overwrite
// the next cell and break the detail-column alignment. The ember ▸ cursor is the
// row marker (chrome palette rule), and labels stay pure ASCII so padEnd aligns
// by display width, not just UTF-16 length.
export const launcherRows: ReadonlyArray<{ choice: Exclude<LaunchChoice, "cancel">; label: string; detail: string }> = [
  { choice: "harness", label: "Create harness", detail: "detect the stack; generate AGENTS.md, hooks, and skills" },
  { choice: "create", label: "Create skill", detail: "author a new skill (SKILL.md) with your agent's skill creator" },
  { choice: "advise", label: "Advise", detail: "analyze repo + recent sessions; recommend hooks, skills, MCP" },
  { choice: "doctor", label: "Doctor & update", detail: "check harness health; repair drift after upgrades" }
];

const labelColumn = Math.max(...launcherRows.map((row) => row.label.length)) + 2;

export function launcherReducer(state: LauncherState, event: LauncherEvent): { state: LauncherState; choice?: LaunchChoice } {
  if (event.type === "cancel") return { state, choice: "cancel" };
  if (event.type === "choose") return { state, choice: launcherRows[state.index]!.choice };
  if (event.type === "up") return { state: { index: Math.max(0, state.index - 1) } };
  if (event.type === "down") return { state: { index: Math.min(launcherRows.length - 1, state.index + 1) } };
  return { state };
}

export function LauncherApp(props: { onChoice: (choice: LaunchChoice) => void }) {
  const [state, setState] = useState<LauncherState>({ index: 0 });

  const apply = (event: LauncherEvent) => {
    const transition = launcherReducer(state, event);
    if (transition.choice) props.onChoice(transition.choice);
    else setState(transition.state);
  };

  const bindings = defineBindings(
    binding(["up", "down"], "move", "move"),
    binding("enter", "choose", "choose"),
    binding(["escape", "b"], "cancel", "back"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );

  useKeyboard((key) => {
    const intent = resolveIntent(bindings, key);
    if (intent === "cancel" || intent === "quit") apply({ type: "cancel" });
    else if (intent === "move") apply({ type: key.name === "down" ? "down" : "up" });
    else if (intent === "choose") apply({ type: "choose" });
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", gap: 0 }}>
        <text fg={palette.accent}>{"🐴 farrier"}</text>
        <text fg={palette.muted}>
          Generates the agent harness for this repo: AGENTS.md/CLAUDE.md, hooks, and skills, so coding agents follow your project's rules.
        </text>
        <text fg={palette.faint}>What would you like to do?</text>
      </box>
      <box style={{ flexDirection: "column", gap: 0 }}>
        {launcherRows.map((row, rowIndex) => {
          const focused = rowIndex === state.index;
          return (
            <text key={row.choice} bg={focused ? palette.selBg : undefined}>
              <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
              <span fg={palette.text}>{row.label.padEnd(labelColumn)}</span>
              <span fg={palette.faint}>{row.detail}</span>
            </text>
          );
        })}
      </box>
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}

export async function runLauncher(): Promise<LaunchChoice> {
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  try {
    renderer = await createCliRenderer();
    const cliRenderer = renderer;
    return await new Promise<LaunchChoice>((done) => {
      let settled = false;
      const finish = (choice: LaunchChoice) => {
        if (settled) return;
        settled = true;
        cliRenderer.destroy();
        done(choice);
      };
      createRoot(cliRenderer).render(<LauncherApp onChoice={finish} />);
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier: ${error instanceof Error ? error.message : String(error)}`);
    return "cancel";
  }
}
