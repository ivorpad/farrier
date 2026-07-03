import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useState } from "react";
import { KeyHints, palette } from "./chrome";

export type LaunchChoice = "forge" | "create" | "cancel";

const rows: ReadonlyArray<{ choice: LaunchChoice; label: string; detail: string }> = [
  { choice: "forge", label: "⚒ Forge the harness", detail: "the full wizard: stack, skills, hooks, learn, review" },
  { choice: "create", label: "✚ Create a skill", detail: "skip straight to authoring — vendor skill-creators, then install" }
];

function LauncherApp(props: { onChoice: (choice: LaunchChoice) => void }) {
  const [index, setIndex] = useState(0);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q") {
      props.onChoice("cancel");
      return;
    }

    if (key.name === "up") {
      setIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (key.name === "down") {
      setIndex((current) => Math.min(current + 1, rows.length - 1));
      return;
    }

    if (key.name === "c") {
      props.onChoice("create");
      return;
    }

    if (key.name === "f") {
      props.onChoice("forge");
      return;
    }

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed") {
      props.onChoice(rows[index]!.choice);
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", gap: 0 }}>
        <text fg={palette.accent}>{"🐴 farrier"}</text>
        <text fg={palette.muted}>What are we forging?</text>
      </box>
      <box style={{ flexDirection: "column", gap: 0 }}>
        {rows.map((row, rowIndex) => {
          const focused = rowIndex === index;

          return (
            <text key={row.choice} bg={focused ? palette.selBg : undefined}>
              <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
              <span fg={palette.text}>{row.label.padEnd(24)}</span>
              <span fg={palette.faint}>{row.detail}</span>
            </text>
          );
        })}
      </box>
      <KeyHints hint="enter choose · f forge · c create · ↑↓ move · q quit" />
    </box>
  );
}

export async function runLauncher(): Promise<LaunchChoice> {
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;

  try {
    renderer = await createCliRenderer();
    const cliRenderer = renderer;

    return await new Promise<LaunchChoice>((resolve) => {
      let settled = false;

      const finish = (choice: LaunchChoice) => {
        if (settled) {
          return;
        }

        settled = true;
        cliRenderer.destroy();
        resolve(choice);
      };

      createRoot(cliRenderer).render(<LauncherApp onChoice={finish} />);
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier: ${error instanceof Error ? error.message : String(error)}`);
    return "cancel";
  }
}
