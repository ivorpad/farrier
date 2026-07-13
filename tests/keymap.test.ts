import { describe, expect, test } from "bun:test";
import { collisionBindings } from "../src/tui/collision";
import {
  binding,
  bindingsHint,
  defineBindings,
  adviceBatchCancellationBindings,
  destructiveConfirmationBindings,
  resolveIntent
} from "../src/tui/keymap";

describe("TUI keymap", () => {
  const common = defineBindings(
    binding(["up", "down"], "move", "move"),
    binding(["left", "right"], "adjust", "change value"),
    binding(["tab", "shift+tab"], "focus", "focus zone"),
    binding("space", "toggle", "toggle"),
    binding("enter", "activate", "activate"),
    binding(["escape", "b"], "back", "back"),
    binding(["q", "ctrl+c"], "quit", "quit"),
    binding(["pageup", "pagedown"], "scroll", "scroll"),
    binding("r", "retry", "retry")
  );

  test.each([
    [{ name: "up" }, "move"],
    [{ name: "down" }, "move"],
    [{ name: "left" }, "adjust"],
    [{ name: "right" }, "adjust"],
    [{ name: "tab" }, "focus"],
    [{ name: "tab", shift: true }, "focus"],
    [{ name: "space", sequence: " " }, "toggle"],
    [{ name: "return" }, "activate"],
    [{ name: "linefeed" }, "activate"],
    [{ name: "escape" }, "back"],
    [{ name: "b" }, "back"],
    [{ name: "q" }, "quit"],
    [{ name: "c", ctrl: true }, "quit"],
    [{ name: "pageup" }, "scroll"],
    [{ name: "pagedown" }, "scroll"],
    [{ name: "r" }, "retry"]
  ] as const)("maps %j to %s", (key, intent) => {
    expect(resolveIntent(common, key)).toBe(intent);
  });

  test("ordinary letters and spaces remain text while a field is focused", () => {
    for (const key of [{ name: "q" }, { name: "b" }, { name: "r" }, { name: "space", sequence: " " }]) {
      expect(resolveIntent(common, key, { textInputFocused: true })).toBeUndefined();
    }
    expect(resolveIntent(common, { name: "escape" }, { textInputFocused: true })).toBe("back");
    expect(resolveIntent(common, { name: "c", ctrl: true }, { textInputFocused: true })).toBe("quit");
  });

  test("rendered hints come from the active bindings, including every alias", () => {
    expect(bindingsHint(destructiveConfirmationBindings)).toBe("y confirm · n/esc reject");
    expect(bindingsHint(collisionBindings)).toBe("y replace · n/esc keep existing · b close prompt");
    expect(bindingsHint(common)).toContain("q/ctrl+c quit");
  });

  test("OpenTUI's normalized super+z event cancels advice batches without binding plain z", () => {
    expect(resolveIntent(adviceBatchCancellationBindings, { name: "z", super: true })).toBe("interrupt");
    expect(resolveIntent(adviceBatchCancellationBindings, { name: "z" })).toBeUndefined();
    expect(resolveIntent(adviceBatchCancellationBindings, { name: "z", meta: true })).toBeUndefined();
    expect(resolveIntent(adviceBatchCancellationBindings, { name: "c", ctrl: true })).toBe("interrupt");
    expect(bindingsHint(adviceBatchCancellationBindings)).toBe("cmd+z/ctrl+c cancel batch and stop child processes");
  });
});
