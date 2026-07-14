import { expect, test } from "bun:test";
import {
  resolveAvailableAuthor,
  resolveSingleAuthorSelectors
} from "../src/engine/agent-selection";

test("canonical and legacy author selectors agree or fail before provider probing", () => {
  expect(resolveSingleAuthorSelectors({ author: "codex", backend: "codex", targets: ["codex"] })).toEqual({
    author: "codex",
    warnings: [
      "--backend is deprecated; use --author.",
      "--targets is deprecated for advice; use --author."
    ]
  });
  expect(() => resolveSingleAuthorSelectors({ author: "claude", backend: "codex" })).toThrow("--author claude conflicts with --backend codex");
  expect(() => resolveSingleAuthorSelectors({ targets: ["claude", "codex"] })).toThrow("exactly one provider");
});

test("an omitted author is inferred only for exactly one available provider", () => {
  expect(resolveAvailableAuthor(undefined, { claude: true, codex: false }, "farrier advise")).toBe("claude");
  expect(resolveAvailableAuthor(undefined, { claude: false, codex: true }, "farrier advise")).toBe("codex");
  expect(() => resolveAvailableAuthor(undefined, { claude: true, codex: true }, "farrier advise")).toThrow("requires --author");
  expect(() => resolveAvailableAuthor(undefined, { claude: false, codex: false }, "farrier advise")).toThrow("no provider CLI found");
});
