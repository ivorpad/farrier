import { useEffect, useState } from "react";
import type { WizardStep } from "./machine";

/**
 * Shared presentational chrome for the wizard: one palette, the step
 * breadcrumb, a spinner hook, and small formatters. Pure view helpers —
 * nothing here touches the machine.
 */
export const palette = {
  accent: "#93c5fd",
  accentText: "#0a0a0a",
  text: "#e4e4e7",
  muted: "#a1a1aa",
  faint: "#52525b",
  success: "#86efac",
  warn: "#fca5a5",
  agent: "#fbbf24"
} as const;

const flowSteps = ["Stack", "Skills", "Hooks", "Learn", "Review"] as const;

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }

    const interval = setInterval(() => {
      setFrame((current) => (current + 1) % spinnerFrames.length);
    }, 90);

    return () => clearInterval(interval);
  }, [active]);

  return spinnerFrames[frame] ?? spinnerFrames[0]!;
}

export function formatInstalls(installs: number): string {
  if (installs >= 1000) {
    const thousands = installs / 1000;
    return `${thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10}K`;
  }

  return String(installs);
}

type StepHeaderProps = {
  current: WizardStep;
  subtitle: string;
};

/**
 * Brand badge plus breadcrumb: ✓ done · ● current · ○ upcoming. The Writing
 * and Done steps are not part of the flow row and render every step as done.
 */
export function StepHeader(props: StepHeaderProps) {
  const currentIndex = (flowSteps as readonly string[]).indexOf(props.current);
  const effectiveIndex = currentIndex === -1 ? flowSteps.length : currentIndex;

  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <box style={{ flexDirection: "row", gap: 2 }}>
        <text fg={palette.accentText} bg={palette.accent}>
          {" farrier "}
        </text>
        {flowSteps.map((step, index) => {
          const isCurrent = index === effectiveIndex;
          const isDone = index < effectiveIndex;
          const glyph = isDone ? "✓" : isCurrent ? "●" : "○";

          return (
            <text key={step} fg={isCurrent ? palette.accent : isDone ? palette.success : palette.faint}>
              {`${glyph} ${step}`}
            </text>
          );
        })}
      </box>
      <text fg={palette.muted}>{props.subtitle}</text>
    </box>
  );
}
