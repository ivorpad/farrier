import { describe, expect, test } from "bun:test";
import { backendCommand, detectAgentBackend } from "../src/engine/backend";

describe("backend engine", () => {
  test("detects the available backend in preference order", () => {
    expect(detectAgentBackend({ which: (bin) => (bin === "codex" ? "/bin/codex" : null) })).toBe("codex");
    expect(detectAgentBackend({ which: (bin) => `/bin/${bin}` })).toBe("claude");
  });

  test("keeps project advice backend commands read-only", () => {
    expect(backendCommand("claude", "sonnet", "advise").cmd).not.toContain("acceptEdits");
    expect(backendCommand("codex", undefined, "advise").cmd).toContain("read-only");
  });

  test("keeps internal advisor calls out of future project session evidence", () => {
    expect(backendCommand("claude", "sonnet", "advise", { ephemeral: true }).cmd).toContain("--no-session-persistence");
    expect(backendCommand("codex", undefined, "advise", { ephemeral: true }).cmd).toContain("--ephemeral");
  });
});
