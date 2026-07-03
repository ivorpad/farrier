import { describe, expect, test } from "bun:test";
import { backendCommand, defaultBackendRunner, formatBackendStreamActivity } from "../src/engine/backend";

function claudeAssistantLine(block: Record<string, unknown>): string {
  return JSON.stringify({ type: "assistant", message: { content: [block] } });
}

describe("backend streaming", () => {
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
