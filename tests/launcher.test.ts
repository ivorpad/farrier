import { describe, expect, test } from "bun:test";
import { launcherReducer, launcherRows } from "../src/tui/launcher";

describe("primary launcher", () => {
  test("exposes exactly the five primary workflows with the required labels", () => {
    expect(launcherRows.map((row) => row.label)).toEqual([
      "Create harness",
      "Create skill",
      "Advise",
      "Learn from failures",
      "Doctor & update"
    ]);
  });

  test("labels are ASCII so the detail column aligns by display width", () => {
    for (const row of launcherRows) {
      // Non-ASCII dingbats render at ambiguous terminal widths and break alignment.
      expect(row.label).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  test("routes all five choices through the visible list", () => {
    expect(launcherReducer({ index: 0 }, { type: "choose" }).choice).toBe("harness");
    const skill = launcherReducer({ index: 0 }, { type: "down" }).state;
    expect(launcherReducer(skill, { type: "choose" }).choice).toBe("create");
    const advice = launcherReducer(skill, { type: "down" }).state;
    expect(launcherReducer(advice, { type: "choose" }).choice).toBe("advise");
    const learn = launcherReducer(advice, { type: "down" }).state;
    expect(launcherReducer(learn, { type: "choose" }).choice).toBe("learn");
    const doctor = launcherReducer(learn, { type: "down" }).state;
    expect(launcherReducer(doctor, { type: "choose" }).choice).toBe("doctor");
    expect(launcherReducer({ index: 0 }, { type: "cancel" }).choice).toBe("cancel");
  });

  test("clamps navigation at the first and last rows", () => {
    expect(launcherReducer({ index: 0 }, { type: "up" }).state.index).toBe(0);
    const last = launcherReducer({ index: launcherRows.length - 1 }, { type: "down" }).state;
    expect(last.index).toBe(launcherRows.length - 1);
  });
});
