import { describe, expect, test } from "bun:test";
import {
  classifyAuthProbe,
  detectAgent,
  detectAgents,
  parseAgentVersion
} from "../src/engine/agent-detection";
import type { BackendCommandRunner, BackendCommandRunnerInput } from "../src/engine/backend";

function runnerFor(
  respond: (cmd: string[]) => { exitCode: number; stdout: string; stderr: string },
  calls: string[][] = []
): BackendCommandRunner {
  return async (input: BackendCommandRunnerInput) => {
    calls.push(input.cmd);
    return respond(input.cmd);
  };
}

describe("agent detection probes", () => {
  test("a missing binary is reported as not installed without spawning anything", async () => {
    const calls: string[][] = [];
    const detection = await detectAgent("claude", {
      which: () => null,
      runner: runnerFor(() => ({ exitCode: 0, stdout: "", stderr: "" }), calls)
    });

    expect(detection).toEqual({ installed: false, auth: "unknown" });
    expect(calls).toEqual([]);
  });

  test("claude: version and signed-in state come from --version and auth status", async () => {
    const calls: string[][] = [];
    const runner = runnerFor((cmd) => {
      if (cmd[1] === "--version") return { exitCode: 0, stdout: "2.1.217 (Claude Code)\n", stderr: "" };
      return { exitCode: 0, stdout: '{\n  "loggedIn": true,\n  "authMethod": "claude.ai"\n}\n', stderr: "" };
    }, calls);

    const detection = await detectAgent("claude", { which: () => "/usr/local/bin/claude", runner });

    expect(detection).toEqual({ installed: true, version: "2.1.217", auth: "signed-in" });
    expect(calls).toContainEqual(["claude", "--version"]);
    expect(calls).toContainEqual(["claude", "auth", "status"]);
  });

  test("codex: a 'Not logged in' nonzero exit is reported as not signed in", async () => {
    const calls: string[][] = [];
    const runner = runnerFor((cmd) => {
      if (cmd[1] === "--version") return { exitCode: 0, stdout: "codex-cli 0.145.0-alpha.4\n", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "Not logged in\n" };
    }, calls);

    const detection = await detectAgent("codex", { which: () => "/usr/local/bin/codex", runner });

    expect(detection).toEqual({ installed: true, version: "0.145.0-alpha.4", auth: "not-signed-in" });
    expect(calls).toContainEqual(["codex", "login", "status"]);
  });

  test("an unrecognized auth subcommand degrades to auth unknown, never to not signed in", async () => {
    const runner = runnerFor((cmd) =>
      cmd[1] === "--version"
        ? { exitCode: 0, stdout: "codex-cli 0.90.0", stderr: "" }
        : { exitCode: 2, stdout: "", stderr: "error: unrecognized subcommand 'status'\nUsage: codex [OPTIONS]" }
    );

    const detection = await detectAgent("codex", { which: () => "/usr/local/bin/codex", runner });
    expect(detection.auth).toBe("unknown");
  });

  test("claude reporting loggedIn false beats its exit code", () => {
    expect(classifyAuthProbe({ exitCode: 0, stdout: '{ "loggedIn": false }', stderr: "" })).toBe("not-signed-in");
    expect(classifyAuthProbe({ exitCode: 0, stdout: '{ "loggedIn": true }', stderr: "" })).toBe("signed-in");
    expect(classifyAuthProbe(undefined)).toBe("unknown");
  });

  test("a hanging CLI times out into installed with unknown auth; startup is never blocked", async () => {
    const hangingRunner: BackendCommandRunner = () => new Promise(() => undefined);
    const detection = await detectAgent("claude", {
      which: () => "/usr/local/bin/claude",
      runner: hangingRunner,
      timeoutMs: 20
    });

    expect(detection).toEqual({ installed: true, auth: "unknown" });
  });

  test("detectAgents probes both CLIs and keys the inventory by backend", async () => {
    const runner = runnerFor((cmd) =>
      cmd[1] === "--version"
        ? { exitCode: 0, stdout: `${cmd[0]} 1.2.3`, stderr: "" }
        : { exitCode: 0, stdout: "ok", stderr: "" }
    );
    const inventory = await detectAgents({ which: (bin) => (bin === "claude" ? "/bin/claude" : null), runner });

    expect(inventory.claude).toEqual({ installed: true, version: "1.2.3", auth: "signed-in" });
    expect(inventory.codex).toEqual({ installed: false, auth: "unknown" });
  });

  test("version parsing takes the first version-shaped token", () => {
    expect(parseAgentVersion("2.1.217 (Claude Code)")).toBe("2.1.217");
    expect(parseAgentVersion("codex-cli 0.145.0-alpha.4")).toBe("0.145.0-alpha.4");
    expect(parseAgentVersion("no version here")).toBeUndefined();
  });
});
