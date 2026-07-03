export type ButtonSpec = {
  id: string;
  label: string;
};

type ButtonBarProps = {
  buttons: ButtonSpec[];
  focusedId?: string;
  hint: string;
};

/**
 * Presentational bottom bar shown on every wizard step. Steps own their own
 * focus/zone state and dispatch the same machine events their keyboard
 * shortcuts already dispatch — this component only renders the buttons and
 * the trailing hint line, it never calls into the machine itself.
 */
export function ButtonBar(props: ButtonBarProps) {
  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <box style={{ flexDirection: "row", gap: 2 }}>
        {props.buttons.map((button) => {
          const isFocused = button.id === props.focusedId;

          return (
            <text key={button.id} fg={isFocused ? "#0a0a0a" : "#e4e4e7"} bg={isFocused ? "#93c5fd" : undefined}>
              {isFocused ? ` ▶ ${button.label} ` : `   ${button.label} `}
            </text>
          );
        })}
      </box>
      <text fg="#a1a1aa">{props.hint}</text>
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
