import { useEffect, useState } from "react";
import type { WizardStep } from "./machine";

/**
 * Shared presentational chrome for the wizard: one palette, the step
 * breadcrumb, a spinner hook, and small formatters. Pure view helpers —
 * nothing here touches the machine.
 *
 * Palette philosophy (the "forge" identity): ember is the single hot hue and
 * is spent only on the current step, focused controls, and the forge verb.
 * Gold marks keys, counts, and versions. Green/rust are semantic (pass/deny)
 * and never decorative.
 */
export const palette = {
  accent: "#e0722f",
  accentText: "#16130f",
  gold: "#c9a227",
  text: "#e6ddcc",
  // The HTML mockup's neutrals (#9a8f7c / #6b6154) sat on a lifted panel
  // ground; on a real terminal's darker bg they fall under readable contrast,
  // so both are brightened while keeping the warm bone hue bias.
  muted: "#b3a78f",
  faint: "#8d8171",
  success: "#8aa650",
  warn: "#cd5f48",
  agent: "#c9a227",
  selBg: "#33261a"
} as const;

const flowSteps = ["Stack", "Skills", "Create", "Hooks", "Learn", "Review"] as const;

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
 * The breadcrumb is the wizard's contract: all six steps are always named,
 * the current one burns ember, done steps cool to muted, upcoming steps stay
 * faint, and a step counter sits at the end so the user always knows how much
 * wizard is left. No brand badge — ember is reserved for the current step, the
 * cursor, and the forge verb; the breadcrumb opens the line directly. Only the
 * six flow steps get a breadcrumb; the forged screen leads with its headline.
 */
export function StepHeader(props: StepHeaderProps) {
  const currentIndex = (flowSteps as readonly string[]).indexOf(props.current);
  const effectiveIndex = currentIndex === -1 ? flowSteps.length : currentIndex;
  const counter = `step ${effectiveIndex + 1}/${flowSteps.length}`;

  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <box style={{ flexDirection: "row", gap: 1, width: "100%" }}>
        <text>
          {flowSteps.map((step, index) => {
            const isCurrent = index === effectiveIndex;
            const isDone = index < effectiveIndex;

            return (
              <span key={step}>
                {index > 0 ? <span fg={palette.faint}>{" · "}</span> : null}
                <span fg={isCurrent ? palette.accent : isDone ? palette.muted : palette.faint}>{step}</span>
              </span>
            );
          })}
        </text>
        <box style={{ flexGrow: 1 }} />
        <text fg={palette.faint}>{counter}</text>
      </box>
      <text fg={palette.muted}>{props.subtitle}</text>
    </box>
  );
}

export type PaneLine = {
  fg: string;
  text: string;
};

const paneMaxInner = 58;

export function truncateTo(text: string, width: number): string {
  if (text.length <= width) {
    return text;
  }

  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
}

/**
 * The single detail-pane grammar, used on every step that explains a focused
 * row: a fully closed box drawn from text lines —
 *   ┌─ title ───┐
 *   │ content   │
 *   └───────────┘
 * The frame is faint; each content line keeps its own fg. One approach, every
 * pane (Hooks "agent sees", Skills "why unchecked", Learn, Review preview). The
 * inner width is pinned to a single constant so every box on every screen draws
 * the same top/bottom border length — one detail-pane grammar, not four widths.
 */
export function DetailPane(props: { title: string; lines: PaneLine[] }) {
  const contentWidth = paneMaxInner;
  const title = truncateTo(props.title, contentWidth - 1);

  const top = `┌─ ${title} ${"─".repeat(Math.max(contentWidth - title.length - 1, 0))}┐`;
  const bottom = `└${"─".repeat(contentWidth + 2)}┘`;

  return (
    <box style={{ flexDirection: "column", gap: 0 }}>
      <text fg={palette.faint}>{top}</text>
      {props.lines.map((line, index) => (
        <text key={`${line.text}-${index}`}>
          <span fg={palette.faint}>{"│ "}</span>
          <span fg={line.fg}>{truncateTo(line.text, contentWidth).padEnd(contentWidth)}</span>
          <span fg={palette.faint}>{" │"}</span>
        </text>
      ))}
      <text fg={palette.faint}>{bottom}</text>
    </box>
  );
}

/**
 * A bounded, centered scroll window over a longer list: renders a fixed number
 * of rows while keeping the focused row visible, so toggle/manifest lists stay
 * inside an 80×24 terminal yet every entry remains reachable. Returns the slice
 * bounds and how many rows are hidden above/below the window.
 */
export function scrollWindow(
  focusedIndex: number,
  total: number,
  maxVisible: number
): { start: number; end: number; hiddenAbove: number; hiddenBelow: number } {
  if (total <= maxVisible) {
    return { start: 0, end: total, hiddenAbove: 0, hiddenBelow: 0 };
  }

  const clampedFocus = Math.min(Math.max(focusedIndex, 0), total - 1);
  let start = clampedFocus - Math.floor(maxVisible / 2);
  start = Math.max(0, Math.min(start, total - maxVisible));
  const end = start + maxVisible;

  return { start, end, hiddenAbove: start, hiddenBelow: total - end };
}

/**
 * Renders a keymap hint line in the vision's grammar: `key action · key
 * action`, keys in gold, actions muted. Each segment's first word is the key.
 */
export function KeyHints(props: { hint: string; emberActions?: string[] }) {
  const segments = props.hint
    .split("·")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const emberActions = props.emberActions ?? [];

  return (
    <text>
      {segments.map((segment, index) => {
        const spaceIndex = segment.indexOf(" ");
        const key = spaceIndex === -1 ? segment : segment.slice(0, spaceIndex);
        const action = spaceIndex === -1 ? "" : segment.slice(spaceIndex);
        // The forge verb is the only action that burns ember — palette rule:
        // ember for the current step, the cursor, and the forge verb only.
        const isEmber = emberActions.includes(action.trim());

        return (
          <span key={`${segment}-${index}`}>
            {index > 0 ? <span fg={palette.faint}>{"  ·  "}</span> : null}
            <span fg={palette.gold}>{key}</span>
            <span fg={isEmber ? palette.accent : palette.muted}>{action}</span>
          </span>
        );
      })}
    </text>
  );
}
