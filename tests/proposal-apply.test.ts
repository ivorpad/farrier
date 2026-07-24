import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrimitiveProposal } from "../src/engine/failure-router";
import { notFarrierProjectMessage } from "../src/engine/manifest";
import {
  appendHardRulesLine,
  applyProposalPlan,
  mergeGuardsRecord,
  minePrimitiveProposals,
  planPrimitiveProposal,
  type PlannedProposal
} from "../src/engine/proposal-apply";
import { createRenderPlan, hookCatalogVersions, writeRenderPlan } from "../src/engine/render";
import { repoMapBeginMarker, repoMapEndMarker } from "../src/engine/repo-map";
import { resolvePack } from "../src/packs/index";

async function tempDir(prefix = "farrier-proposal-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function createProject(): Promise<string> {
  const targetDir = await tempDir();
  const pack = resolvePack("python-fastapi");
  await writeRenderPlan(await createRenderPlan({ targetDir, pack, agents: ["claude", "codex"] }));
  return targetDir;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

function largeFileProposal(): PrimitiveProposal {
  return {
    kind: "guard-instance",
    id: "guard-large-file-commit",
    title: "Deny committing oversized files (large-file-commit-guard)",
    hookId: "large-file-commit-guard",
    guardsPatch: {
      largeFileCommit: {
        maxBytes: 5 * 1024 * 1024,
        message: "Seen 3× across 2 session(s): oversized files reached git history."
      }
    },
    message: "Seen 3× across 2 session(s). A PreToolUse guard makes this unrepeatable.",
    evidence: []
  };
}

function teardownProposal(): PrimitiveProposal {
  return {
    kind: "guard-instance",
    id: "guard-process-teardown",
    title: "Audit leftover test/automation processes at Stop",
    hookId: "process-teardown-audit",
    guardsPatch: {
      processTeardown: {
        patterns: ["Electron"],
        message: "Seen 2× across 2 session(s): sessions repeatedly killed these leftovers."
      }
    },
    message: "Seen 2× across 2 session(s). A Stop-time advisory lists matching leftovers.",
    evidence: []
  };
}

function rulesLineProposal(line = "Before `git push`, fetch and rebase onto the remote branch."): PrimitiveProposal {
  return {
    kind: "rules-line",
    id: "rule-rejected-push",
    title: "Teach the push discipline that failed before",
    line,
    message: "Seen 2× across 2 session(s): pushes were rejected and retried.",
    evidence: []
  };
}

function filesPlan(planned: PlannedProposal): Extract<PlannedProposal, { kind: "files" }> {
  if (planned.kind !== "files") throw new Error(`expected a files plan, got ${planned.kind}`);
  return planned;
}

describe("guard-instance apply", () => {
  test("plans manifest, hook files, and both agent bindings; apply lands them all", async () => {
    const targetDir = await createProject();
    const planned = filesPlan(await planPrimitiveProposal({ targetDir, proposal: largeFileProposal() }));

    const paths = planned.plan.files.map((file) => file.path);
    expect(paths).toContain(".farrier.json");
    expect(paths).toContain(".claude/settings.json");
    expect(paths).toContain(".codex/hooks.json");
    expect(paths).toContain(".farrier/hooks/large-file-commit-guard.py");
    expect(paths).toContain(".farrier/hooks/test_large_file_commit_guard.py");
    // The learned-rules file is user-owned; this apply must never plan it.
    expect(paths).not.toContain(".farrier/hooks/tool-policy-rules.json");
    expect(planned.inspection.blockers).toEqual([]);

    const result = await applyProposalPlan(targetDir, planned.plan, true);
    expect(result.written).toContain(".farrier.json");
    expect(result.backupDir).not.toBeNull();

    const manifest = await readJson(join(targetDir, ".farrier.json"));
    expect(manifest.hookIds).toContain("large-file-commit-guard");
    const guards = manifest.guards as Record<string, Record<string, unknown>>;
    expect(guards.largeFileCommit!.maxBytes).toBe(5 * 1024 * 1024);
    const versions = manifest.versions as { hooks: Record<string, number> };
    expect(versions.hooks["large-file-commit-guard"]).toBe(hookCatalogVersions["large-file-commit-guard"]);

    const settings = await readFile(join(targetDir, ".claude/settings.json"), "utf8");
    expect(settings).toContain("large-file-commit-guard.py");
    const codexHooks = await readFile(join(targetDir, ".codex/hooks.json"), "utf8");
    expect(codexHooks).toContain("large-file-commit-guard.py");
    const hookInfo = await stat(join(targetDir, ".farrier/hooks/large-file-commit-guard.py"));
    expect(hookInfo.mode & 0o111).not.toBe(0);
  });

  test("re-applying the same proposal is idempotent", async () => {
    const targetDir = await createProject();
    const proposal = largeFileProposal();
    const first = filesPlan(await planPrimitiveProposal({ targetDir, proposal }));
    await applyProposalPlan(targetDir, first.plan, true);

    const second = filesPlan(await planPrimitiveProposal({ targetDir, proposal }));
    expect(second.inspection.files.every((file) => file.action === "unchanged")).toBe(true);
    const result = await applyProposalPlan(targetDir, second.plan, false);
    expect(result.written).toEqual([]);

    const manifest = await readJson(join(targetDir, ".farrier.json"));
    const hookIds = manifest.hookIds as string[];
    expect(hookIds.filter((hookId) => hookId === "large-file-commit-guard")).toHaveLength(1);
  });

  test("preserves user manifest keys and unions teardown patterns", async () => {
    const targetDir = await createProject();
    const manifestPath = join(targetDir, ".farrier.json");
    const seeded = await readJson(manifestPath);
    seeded.guards = {
      custom: { keep: true },
      processTeardown: { patterns: ["user-pattern"], enabled: true }
    };
    (seeded.quality as Record<string, unknown>).rules = ["User quality preference."];
    await writeFile(manifestPath, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

    const planned = filesPlan(await planPrimitiveProposal({ targetDir, proposal: teardownProposal() }));
    await applyProposalPlan(targetDir, planned.plan, true);

    const manifest = await readJson(manifestPath);
    const guards = manifest.guards as Record<string, Record<string, unknown>>;
    expect(guards.custom).toEqual({ keep: true });
    expect(guards.processTeardown!.patterns).toEqual(["user-pattern", "Electron"]);
    expect(guards.processTeardown!.enabled).toBe(true);
    expect((manifest.quality as Record<string, unknown>).rules).toEqual(["User quality preference."]);
  });

  test("an injected mid-apply failure rolls back every written file", async () => {
    const targetDir = await createProject();
    const manifestPath = join(targetDir, ".farrier.json");
    const settingsPath = join(targetDir, ".claude/settings.json");
    const manifestBefore = await readFile(manifestPath, "utf8");
    const settingsBefore = await readFile(settingsPath, "utf8");

    const planned = filesPlan(await planPrimitiveProposal({ targetDir, proposal: largeFileProposal() }));
    const lastPath = planned.plan.files[planned.plan.files.length - 1]!.path;
    await expect(
      applyProposalPlan(targetDir, planned.plan, true, {
        beforeWrite: ({ file }) => {
          if (file.path === lastPath) throw new Error("injected failure");
        }
      })
    ).rejects.toThrow("injected failure");

    expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);
    expect(await readFile(settingsPath, "utf8")).toBe(settingsBefore);
    await expect(stat(join(targetDir, ".farrier/hooks/large-file-commit-guard.py"))).rejects.toThrow();
  });

  test("refuses a merge that doctor would flag as invalid", async () => {
    const targetDir = await createProject();
    const invalid: PrimitiveProposal = {
      kind: "guard-instance",
      id: "guard-large-file-commit",
      title: "Deny committing oversized files (large-file-commit-guard)",
      hookId: "large-file-commit-guard",
      guardsPatch: { largeFileCommit: { maxBytes: -1 } },
      message: "invalid shape",
      evidence: []
    };
    await expect(planPrimitiveProposal({ targetDir, proposal: invalid })).rejects.toThrow("maxBytes");
  });

  test("refuses when the project has no manifest", async () => {
    const targetDir = await tempDir();
    await expect(planPrimitiveProposal({ targetDir, proposal: largeFileProposal() })).rejects.toThrow(
      notFarrierProjectMessage
    );
  });
});

describe("rules-line apply", () => {
  test("appends inside AGENTS.md Hard Rules and stays idempotent", async () => {
    const targetDir = await createProject();
    const proposal = rulesLineProposal();
    const planned = filesPlan(await planPrimitiveProposal({ targetDir, proposal }));
    expect(planned.plan.files.map((file) => file.path)).toEqual(["AGENTS.md"]);

    await applyProposalPlan(targetDir, planned.plan, true);
    const agents = await readFile(join(targetDir, "AGENTS.md"), "utf8");
    const bullet = "- Before `git push`, fetch and rebase onto the remote branch.";
    expect(agents).toContain(bullet);
    const hardRulesIndex = agents.indexOf("## Hard Rules");
    const bulletIndex = agents.indexOf(bullet);
    expect(bulletIndex).toBeGreaterThan(hardRulesIndex);
    const nextSectionIndex = agents.indexOf("## ", hardRulesIndex + 1);
    if (nextSectionIndex !== -1) expect(bulletIndex).toBeLessThan(nextSectionIndex);

    const again = filesPlan(await planPrimitiveProposal({ targetDir, proposal }));
    expect(again.inspection.files[0]!.action).toBe("unchanged");
    const result = await applyProposalPlan(targetDir, again.plan, false);
    expect(result.written).toEqual([]);
    expect(agents.split(bullet)).toHaveLength(2);
  });

  test("plans and applies into a hand-harnessed repo without .farrier.json", async () => {
    const targetDir = await tempDir();
    await writeFile(join(targetDir, "AGENTS.md"), "# Agents\n\n## Hard Rules\n\n- Existing rule.\n", "utf8");

    const planned = filesPlan(await planPrimitiveProposal({ targetDir, proposal: rulesLineProposal() }));
    expect(planned.plan.files.map((file) => file.path)).toEqual(["AGENTS.md"]);

    await applyProposalPlan(targetDir, planned.plan, true);
    const agents = await readFile(join(targetDir, "AGENTS.md"), "utf8");
    expect(agents).toContain("- Existing rule.");
    expect(agents).toContain("- Before `git push`, fetch and rebase onto the remote branch.");
  });

  test("keeps the repo-map region the final block when the heading is missing", () => {
    const content = [
      "# Project Agent Instructions",
      "",
      "Custom prose only.",
      "",
      repoMapBeginMarker,
      "## Repository map",
      repoMapEndMarker,
      ""
    ].join("\n");

    const appended = appendHardRulesLine(content, "Use uv for Python commands.");
    expect(appended).toContain("## Hard Rules");
    expect(appended).toContain("- Use uv for Python commands.");
    expect(appended.indexOf("- Use uv for Python commands.")).toBeLessThan(appended.indexOf(repoMapBeginMarker));
    // Idempotent even in the fallback shape.
    expect(appendHardRulesLine(appended, "Use uv for Python commands.")).toBe(appended);
  });
});

describe("skill-suggestion", () => {
  test("plans no files and returns the search query", async () => {
    const targetDir = await createProject();
    const planned = await planPrimitiveProposal({
      targetDir,
      proposal: {
        kind: "skill-suggestion",
        id: "skill-npm-deploy",
        title: "Capture the working procedure around `npm deploy`",
        query: "npm deploy",
        message: "Seen 5× across 3 session(s).",
        evidence: []
      }
    });
    expect(planned).toEqual({ kind: "skill", query: "npm deploy", message: "Seen 5× across 3 session(s)." });
  });
});

describe("guards merge semantics", () => {
  test("keeps user-only keys, unions arrays, and takes reviewed values on scalar conflicts", () => {
    const merged = mergeGuardsRecord(
      { keepMe: 1, nested: { userKey: true, patterns: ["a"] } },
      { nested: { patterns: ["a", "b"], message: "new" }, added: { fresh: true } }
    );
    expect(merged).toEqual({
      keepMe: 1,
      nested: { userKey: true, patterns: ["a", "b"], message: "new" },
      added: { fresh: true }
    });
  });
});

describe("local proposal mining", () => {
  test("mines transcripts against the installed manifest without any backend", async () => {
    const targetDir = await createProject();
    const transcriptsDir = await tempDir("farrier-proposal-transcripts-");
    await mkdir(transcriptsDir, { recursive: true });
    await writeFile(
      join(transcriptsDir, "rewrite.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-07-20T10:00:00.000Z",
        message: {
          content: [{ type: "tool_use", id: "r1", name: "Bash", input: { command: "git filter-repo --strip-blobs-bigger-than 50M" } }]
        }
      })}\n`,
      "utf8"
    );

    const result = await minePrimitiveProposals({
      targetDir,
      transcriptsDir,
      codexSessionsDir: await tempDir("farrier-proposal-codex-empty-")
    });
    expect(result.proposals.map((proposal) => proposal.id)).toContain("guard-large-file-commit");
    expect(result.signals.some((signal) => signal.class === "oversized-commit")).toBe(true);
  });

  test("mines without a manifest; only planning an apply requires one", async () => {
    const targetDir = await tempDir();
    const transcriptsDir = await tempDir("farrier-proposal-bare-transcripts-");
    await mkdir(transcriptsDir, { recursive: true });
    await writeFile(
      join(transcriptsDir, "rewrite.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-07-20T10:00:00.000Z",
        message: {
          content: [{ type: "tool_use", id: "r1", name: "Bash", input: { command: "git filter-repo --strip-blobs-bigger-than 50M" } }]
        }
      })}\n`,
      "utf8"
    );

    const result = await minePrimitiveProposals({
      targetDir,
      transcriptsDir,
      codexSessionsDir: await tempDir("farrier-proposal-codex-empty-")
    });
    expect(result.proposals.map((proposal) => proposal.id)).toContain("guard-large-file-commit");
    expect(result.harnessPresent).toBe(false);
    expect(result.existingAgentFiles).toEqual([]);

    const guard = result.proposals.find((proposal) => proposal.kind === "guard-instance");
    if (!guard) throw new Error("expected a guard proposal");
    await expect(planPrimitiveProposal({ targetDir, proposal: guard })).rejects.toThrow(notFarrierProjectMessage);
  });

  test("a hand-harnessed repo without a manifest reports its existing agent files", async () => {
    const targetDir = await tempDir();
    await writeFile(join(targetDir, "AGENTS.md"), "# Agents\n", "utf8");
    await mkdir(join(targetDir, ".agents/skills/swiftui-pro"), { recursive: true });
    await mkdir(join(targetDir, ".agents/skills/playbook"), { recursive: true });
    // The same skill installed for Claude too counts once.
    await mkdir(join(targetDir, ".claude/skills/playbook"), { recursive: true });

    const result = await minePrimitiveProposals({
      targetDir,
      transcriptsDir: await tempDir("farrier-proposal-empty-transcripts-"),
      codexSessionsDir: await tempDir("farrier-proposal-codex-empty-")
    });
    expect(result.harnessPresent).toBe(false);
    expect(result.existingAgentFiles).toEqual(["AGENTS.md", "2 installed skill(s)"]);
  });
});
