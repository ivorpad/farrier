import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareDistillEvidence, steerFromUserMessage } from "../src/engine/distill-evidence";
import { SignalCollector, workLoopClusterKey } from "../src/engine/learn-signals";
import { scanCodexSessions } from "../src/engine/learn-signals-codex";

async function tempDir(prefix = "farrier-distill-evidence-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function sessionMeta(cwd: string, timestamp = "2026-07-22T08:00:00.000Z"): unknown {
  return {
    timestamp,
    type: "session_meta",
    payload: { id: "019f0000-0000-0000-0000-000000000000", timestamp, cwd, originator: "Codex Desktop", cli_version: "0.145.0-alpha.30", source: "vscode" }
  };
}

// Real event_msg shape observed in Codex Desktop 0.145 rollouts (2026-07-23):
//   {"timestamp":"...","type":"event_msg","payload":{"type":"user_message","message":"...","kind":null}}
function userMessage(message: string, timestamp = "2026-07-22T08:01:00.000Z"): unknown {
  return { timestamp, type: "event_msg", payload: { type: "user_message", message, kind: null } };
}

function execCall(callId: string, cmd: string, workdir: string, timestamp = "2026-07-22T08:02:00.000Z"): unknown {
  return {
    timestamp,
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({ cmd, workdir }),
      call_id: callId
    }
  };
}

function execOutput(callId: string, cmd: string, exitCode: number, body: string, timestamp = "2026-07-22T08:02:05.000Z"): unknown {
  return {
    timestamp,
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: callId,
      output: `Command: /bin/zsh -lc ${JSON.stringify(cmd)}\nProcess exited with code ${exitCode}\nOutput:\n${body}\n`
    }
  };
}

async function writeRollout(sessionsDir: string, stem: string, records: unknown[]): Promise<void> {
  const day = join(sessionsDir, "2026", "07", "22");
  await mkdir(day, { recursive: true });
  await writeFile(join(day, `${stem}.jsonl`), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

describe("steerFromUserMessage noise filters", () => {
  test("keeps a genuine steer and bounds it", () => {
    const steer = steerFromUserMessage("when i invoke the skill is coz im ready. no questpns asked");
    expect(steer?.text).toContain("no questpns asked");
    expect(steer?.truncated).toBe(false);
  });

  test("drops stop/approval-judge history dumps", () => {
    expect(steerFromUserMessage("The following is the Codex agent history added since your last approval assessment ...")).toBeUndefined();
    expect(steerFromUserMessage("The following is the Codex agent history whose request action you are assessing ...")).toBeUndefined();
  });

  test("drops attachment manifests and AGENTS.md dumps", () => {
    expect(steerFromUserMessage("# Files mentioned by the user:\n\n## Foto 1.jpg: /tmp/codex-remote-attachments/x")).toBeUndefined();
    expect(steerFromUserMessage("# AGENTS.md instructions for /repo\n- rule one\n- rule two")).toBeUndefined();
  });

  test("drops farrier's own advisor sessions", () => {
    expect(steerFromUserMessage("You are farrier's read-only project advisor. Analyze ...")).toBeUndefined();
  });

  test("drops messages that are pure ambient context, keeps mixed ones stripped", () => {
    expect(steerFromUserMessage('<in-app-browser-context source="ambient-ui-state">stuff</in-app-browser-context>')).toBeUndefined();
    expect(steerFromUserMessage("<environment_context>cwd: /x</environment_context>")).toBeUndefined();
    const mixed = steerFromUserMessage("<environment_context>cwd: /x</environment_context>fix the login screen");
    expect(mixed?.text).toBe("fix the login screen");
  });
});

describe("workLoopClusterKey", () => {
  test("clusters build variants under the head and subcommand", () => {
    expect(workLoopClusterKey("xcodebuild -scheme WalkLedger -destination 'x' build")).toBe("xcodebuild -scheme");
    expect(workLoopClusterKey("/usr/bin/xcodebuild -scheme Other test")).toBe("xcodebuild -scheme");
    expect(workLoopClusterKey("grep")).toBe("grep");
  });
});

describe("prepareDistillEvidence", () => {
  test("collects steers and unvetoed failure clusters from project sessions only", async () => {
    const project = await tempDir("farrier-distill-project-");
    const other = await tempDir("farrier-distill-other-");
    const sessions = await tempDir("farrier-distill-sessions-");

    await writeRollout(sessions, "rollout-2026-07-22T08-00-00-aaaa", [
      sessionMeta(project),
      userMessage("the UI is stupidly shitty as you haven't used any of the skills"),
      userMessage("The following is the Codex agent history added since your last approval assessment ..."),
      execCall("call_1", "xcodebuild -scheme App build", project),
      execOutput("call_1", "xcodebuild -scheme App build", 65, "error: something failed to compile"),
      execCall("call_2", "xcodebuild -scheme App test", project),
      execOutput("call_2", "xcodebuild -scheme App test", 65, "error: still broken")
    ]);
    // Another project's session mentions this project path in a command; its
    // steers and failures must not leak into the evidence.
    await writeRollout(sessions, "rollout-2026-07-22T09-00-00-bbbb", [
      sessionMeta(other),
      userMessage("unrelated steer from another repo"),
      execCall("call_3", `ls ${project}`, other),
      execOutput("call_3", `ls ${project}`, 1, `ls: ${project}: No such file or directory`)
    ]);

    const evidence = await prepareDistillEvidence({
      projectDir: project,
      codexSessionsDir: sessions,
      claudeTranscriptsDir: join(project, "no-claude-transcripts")
    });

    expect(evidence.steers).toHaveLength(1);
    expect(evidence.steers[0]!.text).toContain("stupidly shitty");
    expect(evidence.steers[0]!.sessionRef).toBe("codex:rollout-2026-07-22T08-00-00-aaaa");
    expect(evidence.steers[0]!.date).toBe("2026-07-22");

    // xcodebuild is a verification-style command learn's proposals exclude;
    // the distill record keeps it, clustered, in a single session (below
    // learn's two-session threshold).
    const cluster = evidence.failureClusters.find((signal) => signal.class === "work-loop-failure");
    expect(cluster?.key).toBe("xcodebuild -scheme");
    expect(cluster?.count).toBe(2);
    expect(cluster?.samples[0]).toContain("xcodebuild -scheme App build");
    expect(cluster?.samples[0]).toContain("error: something failed to compile");
  });

  test("learn's default collector still excludes work-loop failures and applies thresholds", async () => {
    const project = await tempDir("farrier-distill-project-");
    const sessions = await tempDir("farrier-distill-sessions-");
    await writeRollout(sessions, "rollout-2026-07-22T08-00-00-cccc", [
      sessionMeta(project),
      execCall("call_1", "xcodebuild -scheme App build", project),
      execOutput("call_1", "xcodebuild -scheme App build", 65, "error: compile failure")
    ]);

    const collector = new SignalCollector();
    await scanCodexSessions({ projectDir: project, sessionsDir: sessions, collector });
    expect(collector.signals()).toEqual([]);
  });
});
