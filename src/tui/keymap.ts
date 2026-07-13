export type KeyboardInput = {
  name: string;
  sequence?: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  super?: boolean;
};

export type KeyChord =
  | "up"
  | "down"
  | "left"
  | "right"
  | "tab"
  | "shift+tab"
  | "space"
  | "enter"
  | "escape"
  | "pageup"
  | "pagedown"
  | "ctrl+c"
  | "super+z"
  | "b"
  | "q"
  | "r"
  | "y"
  | "n";

export type KeyBinding<Intent extends string> = {
  keys: readonly KeyChord[];
  intent: Intent;
  label: string;
  /** Hide aliases such as ctrl+c when a parent owns them but keep them active. */
  hidden?: boolean;
};

export function binding<Intent extends string>(keys: KeyChord | readonly KeyChord[], intent: Intent, label: string, options?: { hidden?: boolean }): KeyBinding<Intent> {
  return { keys: typeof keys === "string" ? [keys] : keys, intent, label, hidden: options?.hidden };
}

export function defineBindings<const Bindings extends readonly KeyBinding<string>[]>(...bindings: Bindings): Bindings {
  return bindings;
}

function matches(chord: KeyChord, key: KeyboardInput): boolean {
  if (chord === "ctrl+c") return key.ctrl === true && key.name === "c";
  if (chord === "super+z") return key.super === true && key.name === "z";
  if (chord === "shift+tab") return key.shift === true && key.name === "tab";
  if (chord === "enter") return key.name === "enter" || key.name === "return" || key.name === "linefeed";
  if (chord === "space") return key.name === "space" || key.sequence === " ";
  return key.ctrl !== true && key.meta !== true && key.super !== true && key.name === chord;
}

function isOrdinaryTextKey(key: KeyboardInput): boolean {
  if (key.ctrl || key.meta || key.super) return false;
  if (key.name.length === 1) return true;
  return key.sequence?.length === 1 && key.sequence !== "\t" && key.sequence !== "\r" && key.sequence !== "\n";
}

export function resolveIntent<Intent extends string>(bindings: readonly KeyBinding<Intent>[], key: KeyboardInput, options?: { textInputFocused?: boolean }): Intent | undefined {
  if (options?.textInputFocused && isOrdinaryTextKey(key)) return undefined;
  return bindings.find((candidate) => candidate.keys.some((chord) => matches(chord, key)))?.intent;
}

const keyLabels: Record<KeyChord, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  tab: "tab",
  "shift+tab": "shift+tab",
  space: "space",
  enter: "enter",
  escape: "esc",
  pageup: "pgup",
  pagedown: "pgdn",
  "ctrl+c": "ctrl+c",
  "super+z": "cmd+z",
  b: "b",
  q: "q",
  r: "r",
  y: "y",
  n: "n"
};

export function bindingsHint(bindings: readonly KeyBinding<string>[]): string {
  return bindings
    .filter((candidate) => !candidate.hidden)
    .map((candidate) => `${candidate.keys.map((key) => keyLabels[key]).join("/")} ${candidate.label}`)
    .join(" · ");
}

export const destructiveConfirmationBindings = defineBindings(
  binding("y", "confirm", "confirm"),
  binding(["n", "escape"], "reject", "reject")
);

export const runningCancellationBindings = defineBindings(
  binding("ctrl+c", "interrupt", "cancel and stop child processes")
);

export const adviceBatchCancellationBindings = defineBindings(
  binding(["super+z", "ctrl+c"], "interrupt", "cancel batch and stop child processes")
);

export const idleExitBindings = defineBindings(
  binding("ctrl+c", "quit", "quit")
);
