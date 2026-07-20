import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

test("fetched nested repositories do not contribute live harness guidance", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-nested-repositories-"));
  await Promise.all([
    mkdir(join(targetDir, ".git"), { recursive: true }),
    mkdir(join(targetDir, "apps/live/docs"), { recursive: true }),
    mkdir(join(targetDir, "external/fetched/.git"), { recursive: true }),
    mkdir(join(targetDir, "external/worktree/docs"), { recursive: true }),
    mkdir(join(targetDir, ".agents/skills/demo/.git"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(targetDir, "AGENTS.md"), "Read `apps/live/docs/root.md` before editing.\n"),
    writeFile(join(targetDir, "apps/live/AGENTS.md"), "Read `docs/local.md` before editing.\n"),
    writeFile(join(targetDir, "apps/live/docs/root.md"), "# Root requirement\n"),
    writeFile(join(targetDir, "apps/live/docs/local.md"), "# Local requirement\n"),
    writeFile(join(targetDir, "external/fetched/AGENTS.md"),
      "Run `scripts/missing.sh` before completing fetched dependency work.\n"),
    writeFile(join(targetDir, "external/worktree/.git"), "gitdir: ../metadata/worktree\n"),
    writeFile(join(targetDir, "external/worktree/CLAUDE.md"),
      "Read `docs/missing.md` before completing worktree changes.\n"),
    writeFile(join(targetDir, ".agents/skills/demo/SKILL.md"), [
      "---",
      "name: demo",
      "description: Preserve an installed skill checkout.",
      "---",
      "",
      "Follow repository guidance.",
      "",
    ].join("\n")),
  ]);

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });
  const documentPaths = corpus.documents.map((item) => item.path);

  expect(documentPaths).toContain("AGENTS.md");
  expect(documentPaths).toContain("apps/live/AGENTS.md");
  expect(documentPaths).toContain(".agents/skills/demo/SKILL.md");
  expect(documentPaths).not.toContain("external/fetched/AGENTS.md");
  expect(documentPaths).not.toContain("external/worktree/CLAUDE.md");
  expect(corpus.skipped).toEqual(expect.arrayContaining([
    { path: "external/fetched", reason: "nested-repository" },
    { path: "external/worktree", reason: "nested-repository" },
  ]));
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path apps/live/docs/root.md.",
    result: "regular file exists",
  }));
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path apps/live/docs/local.md.",
    result: "regular file exists",
  }));
  expect(corpus.checks.some((item) => item.description.includes("external/"))).toBeFalse();
  expect(report.recommendations).toEqual([]);
  expect(report.metrics.modelCalls).toBe(0);
});
