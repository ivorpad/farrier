import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backendCommand, defaultBackendRunner, formatBackendStreamActivity } from "../src/engine/backend";

function claudeAssistantLine(block: Record<string, unknown>): string {
  return JSON.stringify({ type: "assistant", message: { content: [block] } });
}

async function readProcessId(path: string): Promise<number> {
  const value = Number.parseInt(await readFile(path, "utf8").catch(() => ""), 10);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

describe("backend streaming", () => {
  test("abort terminates fake Claude and Codex process trees", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farrier-backend-tree-"));
    try {
      for (const backend of ["claude", "codex"]) {
        const executable = join(dir, backend);
        const pidFile = join(dir, `${backend}.pid`);
        await writeFile(executable, "#!/bin/sh\nsleep 30 &\nchild=$!\nprintf '%s' \"$child\" > \"$1\"\nwait \"$child\"\n", "utf8");
        await chmod(executable, 0o755);
        const controller = new AbortController();
        const run = defaultBackendRunner({ cmd: [executable, pidFile], cwd: dir, signal: controller.signal });
        let childPid = 0;
        for (let attempt = 0; attempt < 100 && childPid === 0; attempt += 1) {
          childPid = await readProcessId(pidFile);
          if (childPid === 0) await Bun.sleep(10);
        }
        expect(childPid).toBeGreaterThan(0);
        controller.abort();
        const result = await run;
        expect(result.exitCode).not.toBe(0);
        await Bun.sleep(50);
        expect(() => process.kill(childPid, 0)).toThrow();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("abort force-kills a descendant that ignores SIGTERM after its root exits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farrier-backend-stubborn-tree-"));
    try {
      const executable = join(dir, "stubborn");
      const pidFile = join(dir, "child.pid");
      await writeFile(
        executable,
        "#!/bin/sh\n(\n  trap '' TERM\n  while :; do sleep 1; done\n) &\nchild=$!\nprintf '%s' \"$child\" > \"$1\"\nwait \"$child\"\n",
        "utf8"
      );
      await chmod(executable, 0o755);
      const controller = new AbortController();
      const run = defaultBackendRunner({ cmd: [executable, pidFile], cwd: dir, signal: controller.signal });
      let childPid = 0;
      for (let attempt = 0; attempt < 100 && childPid === 0; attempt += 1) {
        childPid = await readProcessId(pidFile);
        if (childPid === 0) await Bun.sleep(10);
      }
      expect(childPid).toBeGreaterThan(0);
      controller.abort();
      const result = await run;
      expect(result.exitCode).not.toBe(0);
      expect(() => process.kill(childPid, 0)).toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("backendCommand stream option adds stream-json to claude and --json to codex", () => {
    const claude = backendCommand("claude", undefined, "prompt", { write: true, stream: true });
    expect(claude.cmd).toContain("--output-format");
    expect(claude.cmd).toContain("stream-json");
    expect(claude.cmd).toContain("--verbose");

    const codex = backendCommand("codex", undefined, "prompt", { write: true, stream: true });
    expect(codex.cmd).toContain("--json");
    // The catalog stays off so the user's global skills don't eat the run's
    // context; explicit $skill mentions in the prompt still resolve.
    expect(codex.cmd.join(" ")).toContain("-c skills.include_instructions=false");
    expect(backendCommand("codex", undefined, "prompt").cmd.join(" ")).toContain("-c skills.include_instructions=false");

    expect(backendCommand("claude", undefined, "prompt").cmd).not.toContain("stream-json");
    expect(backendCommand("codex", undefined, "prompt").cmd).not.toContain("--json");
  });

  test("backendCommand reasoningEffort adds -c model_reasoning_effort for codex only", () => {
    const codex = backendCommand("codex", undefined, "prompt", { write: true, stream: true, reasoningEffort: "high" });
    expect(codex.cmd.join(" ")).toContain("-c model_reasoning_effort=high");

    // Claude ignores reasoning effort entirely.
    const claude = backendCommand("claude", undefined, "prompt", { reasoningEffort: "high" });
    expect(claude.cmd.join(" ")).not.toContain("model_reasoning_effort");

    // No effort configured -> no flag.
    expect(backendCommand("codex", undefined, "prompt").cmd.join(" ")).not.toContain("model_reasoning_effort");
  });

  test("backendCommand applies a native per-process Claude spend ceiling", () => {
    const claude = backendCommand("claude", "sonnet", "prompt", { maxBudgetUsd: 0.05 });
    const flag = claude.cmd.indexOf("--max-budget-usd");
    expect(flag).toBeGreaterThan(-1);
    expect(claude.cmd[flag + 1]).toBe("0.05");
    expect(() => backendCommand("codex", undefined, "prompt", { maxBudgetUsd: 0.05 }))
      .toThrow("supported only by the Claude backend");
    expect(() => backendCommand("claude", undefined, "prompt", { maxBudgetUsd: 0 }))
      .toThrow("positive finite number");
  });

  test("formatBackendStreamActivity summarizes claude tool_use and text blocks", () => {
    expect(
      formatBackendStreamActivity(
        "claude",
        claudeAssistantLine({ type: "tool_use", name: "Bash", input: { command: "mkdir -p skills\nls" } })
      )
    ).toBe("$ mkdir -p skills");

    expect(
      formatBackendStreamActivity(
        "claude",
        claudeAssistantLine({ type: "tool_use", name: "Write", input: { file_path: "/repo/.farrier-staging/abc/my-skill/SKILL.md" } })
      )
    ).toBe("Write my-skill/SKILL.md");

    expect(
      formatBackendStreamActivity("claude", claudeAssistantLine({ type: "tool_use", name: "Glob", input: { pattern: "**/*.md" } }))
    ).toBe("Glob");

    expect(
      formatBackendStreamActivity("claude", claudeAssistantLine({ type: "text", text: "Now I'll validate the frontmatter.\nMore." }))
    ).toBe("Now I'll validate the frontmatter.");
  });

  test("formatBackendStreamActivity skips claude thinking, results, tool_results, and non-JSON noise", () => {
    expect(formatBackendStreamActivity("claude", claudeAssistantLine({ type: "thinking", thinking: "hmm" }))).toBeUndefined();
    expect(formatBackendStreamActivity("claude", JSON.stringify({ type: "system", subtype: "thinking_tokens" }))).toBeUndefined();
    expect(formatBackendStreamActivity("claude", JSON.stringify({ type: "result", result: "Done!" }))).toBeUndefined();
    expect(formatBackendStreamActivity("claude", JSON.stringify({ type: "user", message: {} }))).toBeUndefined();
    expect(formatBackendStreamActivity("claude", "not json")).toBeUndefined();
  });

  test("formatBackendStreamActivity summarizes codex items and strips the shell wrapper", () => {
    expect(
      formatBackendStreamActivity(
        "codex",
        JSON.stringify({
          type: "item.started",
          item: { type: "command_execution", command: "/bin/zsh -lc 'echo hello'", status: "in_progress" }
        })
      )
    ).toBe("$ echo hello");

    // Completed commands were already shown at item.started.
    expect(
      formatBackendStreamActivity(
        "codex",
        JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "/bin/zsh -lc 'echo hello'" } })
      )
    ).toBeUndefined();

    expect(
      formatBackendStreamActivity(
        "codex",
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Creating the skill now." } })
      )
    ).toBe("Creating the skill now.");

    expect(
      formatBackendStreamActivity(
        "codex",
        JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "**Planning the skill layout**" } })
      )
    ).toBe("**Planning the skill layout**");

    expect(
      formatBackendStreamActivity(
        "codex",
        JSON.stringify({
          type: "item.completed",
          item: { type: "file_change", changes: [{ path: "skills/my-skill/SKILL.md", kind: "add" }] }
        })
      )
    ).toBe("Edit my-skill/SKILL.md");

    expect(
      formatBackendStreamActivity("codex", JSON.stringify({ type: "item.completed", item: { type: "error", message: "boom" } }))
    ).toBe("boom");

    expect(formatBackendStreamActivity("codex", JSON.stringify({ type: "turn.completed", usage: {} }))).toBeUndefined();
    expect(formatBackendStreamActivity("codex", JSON.stringify({ type: "thread.started" }))).toBeUndefined();
  });

  test("defaultBackendRunner reports stdout lines as they arrive and still returns full stdout", async () => {
    const lines: string[] = [];
    const output = await defaultBackendRunner({
      cmd: ["sh", "-c", "printf 'one\\ntwo\\nlast-no-newline'"],
      cwd: process.cwd(),
      onStdoutLine: (line) => lines.push(line)
    });

    expect(output.exitCode).toBe(0);
    expect(lines).toEqual(["one", "two"]);
    expect(output.stdout).toBe("one\ntwo\nlast-no-newline");
  });

  test("defaultBackendRunner caps streams, hashes all bytes, and keeps a diagnostic tail", async () => {
    const stdout = "x".repeat(40);
    const stderr = "0123456789";
    const output = await defaultBackendRunner({
      cmd: [process.execPath, "-e", `process.stdout.write("${stdout}"); process.stderr.write("${stderr}")`],
      cwd: process.cwd(),
      outputLimits: { stdoutBytes: 16, stderrBytes: 8, diagnosticTailBytes: 4, lineBytes: 8 }
    });

    expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(16);
    expect(output.stderr).toBe("23456789");
    expect(output.capture?.stdout).toEqual({
      byteCount: 40,
      sha256: createHash("sha256").update(stdout).digest("hex"),
      truncated: true
    });
    expect(output.capture?.stderr).toEqual({
      byteCount: 10,
      sha256: createHash("sha256").update(stderr).digest("hex"),
      truncated: true
    });
  });

  test("defaultBackendRunner scrubs exact values and summarizes oversized progress lines", async () => {
    const canary = "violet horse battery";
    const lines: string[] = [];
    const output = await defaultBackendRunner({
      cmd: [
        process.execPath,
        "-e",
        `process.stdout.write("${canary}\\n" + "z".repeat(20) + "\\n"); process.stderr.write("${canary}")`
      ],
      cwd: process.cwd(),
      redactValues: [canary],
      outputLimits: { stdoutBytes: 200, stderrBytes: 200, diagnosticTailBytes: 32, lineBytes: 8 },
      onStdoutLine: (line) => lines.push(line)
    });

    expect(output.stdout).not.toContain(canary);
    expect(output.stderr).not.toContain(canary);
    expect(lines.join("\n")).not.toContain(canary);
    expect(lines).toContain("[cut]");
    expect(lines.every((line) => Buffer.byteLength(line, "utf8") <= 8)).toBe(true);
  });

  test("applies final byte caps after exact and pattern redaction", async () => {
    const lines: string[] = [];
    const output = await defaultBackendRunner({
      cmd: [process.execPath, "-e", 'process.stdout.write("x\\n"); process.stderr.write("token=y")'],
      cwd: process.cwd(),
      redactValues: ["x"],
      outputLimits: { stdoutBytes: 8, stderrBytes: 8, diagnosticTailBytes: 8, lineBytes: 8 },
      onStdoutLine: (line) => lines.push(line),
    });

    expect(Buffer.byteLength(output.stdout, "utf8")).toBeLessThanOrEqual(8);
    expect(Buffer.byteLength(output.stderr, "utf8")).toBeLessThanOrEqual(8);
    expect(output.capture?.stdout.truncated).toBe(true);
    expect(output.capture?.stderr.truncated).toBe(true);
    expect(output.stdout).not.toContain("x");
    expect(output.stderr).not.toContain("y");
    expect(lines).toEqual(["[cut]"]);
  });

  test("defaultBackendRunner survives a throwing line callback", async () => {
    const output = await defaultBackendRunner({
      cmd: ["sh", "-c", "printf 'a\\nb\\n'"],
      cwd: process.cwd(),
      onStdoutLine: () => {
        throw new Error("renderer exploded");
      }
    });

    expect(output.exitCode).toBe(0);
    expect(output.stdout).toBe("a\nb\n");
  });
});
