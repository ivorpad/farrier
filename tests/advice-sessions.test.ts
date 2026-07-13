import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { collectProjectSessionEvidence, discoverProjectSessionCounts, redactSessionText } from "../src/engine/advice-sessions";
import type { CodexAppServerClient } from "../src/engine/codex-app-server";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("session evidence", () => {
  test("redacts secrets and personal identifiers before bounding text", () => {
    const redacted = redactSessionText("Bearer abc123 token=super-secret email dev@example.com sk-abcdefghijklmnop");
    expect(redacted).toContain("Bearer [REDACTED_TOKEN]");
    expect(redacted).toContain("token=[REDACTED]");
    expect(redacted).toContain("[REDACTED_EMAIL]");
    expect(redacted).toContain("[REDACTED_KEY]");
    expect(redacted).not.toContain("super-secret");
  });

  test("reads only Claude JSONL sessions explicitly matching the resolved project", async () => {
    const project = resolve(await tempDir("farrier-advice-project-"));
    const other = resolve(await tempDir("farrier-advice-other-"));
    const transcripts = await tempDir("farrier-advice-claude-");
    const matching = [
      { cwd: project, type: "user", message: { content: [{ type: "text", text: "Actually use token=private and email me@example.com" }] } },
      { cwd: project, type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "just check" } }] } },
      { cwd: project, type: "assistant", message: { content: [{ type: "tool_use", name: "WebSearch", input: { query: "current API docs" } }] } }
    ];
    const ignored = [{ cwd: other, type: "user", message: { content: [{ type: "text", text: "Actually expose this" }] } }];
    const internal = [{ cwd: project, type: "user", message: { content: "You are Farrier's read-only project advisor. Return JSON." } }];
    await writeFile(join(transcripts, "matching.jsonl"), `${matching.map((item) => JSON.stringify(item)).join("\n")}\nnot-json\n`, "utf8");
    await writeFile(join(transcripts, "ignored.jsonl"), `${ignored.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
    await writeFile(join(transcripts, "internal.jsonl"), `${internal.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");

    const result = await collectProjectSessionEvidence({ targetDir: project, targets: ["claude"], claudeTranscriptsDir: transcripts });

    expect(result.sources).toEqual([{ source: "claude", count: 1 }]);
    expect(result.signals.map((item) => item.kind).sort()).toEqual(["correction", "external-lookup", "verification"]);
    expect(result.signals.map((item) => item.summary).join(" ")).not.toContain("private");
    expect(result.signals.map((item) => item.summary).join(" ")).not.toContain("me@example.com");
    expect(result.notes).toContain("Skipped 1 malformed Claude session record(s).");
  });

  test("filters Claude sessions by their latest matching record timestamp", async () => {
    const project = resolve(await tempDir("farrier-advice-project-"));
    const transcripts = await tempDir("farrier-advice-claude-dates-");
    const now = Date.UTC(2026, 6, 10);
    const record = (timestamp: string, text: string) => ({
      cwd: project,
      timestamp,
      type: "user",
      message: { content: [{ type: "text", text }] }
    });
    await writeFile(join(transcripts, "recent.jsonl"), `${JSON.stringify(record("2026-07-09T12:00:00.000Z", "Actually use the project check"))}\n`, "utf8");
    await writeFile(join(transcripts, "old.jsonl"), `${JSON.stringify(record("2026-06-20T12:00:00.000Z", "Actually use the old command"))}\n`, "utf8");

    const result = await collectProjectSessionEvidence({
      targetDir: project,
      targets: ["claude"],
      claudeTranscriptsDir: transcripts,
      lookback: "7d",
      now
    });

    expect(result.sources).toEqual([{ source: "claude", count: 1 }]);
    expect(result.signals.map((item) => item.summary).join(" ")).toContain("project check");
    expect(result.signals.map((item) => item.summary).join(" ")).not.toContain("old command");
  });

  test("includes the exact lookback boundary and excludes the millisecond before it", async () => {
    const project = resolve(await tempDir("farrier-advice-boundary-project-"));
    const transcripts = await tempDir("farrier-advice-boundary-claude-");
    const now = Date.UTC(2026, 6, 10);
    const cutoff = now - 7 * 86_400_000;
    const record = (timestamp: number, text: string) => ({
      cwd: project, timestamp: new Date(timestamp).toISOString(), type: "user", message: { content: text }
    });
    await writeFile(join(transcripts, "included.jsonl"), `${JSON.stringify(record(cutoff, "Actually use the boundary check"))}\n`, "utf8");
    await writeFile(join(transcripts, "excluded.jsonl"), `${JSON.stringify(record(cutoff - 1, "Actually use the stale check"))}\n`, "utf8");

    const result = await collectProjectSessionEvidence({
      targetDir: project, targets: ["claude"], claudeTranscriptsDir: transcripts, lookback: "7d", now
    });

    expect(result.sources).toEqual([{ source: "claude", count: 1 }]);
    expect(result.signals.map((signal) => signal.summary).join(" ")).toContain("boundary check");
    expect(result.signals.map((signal) => signal.summary).join(" ")).not.toContain("stale check");
  });

  test("filters Codex thread/list by exact cwd, follows pagination, and uses thread/read only", async () => {
    const targetDir = "/target";
    const now = Date.UTC(2026, 6, 10);
    const recent = Math.floor(now / 1_000);
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const client: CodexAppServerClient = {
      request: async (method, params) => {
        calls.push({ method, params });
        if (method === "thread/list" && params?.cursor === null) {
          return { data: [
            { id: "one", cwd: targetDir, updatedAt: recent },
            { id: "wrong", cwd: "/other", updatedAt: recent },
            { id: "internal", cwd: targetDir, updatedAt: recent, preview: "You are Farrier's read-only project advisor" }
          ], nextCursor: "page-2" };
        }
        if (method === "thread/list") return { data: [{ id: "two", cwd: targetDir, updatedAt: recent }], nextCursor: null };
        const id = params?.threadId;
        return {
          thread: {
            id,
            cwd: targetDir,
            turns: [{ items: id === "one"
              ? [
                  { type: "userMessage", content: [{ type: "text", text: "No, please use the project command" }] },
                  { type: "commandExecution", command: "npm test", status: "failed", exitCode: 1, aggregatedOutput: "token=secret failed" },
                  { type: "reasoning", summary: ["must never be consumed"] }
                ]
              : [{ type: "webSearch", query: "library docs" }] }]
          }
        };
      },
      close: async () => {}
    };

    const result = await collectProjectSessionEvidence({ targetDir, targets: ["codex"], codexClientFactory: async () => client, now });

    expect(result.sources).toEqual([{ source: "codex", count: 2 }]);
    const listCalls = calls.filter((call) => call.method === "thread/list");
    expect(listCalls.map((call) => ({ cwd: call.params?.cwd, cursor: call.params?.cursor, limit: call.params?.limit }))).toEqual([
      { cwd: targetDir, cursor: null, limit: 100 },
      { cwd: targetDir, cursor: "page-2", limit: 100 }
    ]);
    expect(listCalls.every((call) => Array.isArray(call.params?.sourceKinds) && call.params.sourceKinds.includes("appServer"))).toBe(true);
    expect(listCalls.every((call) => call.params?.sortKey === "updated_at" && call.params?.sortDirection === "desc")).toBe(true);
    expect(calls.filter((call) => call.method === "thread/read").map((call) => call.params?.threadId)).toEqual(["one", "two"]);
    expect(calls.some((call) => call.params?.threadId === "wrong")).toBe(false);
    expect(calls.some((call) => call.params?.threadId === "internal")).toBe(false);
    expect(result.signals.some((item) => item.summary.includes("must never"))).toBe(false);
    expect(result.signals.map((item) => item.summary).join(" ")).not.toContain("secret");
  });

  test("applies the selected lookback before reading Codex thread bodies", async () => {
    const targetDir = "/target";
    const now = Date.UTC(2026, 6, 10);
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const client: CodexAppServerClient = {
      request: async (method, params) => {
        calls.push({ method, params });
        if (method === "thread/list") return {
          data: [
            { id: "recent", cwd: targetDir, updatedAt: Math.floor((now - 2 * 86_400_000) / 1_000) },
            { id: "old", cwd: targetDir, updatedAt: Math.floor((now - 10 * 86_400_000) / 1_000) }
          ],
          nextCursor: "older-page"
        };
        return { thread: { id: params?.threadId, cwd: targetDir, turns: [] } };
      },
      close: async () => {}
    };

    const result = await collectProjectSessionEvidence({
      targetDir,
      targets: ["codex"],
      codexClientFactory: async () => client,
      lookback: "7d",
      now
    });

    expect(result.sources).toEqual([{ source: "codex", count: 1 }]);
    expect(calls.filter((call) => call.method === "thread/read").map((call) => call.params?.threadId)).toEqual(["recent"]);
    expect(calls.filter((call) => call.method === "thread/list")).toHaveLength(1);
  });

  test("discovers per-window source counts without reading Codex thread bodies", async () => {
    const targetDir = resolve(await tempDir("farrier-advice-counts-project-"));
    const transcripts = await tempDir("farrier-advice-counts-claude-");
    const now = Date.UTC(2026, 6, 10);
    await writeFile(join(transcripts, "claude-recent.jsonl"), `${JSON.stringify({ cwd: targetDir, timestamp: "2026-07-09T12:00:00.000Z", type: "user" })}\n`, "utf8");
    const methods: string[] = [];
    const client: CodexAppServerClient = {
      request: async (method) => {
        methods.push(method);
        return {
          data: [
            { id: "codex-recent", cwd: targetDir, updatedAt: Math.floor((now - 2 * 86_400_000) / 1_000) },
            { id: "codex-two-weeks", cwd: targetDir, updatedAt: Math.floor((now - 10 * 86_400_000) / 1_000) },
            { id: "codex-old", cwd: targetDir, updatedAt: Math.floor((now - 30 * 86_400_000) / 1_000) }
          ],
          nextCursor: null
        };
      },
      close: async () => {}
    };

    const counts = await discoverProjectSessionCounts({
      targetDir,
      claudeTranscriptsDir: transcripts,
      codexClientFactory: async () => client,
      now
    });

    expect(counts["7d"]).toEqual([{ source: "claude", count: 1 }, { source: "codex", count: 1 }]);
    expect(counts["14d"]).toEqual([{ source: "claude", count: 1 }, { source: "codex", count: 2 }]);
    expect(counts.all).toEqual([{ source: "claude", count: 1 }, { source: "codex", count: 3 }]);
    expect(methods).toEqual(["thread/list"]);
  });

  test("normalizes superficial command differences and counts distinct sessions", async () => {
    const project = resolve(await tempDir("farrier-advice-normalize-project-"));
    const transcripts = await tempDir("farrier-advice-normalize-claude-");
    const commands = ["bun test --no-color", "bun   test", "./bun test"];
    await Promise.all(commands.map((command, index) => writeFile(
      join(transcripts, `session-${index}.jsonl`),
      `${JSON.stringify({ cwd: project, timestamp: `2026-07-0${7 + index}T12:00:00.000Z`, type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] } })}\n`,
      "utf8"
    )));

    const result = await collectProjectSessionEvidence({
      targetDir: project, targets: ["claude"], claudeTranscriptsDir: transcripts, now: Date.UTC(2026, 6, 10)
    });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]?.occurrences).toBe(3);
    expect(result.signals[0]?.distinctSessions).toBe(3);
    expect(result.funnel?.visibleEvents).toBe(3);
    expect(result.funnel?.recurringPatterns).toBe(1);
  });

  test("keeps unique Codex patterns when Claude exceeds the global evidence budget", async () => {
    const project = resolve(await tempDir("farrier-advice-fair-project-"));
    const transcripts = await tempDir("farrier-advice-fair-claude-");
    const claudeRecords = Array.from({ length: 55 }, (_, index) => ({
      cwd: project, timestamp: "2026-07-09T12:00:00.000Z", type: "user",
      message: { content: [{ type: "text", text: `Please review and update release workflow ${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + index % 26)}` }] }
    }));
    await writeFile(join(transcripts, "claude-heavy.jsonl"), `${claudeRecords.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    const client: CodexAppServerClient = {
      request: async (method, params) => method === "thread/list"
        ? { data: [{ id: "codex-unique", cwd: project, updatedAt: Math.floor(Date.UTC(2026, 6, 9) / 1_000) }], nextCursor: null }
        : { thread: { id: params?.threadId, cwd: project, turns: [{ items: [{ type: "mcpToolCall", server: "release-api", tool: "deployment_status" }] }] } },
      close: async () => {}
    };

    const result = await collectProjectSessionEvidence({
      targetDir: project, claudeTranscriptsDir: transcripts, codexClientFactory: async () => client, now: Date.UTC(2026, 6, 10)
    });

    expect(result.signals).toHaveLength(40);
    expect(result.signals.some((signal) => signal.source === "codex" && signal.summary.includes("release-api"))).toBe(true);
    expect(result.funnel?.sources.find((source) => source.source === "claude")?.discarded.limits).toBeGreaterThan(0);
    expect(result.funnel?.sources.find((source) => source.source === "codex")?.retainedPatterns).toBe(1);
  });

  test("extracts recurring actionable patterns from a realistic 20-Claude/14-Codex corpus", async () => {
    const project = resolve(await tempDir("farrier-advice-rich-project-"));
    const transcripts = await tempDir("farrier-advice-rich-claude-");
    const timestamp = "2026-07-09T12:00:00.000Z";
    const claudeRecords = (session: number) => [
      { cwd: project, timestamp, type: "user", message: { content: [{ type: "text", text: "Actually use the release checklist before publishing" }] } },
      { cwd: project, timestamp, type: "user", message: { content: [{ type: "text", text: "Please review, deploy, and verify the release" }] } },
      { cwd: project, timestamp, type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "just check" } }] } },
      { cwd: project, timestamp, type: "assistant", message: { content: [{ type: "tool_use", name: "WebSearch", input: { query: "current deployment API documentation" } }] } },
      { cwd: project, timestamp, type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { description: "Review the release for regressions" } }] } },
      { cwd: project, timestamp, type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: join(project, "AGENTS.md"), old_string: `${session}`, new_string: "updated" } }] } }
    ];
    await Promise.all(Array.from({ length: 20 }, (_, index) => writeFile(
      join(transcripts, `claude-${index}.jsonl`), `${claudeRecords(index).map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8"
    )));
    const codexIds = Array.from({ length: 14 }, (_, index) => `codex-${index}`);
    const client: CodexAppServerClient = {
      request: async (method, params) => method === "thread/list"
        ? { data: codexIds.map((id) => ({ id, cwd: project, updatedAt: Math.floor(Date.UTC(2026, 6, 9) / 1_000) })), nextCursor: null }
        : { thread: { id: params?.threadId, cwd: project, turns: [{ items: [
            { type: "userMessage", content: "Actually use the release checklist before publishing" },
            { type: "userMessage", content: "Please review, deploy, and verify the release" },
            { type: "commandExecution", command: "just check", status: "completed", exitCode: 0 },
            { type: "webSearch", query: "current deployment API documentation" },
            { type: "collabToolCall", prompt: "Review the release for regressions" },
            { type: "fileChange", changes: [{ path: join(project, "AGENTS.md") }] }
          ] }] } },
      close: async () => {}
    };

    const result = await collectProjectSessionEvidence({
      targetDir: project, claudeTranscriptsDir: transcripts, codexClientFactory: async () => client, now: Date.UTC(2026, 6, 10)
    });

    expect(result.sources).toEqual([{ source: "claude", count: 20 }, { source: "codex", count: 14 }]);
    expect(result.signals.filter((signal) => signal.source === "claude")).toHaveLength(6);
    expect(result.signals.filter((signal) => signal.source === "codex")).toHaveLength(6);
    expect(result.signals.every((signal) => (signal.distinctSessions ?? 0) >= 14)).toBe(true);
    expect(result.funnel?.visibleEvents).toBe(204);
    expect(result.funnel?.recurringPatterns).toBe(12);
  });
});
