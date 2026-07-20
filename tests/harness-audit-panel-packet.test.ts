import { describe, expect, test } from "bun:test";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildHarnessAuditPanelPacket,
  type HarnessAuditPanelPacketInput,
} from "../src/engine/harness-audit-panel-packet";
import { harnessAuditPanelPacketProblems } from "../src/engine/harness-audit-panel-packet-check";
import {
  inspectHarnessAuditPanelSource,
  snapshotHarnessAuditPanelSource,
} from "../src/engine/harness-audit-panel-source";
import type { HarnessAuditRepositoryKind } from "../src/engine/harness-audit-review-results";

const fixtures = resolve(import.meta.dir, "fixtures/harness-audit");
const repoRoot = resolve(import.meta.dir, "..");
const permutations: HarnessAuditRepositoryKind[][] = [
  ["known-defects", "clean", "seeded"],
  ["known-defects", "seeded", "clean"],
  ["clean", "known-defects", "seeded"],
  ["clean", "seeded", "known-defects"],
  ["seeded", "known-defects", "clean"],
];

async function git(dir: string, args: string[]): Promise<void> {
  const process = Bun.spawn({
    cmd: ["git", "-C", dir, ...args],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]).then(([code, error]) => [code, error] as const);
  if (exitCode !== 0) throw new Error(stderr);
}

async function sourceRepository(root: string, name: string): Promise<string> {
  const dir = join(root, `source-${name}`);
  await cp(join(fixtures, name), dir, { recursive: true });
  await git(dir, ["init", "--quiet"]);
  await git(dir, ["add", "."]);
  await git(dir, ["-c", "user.name=Farrier Test", "-c", "user.email=farrier@example.invalid", "commit", "--quiet", "-m", "fixture"]);
  return dir;
}

async function panelInput(root: string): Promise<HarnessAuditPanelPacketInput> {
  await mkdir(root, { recursive: true });
  const [known, clean, seeded] = await Promise.all([
    sourceRepository(root, "known-defects"),
    sourceRepository(root, "clean"),
    sourceRepository(root, "seeded"),
  ]);
  return {
    schemaVersion: 1,
    farrierBuildId: "panel-packet-test-build",
    backend: "claude",
    model: "comparison-model",
    maxProviderCostUsdPerCall: 0.05,
    reviewers: Array.from({ length: 5 }, (_, index) => ({
      reviewerId: `reviewer-${index + 1}`,
      role: index % 2 ? "principal" : "staff",
    })),
    sources: [
      {
        kind: "known-defects",
        sourceDir: known,
        evidence: ["Known harness defects were independently adjudicated."],
        truth: {
          repository: "known-defects",
          issues: [
            { id: "known-guidance", layer: "guidance", severity: "high", locations: [{ path: "AGENTS.md", line: 7 }] },
          ],
        },
      },
      {
        kind: "clean",
        sourceDir: clean,
        evidence: ["Mature restraint source selected by the evaluation coordinator."],
        truth: { repository: "clean", issues: [] },
      },
      {
        kind: "seeded",
        sourceDir: seeded,
        evidence: ["Cross-layer seed set independently adjudicated."],
        truth: {
          repository: "seeded",
          issues: [
            { id: "seed-guidance", layer: "guidance", severity: "high", locations: [{ path: "AGENTS.md", line: 3 }] },
            { id: "seed-verification", layer: "verification", severity: "high", locations: [{ path: "AGENTS.md", line: 11 }] },
            { id: "seed-skill", layer: "skill", severity: "high", locations: [{ path: ".agents/skills/release/SKILL.md", line: 1 }] },
            { id: "seed-hook", layer: "hook", severity: "blocking", locations: [{ path: ".claude/settings.json", line: 6 }] },
            { id: "seed-toolchain", layer: "toolchain", severity: "high", locations: [{ path: "AGENTS.md", line: 7 }] },
          ],
        },
      },
    ],
  };
}

describe("harness audit blinded panel packet", () => {
  test("builds 15 physical copies and 30 zero-provider plans without leaking truth", async () => {
    const root = await mkdtemp(join(tmpdir(), "farrier-panel-packet-"));
    try {
      const input = await panelInput(root);
      let aliasIndex = 0;
      let orderIndex = 0;
      const packet = await buildHarnessAuditPanelPacket(input, join(root, "packet"), {
        alias: () => (aliasIndex++ + 1).toString(16).padStart(12, "0"),
        shuffleKinds: () => [...permutations[orderIndex++]!],
      });

      expect(await harnessAuditPanelPacketProblems(packet)).toEqual([]);
      expect(packet).toMatchObject({
        status: "awaiting-external-approval",
        providerCallsMade: 0,
        externalApprovalReference: null,
        budgetProposal: {
          maxProviderCalls: 25,
          maxEstimatedInputTokens: 39_875,
          maxProviderCostUsd: 1.25,
        },
      });
      const aliases = packet.reviewers.flatMap((reviewer) => reviewer.aliases);
      expect(aliases).toHaveLength(15);
      expect(new Set(aliases.map((alias) => alias.targetDir)).size).toBe(15);
      expect(aliases.flatMap((alias) => alias.plans)).toHaveLength(30);
      expect(packet.reviewers.every((reviewer) => reviewer.aliases.some((alias) =>
        alias.plans.some((plan) => plan.plan.mode === "deep" && plan.plan.plannedModelCalls >= 2)))).toBeTrue();
      expect(await Promise.all(aliases.map((alias) => lstat(join(alias.targetDir, ".git"))
        .then(() => true).catch(() => false)))).not.toContain(true);
      for (const reviewer of packet.reviewers) {
        const assignment = await readFile(reviewer.assignmentFile, "utf8");
        expect(assignment).not.toContain('"kind"');
        expect(assignment).not.toContain('"truth"');
        for (const source of input.sources) expect(assignment).not.toContain(source.sourceDir);
      }

      const originalDigest = aliases[0]!.corpusDigest;
      aliases[0]!.corpusDigest = "f".repeat(64);
      expect((await harnessAuditPanelPacketProblems(packet)).some((item) =>
        item.includes("another corpus digest"))).toBeTrue();
      aliases[0]!.corpusDigest = originalDigest;

      const extraPath = join(aliases[0]!.targetDir, "unplanned-file.txt");
      await writeFile(extraPath, "packet drift\n");
      expect((await harnessAuditPanelPacketProblems(packet)).some((item) =>
        item.includes("prepared content digest"))).toBeTrue();
      await rm(extraPath);

      const changedPlan = aliases[0]!.planFiles[0]!;
      await writeFile(changedPlan, "{}\n");
      expect((await harnessAuditPanelPacketProblems(packet)).some((item) =>
        item.includes("saved plan differs"))).toBeTrue();

      const reused = aliases[1]!.targetDir;
      await rm(aliases[0]!.targetDir, { recursive: true, force: true });
      await symlink(reused, aliases[0]!.targetDir);
      expect((await harnessAuditPanelPacketProblems(packet)).some((item) =>
        item.includes("not a physical directory"))).toBeTrue();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects tracked secrets, dirty sources, and existing output", async () => {
    const root = await mkdtemp(join(tmpdir(), "farrier-panel-source-"));
    try {
      const source = join(root, "source");
      await cp(join(fixtures, "clean"), source, { recursive: true });
      await git(source, ["init", "--quiet"]);
      await writeFile(join(source, ".envrc"), "SECRET=test-only\n");
      await git(source, ["add", "."]);
      await git(source, ["-c", "user.name=Farrier Test", "-c", "user.email=farrier@example.invalid", "commit", "--quiet", "-m", "fixture"]);
      await expect(inspectHarnessAuditPanelSource(source)).rejects.toThrow("tracked environment or private-key material");

      await git(source, ["rm", "--quiet", ".envrc"]);
      await git(source, ["-c", "user.name=Farrier Test", "-c", "user.email=farrier@example.invalid", "commit", "--quiet", "-m", "remove secret"]);
      await writeFile(join(source, "AGENTS.md"), "changed after commit\n");
      await expect(inspectHarnessAuditPanelSource(source)).rejects.toThrow("tracked worktree changes");

      const input = await panelInput(join(root, "second"));
      input.sources[0]!.evidence = [];
      await expect(buildHarnessAuditPanelPacket(input, join(root, "invalid-evidence"))).rejects.toThrow("adjudication evidence");
      input.sources[0]!.evidence = ["Independent known-defect adjudication."];
      const driftOutput = join(root, "source-drift-output");
      let drifted = false;
      await expect(buildHarnessAuditPanelPacket(input, driftOutput, {
        snapshotSource: async (inspection, target) => {
          if (!drifted) await writeFile(join(inspection.sourceDir, inspection.trackedPaths[0]!), "changed after inspection\n");
          drifted = true;
          return snapshotHarnessAuditPanelSource(inspection, target);
        },
      })).rejects.toThrow("changed after its committed content was frozen");
      expect(await lstat(driftOutput).then(() => true).catch(() => false)).toBeFalse();
      const output = join(root, "existing-output");
      await writeFile(output, "occupied\n");
      await expect(buildHarnessAuditPanelPacket(input, output)).rejects.toThrow("already exists");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("CLI emits only an unapproved source-blind packet summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "farrier-panel-cli-"));
    try {
      const input = await panelInput(root);
      const manifest = join(root, "manifest.json");
      const output = join(root, "packet");
      await writeFile(manifest, `${JSON.stringify(input)}\n`);
      const child = Bun.spawn({
        cmd: [process.execPath, join(repoRoot, "src/cli.ts"), "audit-panel", "prepare",
          "--manifest", manifest, "--output", output, "--json"],
        cwd: repoRoot,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const summary = JSON.parse(stdout);
      expect(summary).toMatchObject({
        status: "awaiting-external-approval",
        reviewers: 5,
        aliases: 15,
        plans: 30,
        providerCallsMade: 0,
        externalApprovalReference: null,
      });
      for (const source of input.sources) expect(stdout).not.toContain(source.sourceDir);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
