import { expect, test } from "bun:test";
import { normalizeSkillCreationRequest, type SkillCreationRequest, type SkillLayout } from "../src/engine/create-skill";

test("legacy skill selectors map exactly to canonical authors and layout", () => {
  const cases: Array<[Omit<SkillCreationRequest, "description">, { authors: Array<"claude" | "codex">; layout: SkillLayout }]> = [
    [{ agents: ["claude"] }, { authors: ["claude"], layout: "native" }],
    [{ agents: ["codex"] }, { authors: ["codex"], layout: "native" }],
    [{ agents: ["claude", "codex"], mode: "per-agent" }, { authors: ["claude", "codex"], layout: "native" }],
    [{ agents: ["claude", "codex"], mode: "author-claude" }, { authors: ["claude"], layout: "shared" }],
    [{ agents: ["claude", "codex"], mode: "author-codex" }, { authors: ["codex"], layout: "shared" }]
  ];

  for (const [legacy, expected] of cases) {
    const normalized = normalizeSkillCreationRequest({ description: "x", ...legacy });
    expect({ authors: normalized.authors, layout: normalized.layout }).toEqual(expected);
  }
});

test("canonical requests preserve order and reject ambiguous combinations", () => {
  expect(normalizeSkillCreationRequest({
    description: "x",
    authors: ["codex", "claude"],
    layout: "native"
  }).authors).toEqual(["codex", "claude"]);

  expect(() => normalizeSkillCreationRequest({ description: "x", authors: ["claude", "claude"], layout: "native" })).toThrow("duplicate");
  expect(() => normalizeSkillCreationRequest({ description: "x", authors: ["claude", "codex"], layout: "shared" })).toThrow("exactly one author");
  expect(() => normalizeSkillCreationRequest({ description: "x", authors: ["claude", "codex"], layout: "native", model: "one-model" })).toThrow("one --model");
  expect(() => normalizeSkillCreationRequest({ description: "x", agents: ["claude", "codex"] })).toThrow("require --mode");
  expect(() => normalizeSkillCreationRequest({ description: "x", agents: ["codex"], mode: "author-claude" })).toThrow("requires claude");
});
