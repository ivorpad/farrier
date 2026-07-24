import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { improveSessionSelection, listImproveSessions, type ImproveSessionList } from "../src/engine/improve-sessions";
import type { SessionIndexEntry } from "../src/engine/advice-session-consent";

async function tempDir(prefix = "farrier-improve-sessions-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function entry(opaqueId: string, provider: "claude" | "codex", updatedAt: string): SessionIndexEntry {
  return { opaqueId, provider, updatedAt, projectMatch: "directory", sourceFingerprint: `fp-${opaqueId}` };
}

describe("listImproveSessions", () => {
  test("lists Claude transcripts with a local stem map; a failing Codex factory becomes a note", async () => {
    const project = await tempDir();
    const transcripts = await tempDir();
    await writeFile(
      join(transcripts, "aaaa-session.jsonl"),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "hola" } })}\n`,
      "utf8"
    );

    const list = await listImproveSessions({
      targetDir: project,
      claudeTranscriptsDir: transcripts,
      codexClientFactory: async () => {
        throw new Error("no codex in tests");
      }
    });

    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]!.provider).toBe("claude");
    expect(list.sources.get(list.entries[0]!.opaqueId)).toEqual({ provider: "claude", stem: "aaaa-session" });
    expect(list.notes.join("\n")).toContain("Codex session metadata unavailable");
  });
});

describe("improveSessionSelection", () => {
  test("maps chosen entries to per-backend file identities; both sets always present", () => {
    const claude = entry("c1", "claude", "2026-07-24T10:00:00.000Z");
    const codex = entry("x1", "codex", "2026-07-24T09:00:00.000Z");
    const list: ImproveSessionList = {
      entries: [claude, codex],
      sources: new Map([
        ["c1", { provider: "claude", stem: "aaaa-session" }],
        ["x1", { provider: "codex", threadId: "019f-thread" }]
      ]),
      notes: []
    };

    expect(improveSessionSelection([claude, codex], list)).toEqual({
      claudeStems: new Set(["aaaa-session"]),
      codexThreadIds: new Set(["019f-thread"])
    });
    // A claude-only pick yields an EMPTY codex set (scan none), never "all".
    expect(improveSessionSelection([claude], list)).toEqual({
      claudeStems: new Set(["aaaa-session"]),
      codexThreadIds: new Set()
    });
  });
});
