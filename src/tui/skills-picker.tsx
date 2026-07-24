import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useState } from "react";
import { KeyHints, palette } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

/**
 * The chooser behind the launcher's "Find/Create skills" row. Skill authoring
 * used to hide behind the `a` binding inside the search surface and went
 * undiscovered; this screen makes both workflows first-class. Find still
 * keeps `a` as the fast path into authoring.
 */

export type SkillsPickerChoice = "find" | "create" | "back" | "quit";
export type SkillsPickerState = { index: number };
export type SkillsPickerEvent = { type: "up" | "down" | "choose" | "back" | "quit" };

// Labels stay pure ASCII so padEnd aligns by display width (launcher rule).
export const skillsPickerRows: ReadonlyArray<{ choice: "find" | "create"; label: string; detail: string }> = [
  { choice: "find", label: "Find skills", detail: "search skills.sh with a query, an intent, or a PRD; install what fits" },
  { choice: "create", label: "Create a skill", detail: "describe it; your coding agent authors and installs it" }
];

const labelColumn = Math.max(...skillsPickerRows.map((row) => row.label.length)) + 2;

export function skillsPickerReducer(
  state: SkillsPickerState,
  event: SkillsPickerEvent
): { state: SkillsPickerState; choice?: SkillsPickerChoice } {
  if (event.type === "back") return { state, choice: "back" };
  if (event.type === "quit") return { state, choice: "quit" };
  if (event.type === "choose") return { state, choice: skillsPickerRows[state.index]!.choice };
  if (event.type === "up") return { state: { index: Math.max(0, state.index - 1) } };
  return { state: { index: Math.min(skillsPickerRows.length - 1, state.index + 1) } };
}

export function SkillsPickerApp(props: { onChoice: (choice: SkillsPickerChoice) => void }) {
  const [state, setState] = useState<SkillsPickerState>({ index: 0 });

  const apply = (event: SkillsPickerEvent) => {
    const transition = skillsPickerReducer(state, event);
    if (transition.choice) props.onChoice(transition.choice);
    else setState(transition.state);
  };

  const bindings = defineBindings(
    binding(["up", "down"], "move", "move"),
    binding("enter", "choose", "choose"),
    binding(["escape", "b"], "back", "back"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );

  useKeyboard((key) => {
    const intent = resolveIntent(bindings, key);
    if (intent === "back") apply({ type: "back" });
    else if (intent === "quit") apply({ type: "quit" });
    else if (intent === "move") apply({ type: key.name === "down" ? "down" : "up" });
    else if (intent === "choose") apply({ type: "choose" });
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", gap: 0 }}>
        <text fg={palette.accent}>✦ Skills</text>
        <text fg={palette.muted}>Find existing skills for this project, or create a new one.</text>
      </box>
      <box style={{ flexDirection: "column", gap: 0 }}>
        {skillsPickerRows.map((row, rowIndex) => {
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
      <text fg={palette.faint}>Inside Find, `a` also jumps to authoring with the typed text as the brief.</text>
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}

export async function runSkillsPicker(): Promise<SkillsPickerChoice> {
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  try {
    renderer = await createCliRenderer();
    const cliRenderer = renderer;
    return await new Promise<SkillsPickerChoice>((done) => {
      let settled = false;
      const finish = (choice: SkillsPickerChoice) => {
        if (settled) return;
        settled = true;
        cliRenderer.destroy();
        done(choice);
      };
      createRoot(cliRenderer).render(<SkillsPickerApp onChoice={finish} />);
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier: ${error instanceof Error ? error.message : String(error)}`);
    return "back";
  }
}
