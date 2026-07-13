import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useState } from "react";
import { KeyHints, palette } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

export type LaunchChoice = "harness" | "create" | "advise" | "cancel";
export type LauncherState = { index: number };
export type LauncherEvent = { type: "up" | "down" | "choose" | "cancel" };

export const launcherRows: ReadonlyArray<{ choice: Exclude<LaunchChoice, "cancel">; label: string; detail: string }> = [
  { choice: "harness", label: "⚒ Create a harness", detail: "detect the stack and generate the agent harness" },
  { choice: "create", label: "✚ Create a skill", detail: "author and install a reusable skill" },
  { choice: "advise", label: "✦ Advise this project", detail: "inspect the project and suggest agent configuration improvements" }
];

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
        <text fg={palette.muted}>What would you like to do?</text>
      </box>
      <box style={{ flexDirection: "column", gap: 0 }}>
        {launcherRows.map((row, rowIndex) => {
          const focused = rowIndex === state.index;
          return (
            <text key={row.choice} bg={focused ? palette.selBg : undefined}>
              <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
              <span fg={palette.text}>{row.label.padEnd(28)}</span>
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
