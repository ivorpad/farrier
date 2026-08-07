import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SignalCollector, mineFailureSignals } from "../src/engine/learn-signals";
import { mineFailureSignalsFromSources, scanCodexSessions } from "../src/engine/learn-signals-codex";

async function tempDir(prefix = "farrier-codex-signals-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

// Real record shapes observed in ~/.codex/sessions (codex_cli_rs 0.115/0.116):
//   {"timestamp":"2026-03-20T09:13:07.444Z","type":"session_meta","payload":{"id":"019d0a83-...","cwd":"<project-dir>","originator":"codex_cli_rs","cli_version":"0.116.0","source":"cli",...}}
//   {"timestamp":"...","type":"turn_context","payload":{"turn_id":"019d0a85-...","cwd":"<project-dir>","approval_policy":"never",...}}
//   {"timestamp":"...","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"pwd && rg --files .\",\"workdir\":\"<project-dir>\",\"yield_time_ms\":1000}","call_id":"call_c3xP62E6UPGXzMuGIu5JRbW6"}}
//   {"timestamp":"...","type":"response_item","payload":{"type":"function_call_output","call_id":"call_c3xP62E6UPGXzMuGIu5JRbW6","output":"Command: /bin/zsh -lc \"pwd && rg --files .\"\nChunk ID: 2d6ed4\nWall time: 0.0000 seconds\nProcess exited with code 0\nOriginal token count: 295\nOutput:\n..."}}
function sessionMeta(cwd: string, timestamp = "2026-07-20T08:00:00.000Z"): unknown {
  return {
    timestamp,
    type: "session_meta",
    payload: { id: "019f0000-0000-0000-0000-000000000000", timestamp, cwd, originator: "codex_cli_rs", cli_version: "0.116.0", source: "cli" }
  };
}

function turnContext(cwd: string, timestamp = "2026-07-20T08:01:00.000Z"): unknown {
  return {
    timestamp,
    type: "turn_context",
    payload: { turn_id: "019f0000-0000-0000-0000-000000000001", cwd, approval_policy: "never" }
  };
}

function execCall(callId: string, cmd: string, workdir: string, timestamp = "2026-07-20T08:02:00.000Z"): unknown {
  return {
    timestamp,
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({ cmd, workdir, yield_time_ms: 1000, max_output_tokens: 12000 }),
      call_id: callId
    }
  };
}

function execOutput(callId: string, cmd: string, exitCode: number, body: string, timestamp = "2026-07-20T08:02:05.000Z"): unknown {
  return {
    timestamp,
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: callId,
      output: `Command: /bin/zsh -lc ${JSON.stringify(cmd)}\nChunk ID: 2d6ed4\nWall time: 0.1210 seconds\nProcess exited with code ${exitCode}\nOriginal token count: 21\nOutput:\n${body}\n`
    }
  };
}

// Codex Desktop 0.145.0-alpha.30 shapes (observed 2026-07-23): shell work is a
// custom_tool_call named "exec" whose input is JS source calling
// tools.exec_command({cmd: ...}); the output is an array of input_text parts
// prefixed "Script completed"/"Script failed", with exit codes only as
// printed "exit_code":N fragments.
function customExecCall(callId: string, cmds: string[], workdir: string, timestamp = "2026-07-20T08:02:00.000Z"): unknown {
  const input = cmds
    .map(
      (cmd, index) =>
        `const r${index} = await tools.exec_command({\n  cmd: ${JSON.stringify(cmd)},\n  workdir: ${JSON.stringify(workdir)},\n  yield_time_ms: 10000\n});\ntext(r${index}.output);`
    )
    .join("\n");
  return {
    timestamp,
    type: "response_item",
    payload: { type: "custom_tool_call", id: "ctc_0", status: "completed", call_id: callId, name: "exec", input }
  };
}

function customExecOutput(callId: string, parts: string[], timestamp = "2026-07-20T08:02:05.000Z"): unknown {
  return {
    timestamp,
    type: "response_item",
    payload: {
      type: "custom_tool_call_output",
      id: "ctco_0",
      call_id: callId,
      output: parts.map((text) => ({ type: "input_text", text }))
    }
  };
}

async function writeRollout(sessionsDir: string, stem: string, records: unknown[]): Promise<void> {
  const day = join(sessionsDir, "2026", "07", "20");
  await mkdir(day, { recursive: true });
  await writeFile(join(day, `${stem}.jsonl`), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

async function bareCollectorScan(projectDir: string, sessionsDir: string) {
  const collector = new SignalCollector();
  const scan = await scanCodexSessions({ projectDir, sessionsDir, collector });
  return { scan, signals: collector.signals() };
}

describe("codex session mining", () => {
  test("extracts commands and failures from exec_command records with codex-prefixed session refs", async () => {
    const project = await tempDir("farrier-codex-project-");
    const sessions = await tempDir("farrier-codex-sessions-");
    for (const stem of ["rollout-2026-07-20T08-00-00-aaaa", "rollout-2026-07-20T09-00-00-bbbb"]) {
      await writeRollout(sessions, stem, [
        sessionMeta(project),
        execCall("call_1", "npm deploy", project),
        execOutput("call_1", "npm deploy", 1, "npm ERR! missing script: deploy")
      ]);
    }

    const { signals } = await bareCollectorScan(project, sessions);
    const repeated = signals.find((signal) => signal.class === "repeated-failure");

    expect(repeated?.key).toBe("npm deploy");
    expect(repeated?.count).toBe(2);
    expect(repeated?.sessionCount).toBe(2);
    expect(repeated?.dates).toEqual(["2026-07-20"]);
    expect(repeated?.sessionRefs).toEqual([
      "codex:rollout-2026-07-20T08-00-00-aaaa",
      "codex:rollout-2026-07-20T09-00-00-bbbb"
    ]);
  });

  test("a session from a different project never contributes evidence, even when its bytes mention the project path", async () => {
    const project = await tempDir("farrier-codex-project-");
    const other = await tempDir("farrier-codex-other-");
    const sessions = await tempDir("farrier-codex-sessions-");
    // The other-project session prints the target project path in command
    // output, so the byte pre-filter alone would let it through.
    await writeRollout(sessions, "rollout-2026-07-20T08-00-00-cccc", [
      sessionMeta(other),
      execCall("call_1", "pkill -f Electron", other),
      execCall("call_2", `ls ${project}`, other),
      execOutput("call_2", `ls ${project}`, 1, `ls: ${project}: No such file or directory`)
    ]);
    await writeRollout(sessions, "rollout-2026-07-20T09-00-00-dddd", [
      sessionMeta(other),
      execCall("call_3", "pkill -f Electron", other)
    ]);

    const { scan, signals } = await bareCollectorScan(project, sessions);
    expect(signals).toEqual([]);
    // Only the session whose bytes mention the project path was parsed at all.
    expect(scan.filesScanned).toBe(1);
  });

  test("reports truncation and a cap note when the scan cap is hit, and not otherwise", async () => {
    const project = await tempDir("farrier-codex-project-");
    const sessions = await tempDir("farrier-codex-sessions-");
    await writeRollout(sessions, "rollout-2026-07-20T08-00-00-aaaa", [sessionMeta(project), execCall("call_1", "bun test a", project)]);
    await writeRollout(sessions, "rollout-2026-07-20T09-00-00-bbbb", [sessionMeta(project), execCall("call_2", "bun test b", project)]);

    const capped = await scanCodexSessions({ projectDir: project, collector: new SignalCollector(), sessionsDir: sessions, maxFiles: 1 });
    expect(capped.truncated).toBe(true);
    expect(capped.filesScanned).toBe(1);
    expect(capped.notes.some((note) => /Codex scan cap reached at 1 file\(s\)/.test(note))).toBe(true);

    const full = await scanCodexSessions({ projectDir: project, collector: new SignalCollector(), sessionsDir: sessions, maxFiles: 10 });
    expect(full.truncated).toBe(false);
    expect(full.filesMatched).toBe(2);
  });

  test("cwd from turn_context gates evidence and handles realpath variants", async () => {
    const project = await tempDir("farrier-codex-project-");
    const alias = `${project}-alias`;
    await symlink(project, alias);
    const sessions = await tempDir("farrier-codex-sessions-");
    // A thread that starts elsewhere, then a turn switches into the project
    // via a symlinked path variant that realpaths to the project root.
    await writeRollout(sessions, "rollout-2026-07-20T08-00-00-eeee", [
      sessionMeta("/tmp"),
      execCall("call_0", `pkill -f ${project.split("/").pop()}-Electron`, "/tmp"),
      turnContext(alias),
      execCall("call_1", "pkill -f Electron", alias, "2026-07-20T08:03:00.000Z")
    ]);
    await writeRollout(sessions, "rollout-2026-07-20T09-00-00-ffff", [
      sessionMeta(alias),
      execCall("call_2", "pkill -f Electron", alias, "2026-07-21T10:00:00.000Z")
    ]);

    const { signals } = await bareCollectorScan(project, sessions);
    const leftovers = signals.filter((signal) => signal.class === "leftover-process");

    expect(leftovers).toHaveLength(1);
    expect(leftovers[0]!.key).toBe("Electron");
    expect(leftovers[0]!.sessionCount).toBe(2);
    expect(leftovers[0]!.dates).toEqual(["2026-07-20", "2026-07-21"]);
  });

  test("argv-wrapped shell calls unwrap to the command text", async () => {
    const project = await tempDir("farrier-codex-project-");
    const sessions = await tempDir("farrier-codex-sessions-");
    await writeRollout(sessions, "rollout-2026-07-20T08-00-00-gggg", [
      sessionMeta(project),
      // Older codex versions record the shell tool with an argv array.
      {
        timestamp: "2026-07-20T08:02:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "shell",
          arguments: JSON.stringify({ command: ["bash", "-lc", "git filter-repo --strip-blobs-bigger-than 50M"] }),
          call_id: "call_1"
        }
      }
    ]);

    const { signals } = await bareCollectorScan(project, sessions);
    const oversized = signals.find((signal) => signal.class === "oversized-commit");

    expect(oversized?.key).toBe("history-rewrite");
    expect(oversized?.samples[0]).toContain("git filter-repo");
  });

  test("a structured exit code of zero beats error-looking output text", async () => {
    const project = await tempDir("farrier-codex-project-");
    const sessions = await tempDir("farrier-codex-sessions-");
    for (const stem of ["rollout-2026-07-20T08-00-00-hhhh", "rollout-2026-07-20T09-00-00-iiii"]) {
      await writeRollout(sessions, stem, [
        sessionMeta(project),
        execCall("call_1", "cargo publish --dry-run", project),
        // The wrapper text always contains "exited with code", which the text
        // heuristic alone would flag as an error; body mentions errors too.
        execOutput("call_1", "cargo publish --dry-run", 0, "warning: 3 files failed lint; error log written to target/")
      ]);
    }

    const { signals } = await bareCollectorScan(project, sessions);
    expect(signals.filter((signal) => signal.class === "repeated-failure")).toEqual([]);
  });

  test("non-shell tool outputs are never misattributed to the previous shell command", async () => {
    const project = await tempDir("farrier-codex-project-");
    const sessions = await tempDir("farrier-codex-sessions-");
    for (const stem of ["rollout-2026-07-20T08-00-00-jjjj", "rollout-2026-07-20T09-00-00-kkkk"]) {
      await writeRollout(sessions, stem, [
        sessionMeta(project),
        execCall("call_1", "swift build --target Capture", project),
        execOutput("call_1", "swift build --target Capture", 0, "Build complete!"),
        {
          timestamp: "2026-07-20T08:03:00.000Z",
          type: "response_item",
          payload: { type: "function_call_output", call_id: "call_mcp_9", output: "MCP tool failed: connection error" }
        }
      ]);
    }

    const { signals } = await bareCollectorScan(project, sessions);
    expect(signals).toEqual([]);
  });
});

describe("codex desktop 0.145 custom exec mining", () => {
  test("extracts commands and failures from custom_tool_call exec records", async () => {
    const project = await tempDir("farrier-codex-project-");
    const sessions = await tempDir("farrier-codex-sessions-");
    for (const stem of ["rollout-2026-07-20T08-00-00-m145", "rollout-2026-07-20T09-00-00-n145"]) {
      await writeRollout(sessions, stem, [
        sessionMeta(project),
        customExecCall("call_1", ["npm deploy"], project),
        customExecOutput("call_1", ["Script failed\nWall time 0.0 seconds\nOutput:\n", "Script error:\nnpm ERR! missing script: deploy"])
      ]);
    }

    const { scan, signals } = await bareCollectorScan(project, sessions);
    const repeated = signals.find((signal) => signal.class === "repeated-failure");

    expect(repeated?.key).toBe("npm deploy");
    expect(repeated?.sessionCount).toBe(2);
    // Events were extracted, so the format-drift tripwire stays quiet.
    expect(scan.notes).toEqual([]);
  });

  test("Script completed output is not a failure even when the text looks error-ish", async () => {
    const project = await tempDir("farrier-codex-project-");
    const sessions = await tempDir("farrier-codex-sessions-");
    for (const stem of ["rollout-2026-07-20T08-00-00-o145", "rollout-2026-07-20T09-00-00-p145"]) {
      await writeRollout(sessions, stem, [
        sessionMeta(project),
        customExecCall("call_1", ["npm deploy"], project),
        // Echoed file contents mention failures and a zero exit code; the
        // old word heuristics would have flagged this on every success.
        customExecOutput("call_1", [
          "Script completed\nWall time 0.1 seconds\nOutput:\n",
          'PLANS.md says recording_start_failed was fixed; last run {"exit_code":0} and no error remained'
        ])
      ]);
    }

    const { signals } = await bareCollectorScan(project, sessions);
    expect(signals.filter((signal) => signal.class === "repeated-failure")).toEqual([]);
  });

  test("a nonzero printed exit_code fragment marks the command failed", async () => {
    const project = await tempDir("farrier-codex-project-");
    const sessions = await tempDir("farrier-codex-sessions-");
    for (const stem of ["rollout-2026-07-20T08-00-00-q145", "rollout-2026-07-20T09-00-00-r145"]) {
      await writeRollout(sessions, stem, [
        sessionMeta(project),
        customExecCall("call_1", ["npm deploy"], project),
        customExecOutput("call_1", ["Script completed\nWall time 3.2 seconds\nOutput:\n", '{"exit_code":65,"output":"BUILD FAILED"}'])
      ]);
    }

    const { signals } = await bareCollectorScan(project, sessions);
    const repeated = signals.find((signal) => signal.class === "repeated-failure");
    expect(repeated?.key).toBe("npm deploy");
    expect(repeated?.sessionCount).toBe(2);
  });

  test("every exec_command in a multi-command script registers as a use", async () => {
    const project = await tempDir("farrier-codex-project-");
    const sessions = await tempDir("farrier-codex-sessions-");
    for (const stem of ["rollout-2026-07-20T08-00-00-s145", "rollout-2026-07-20T09-00-00-t145"]) {
      await writeRollout(sessions, stem, [
        sessionMeta(project),
        customExecCall("call_1", ["pkill -f Electron", "pkill -f GhostHelper"], project)
      ]);
    }

    const { signals } = await bareCollectorScan(project, sessions);
    const leftovers = signals.filter((signal) => signal.class === "leftover-process").map((signal) => signal.key).sort();
    expect(leftovers).toEqual(["Electron", "GhostHelper"]);
  });

  test("matched sessions yielding zero tool events raise the format-drift note", async () => {
    const project = await tempDir("farrier-codex-project-");
    const sessions = await tempDir("farrier-codex-sessions-");
    await writeRollout(sessions, "rollout-2026-07-20T08-00-00-u145", [
      sessionMeta(project),
      { timestamp: "2026-07-20T08:02:00.000Z", type: "response_item", payload: { type: "some_future_shape", call_id: "call_1" } }
    ]);

    const { scan } = await bareCollectorScan(project, sessions);
    expect(scan.filesMatched).toBe(1);
    expect(scan.notes.some((note) => note.includes("rollout format may have drifted"))).toBe(true);
  });
});

describe("merged Claude + codex mining", () => {
  test("the same failure in one Claude and one codex session counts as two sessions", async () => {
    const project = await tempDir("farrier-codex-project-");
    const transcripts = await tempDir("farrier-codex-transcripts-");
    const sessions = await tempDir("farrier-codex-sessions-");

    await mkdir(transcripts, { recursive: true });
    await writeFile(join(transcripts, "claude-session.jsonl"), `${[
      JSON.stringify({
        timestamp: "2026-07-19T10:00:00.000Z",
        message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm deploy" } }] }
      }),
      JSON.stringify({
        timestamp: "2026-07-19T10:00:05.000Z",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "npm ERR! missing script: deploy" }] }
      })
    ].join("\n")}\n`, "utf8");

    await writeRollout(sessions, "rollout-2026-07-20T08-00-00-llll", [
      sessionMeta(project),
      execCall("call_1", "npm deploy", project),
      execOutput("call_1", "npm deploy", 1, "npm ERR! missing script: deploy")
    ]);

    const scan = await mineFailureSignalsFromSources({
      claudeTranscriptsDir: transcripts,
      codexProjectDir: project,
      codexSessionsDir: sessions
    });
    const repeated = scan.signals.find((signal) => signal.class === "repeated-failure");

    expect(repeated?.key).toBe("npm deploy");
    expect(repeated?.sessionCount).toBe(2);
    expect(repeated?.sessionRefs).toEqual(["claude-session", "codex:rollout-2026-07-20T08-00-00-llll"]);
    expect(scan.notes).toContainEqual(
      "Failure signals were mined from 1 Claude transcript file(s) and 1 codex session file(s) belonging to this project (of 1 scanned)."
    );

    // The Claude-only miner alone would not cross the two-session threshold.
    const claudeOnly = await mineFailureSignals(transcripts);
    expect(claudeOnly.signals.find((signal) => signal.class === "repeated-failure")).toBeUndefined();
  });

  test("a missing codex sessions directory is silent", async () => {
    const project = await tempDir("farrier-codex-project-");
    const transcripts = await tempDir("farrier-codex-transcripts-");
    await writeFile(join(transcripts, "claude-session.jsonl"), `${JSON.stringify({
      timestamp: "2026-07-19T10:00:00.000Z",
      message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "pkill -f Electron" } }] }
    })}\n`, "utf8");

    const scan = await mineFailureSignalsFromSources({
      claudeTranscriptsDir: transcripts,
      codexProjectDir: project,
      codexSessionsDir: join(project, "does-not-exist")
    });

    expect(scan.notes).toEqual(["Failure signals were mined from 1 Claude transcript file(s)."]);
  });
});
