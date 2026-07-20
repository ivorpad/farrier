import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

test("Claude project-root hook paths resolve inside the repository", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-project-root-hook-"));
  await mkdir(join(targetDir, ".claude/hooks"), { recursive: true });
  await writeFile(join(targetDir, ".claude/hooks/live.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(join(targetDir, ".claude/hooks/braced.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(join(targetDir, ".claude/settings.json"), JSON.stringify({
    hooks: {
      PreToolUse: [{ hooks: [
        { type: "command", command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/live.sh"' },
        { type: "command", command: '"${CLAUDE_PROJECT_DIR}/.claude/hooks/braced.sh"' },
        { type: "command", command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/missing.sh"' },
      ] }],
    },
  }, null, 2));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });
  const pathChecks = corpus.checks.filter((check) => check.id.startsWith("check:path:"));

  expect(pathChecks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      description: "Checked referenced path .claude/hooks/live.sh.",
      result: "regular file exists",
    }),
    expect.objectContaining({
      description: "Checked referenced path .claude/hooks/braced.sh.",
      result: "regular file exists",
    }),
    expect.objectContaining({
      description: "Checked referenced path .claude/hooks/missing.sh.",
      result: "missing",
    }),
  ]));
  expect(pathChecks.some((check) => check.description.includes("CLAUDE_PROJECT_DIR"))).toBeFalse();
  expect(report.recommendations).toHaveLength(1);
  expect(report.recommendations[0]).toEqual(expect.objectContaining({
    layer: "hook",
    severity: "blocking",
    defect: expect.stringContaining(".claude/hooks/missing.sh"),
  }));
});

test("Task Master paths resolve from the repository root without changing local guidance paths", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-taskmaster-root-"));
  await mkdir(join(targetDir, ".taskmaster/tasks"), { recursive: true });
  await mkdir(join(targetDir, "packages/demo/docs"), { recursive: true });
  await writeFile(join(targetDir, ".taskmaster/tasks/tasks.json"), "{}\n");
  await writeFile(join(targetDir, "packages/demo/docs/local.md"), "# Local notes\n");
  await writeFile(join(targetDir, "packages/demo/CLAUDE.md"), [
    "Read `.taskmaster/tasks/tasks.json` for the repository task state.",
    "Read `docs/local.md` for package-specific notes.",
    "Read `docs/missing.md` before changing the package.",
    "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const pathChecks = corpus.checks.filter((check) => check.id.startsWith("check:path:"));
  const taskLine = corpus.lines.find((line) => line.text.includes(".taskmaster/tasks/tasks.json"))!;
  const missingLine = corpus.lines.find((line) => line.text.includes("docs/missing.md"))!;
  const taskCheck = pathChecks.find((check) =>
    check.description === "Checked referenced path .taskmaster/tasks/tasks.json.")!;
  const missingCheck = pathChecks.find((check) =>
    check.description === "Checked referenced path packages/demo/docs/missing.md.")!;

  expect(pathChecks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      description: "Checked referenced path .taskmaster/tasks/tasks.json.",
      result: "regular file exists",
    }),
    expect.objectContaining({
      description: "Checked referenced path packages/demo/docs/local.md.",
      result: "regular file exists",
    }),
  ]));
  expect(pathChecks.some((check) =>
    check.description.includes("packages/demo/.taskmaster/tasks/tasks.json"))).toBeFalse();

  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [
      {
        id: "guidance:taskmaster-path-missing",
        layer: "guidance",
        severity: "high",
        title: "Task Master state path is missing",
        defect: "The guidance requires .taskmaster/tasks/tasks.json, but that path is missing.",
        evidence: [taskLine.id],
        counterchecks: [taskCheck.id],
        artifact: taskLine.path,
        change: "Remove the Task Master state instruction until the file exists.",
        risk: "Maintainers could follow a stale task-state instruction.",
        uncertainty: "The repository path was checked statically.",
      },
      {
        id: "guidance:package-document-missing",
        layer: "guidance",
        severity: "high",
        title: "Required package document is missing",
        defect: "The guidance requires packages/demo/docs/missing.md, but that path is missing.",
        evidence: [missingLine.id],
        counterchecks: [missingCheck.id],
        artifact: missingLine.path,
        change: "Remove the cited prerequisite until its file exists and has been reviewed.",
        risk: "Maintainers cannot complete the documented prerequisite.",
        uncertainty: "The repository path was checked statically; intent was not executed.",
      },
    ] }),
  });
  const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

  expect(report.recommendations.map((item) => item.id)).toEqual(["guidance:package-document-missing"]);
  expect(report.notes.some((note) => note.includes("taskmaster-path-missing"))).toBeTrue();
});
