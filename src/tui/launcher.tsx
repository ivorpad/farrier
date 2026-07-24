import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useState } from "react";
import { KeyHints, palette } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

export type LaunchChoice = "harness" | "skills" | "improve" | "export" | "doctor" | "cancel";
export type LauncherState = { index: number };
export type LauncherEvent = { type: "up" | "down" | "choose" | "cancel" };

// No per-row glyphs: the dingbats (⚒ ✚ ✦ ⟳) have ambiguous terminal width —
// some render double-wide while opentui advances one column, so they overwrite
// the next cell and break the detail-column alignment. The ember ▸ cursor is the
// row marker (chrome palette rule), and labels stay pure ASCII so padEnd aligns
// by display width, not just UTF-16 length.
export const launcherRows: ReadonlyArray<{ choice: Exclude<LaunchChoice, "cancel">; label: string; detail: string }> = [
  { choice: "harness", label: "Create harness", detail: "detect the stack or start from a PRD; generate AGENTS.md, hooks, and skills" },
  { choice: "skills", label: "Find/Create skills", detail: "search the registry with a query or a PRD; install or author what's missing" },
  { choice: "improve", label: "Improve harness", detail: "count session failures locally, then LLM analysis; hooks, rules, skills" },
  { choice: "export", label: "Export harness", detail: "export finished sessions as a portable playbook: gates, evidence, subagents" },
  { choice: "doctor", label: "Doctor & update", detail: "check harness health; repair drift after upgrades" }
];

const labelColumn = Math.max(...launcherRows.map((row) => row.label.length)) + 2;

/** Per-row capability note; when present it replaces the detail column (warn color). */
export type LauncherRowNotes = Partial<Record<Exclude<LaunchChoice, "cancel">, string>>;

export type LauncherContext = {
  /** One line under the header naming the confirmed working agent (or its absence). */
  statusLine?: string;
  rowNotes?: LauncherRowNotes;
};

export function launcherReducer(state: LauncherState, event: LauncherEvent): { state: LauncherState; choice?: LaunchChoice } {
  if (event.type === "cancel") return { state, choice: "cancel" };
  if (event.type === "choose") return { state, choice: launcherRows[state.index]!.choice };
  if (event.type === "up") return { state: { index: Math.max(0, state.index - 1) } };
  if (event.type === "down") return { state: { index: Math.min(launcherRows.length - 1, state.index + 1) } };
  return { state };
}

export function LauncherApp(props: { onChoice: (choice: LaunchChoice) => void; context?: LauncherContext }) {
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
        {props.context?.statusLine ? <text fg={palette.gold}>{props.context.statusLine}</text> : null}
        <text fg={palette.faint}>What would you like to do?</text>
      </box>
      <box style={{ flexDirection: "column", gap: 0 }}>
        {launcherRows.map((row, rowIndex) => {
          const focused = rowIndex === state.index;
          const note = props.context?.rowNotes?.[row.choice];
          return (
            <text key={row.choice} bg={focused ? palette.selBg : undefined}>
              <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
              <span fg={palette.text}>{row.label.padEnd(labelColumn)}</span>
              {note ? <span fg={palette.warn}>{note}</span> : <span fg={palette.faint}>{row.detail}</span>}
            </text>
          );
        })}
      </box>
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}

export async function runLauncher(context?: LauncherContext): Promise<LaunchChoice> {
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
      createRoot(cliRenderer).render(<LauncherApp onChoice={finish} context={context} />);
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier: ${error instanceof Error ? error.message : String(error)}`);
    return "cancel";
  }
}
