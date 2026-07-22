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
//   {"timestamp":"2026-03-20T09:13:07.444Z","type":"session_meta","payload":{"id":"019d0a83-...","cwd":"/Users/ivor/src/tries/2026-03-19-hud","originator":"codex_cli_rs","cli_version":"0.116.0","source":"cli",...}}
//   {"timestamp":"...","type":"turn_context","payload":{"turn_id":"019d0a85-...","cwd":"/Users/ivor/src/tries/2026-03-19-hud","approval_policy":"never",...}}
//   {"timestamp":"...","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"pwd && rg --files .\",\"workdir\":\"/Users/ivor/src/tries/2026-03-19-hud\",\"yield_time_ms\":1000}","call_id":"call_c3xP62E6UPGXzMuGIu5JRbW6"}}
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
