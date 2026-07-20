import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

async function writeSkill(targetDir: string, name: string, body: string): Promise<void> {
  const directory = join(targetDir, ".agents/skills", name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: Exercise ${name} path resolution.`,
    "---",
    "",
    body,
    "",
  ].join("\n"));
}

test("explicit relative skill paths preserve their owning root", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-skill-explicit-relative-"));
  await Promise.all([
    mkdir(join(targetDir, ".agents/skills/browser/templates"), { recursive: true }),
    mkdir(join(targetDir, ".agents/skills/shared"), { recursive: true }),
    mkdir(join(targetDir, "scripts"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(targetDir, ".agents/skills/browser/templates/form.sh"), "#!/bin/sh\n"),
    writeFile(join(targetDir, ".agents/skills/shared/tool.sh"), "#!/bin/sh\n"),
    writeFile(join(targetDir, "scripts/check.sh"), "#!/bin/sh\n"),
    writeSkill(targetDir, "browser", "Run `./templates/form.sh` to fill the form."),
    writeSkill(targetDir, "consumer", "Run `../shared/tool.sh` to inspect shared state."),
    writeSkill(targetDir, "rooted", "From the repository root, run `./scripts/check.sh`."),
  ]);
  const corpus = await collectHarnessAuditCorpus(targetDir);

  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path .agents/skills/browser/templates/form.sh.",
    result: "regular file exists",
  }));
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path .agents/skills/shared/tool.sh.",
    result: "regular file exists",
  }));
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path scripts/check.sh.",
    result: "regular file exists",
  }));
  expect(corpus.checks.some((item) =>
    item.description === "Checked referenced path templates/form.sh.")).toBeFalse();
});

test("a missing explicit relative path remains an exact skill finding", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-skill-explicit-missing-"));
  await writeSkill(targetDir, "browser", "Run `./templates/missing.sh` before completion.");
  const [corpus, report] = await Promise.all([
    collectHarnessAuditCorpus(targetDir),
    auditHarness({ targetDir, mode: "quick" }),
  ]);

  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path .agents/skills/browser/templates/missing.sh.",
    result: "missing",
  }));
  expect(report.recommendations).toHaveLength(1);
  expect(report.recommendations[0]).toEqual(expect.objectContaining({
    layer: "skill",
    proposal: expect.objectContaining({ artifact: ".agents/skills/browser/SKILL.md" }),
    counterchecks: expect.arrayContaining([
      expect.objectContaining({
        description: "Checked referenced path .agents/skills/browser/templates/missing.sh.",
        result: "missing",
      }),
    ]),
  }));
});
