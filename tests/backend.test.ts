import { describe, expect, test } from "bun:test";
import {
  backendCommand,
  backendEnvironmentOverrides,
  detectAgentBackend,
  invokeBackend,
  type BackendCommandRunner
} from "../src/engine/backend";

describe("backend engine", () => {
  test("detects the available backend in preference order", () => {
    expect(detectAgentBackend({ which: (bin) => (bin === "codex" ? "/bin/codex" : null) })).toBe("codex");
    expect(detectAgentBackend({ which: (bin) => `/bin/${bin}` })).toBe("claude");
  });

  test("keeps project advice backend commands read-only", () => {
    expect(backendCommand("claude", "sonnet", "advise").cmd).not.toContain("acceptEdits");
    expect(backendCommand("codex", undefined, "advise").cmd).toContain("read-only");
    expect(backendCommand("codex", undefined, "advise").cmd).toContain("--skip-git-repo-check");
  });

  test("codex write commands skip the git/trust gate and end with the positional prompt", () => {
    // Skill authoring runs codex in a fresh temporary workspace that is never a
    // git repo and never trusted; without --skip-git-repo-check codex ≥0.145
    // exits 1 ("Not inside a trusted directory ..."). The prompt must stay the
    // final positional argument so codex does not fall back to reading it from
    // stdin.
    const { cmd, stdin } = backendCommand("codex", undefined, "author this skill", {
      write: true,
      stream: true,
      reasoningEffort: "high"
    });
    expect(cmd).toContain("workspace-write");
    expect(cmd).toContain("--skip-git-repo-check");
    expect(cmd.join(" ")).toContain("model_reasoning_effort=high");
    expect(cmd.at(-1)).toBe("author this skill");
    expect(stdin).toBeUndefined();
  });

  test("preserves Claude's normal login environment unless a config directory is explicit", () => {
    expect(backendEnvironmentOverrides("claude", {}, "/Users/tester")).toEqual({ HOME: "/Users/tester" });
    expect(backendEnvironmentOverrides("claude", { CLAUDE_CONFIG_DIR: "/tmp/claude" }, "/Users/tester"))
      .toEqual({ CLAUDE_CONFIG_DIR: "/tmp/claude" });
  });

  test("invokeBackend rejects truncated JSON before parsing", async () => {
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: '{"ok":true}',
      stderr: "",
      capture: {
        stdout: { byteCount: 100, sha256: "a".repeat(64), truncated: true },
        stderr: { byteCount: 0, sha256: "b".repeat(64), truncated: false }
      }
    });
    await expect(invokeBackend({
      backend: "codex",
      prompt: "test",
      targetDir: process.cwd(),
      runner,
      outputLimits: { stdoutBytes: 10, stderrBytes: 10, diagnosticTailBytes: 10, lineBytes: 10 }
    })).rejects.toThrow("stdout exceeded 10 bytes");
  });

  test("invokeBackend scrubs and bounds errors and excludes unrelated ambient variables", async () => {
    const ambientProviderCanary = "ambient provider canary";
    const providerCanary = "child provider canary with spaces";
    const ambientName = "FARRIER_TEST_AMBIENT_CANARY";
    const previousProvider = process.env.OPENAI_API_KEY;
    const previousAmbient = process.env[ambientName];
    process.env.OPENAI_API_KEY = ambientProviderCanary;
    process.env[ambientName] = "ambient should not pass";
    let childEnvironment: Record<string, string> | undefined;
    let childRedactValues: readonly string[] | undefined;
    const runner: BackendCommandRunner = async (input) => {
      childEnvironment = input.env;
      childRedactValues = input.redactValues;
      return { exitCode: 7, stdout: "", stderr: `before ${providerCanary} ${"x".repeat(100)} tail` };
    };

    try {
      const failure = invokeBackend({
        backend: "codex",
        prompt: "test",
        targetDir: process.cwd(),
        runner,
        env: { OPENAI_API_KEY: providerCanary, CODEX_HOME: "/tmp/codex-test-home" },
        outputLimits: { stdoutBytes: 100, stderrBytes: 100, diagnosticTailBytes: 32, lineBytes: 100 }
      });
      await expect(failure).rejects.toThrow("codex backend exited with code 7");
      await failure.catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(providerCanary);
        expect(Buffer.byteLength(message)).toBeLessThan(160);
      });
      expect(childEnvironment?.OPENAI_API_KEY).toBe(providerCanary);
      expect(childEnvironment?.[ambientName]).toBeUndefined();
      expect(childRedactValues).toContain(providerCanary);
    } finally {
      if (previousProvider === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousProvider;
      if (previousAmbient === undefined) delete process.env[ambientName];
      else process.env[ambientName] = previousAmbient;
    }
  });

  test("reports a bounded stdout diagnostic when a backend fails without stderr", async () => {
    const runner: BackendCommandRunner = async () => ({
      exitCode: 1,
      stdout: "subscription access is disabled",
      stderr: "",
      capture: {
        stdout: { byteCount: 31, sha256: "a".repeat(64), truncated: false },
        stderr: { byteCount: 0, sha256: "b".repeat(64), truncated: false }
      }
    });

    await expect(invokeBackend({
      backend: "claude",
      prompt: "test",
      targetDir: process.cwd(),
      runner
    })).rejects.toThrow("claude backend exited with code 1: stdout: subscription access is disabled [received 31 bytes");
  });

  test("keeps internal advisor calls out of future project session evidence", () => {
    expect(backendCommand("claude", "sonnet", "advise", { ephemeral: true }).cmd).toContain("--no-session-persistence");
    expect(backendCommand("codex", undefined, "advise", { ephemeral: true }).cmd).toContain("--ephemeral");
  });

  test("invokeBackend reads final JSON and exact usage from provider event streams", async () => {
    const usages: Array<{ inputTokens: number; outputTokens: number }> = [];
    const codexRunner: BackendCommandRunner = async (input) => {
      expect(input.cmd).toContain("--json");
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"ok":"codex"}' } }),
          JSON.stringify({ type: "turn.completed", usage: { input_tokens: 123, cached_input_tokens: 80, output_tokens: 9 } }),
        ].join("\n"),
        stderr: "",
      };
    };
    const claudeRunner: BackendCommandRunner = async (input) => {
      expect(input.cmd).toContain("stream-json");
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          type: "result",
          result: '{"ok":"claude"}',
          usage: { input_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 70, output_tokens: 8 },
        }),
        stderr: "",
      };
    };

    expect(await invokeBackend({
      backend: "codex", prompt: "test", targetDir: process.cwd(), runner: codexRunner,
      captureUsage: true, onUsage: (usage) => usages.push(usage),
    })).toEqual({ ok: "codex" });
    expect(await invokeBackend({
      backend: "claude", prompt: "test", targetDir: process.cwd(), runner: claudeRunner,
      captureUsage: true, onUsage: (usage) => usages.push(usage),
    })).toEqual({ ok: "claude" });
    expect(usages).toEqual([
      { inputTokens: 123, outputTokens: 9 },
      { inputTokens: 95, outputTokens: 8 },
    ]);
  });
});
