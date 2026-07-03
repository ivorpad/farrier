import { describe, expect, test } from "bun:test";
import { forgeVerbs, pickForgeVerb } from "../src/tui/verbs";

describe("forge verbs", () => {
  test("holds exactly 50 entries", () => {
    expect(forgeVerbs.length).toBe(50);
  });

  test("every gerund and past is non-empty and gerunds are unique", () => {
    for (const verb of forgeVerbs) {
      expect(verb.gerund.length).toBeGreaterThan(0);
      expect(verb.past.length).toBeGreaterThan(0);
    }

    const gerunds = forgeVerbs.map((verb) => verb.gerund);
    expect(new Set(gerunds).size).toBe(gerunds.length);
  });

  test("keeps Forging in the rotation", () => {
    expect(forgeVerbs.some((verb) => verb.gerund === "Forging" && verb.past === "forged")).toBe(true);
  });

  test("maps the injected random into the list deterministically", () => {
    expect(pickForgeVerb(() => 0)).toBe(forgeVerbs[0]);
    expect(pickForgeVerb(() => 0.9999999)).toBe(forgeVerbs[forgeVerbs.length - 1]);
  });

  test("uses Math.random by default without throwing", () => {
    const verb = pickForgeVerb();
    expect(forgeVerbs).toContain(verb);
  });
});
