import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState } from "react";
import type { SessionIndexEntry } from "../engine/advice-sessions";
import type { AgentBackend } from "../engine/backend";
import { backendName } from "./advice-presenter";
import { KeyHints, palette } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

/** One picker row: recency, turn count when the provider reports one, and the
 * session's own first-request preview (codex `preview` / Claude head read). */
export function adviceSessionPickerRowLabel(entry: SessionIndexEntry): string {
  const when = entry.updatedAt.slice(0, 16).replace("T", " ");
  const turns = entry.approximateTurns === undefined ? "" : ` · ${entry.approximateTurns} turn(s)`;
  return `${when}${turns} · ${entry.label ?? "no preview available"}`;
}

/** Toggles one session in the selection, refusing additions past the cap. */
export function toggledSessionSelection(
  selected: readonly string[],
  opaqueId: string,
  cap: number,
): { selected: string[]; capped: boolean } {
  if (selected.includes(opaqueId)) {
    return { selected: selected.filter((id) => id !== opaqueId), capped: false };
  }
  if (selected.length >= cap) return { selected: [...selected], capped: true };
  return { selected: [...selected, opaqueId], capped: false };
}

const pickerBindings = defineBindings(
  binding(["up", "down"], "move", "choose"),
  binding("space", "toggle", "include/exclude"),
  binding("a", "all", "all/none"),
  binding("enter", "confirm", "confirm"),
  binding(["pageup", "pagedown"], "scroll", "scroll"),
  binding(["escape", "b"], "back", "cancel"),
);

export function AdviceSessionPicker(props: {
  backend: AgentBackend;
  entries: SessionIndexEntry[];
  selectionCap: number;
  onConfirm: (chosen: SessionIndexEntry[]) => void;
  onCancel: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => props.entries.slice(0, props.selectionCap).map((entry) => entry.opaqueId));
  const [notice, setNotice] = useState<string>();
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const name = backendName(props.backend);

  useKeyboard((key) => {
    const intent = resolveIntent(pickerBindings, key);
    if (intent === "move") {
      const next = Math.min(
        props.entries.length - 1,
        Math.max(0, cursor + (key.name === "down" ? 1 : -1)));
      setCursor(next);
      scrollRef.current?.scrollTo({ x: 0, y: Math.max(0, next - 4) });
    } else if (intent === "toggle") {
      const entry = props.entries[cursor];
      if (!entry) return;
      const result = toggledSessionSelection(selectedIds, entry.opaqueId, props.selectionCap);
      setSelectedIds(result.selected);
      setNotice(result.capped ? `Selection is capped at ${props.selectionCap} sessions.` : undefined);
    } else if (intent === "all") {
      const cappedAll = props.entries.slice(0, props.selectionCap).map((entry) => entry.opaqueId);
      const allSelected = selectedIds.length === cappedAll.length;
      setSelectedIds(allSelected ? [] : cappedAll);
      setNotice(!allSelected && props.entries.length > props.selectionCap
        ? `Selected the ${props.selectionCap} most recent; the cap is ${props.selectionCap} sessions.`
        : undefined);
    } else if (intent === "confirm") {
      if (!selectedIds.length) {
        setNotice("Select at least one session, or press Esc to keep sessions off.");
        return;
      }
      props.onConfirm(props.entries.filter((entry) => selectedIds.includes(entry.opaqueId)));
    } else if (intent === "scroll") {
      scrollRef.current?.scrollBy(key.name === "pagedown" ? 0.85 : -0.85, "viewport");
    } else if (intent === "back") {
      props.onCancel();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text fg={palette.accent}>{`✦ Choose ${name} sessions`}</text>
        <text fg={palette.muted}>{`${selectedIds.length} of ${props.entries.length} selected · excerpts from selected sessions are sent to ${name} when you analyze`}</text>
      </box>
      <scrollbox
        ref={scrollRef}
        focused={false}
        scrollX={false}
        scrollY
        viewportCulling
        style={{ flexGrow: 1, flexShrink: 1, width: "100%" }}
        contentOptions={{ flexDirection: "column", width: "100%" }}
      >
        {props.entries.map((entry, index) => (
          <text key={entry.opaqueId} style={{ flexShrink: 0 }} bg={cursor === index ? palette.selBg : undefined}>
            <span fg={palette.accent}>{cursor === index ? "▸ " : "  "}</span>
            <span fg={selectedIds.includes(entry.opaqueId) ? palette.success : palette.muted}>
              {selectedIds.includes(entry.opaqueId) ? "[x] " : "[ ] "}
            </span>
            <span fg={palette.text}>{adviceSessionPickerRowLabel(entry)}</span>
          </text>
        ))}
      </scrollbox>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        {notice ? <text fg={palette.warn}>{notice}</text> : null}
        <KeyHints hint={bindingsHint(pickerBindings)} />
      </box>
    </box>
  );
}
