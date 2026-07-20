import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

test("skill paths honor explicit repository-root context without moving ordinary resources", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-skill-project-root-"));
  await Promise.all([
    mkdir(join(targetDir, "docs"), { recursive: true }),
    mkdir(join(targetDir, "scripts"), { recursive: true }),
    mkdir(join(targetDir, ".agents/skills/mintlify"), { recursive: true }),
    mkdir(join(targetDir, ".agents/skills/merge-pr"), { recursive: true }),
    mkdir(join(targetDir, ".agents/skills/local"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(targetDir, "docs/docs.json"), "{}\n"),
    writeFile(join(targetDir, "scripts/pr-merge"), "#!/bin/sh\n"),
    writeFile(join(targetDir, "scripts/local.sh"), "#!/bin/sh\n"),
    writeFile(join(targetDir, ".agents/skills/mintlify/SKILL.md"), [
      "---", "name: mintlify", "description: Maintain repository docs.", "---", "",
      "Documentation lives in the `docs/` directory in this repo. Read `docs/docs.json`.",
      "Before writing, read `docs/docs.json` again.", "",
    ].join("\n")),
    writeFile(join(targetDir, ".agents/skills/merge-pr/SKILL.md"), [
      "---", "name: merge-pr", "description: Merge through the repository wrapper.", "---", "",
      "Wrapper commands are cwd-agnostic; run them from repo root or a worktree.",
      "`scripts/pr-merge` treats no required checks configured as acceptable.", "",
    ].join("\n")),
    writeFile(join(targetDir, ".agents/skills/local/SKILL.md"), [
      "---", "name: local", "description: Run a skill-local helper.", "---", "",
      "Run `scripts/local.sh` before completion.", "",
    ].join("\n")),
  ]);

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.recommendations.map((item) => item.defect)).toEqual([
    expect.stringContaining(".agents/skills/local/scripts/local.sh"),
  ]);
});

test("an existing repository-root script prevents an ambiguous skill-local missing claim", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-skill-root-alternative-"));
  const skillDir = join(targetDir, ".agents/skills/publisher");
  await Promise.all([
    mkdir(join(targetDir, "scripts"), { recursive: true }),
    mkdir(skillDir, { recursive: true }),
  ]);
  await writeFile(join(targetDir, "scripts/publish.py"), "print('publish')\n");
  await writeFile(join(skillDir, "SKILL.md"), [
    "---", "name: publisher", "description: Publish a repository artifact.", "---", "",
    "Run `uv run scripts/publish.py draft.md` to publish the draft.",
    "Run `uv run scripts/missing.py draft.md` to verify the upload.", "",
  ].join("\n"));

  const [report, corpus] = await Promise.all([
    auditHarness({ targetDir, mode: "quick" }),
    collectHarnessAuditCorpus(targetDir),
  ]);

  expect(report.recommendations.map((item) => item.defect)).toEqual([
    expect.stringContaining(".agents/skills/publisher/scripts/missing.py"),
  ]);
  expect(corpus.checks.find((item) => item.description.includes("publisher/scripts/publish.py"))?.result).toBe(
    "skill-local path missing; repository-root alternative scripts/publish.py: regular file exists",
  );
});
