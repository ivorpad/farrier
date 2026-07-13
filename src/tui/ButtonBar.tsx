import { KeyHints } from "./chrome";

type ButtonBarProps = {
  hint: string;
  emberActions?: string[];
};

/**
 * The single interaction line shown on every wizard step. The spec's grammar is
 * one keymap line — `key action · key action` — not a row of focusable chips.
 * Consumers must not create a focus zone for this non-interactive component.
 */
export function ButtonBar(props: ButtonBarProps) {
  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <KeyHints hint={props.hint} emberActions={props.emberActions} />
    </box>
  );
}
