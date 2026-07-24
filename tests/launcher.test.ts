import { describe, expect, test } from "bun:test";
import { launcherReducer, launcherRows } from "../src/tui/launcher";

describe("primary launcher", () => {
  test("exposes exactly the five primary workflows with the required labels", () => {
    expect(launcherRows.map((row) => row.label)).toEqual([
      "Create harness",
      "Find/Create skills",
      "Improve harness",
      "Export harness",
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
    const skills = launcherReducer({ index: 0 }, { type: "down" }).state;
    expect(launcherReducer(skills, { type: "choose" }).choice).toBe("skills");
    const improve = launcherReducer(skills, { type: "down" }).state;
    expect(launcherReducer(improve, { type: "choose" }).choice).toBe("improve");
    const exportRow = launcherReducer(improve, { type: "down" }).state;
    expect(launcherReducer(exportRow, { type: "choose" }).choice).toBe("export");
    const doctor = launcherReducer(exportRow, { type: "down" }).state;
    expect(launcherReducer(doctor, { type: "choose" }).choice).toBe("doctor");
    expect(launcherReducer({ index: 0 }, { type: "cancel" }).choice).toBe("cancel");
  });

  test("clamps navigation at the first and last rows", () => {
    expect(launcherReducer({ index: 0 }, { type: "up" }).state.index).toBe(0);
    const last = launcherReducer({ index: launcherRows.length - 1 }, { type: "down" }).state;
    expect(last.index).toBe(launcherRows.length - 1);
  });
});
