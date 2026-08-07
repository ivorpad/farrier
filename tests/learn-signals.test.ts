import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { failureSignalKey, mineFailureSignals, type FailureSignal } from "../src/engine/learn-signals";
import { citeEvidence, routeFailureSignals } from "../src/engine/failure-router";
import { createLearnReport, formatLearnReport } from "../src/engine/learn";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { resolvePack } from "../src/packs/index";

async function tempDir(prefix = "farrier-signals-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeTranscript(dir: string, name: string, records: Array<unknown | string>): Promise<void> {
  await mkdir(dir, { recursive: true });
  const lines = records.map((record) => (typeof record === "string" ? record : JSON.stringify(record)));
  await writeFile(join(dir, name), `${lines.join("\n")}\n`, "utf8");
}

function bashUse(id: string, command: string, timestamp?: string): unknown {
  return {
    ...(timestamp ? { timestamp } : {}),
    message: {
      content: [{ type: "tool_use", id, name: "Bash", input: { command } }]
    }
  };
}

function toolResult(id: string, content: string, timestamp?: string): unknown {
  return {
    ...(timestamp ? { timestamp } : {}),
    message: {
      content: [{ type: "tool_result", tool_use_id: id, is_error: true, content }]
    }
  };
}

function signal(overrides: Partial<FailureSignal>): FailureSignal {
  return {
    class: "repeated-failure",
    key: "npm deploy",
    count: 2,
    sessionCount: 2,
    dates: ["2026-07-20", "2026-07-21"],
    sessionRefs: ["session-a", "session-b"],
    samples: ["npm deploy"],
    ...overrides
  };
}

describe("failure-signal mining", () => {
  test("one history rewrite is direct oversized-commit evidence with dates and session refs", async () => {
    const transcripts = await tempDir();
    await writeTranscript(transcripts, "rewrite-session.jsonl", [
      bashUse("r1", "git filter-repo --strip-blobs-bigger-than 50M", "2026-07-20T10:00:00.000Z")
    ]);

    const scan = await mineFailureSignals(transcripts);
    const oversized = scan.signals.find((item) => item.class === "oversized-commit");

    expect(oversized).toBeDefined();
    expect(oversized!.key).toBe("history-rewrite");
    expect(oversized!.count).toBe(1);
    expect(oversized!.dates).toEqual(["2026-07-20"]);
    expect(oversized!.sessionRefs).toEqual(["rewrite-session"]);
    expect(oversized!.samples[0]).toContain("git filter-repo");
  });

  test("tool probes for git-filter-repo are not counted as rewrites", async () => {
    const transcripts = await tempDir();
    await writeTranscript(transcripts, "probe.jsonl", [
      bashUse("p1", "command -v git-filter-repo || pip3 show git-filter-repo"),
      bashUse("p2", "which bfg")
    ]);

    const scan = await mineFailureSignals(transcripts);
    expect(scan.signals.find((item) => item.class === "oversized-commit")).toBeUndefined();
  });

  test("exploration and verification failures never become repeated-failure signals", async () => {
    const transcripts = await tempDir();
    for (const name of ["noise-a.jsonl", "noise-b.jsonl"]) {
      await writeTranscript(transcripts, name, [
        bashUse("g1", "grep -n pattern src/main.ts"),
        toolResult("g1", "exit code 1: no matches found"),
        bashUse("t1", "pnpm vitest run tests/unit"),
        toolResult("t1", "2 tests failed"),
        bashUse("c1", "pnpm typecheck 2>&1 | tail -5"),
        toolResult("c1", "error TS2345: argument type mismatch")
      ]);
    }

    const scan = await mineFailureSignals(transcripts);
    expect(scan.signals.filter((item) => item.class === "repeated-failure")).toEqual([]);
  });

  test("size-rejection push output also counts as oversized-commit evidence", async () => {
    const transcripts = await tempDir();
    await writeTranscript(transcripts, "push-session.jsonl", [
      bashUse("p1", "git push origin main"),
      toolResult("p1", "remote: error: File assets/framework.dylib is 141.00 MB; this exceeds GitHub's file size limit of 100.00 MB")
    ]);

    const scan = await mineFailureSignals(transcripts);
    const oversized = scan.signals.find((item) => item.class === "oversized-commit");

    expect(oversized?.key).toBe("size-rejection");
  });

  test("process kills only signal once the same target repeats", async () => {
    const transcripts = await tempDir();
    await writeTranscript(transcripts, "kill-a.jsonl", [
      bashUse("k1", "pkill -f Electron", "2026-07-19T08:00:00.000Z"),
      bashUse("k2", "kill -9 12345")
    ]);
    await writeTranscript(transcripts, "kill-b.jsonl", [
      bashUse("k3", "pkill -f Electron", "2026-07-21T09:00:00.000Z"),
      bashUse("k4", "killall node")
    ]);

    const scan = await mineFailureSignals(transcripts);
    const leftovers = scan.signals.filter((item) => item.class === "leftover-process");

    expect(leftovers).toHaveLength(1);
    expect(leftovers[0]!.key).toBe("Electron");
    expect(leftovers[0]!.count).toBe(2);
    expect(leftovers[0]!.sessionCount).toBe(2);
    expect(leftovers[0]!.dates).toEqual(["2026-07-19", "2026-07-21"]);
  });

  test("lsof-and-kill by port is mined as a port target", async () => {
    const transcripts = await tempDir();
    await writeTranscript(transcripts, "port.jsonl", [
      bashUse("l1", "lsof -tiTCP:5003 -sTCP:LISTEN | xargs kill"),
      bashUse("l2", "lsof -ti:5003 | xargs kill -9")
    ]);

    const scan = await mineFailureSignals(transcripts);
    const port = scan.signals.find((item) => item.class === "leftover-process");

    expect(port?.key).toBe("port:5003");
    expect(port?.count).toBe(2);
  });

  test("rejected pushes signal after repeating and exclude size rejections", async () => {
    const transcripts = await tempDir();
    await writeTranscript(transcripts, "push-a.jsonl", [
      bashUse("p1", "git push"),
      toolResult("p1", "! [rejected] main -> main (fetch first)\nerror: failed to push some refs")
    ]);
    await writeTranscript(transcripts, "push-b.jsonl", [
      bashUse("p2", "git push origin main"),
      toolResult("p2", "! [remote rejected] main -> main (pre-receive hook declined)")
    ]);

    const scan = await mineFailureSignals(transcripts);
    const rejected = scan.signals.find((item) => item.class === "rejected-push");

    expect(rejected?.count).toBe(2);
    expect(rejected?.sessionCount).toBe(2);
  });

  test("repeated failures require two distinct sessions, not two occurrences in one", async () => {
    const transcripts = await tempDir();
    await writeTranscript(transcripts, "one.jsonl", [
      bashUse("f1", "npm deploy"),
      toolResult("f1", "npm ERR! missing script: deploy — command failed"),
      bashUse("f2", "npm deploy"),
      toolResult("f2", "npm ERR! missing script: deploy — command failed")
    ]);

    const single = await mineFailureSignals(transcripts);
    expect(single.signals.find((item) => item.class === "repeated-failure")).toBeUndefined();

    await writeTranscript(transcripts, "two.jsonl", [
      bashUse("f3", "npm deploy"),
      toolResult("f3", "npm ERR! missing script: deploy — command failed")
    ]);

    const cross = await mineFailureSignals(transcripts);
    const repeated = cross.signals.find((item) => item.class === "repeated-failure");
    expect(repeated?.key).toBe("npm deploy");
    expect(repeated?.sessionCount).toBe(2);
  });

  test("the same operation with different arguments aggregates into one signal", async () => {
    const transcripts = await tempDir();
    await writeTranscript(transcripts, "sim-a.jsonl", [
      bashUse("s1", "xcrun simctl shutdown E6CAE5F0-701A-46A6-9AC0-2F664915DECC"),
      toolResult("s1", "An error was encountered processing the command: Invalid device state")
    ]);
    await writeTranscript(transcripts, "sim-b.jsonl", [
      bashUse("s2", "cd /Users/dev/app && xcrun simctl shutdown 0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0"),
      toolResult("s2", "An error was encountered processing the command: Invalid device state")
    ]);

    const scan = await mineFailureSignals(transcripts);
    const repeated = scan.signals.filter((item) => item.class === "repeated-failure");

    expect(repeated).toHaveLength(1);
    expect(repeated[0]!.key).toBe("xcrun simctl shutdown");
    expect(repeated[0]!.sessionCount).toBe(2);
  });

  test("quoted rejection wording is not an incident unless a git command produced it", async () => {
    const transcripts = await tempDir();
    const rejection =
      "remote: error: File assets/framework.dylib is 141.00 MB; this exceeds GitHub's file size limit of 100.00 MB";
    await writeTranscript(transcripts, "read-session.jsonl", [
      bashUse("r1", "bun run src/cli.ts learn --dir ."),
      toolResult("r1", `error: the mining regex matches "${rejection}"`)
    ]);

    const scan = await mineFailureSignals(transcripts);
    expect(scan.signals.find((item) => item.class === "oversized-commit")).toBeUndefined();
  });

  test("missing transcript directory returns a note and no signals", async () => {
    const scan = await mineFailureSignals(join(await tempDir(), "missing"));
    expect(scan.signals).toEqual([]);
    expect(scan.notes[0]).toContain("not found or unreadable");
  });
});

describe("failureSignalKey", () => {
  test("keys on the leading verbs, not the arguments that vary per run", () => {
    expect(failureSignalKey("xcrun simctl shutdown E6CAE5F0-701A-46A6-9AC0-2F664915DECC")).toBe("xcrun simctl shutdown");
    expect(failureSignalKey("sqlite3 -header -column /Users/dev/Library/app.sqlite 'select 1'")).toBe("sqlite3");
    expect(failureSignalKey("bun run src/cli.ts doctor --dir . --json")).toBe("bun run");
  });

  test("chains and length no longer disqualify a command; the shell prelude is skipped", () => {
    expect(failureSignalKey(`cd /Users/dev/${"nested/".repeat(20)}app && pnpm package`)).toBe("pnpm package");
    expect(failureSignalKey("set -euo pipefail; asc pricing availability view --app 6793902238")).toBe(
      "asc pricing availability"
    );
  });

  test("wrappers do not hide the command that failed", () => {
    expect(failureSignalKey("bash -lc 'rg -n needle src'")).toBeUndefined();
    expect(failureSignalKey("rtk proxy sh -c 'sed -n 1,40p src/main.ts'")).toBeUndefined();
    expect(failureSignalKey("rtk proxy grep -rn thing src")).toBeUndefined();
    expect(failureSignalKey("timeout 200 bun run migrate")).toBe("bun run migrate");
  });

  test("shell one-liners and loops do not invent commands out of their bodies", () => {
    expect(failureSignalKey(`bun -e 'import { run } from "./x"; await run()'`)).toBeUndefined();
    expect(failureSignalKey("for f in *.ts; do echo $f; done")).toBeUndefined();
    expect(failureSignalKey("bash scripts/one-off.sh")).toBeUndefined();
  });

  test("a verification or exploration segment anywhere still drops the whole command", () => {
    expect(failureSignalKey("set -o pipefail; xcodebuild -scheme App -destination 'x' test")).toBeUndefined();
    expect(failureSignalKey("pnpm build | tee build.log")).toBeUndefined();
    expect(failureSignalKey("cd app && rg -n 'needle' src")).toBeUndefined();
    expect(failureSignalKey("make")).toBeUndefined();
  });
});

describe("failure→primitive router", () => {
  test("oversized-commit routes to a large-file-commit-guard instance with cited evidence", () => {
    const oversized = signal({
      class: "oversized-commit",
      key: "history-rewrite",
      count: 3,
      sessionCount: 3,
      sessionRefs: ["a", "b", "c"]
    });

    const proposals = routeFailureSignals({ signals: [oversized], installedHookIds: [] });
    const guard = proposals.find((proposal) => proposal.kind === "guard-instance");

    expect(guard).toBeDefined();
    if (guard?.kind !== "guard-instance") throw new Error("expected guard-instance");
    expect(guard.hookId).toBe("large-file-commit-guard");
    const patch = guard.guardsPatch.largeFileCommit as Record<string, unknown>;
    expect(patch.maxBytes).toBe(5 * 1024 * 1024);
    expect(String(patch.message)).toContain("3× across 3 session(s)");
    expect(guard.message).toContain("2026-07-20 to 2026-07-21");
  });

  test("an installed large-file guard suppresses the proposal", () => {
    const proposals = routeFailureSignals({
      signals: [signal({ class: "oversized-commit", key: "history-rewrite", count: 1 })],
      installedHookIds: ["large-file-commit-guard"]
    });

    expect(proposals.filter((proposal) => proposal.kind === "guard-instance")).toEqual([]);
  });

  test("leftover processes route to teardown patterns; port targets stay evidence-only", () => {
    const proposals = routeFailureSignals({
      signals: [
        signal({ class: "leftover-process", key: "Electron", count: 4 }),
        signal({ class: "leftover-process", key: "port:5003", count: 2 })
      ],
      installedHookIds: []
    });

    const guard = proposals.find((proposal) => proposal.kind === "guard-instance");
    if (guard?.kind !== "guard-instance") throw new Error("expected guard-instance");
    expect(guard.hookId).toBe("process-teardown-audit");
    const patch = guard.guardsPatch.processTeardown as { patterns: string[] };
    expect(patch.patterns).toEqual(["Electron"]);
  });

  test("with the audit installed, only uncovered targets are proposed as a patch", () => {
    const covered = routeFailureSignals({
      signals: [signal({ class: "leftover-process", key: "Electron", count: 3 })],
      installedHookIds: ["process-teardown-audit"],
      guards: { processTeardown: { patterns: ["Elec.*"] } }
    });
    expect(covered).toEqual([]);

    const uncovered = routeFailureSignals({
      signals: [
        signal({ class: "leftover-process", key: "Electron", count: 3 }),
        signal({ class: "leftover-process", key: "playwright", count: 2 })
      ],
      installedHookIds: ["process-teardown-audit"],
      guards: { processTeardown: { patterns: ["Elec.*"] } }
    });
    const guard = uncovered.find((proposal) => proposal.kind === "guard-instance");
    if (guard?.kind !== "guard-instance") throw new Error("expected guard-instance");
    expect((guard.guardsPatch.processTeardown as { patterns: string[] }).patterns).toEqual(["playwright"]);
  });

  test("rejected pushes route to one declarative rules line", () => {
    const proposals = routeFailureSignals({
      signals: [signal({ class: "rejected-push", key: "rejected-push", count: 2 })],
      installedHookIds: []
    });

    const line = proposals.find((proposal) => proposal.kind === "rules-line");
    if (line?.kind !== "rules-line") throw new Error("expected rules-line");
    expect(line.line).toContain("git push");
    expect(line.message).toContain("2× across 2 session(s)");
  });

  test("repeated failures route to a rules line, or a skill suggestion when stubborn", () => {
    const mild = routeFailureSignals({
      signals: [signal({ class: "repeated-failure", key: "npm deploy", count: 2, sessionCount: 2 })],
      installedHookIds: []
    });
    expect(mild[0]?.kind).toBe("rules-line");

    const stubborn = routeFailureSignals({
      signals: [
        signal({
          class: "repeated-failure",
          key: "npm deploy",
          count: 5,
          sessionCount: 3,
          sessionRefs: ["a", "b", "c"]
        })
      ],
      installedHookIds: []
    });
    expect(stubborn[0]?.kind).toBe("skill-suggestion");
    if (stubborn[0]?.kind !== "skill-suggestion") throw new Error("expected skill-suggestion");
    expect(stubborn[0].query).toBe("npm deploy");
  });

  test("evidence citation spans dates and dedupes session refs", () => {
    const citation = citeEvidence([
      signal({ count: 2, sessionRefs: ["a", "b"], dates: ["2026-07-19"] }),
      signal({ count: 1, sessionRefs: ["b"], dates: ["2026-07-21"] })
    ]);
    expect(citation).toBe("Seen 3× across 2 session(s) (2026-07-19 to 2026-07-21)");
  });
});

describe("learn report integration", () => {
  test("mining and proposing work without a .farrier.json; applying rules does not", async () => {
    const project = await tempDir("farrier-signals-bare-");
    const transcripts = await tempDir("farrier-signals-bare-transcripts-");
    await writeTranscript(transcripts, "rewrite.jsonl", [
      bashUse("r1", "git filter-repo --strip-blobs-bigger-than 50M", "2026-07-20T10:00:00.000Z")
    ]);

    const report = await createLearnReport({
      targetDir: project,
      transcriptsDir: transcripts,
      // Keep the test hermetic: the default scans the machine's real
      // ~/.codex/sessions, whose size alone can exceed the test timeout.
      codexSessionsDir: join(transcripts, "no-codex-sessions"),
      noLlm: true
    });

    expect(report.learnEnabled).toBe(false);
    expect(report.signals.map((item) => item.class)).toEqual(["oversized-commit"]);
    expect(report.primitiveProposals.map((proposal) => proposal.id)).toEqual(["guard-large-file-commit"]);
    expect(report.notes.some((note) => note.includes("run farrier create first"))).toBe(true);

    const { applyLearn } = await import("../src/engine/learn");
    await expect(
      applyLearn({ targetDir: project, transcriptsDir: transcripts, noLlm: true, yes: true })
    ).rejects.toThrow("not a farrier project; run farrier create first");
  });

  test("createLearnReport carries mined signals and routed proposals into the formatted report", async () => {
    const project = await tempDir("farrier-signals-project-");
    const pack = resolvePack("python-fastapi");
    await writeRenderPlan(await createRenderPlan({ targetDir: project, pack }));

    const transcripts = await tempDir("farrier-signals-transcripts-");
    await writeTranscript(transcripts, "rewrite.jsonl", [
      bashUse("r1", "git filter-repo --strip-blobs-bigger-than 50M", "2026-07-20T10:00:00.000Z")
    ]);
    await writeTranscript(transcripts, "kill-a.jsonl", [bashUse("k1", "pkill -f Electron")]);
    await writeTranscript(transcripts, "kill-b.jsonl", [bashUse("k2", "pkill -f Electron")]);

    const report = await createLearnReport({
      targetDir: project,
      transcriptsDir: transcripts,
      codexSessionsDir: join(transcripts, "no-codex-sessions"),
      noLlm: true
    });

    expect(report.signals.map((item) => item.class).sort()).toEqual(["leftover-process", "oversized-commit"]);
    const kinds = report.primitiveProposals.map((proposal) => proposal.id).sort();
    expect(kinds).toEqual(["guard-large-file-commit", "guard-process-teardown"]);

    const formatted = formatLearnReport(report);
    expect(formatted).toContain("Failure signals (deterministic, with evidence):");
    expect(formatted).toContain("[oversized-commit] history-rewrite: 1x across 1 session(s) (2026-07-20)");
    expect(formatted).toContain("[guard-instance] guard-large-file-commit");
    expect(formatted).toContain("nothing is applied automatically");
  });
});
