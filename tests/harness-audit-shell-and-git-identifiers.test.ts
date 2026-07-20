import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

test("home-directory paths and Git refs do not become repository counterchecks", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-external-path-identifiers-"));
  const skillDir = join(targetDir, ".agents/skills/git-ops");
  await mkdir(join(targetDir, "docs"), { recursive: true });
  await mkdir(join(skillDir, "scripts"), { recursive: true });
  await writeFile(join(targetDir, "docs/setup.md"), "# Setup\n");
  await writeFile(join(skillDir, "scripts/check.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(join(targetDir, "AGENTS.md"), [
    "Add `$HOME/Library/pnpm` to the launch PATH.",
    "A second shell may use `${HOME}/Library/Application/Support/pnpm`.",
    "A local example may use `~/Library/Application Support/pnpm`.",
    "Read `docs/setup.md` before changing launch behavior.",
    "",
  ].join("\n"));
  await writeFile(join(skillDir, "SKILL.md"), [
    "---", "name: git-ops", "description: Run a branch operation.", "---", "",
    "```json", '{"self": {"refName": "refs/heads/feature-branch"}}', "```", "",
    "Run `scripts/check.sh` before reporting the operation complete.", "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const checked = corpus.checks.filter((item) => item.id.startsWith("check:path:"));
  const homeLine = corpus.lines.find((item) => item.text.includes("$HOME/Library/pnpm"))!;
  const refLine = corpus.lines.find((item) => item.text.includes("refs/heads/feature-branch"))!;
  const homeCheck = checked.find((item) => item.description.includes("HOME/Library/pnpm"));
  const refCheck = checked.find((item) => item.description.includes("refs/heads/feature-branch"));
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [
      {
        id: "guidance:missing-home-bin",
        layer: "guidance",
        severity: "high",
        title: "Documented package-manager path is missing",
        defect: "AGENTS.md requires HOME/Library/pnpm, but that repository path is missing.",
        evidence: [homeLine.id],
        counterchecks: [homeCheck?.id ?? "check:path:home-bin"],
        artifact: "AGENTS.md",
        change: "Remove the stale HOME/Library/pnpm instruction.",
        risk: "Agents may configure an unavailable path.",
        uncertainty: "The location may be outside the repository.",
      },
      {
        id: "skill:missing-git-ref",
        layer: "skill",
        severity: "high",
        title: "Pipeline skill names a missing branch path",
        defect: "The skill requires refs/heads/feature-branch, but that repository path is missing.",
        evidence: [refLine.id],
        counterchecks: [refCheck?.id ?? "check:path:git-ref"],
        artifact: ".agents/skills/git-ops/SKILL.md",
        change: "Remove the stale refs/heads/feature-branch example.",
        risk: "Agents may use an unavailable branch path.",
        uncertainty: "The value may identify a Git branch rather than a file.",
      },
    ] }),
  });
  const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

  expect(checked.some((item) => item.description.includes("HOME/Library"))).toBeFalse();
  expect(checked.some((item) => item.description.includes("Support/pnpm"))).toBeFalse();
  expect(checked.some((item) => item.description.includes("refs/heads"))).toBeFalse();
  expect(checked).toEqual(expect.arrayContaining([
    expect.objectContaining({
      description: "Checked referenced path docs/setup.md.",
      result: "regular file exists",
    }),
    expect.objectContaining({
      description: "Checked referenced path .agents/skills/git-ops/scripts/check.sh.",
      result: "regular file exists",
    }),
  ]));
  expect(report.recommendations).toEqual([]);
  expect(report.metrics.modelCalls).toBe(1);
});
