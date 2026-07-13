import { describe, expect, test } from "bun:test";
import { launcherReducer, launcherRows } from "../src/tui/launcher";

describe("primary launcher", () => {
  test("exposes exactly the three primary workflows with the required labels", () => {
    expect(launcherRows.map((row) => row.label)).toEqual([
      "⚒ Create a harness",
      "✚ Create a skill",
      "✦ Advise this project"
    ]);
  });

  test("routes all three choices through the visible list", () => {
    expect(launcherReducer({ index: 0 }, { type: "choose" }).choice).toBe("harness");
    const skill = launcherReducer({ index: 0 }, { type: "down" }).state;
    expect(launcherReducer(skill, { type: "choose" }).choice).toBe("create");
    const advice = launcherReducer(skill, { type: "down" }).state;
    expect(launcherReducer(advice, { type: "choose" }).choice).toBe("advise");
    expect(launcherReducer({ index: 0 }, { type: "cancel" }).choice).toBe("cancel");
  });
});
