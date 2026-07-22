import { describe, expect, test } from "bun:test";
import {
  chmod,
  mkdtemp,
  rename,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  collectProjectSessionEvidence,
  createSessionConsent,
  discoverProjectSessionCounts,
  extractUserRequest,
  listProjectSessions,
  redactSessionText,
  type SessionConsentCategory,
  type SessionMetadataInventory,
} from "../src/engine/advice-sessions";
import {
  listClaudeSessions,
  readClaudeSelection,
} from "../src/engine/advice-session-claude";
import type { AdviceVendor } from "../src/engine/advice-types";
import type { CodexAppServerClient, CodexAppServerFactory } from "../src/engine/codex-app-server";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

const allCategories: SessionConsentCategory[] = [
  "requests",
  "corrections",
  "commands",
  "files",
  "outcomes",
];

async function inventoryAndConsent(input: {
  targetDir: string;
  targets: AdviceVendor[];
  claudeTranscriptsDir?: string;
  codexClientFactory?: CodexAppServerFactory;
  now?: number;
  select?: (entry: SessionMetadataInventory["entries"][number]) => boolean;
  categories?: SessionConsentCategory[];
  maxBytes?: number;
  maxTurns?: number;
}) {
  const inventory = await listProjectSessions({
    targetDir: input.targetDir,
    targets: input.targets,
    lookback: "all",
    claudeTranscriptsDir: input.claudeTranscriptsDir,
    codexClientFactory: input.codexClientFactory,
    now: input.now,
  });
  const entries = inventory.entries.filter(input.select ?? (() => true));
  const consent = createSessionConsent({
    projectRootDigest: inventory.projectRootDigest,
    selected: entries.map((entry) => ({
      entry,
      maxBytes: input.maxBytes ?? 2_000_000,
      maxTurns: input.maxTurns ?? 200,
    })),
    categories: input.categories ?? allCategories,
  });
  return { inventory, consent };
}

function codexClient(handler: CodexAppServerClient["request"]): CodexAppServerClient {
  return { request: handler, close: async () => undefined };
}

describe("session evidence", () => {
  test("redacts secrets and extracts wrapped requests before bounding", () => {
    const redacted = redactSessionText(
      "Bearer abc123 token=super-secret email dev@example.com sk-abcdefghijklmnop",
    );
    expect(redacted).toContain("Bearer [REDACTED_TOKEN]");
    expect(redacted).toContain("token=[REDACTED]");
    expect(redacted).toContain("[REDACTED_EMAIL]");
    expect(redacted).toContain("[REDACTED_KEY]");
    expect(redacted).not.toContain("super-secret");

    // Session prose inherits the shared pattern upgrades (built from parts so
    // no token-shaped literal lands in the repo).
    const providerSecrets = [
      ["AK", "IA", "7".repeat(16)].join(""),
      ["ghp", "a".repeat(36)].join("_"),
      ["github", "pat", "b".repeat(24)].join("_"),
      ["xoxb", "1".repeat(10), "c".repeat(12)].join("-"),
      ["AIza", "SyA", "d".repeat(32)].join(""),
      ["npm", "e".repeat(36)].join("_"),
      ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "h".repeat(12)].join("."),
      `aws_secret_access_key = ${"j".repeat(30)}`
    ];
    for (const sample of providerSecrets) {
      expect(redactSessionText(sample)).toContain("REDACTED");
    }
    for (const ordinary of [
      `commit ${"3f78".repeat(10)} tagged for release`,
      "the task-scheduler and risk-assessment jobs run nightly",
      "https://github.com/owner/repo/pull/42",
      "max_tokens: 4096"
    ]) {
      expect(redactSessionText(ordinary)).toBe(ordinary);
    }

    const wrapped = "<in-app-browser-context>payload</in-app-browser-context>\n"
      + "# AGENTS.md instructions\n<INSTRUCTIONS>rules</INSTRUCTIONS>\n"
      + "## My request for Codex:\nCreate a reusable goal-oriented metaprompt";
    expect(extractUserRequest(wrapped)).toBe("Create a reusable goal-oriented metaprompt");
  });

  test("lists Claude metadata without opening bodies and keeps paths opaque", async () => {
    const project = resolve(await tempDir("farrier-session-project-"));
    const transcripts = await tempDir("farrier-session-claude-");
    const body = "{ definitely not valid json and must not be parsed during listing";
    await writeFile(join(transcripts, "private-name.jsonl"), body, "utf8");
    await chmod(join(transcripts, "private-name.jsonl"), 0o000);

    try {
      const inventory = await listProjectSessions({
        targetDir: project,
        targets: ["claude"],
        claudeTranscriptsDir: transcripts,
      });

      expect(inventory.entries).toHaveLength(1);
      expect(inventory.entries[0]?.provider).toBe("claude");
      expect(inventory.entries[0]?.projectMatch).toBe("unknown");
      expect(inventory.entries[0]?.opaqueId).not.toContain("private-name");
      expect(JSON.stringify(inventory)).not.toContain(join(transcripts, "private-name.jsonl"));
    } finally {
      await chmod(join(transcripts, "private-name.jsonl"), 0o600);
    }
  });

  test("ignores Claude symlinks and caps metadata at the newest 500 entries", async () => {
    const project = resolve(await tempDir("farrier-session-cap-project-"));
    const transcripts = await tempDir("farrier-session-cap-claude-");
    await Promise.all(Array.from({ length: 505 }, (_, index) =>
      writeFile(join(transcripts, `session-${String(index).padStart(3, "0")}.jsonl`), "", "utf8")));
    const outside = join(await tempDir("farrier-session-outside-"), "outside.jsonl");
    await writeFile(outside, "secret", "utf8");
    await symlink(outside, join(transcripts, "linked.jsonl"));

    const inventory = await listProjectSessions({
      targetDir: project,
      targets: ["claude"],
      claudeTranscriptsDir: transcripts,
    });

    expect(inventory.entries).toHaveLength(500);
    expect(inventory.limits).toEqual([{
      provider: "claude",
      discovered: 506,
      retained: 500,
      omitted: 5,
      invalid: 1,
    }]);
  });

  test("reads only selected Claude tails, validates cwd, and preserves parsing/redaction", async () => {
    const project = resolve(await tempDir("farrier-session-read-project-"));
    const other = resolve(await tempDir("farrier-session-read-other-"));
    const transcripts = await tempDir("farrier-session-read-claude-");
    const old = Array.from({ length: 30 }, (_, index) => ({
      cwd: other,
      type: "user",
      message: { content: `Old unrelated request ${index} ${"x".repeat(100)}` },
    }));
    const recent = [
      { cwd: project, type: "user", message: { content: "Create a release checklist token=private dev@example.com" } },
      { cwd: project, type: "user", message: { content: "No, keep deployment manual." } },
      { cwd: project, type: "assistant", message: { content: [
        { type: "text", text: "Updated the checklist." },
        { type: "tool_use", name: "Bash", input: { command: "just check" } },
        { type: "tool_use", name: "Edit", input: { file_path: "AGENTS.md" } },
      ] } },
    ];
    await writeFile(
      join(transcripts, "selected.jsonl"),
      `${[...old, ...recent].map((record) => JSON.stringify(record)).join("\n")}\nnot-json\n`,
      "utf8",
    );
    await writeFile(
      join(transcripts, "unselected.jsonl"),
      `${JSON.stringify({ cwd: project, type: "user", message: { content: "Never expose this request" } })}\n`,
      "utf8",
    );
    const selectedTime = Date.now() / 1_000 + 5;
    await utimes(join(transcripts, "selected.jsonl"), selectedTime, selectedTime);
    const { inventory } = await inventoryAndConsent({
      targetDir: project,
      targets: ["claude"],
      claudeTranscriptsDir: transcripts,
      maxBytes: 1_200,
      maxTurns: 3,
    });
    const selectedEntry = inventory.entries[0];
    const narrowed = createSessionConsent({
      projectRootDigest: inventory.projectRootDigest,
      selected: [{
        entry: selectedEntry ?? (() => { throw new Error("selected metadata missing"); })(),
        maxBytes: 1_200,
        maxTurns: 3,
      }],
      categories: allCategories,
    });

    const result = await collectProjectSessionEvidence({
      targetDir: project,
      consent: narrowed,
      claudeTranscriptsDir: transcripts,
    });

    expect(result.sources).toEqual([{ source: "claude", count: 1 }]);
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes?.[0]?.request).toContain("release checklist");
    expect(result.episodes?.[0]?.corrections).toEqual(["No, keep deployment manual."]);
    expect(result.episodes?.[0]?.actions.map((item) => item.type)).toEqual([
      "verification",
      "file-change",
    ]);
    expect(result.episodes?.[0]?.outcome).toBe("Updated the checklist.");
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("dev@example.com");
    expect(JSON.stringify(result)).not.toContain("Never expose");
    expect(result.notes).toContain("Skipped 1 malformed Claude session record(s).");
  });

  test("Claude turn bounds retain assistant records after the latest user request", async () => {
    const project = resolve(await tempDir("farrier-session-turn-project-"));
    const transcripts = await tempDir("farrier-session-turn-claude-");
    const records = [
      { cwd: project, type: "user", message: { content: "Create a release checklist" } },
      ...Array.from({ length: 25 }, (_, index) => ({
        cwd: project,
        type: "assistant",
        message: { content: `Progress ${index}` },
      })),
    ];
    await writeFile(
      join(transcripts, "turns.jsonl"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
    const { consent } = await inventoryAndConsent({
      targetDir: project,
      targets: ["claude"],
      claudeTranscriptsDir: transcripts,
      maxTurns: 1,
    });

    const result = await collectProjectSessionEvidence({
      targetDir: project,
      consent,
      claudeTranscriptsDir: transcripts,
    });

    expect(result.episodes?.map((episode) => episode.request)).toEqual([
      "Create a release checklist",
    ]);
    expect(result.funnel?.sources[0]?.parsed).toBe(26);
  });

  test("rejects a pathname replaced during a selected Claude body read", async () => {
    const project = resolve(await tempDir("farrier-session-replaced-project-"));
    const transcripts = await tempDir("farrier-session-replaced-claude-");
    const path = join(transcripts, "selected.jsonl");
    const body = `${JSON.stringify({
      cwd: project,
      type: "user",
      message: { content: "Create a checklist " + "x".repeat(16 * 1024 * 1024) },
    })}\n`;
    await writeFile(path, body, "utf8");
    const index = await listClaudeSessions({
      targetDir: project,
      transcriptsDir: transcripts,
      lookback: "all",
      now: Date.now(),
    });
    const indexed = index.sessions[0] ?? (() => { throw new Error("Claude entry missing"); })();
    // Stage the replacement fully BEFORE starting the read so only one rename
    // syscall sits inside the race window. Both orderings must reject: a swap
    // before open trips O_NOFOLLOW ("disappeared or changed"), a swap mid-read
    // trips the post-read fingerprint checks ("changed while reading"). With
    // mkdtemp/writeFile/symlink inside the window, a loaded machine sometimes
    // let the 16MB read finish first and the test flaked on a benign ordering.
    const outside = join(await tempDir("farrier-session-replaced-outside-"), "outside.jsonl");
    await writeFile(outside, `${JSON.stringify({ cwd: project, type: "user", message: { content: "Outside" } })}\n`);
    const replacement = join(transcripts, "replacement");
    await symlink(outside, replacement);
    const reading = readClaudeSelection({
      indexed,
      selection: {
        provider: "claude",
        opaqueId: indexed.entry.opaqueId,
        expectedFingerprint: indexed.entry.sourceFingerprint,
        maxBytes: Buffer.byteLength(body),
        maxTurns: 10,
      },
      categories: allCategories,
      targetDir: project,
    });
    const renamed = rename(replacement, path);

    // Every ordering must reject, each through its own check: swap before
    // open fails O_NOFOLLOW ("disappeared or changed"); swap between open and
    // the first fd stat drops the inode's link count, bumping ctime past the
    // indexed fingerprint ("changed"); swap mid-read trips the post-read
    // checks ("changed while reading").
    await expect(reading).rejects.toThrow(
      /Consented Claude session source (?:disappeared or changed|changed(?: while reading)?):/
    );
    await renamed;
  });

  test("skips internal Farrier Claude sessions without losing readable project sessions", async () => {
    const project = resolve(await tempDir("farrier-session-internal-project-"));
    const transcripts = await tempDir("farrier-session-internal-claude-");
    const record = (content: string) => JSON.stringify({
      cwd: project,
      type: "user",
      message: { content },
    });
    await writeFile(
      join(transcripts, "internal.jsonl"),
      `${record("Farrier's read-only project advisor must inspect this project")}\n`,
      "utf8",
    );
    await writeFile(
      join(transcripts, "readable.jsonl"),
      `${record("Create a readable project checklist")}\n`,
      "utf8",
    );
    const { consent } = await inventoryAndConsent({
      targetDir: project,
      targets: ["claude"],
      claudeTranscriptsDir: transcripts,
    });

    const result = await collectProjectSessionEvidence({
      targetDir: project,
      consent,
      claudeTranscriptsDir: transcripts,
    });

    expect(result.episodes?.map((episode) => episode.request)).toEqual([
      "Create a readable project checklist",
    ]);
    expect(result.notes).toContain("Skipped 1 internal Farrier Claude session(s).");
    expect(result.funnel?.sources[0]?.read).toBe(1);
  });

  test("filters unconsented categories before evidence leaves collection", async () => {
    const project = resolve(await tempDir("farrier-session-category-project-"));
    const transcripts = await tempDir("farrier-session-category-claude-");
    const records = [
      { cwd: project, type: "user", message: { content: "Create a reusable release checklist" } },
      { cwd: project, type: "user", message: { content: "No, keep deployment manual." } },
      { cwd: project, type: "assistant", message: { content: [
        { type: "text", text: "Sensitive outcome" },
        { type: "tool_use", name: "Bash", input: { command: "secret command" } },
        { type: "tool_use", name: "Edit", input: { file_path: "secret-file" } },
      ] } },
    ];
    await writeFile(
      join(transcripts, "categories.jsonl"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
    const { consent } = await inventoryAndConsent({
      targetDir: project,
      targets: ["claude"],
      claudeTranscriptsDir: transcripts,
      categories: ["requests"],
    });

    const result = await collectProjectSessionEvidence({
      targetDir: project,
      consent,
      claudeTranscriptsDir: transcripts,
    });

    expect(result.episodes?.[0]?.request).toContain("release checklist");
    expect(result.episodes?.[0]?.corrections).toEqual([]);
    expect(result.episodes?.[0]?.actions).toEqual([]);
    expect(result.episodes?.[0]?.outcome).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("Sensitive outcome");
    expect(JSON.stringify(result)).not.toContain("secret command");
    expect(JSON.stringify(result)).not.toContain("secret-file");
  });

  test("returns no episodes when requests are not consented", async () => {
    const project = resolve(await tempDir("farrier-session-no-request-project-"));
    const transcripts = await tempDir("farrier-session-no-request-claude-");
    await writeFile(
      join(transcripts, "commands.jsonl"),
      `${JSON.stringify({ cwd: project, type: "user", message: { content: "Create a checklist" } })}\n`,
      "utf8",
    );
    const { consent } = await inventoryAndConsent({
      targetDir: project,
      targets: ["claude"],
      claudeTranscriptsDir: transcripts,
      categories: ["commands"],
    });
    const result = await collectProjectSessionEvidence({
      targetDir: project,
      consent,
      claudeTranscriptsDir: transcripts,
    });
    expect(result.episodes).toEqual([]);
    expect(result.signals).toEqual([]);
  });

  test("bounds and redacts Codex metadata listing errors", async () => {
    const targetDir = resolve(await tempDir("farrier-session-codex-error-project-"));
    const inventory = await listProjectSessions({
      targetDir,
      targets: ["codex"],
      codexClientFactory: async () => {
        throw new Error(`token=super-secret ${"x".repeat(2_000)}`);
      },
    });

    expect(inventory.notes).toHaveLength(1);
    expect(Buffer.byteLength(inventory.notes[0] ?? "", "utf8")).toBeLessThanOrEqual(512);
    expect(inventory.notes[0]).toContain("[REDACTED]");
    expect(inventory.notes[0]).not.toContain("super-secret");
  });

  test("Codex metadata uses thread/list only and collection reads only consented opaque IDs", async () => {
    const targetDir = resolve(await tempDir("farrier-session-codex-project-"));
    const now = Date.UTC(2026, 6, 10);
    const calls: Array<{
      method: string;
      params?: Record<string, unknown>;
      options?: { maxResponseBytes?: number };
    }> = [];
    const client = codexClient(async (method, params, options) => {
      calls.push({ method, params, options });
      if (method === "thread/list") {
        return {
          data: [
            { id: "one", cwd: targetDir, updatedAt: Math.floor(now / 1_000) },
            { id: "two", cwd: targetDir, updatedAt: Math.floor(now / 1_000) - 1 },
            { id: "child", cwd: targetDir, parentThreadId: "one", updatedAt: Math.floor(now / 1_000) },
            { id: "fork", cwd: targetDir, forkedFromId: "one", updatedAt: Math.floor(now / 1_000) },
            { id: "subagent", cwd: targetDir, source: "subAgent", updatedAt: Math.floor(now / 1_000) },
            { id: "wrong", cwd: "/other", updatedAt: Math.floor(now / 1_000) },
          ],
          nextCursor: null,
        };
      }
      return {
        thread: {
          id: params?.threadId,
          cwd: targetDir,
          turns: [{ items: [
            { type: "userMessage", content: `Create checklist ${params?.threadId}` },
            { type: "reasoning", summary: ["must never be consumed"] },
          ] }],
        },
      };
    });
    const factory = async () => client;
    const inventory = await listProjectSessions({
      targetDir,
      targets: ["codex"],
      codexClientFactory: factory,
      now,
    });
    expect(calls.map((call) => call.method)).toEqual(["thread/list"]);
    expect(inventory.entries).toHaveLength(2);
    const selected = inventory.entries.find((entry) => entry.updatedAt === new Date(now).toISOString());
    const consent = createSessionConsent({
      projectRootDigest: inventory.projectRootDigest,
      selected: [{
        entry: selected ?? (() => { throw new Error("Codex entry missing"); })(),
        maxBytes: 50_000,
        maxTurns: 10,
      }],
      categories: allCategories,
    });

    const result = await collectProjectSessionEvidence({
      targetDir,
      consent,
      codexClientFactory: factory,
      now,
    });

    expect(calls.filter((call) => call.method === "thread/read").map((call) => call.params?.threadId)).toEqual(["one"]);
    expect(calls.filter((call) => call.method === "thread/list")
      .every((call) => call.options?.maxResponseBytes === 1_000_000)).toBe(true);
    expect(calls.filter((call) => call.method === "thread/list")
      .flatMap((call) => call.params?.sourceKinds as string[])
      .some((source) => source.toLowerCase().startsWith("subagent"))).toBe(false);
    expect(calls.find((call) => call.method === "thread/read")?.options?.maxResponseBytes).toBe(50_000);
    expect(result.episodes?.[0]?.request).toBe("Create checklist one");
    expect(JSON.stringify(result)).not.toContain("must never");
  });

  test("Codex metadata uses bounded pages so large local histories remain listable", async () => {
    const targetDir = resolve(await tempDir("farrier-session-codex-pages-"));
    const now = Date.UTC(2026, 6, 10);
    const limits: unknown[] = [];
    const client = codexClient(async (_method, params) => {
      limits.push(params?.limit);
      const secondPage = params?.cursor === "page-2";
      return {
        data: [{
          id: secondPage ? "two" : "one",
          cwd: targetDir,
          updatedAt: Math.floor(now / 1_000) - (secondPage ? 1 : 0)
        }],
        nextCursor: secondPage ? null : "page-2"
      };
    });

    const inventory = await listProjectSessions({
      targetDir,
      targets: ["codex"],
      codexClientFactory: async () => client,
      now
    });

    expect(inventory.entries).toHaveLength(2);
    expect(limits).toEqual([20, 20]);
  });

  test("skips oversized and internal Codex sessions without losing readable sessions", async () => {
    const targetDir = resolve(await tempDir("farrier-session-codex-oversized-"));
    const now = Date.UTC(2026, 6, 10);
    const client = codexClient(async (method, params) => {
      if (method === "thread/list") {
        return {
          data: [
            { id: "large", cwd: targetDir, updatedAt: Math.floor(now / 1_000) },
            { id: "readable", cwd: targetDir, updatedAt: Math.floor(now / 1_000) - 1 },
            { id: "internal", cwd: targetDir, updatedAt: Math.floor(now / 1_000) - 2 },
          ],
          nextCursor: null,
        };
      }
      if (params?.threadId === "large") {
        throw new Error("Codex App Server response exceeded the bounded response limit.");
      }
      const content = params?.threadId === "internal"
        ? "Farrier's read-only project advisor must inspect this project"
        : "Create a readable release checklist";
      return {
        thread: {
          id: params?.threadId,
          cwd: targetDir,
          turns: [{ items: [{ type: "userMessage", content }] }],
        },
      };
    });
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls += 1;
      return client;
    };
    const { consent } = await inventoryAndConsent({
      targetDir,
      targets: ["codex"],
      codexClientFactory: factory,
      now,
      maxBytes: 250_000,
      maxTurns: 20,
    });

    const result = await collectProjectSessionEvidence({
      targetDir,
      consent,
      codexClientFactory: factory,
      now,
    });

    expect(result.episodes?.map((episode) => episode.request)).toEqual([
      "Create a readable release checklist",
    ]);
    expect(result.notes).toContain(
      "Skipped 1 Codex session(s) that exceeded the reviewed per-session byte cap.",
    );
    expect(result.notes).toContain("Skipped 1 internal Farrier Codex session(s).");
    expect(result.funnel?.sources[0]?.read).toBe(1);
    expect(factoryCalls).toBe(3);
  });

  test("drops Codex evidence when its source changes during extraction", async () => {
    const targetDir = resolve(await tempDir("farrier-session-codex-changing-"));
    const now = Date.UTC(2026, 6, 10);
    let readStarted = false;
    const client = codexClient(async (method, params) => {
      if (method === "thread/list") {
        return {
          data: [
            { id: "stable", cwd: targetDir, updatedAt: Math.floor(now / 1_000) },
            {
              id: "changing",
              cwd: targetDir,
              updatedAt: Math.floor(now / 1_000) - 1 + (readStarted ? 1 : 0),
            },
          ],
          nextCursor: null,
        };
      }
      readStarted = true;
      return {
        thread: {
          id: params?.threadId,
          cwd: targetDir,
          turns: [{ items: [{
            type: "userMessage",
            content: `Create ${params?.threadId} checklist`,
          }] }],
        },
      };
    });
    const factory = async () => client;
    const { consent } = await inventoryAndConsent({
      targetDir,
      targets: ["codex"],
      codexClientFactory: factory,
      now,
    });

    const result = await collectProjectSessionEvidence({
      targetDir,
      consent,
      codexClientFactory: factory,
      now,
    });

    expect(result.episodes?.map((episode) => episode.request)).toEqual([
      "Create stable checklist",
    ]);
    expect(result.sources).toEqual([{ source: "codex", count: 1 }]);
    expect(result.notes).toContain(
      "Skipped 1 Codex session(s) that changed before or during local extraction.",
    );
  });

  test("preserves later Codex correction attachment and recent-turn bounds", async () => {
    const targetDir = resolve(await tempDir("farrier-session-correction-project-"));
    const now = Date.UTC(2026, 6, 10);
    const client = codexClient(async (method, params) => method === "thread/list"
      ? { data: [{ id: "corrected", cwd: targetDir, updatedAt: Math.floor(now / 1_000) }], nextCursor: null }
      : { thread: { id: params?.threadId, cwd: targetDir, turns: [
          { id: "old", items: [{ type: "userMessage", content: "Old task outside turn allowance" }] },
          { id: "one", items: [{ type: "userMessage", content: "Create a reusable release checklist" }, { type: "agentMessage", text: "Drafted." }] },
          { id: "two", items: [{ type: "userMessage", content: "No, keep deploy as a user action." }, { type: "agentMessage", text: "Updated." }] },
        ] } });
    const factory = async () => client;
    const { consent } = await inventoryAndConsent({
      targetDir,
      targets: ["codex"],
      codexClientFactory: factory,
      now,
      maxBytes: 50_000,
      maxTurns: 2,
    });

    const result = await collectProjectSessionEvidence({
      targetDir,
      consent,
      codexClientFactory: factory,
      now,
    });

    expect(result.episodes).toHaveLength(1);
    expect(result.episodes?.[0]?.request).toBe("Create a reusable release checklist");
    expect(result.episodes?.[0]?.corrections).toEqual(["No, keep deploy as a user action."]);
    expect(result.episodes?.[0]?.outcome).toBe("Updated.");
    expect(JSON.stringify(result)).not.toContain("Old task");
  });

  test("metadata counts use no Codex thread/read and honor exact lookback boundaries", async () => {
    const targetDir = resolve(await tempDir("farrier-session-count-project-"));
    const transcripts = await tempDir("farrier-session-count-claude-");
    const now = Date.UTC(2026, 6, 10);
    const cutoff = now - 7 * 86_400_000;
    const included = join(transcripts, "included.jsonl");
    const excluded = join(transcripts, "excluded.jsonl");
    await writeFile(included, "", "utf8");
    await writeFile(excluded, "", "utf8");
    await utimes(included, cutoff / 1_000, cutoff / 1_000);
    await utimes(excluded, (cutoff - 1) / 1_000, (cutoff - 1) / 1_000);
    const methods: string[] = [];
    const client = codexClient(async (method) => {
      methods.push(method);
      return {
        data: [
          { id: "recent", cwd: targetDir, updatedAt: Math.floor((now - 2 * 86_400_000) / 1_000) },
          { id: "old", cwd: targetDir, updatedAt: Math.floor((now - 20 * 86_400_000) / 1_000) },
        ],
        nextCursor: null,
      };
    });

    const counts = await discoverProjectSessionCounts({
      targetDir,
      claudeTranscriptsDir: transcripts,
      codexClientFactory: async () => client,
      now,
    });

    expect(counts["7d"]).toEqual([
      { source: "claude", count: 1 },
      { source: "codex", count: 1 },
    ]);
    expect(counts.all).toEqual([
      { source: "claude", count: 2 },
      { source: "codex", count: 2 },
    ]);
    expect(methods).toEqual(["thread/list"]);
  });

  test("collapses normalized repeats while preserving recurrence annotation", async () => {
    const project = resolve(await tempDir("farrier-session-fair-project-"));
    const transcripts = await tempDir("farrier-session-fair-claude-");
    const common = { cwd: project, type: "user", message: { content: "Create a reusable release checklist" } };
    const heavy = [
      common,
      ...Array.from({ length: 89 }, (_, index) => ({
        cwd: project,
        type: "user",
        message: { content: `Review release workflow item ${index}` },
      })),
    ];
    const light = [
      common,
      { cwd: project, type: "user", message: { content: "Create a unique deployment status checklist" } },
    ];
    await writeFile(join(transcripts, "heavy.jsonl"), `${heavy.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    await writeFile(join(transcripts, "light.jsonl"), `${light.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    const { consent } = await inventoryAndConsent({
      targetDir: project,
      targets: ["claude"],
      claudeTranscriptsDir: transcripts,
    });

    const result = await collectProjectSessionEvidence({
      targetDir: project,
      consent,
      claudeTranscriptsDir: transcripts,
    });

    expect(result.episodes).toHaveLength(3);
    expect(result.episodes?.some((episode) =>
      episode.request.includes("unique deployment status"))).toBe(true);
    const recurring = result.episodes?.filter((episode) =>
      episode.request.includes("reusable release checklist")) ?? [];
    expect(recurring).toHaveLength(1);
    expect(recurring[0]?.occurrences).toBe(2);
    expect(recurring[0]?.distinctSessions).toBe(2);
    expect(result.episodes?.find((episode) =>
      episode.request.includes("Review release workflow item"))?.occurrences).toBe(89);
    expect(result.funnel?.recurringPatterns).toBe(1);
    expect(result.funnel?.sources[0]?.discarded.deduplication).toBeGreaterThan(0);
  });
});
