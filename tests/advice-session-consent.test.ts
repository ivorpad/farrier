import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  collectProjectSessionEvidence,
  createSessionConsent,
  listProjectSessions,
  sessionConsentDigest,
  validateSessionConsent,
} from "../src/engine/advice-sessions";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

test("consent rejects duplicates, limits, and project drift while safely skipping changed sources", async () => {
  const project = resolve(await tempDir("farrier-session-drift-project-"));
  const otherProject = resolve(await tempDir("farrier-session-drift-other-"));
  const transcripts = await tempDir("farrier-session-drift-claude-");
  const path = join(transcripts, "session.jsonl");
  await writeFile(
    path,
    `${JSON.stringify({ cwd: project, type: "user", message: { content: "Create a checklist" } })}\n`,
    "utf8",
  );
  const inventory = await listProjectSessions({
    targetDir: project,
    targets: ["claude"],
    claudeTranscriptsDir: transcripts,
  });
  const entry = inventory.entries[0]!;
  const consent = createSessionConsent({
    projectRootDigest: inventory.projectRootDigest,
    selected: [{ entry, maxBytes: 2_000_000, maxTurns: 200 }],
    categories: ["requests"],
  });
  const selection = consent.selected[0]!;
  expect(() => validateSessionConsent({
    ...consent,
    selected: [selection, selection],
    selectionDigest: "invalid",
  })).toThrow("duplicate selection");
  expect(() => createSessionConsent({
    projectRootDigest: consent.projectRootDigest,
    selected: [{ entry, maxBytes: 2_000_001, maxTurns: 1 }],
    categories: ["requests"],
  })).toThrow("maxBytes");

  await writeFile(
    path,
    `${JSON.stringify({ cwd: project, type: "user", message: { content: "Changed" } })}\n`,
    "utf8",
  );
  const changed = await collectProjectSessionEvidence({
    targetDir: project,
    consent,
    claudeTranscriptsDir: transcripts,
  });
  expect(changed.episodes).toEqual([]);
  expect(changed.notes).toContain("Skipped 1 Claude session(s) that changed before or during local extraction.");

  const currentInventory = await listProjectSessions({
    targetDir: project,
    targets: ["claude"],
    claudeTranscriptsDir: transcripts,
  });
  const currentConsent = createSessionConsent({
    projectRootDigest: currentInventory.projectRootDigest,
    selected: [{ entry: currentInventory.entries[0]!, maxBytes: 2_000_000, maxTurns: 200 }],
    categories: ["requests"],
  });
  await rm(path);
  const missing = await collectProjectSessionEvidence({
    targetDir: project,
    consent: currentConsent,
    claudeTranscriptsDir: transcripts,
  });
  expect(missing.episodes).toEqual([]);
  expect(missing.notes).toContain("Skipped 1 missing Claude session(s).");
  await expect(collectProjectSessionEvidence({
    targetDir: otherProject,
    consent: currentConsent,
    claudeTranscriptsDir: transcripts,
  })).rejects.toThrow("project root has changed");
});

test("Codex collection drops a thread that drifts after its body read", async () => {
  const project = resolve(await tempDir("farrier-session-codex-drift-"));
  let bodyRead = false;
  const client = {
    request: async (method: string, params?: Record<string, unknown>) => {
      if (method === "thread/list") {
        return {
          data: [{
            id: "thread",
            cwd: project,
            updatedAt: bodyRead ? 2 : 1
          }],
          nextCursor: null
        };
      }
      bodyRead = true;
      return {
        thread: {
          id: params?.threadId,
          cwd: project,
          turns: [{ items: [{ type: "userMessage", content: "Create a checklist" }] }]
        }
      };
    },
    close: async () => undefined
  };
  const inventory = await listProjectSessions({
    targetDir: project,
    targets: ["codex"],
    codexClientFactory: async () => client
  });
  const consent = createSessionConsent({
    projectRootDigest: inventory.projectRootDigest,
    selected: [{ entry: inventory.entries[0]!, maxBytes: 50_000, maxTurns: 10 }],
    categories: ["requests"]
  });

  const result = await collectProjectSessionEvidence({
    targetDir: project,
    consent,
    codexClientFactory: async () => client
  });

  expect(result.sources).toEqual([{ source: "codex", count: 0 }]);
  expect(result.episodes).toEqual([]);
  expect(result.notes).toContain("Skipped 1 Codex session(s) that changed before or during local extraction.");
});

test("metadata cancellation interrupts Codex listing and closes its client", async () => {
  const project = resolve(await tempDir("farrier-session-codex-cancel-"));
  const controller = new AbortController();
  let closed = 0;
  let markStarted!: () => void;
  const started = new Promise<void>((resolveStarted) => { markStarted = resolveStarted; });
  const client = {
    request: async (
      _method: string,
      _params?: Record<string, unknown>,
      options?: { signal?: AbortSignal }
    ) => {
      markStarted();
      return new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
    },
    close: async () => { closed += 1; }
  };
  const listing = listProjectSessions({
    targetDir: project,
    targets: ["codex"],
    codexClientFactory: async () => client,
    signal: controller.signal
  });
  await started;
  controller.abort();

  await expect(listing).rejects.toThrow("cancelled");
  expect(closed).toBeGreaterThan(0);
});

test("selection digest is canonical across category and selection order", async () => {
  const project = resolve(await tempDir("farrier-session-digest-project-"));
  const transcripts = await tempDir("farrier-session-digest-claude-");
  for (const name of ["a.jsonl", "b.jsonl"]) {
    await writeFile(join(transcripts, name), "", "utf8");
  }
  const inventory = await listProjectSessions({
    targetDir: project,
    targets: ["claude"],
    claudeTranscriptsDir: transcripts,
  });
  const selections = inventory.entries.map((entry) => ({
    provider: entry.provider,
    opaqueId: entry.opaqueId,
    expectedFingerprint: entry.sourceFingerprint,
    maxBytes: 100,
    maxTurns: 1,
  }));
  const left = sessionConsentDigest({
    projectRootDigest: inventory.projectRootDigest,
    selected: selections,
    categories: ["outcomes", "requests"],
  });
  const right = sessionConsentDigest({
    projectRootDigest: inventory.projectRootDigest,
    selected: [...selections].reverse(),
    categories: ["requests", "outcomes"],
  });
  expect(left).toBe(right);
});
