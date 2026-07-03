import { KeyHints } from "./chrome";

export type ButtonSpec = {
  id: string;
  label: string;
};

type ButtonBarProps = {
  // Retained so steps can keep their tab-zone / left-right focus state and the
  // keyboard handlers that drive it, even though the bar no longer draws chips.
  buttons?: ButtonSpec[];
  focusedId?: string;
  hint: string;
  emberActions?: string[];
};

/**
 * The single interaction line shown on every wizard step. The spec's grammar is
 * one keymap line — `key action · key action` — not a row of focusable chips, so
 * the bar renders only that line (see KeyHints). Steps still own their tab-zone
 * focus state and dispatch the same machine events their shortcuts already do;
 * this component just draws the keymap, it never calls into the machine.
 */
export function ButtonBar(props: ButtonBarProps) {
  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <KeyHints hint={props.hint} emberActions={props.emberActions} />
    </box>
  );
}

/**
 * Given the currently focused button id, returns the id of the button one
 * step to the left (delta -1) or right (delta 1). Clamps at the ends of the
 * list instead of wrapping.
 */
export function adjacentButtonId(buttons: ButtonSpec[], currentId: string | undefined, delta: -1 | 1): string | undefined {
  if (buttons.length === 0) {
    return undefined;
  }

  const currentIndex = buttons.findIndex((button) => button.id === currentId);
  const startIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = Math.min(Math.max(startIndex + delta, 0), buttons.length - 1);

  return buttons[nextIndex].id;
}
