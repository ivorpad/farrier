import { describe, expect, test } from "bun:test";
import { harnessVerbs, pickHarnessVerb } from "../src/tui/verbs";

describe("harness verbs", () => {
  test("holds exactly 50 entries", () => {
    expect(harnessVerbs.length).toBe(50);
  });

  test("every gerund and past is non-empty and gerunds are unique", () => {
    for (const verb of harnessVerbs) {
      expect(verb.gerund.length).toBeGreaterThan(0);
      expect(verb.past.length).toBeGreaterThan(0);
    }

    const gerunds = harnessVerbs.map((verb) => verb.gerund);
    expect(new Set(gerunds).size).toBe(gerunds.length);
  });

  test("keeps Harnessing in the rotation", () => {
    expect(harnessVerbs.some((verb) => verb.gerund === "Harnessing" && verb.past === "harnessed")).toBe(true);
  });

  test("maps the injected random into the list deterministically", () => {
    expect(pickHarnessVerb(() => 0)).toBe(harnessVerbs[0]);
    expect(pickHarnessVerb(() => 0.9999999)).toBe(harnessVerbs[harnessVerbs.length - 1]);
  });

  test("uses Math.random by default without throwing", () => {
    const verb = pickHarnessVerb();
    expect(harnessVerbs).toContain(verb);
  });
});
