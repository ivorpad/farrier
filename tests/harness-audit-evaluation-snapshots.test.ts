import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

test("inactive evaluation guidance snapshots are disclosed but not audited as live scope", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-inactive-evaluation-snapshots-"));
  await Promise.all([
    mkdir(join(targetDir, "claude_evals/variants/original"), { recursive: true }),
    mkdir(join(targetDir, "claude_evals/variants/improved"), { recursive: true }),
    mkdir(join(targetDir, "apps/web/docs"), { recursive: true }),
    mkdir(join(targetDir, "evals/docs"), { recursive: true }),
    mkdir(join(targetDir, "docs"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(targetDir, "docs/DESIGN.md"), "# Root design\n"),
    writeFile(join(targetDir, "apps/web/docs/live.md"), "# Live app\n"),
    writeFile(join(targetDir, "evals/docs/live.md"), "# Live eval guidance\n"),
    writeFile(join(targetDir, "apps/web/CLAUDE.md"),
      "Read `docs/live.md` before changing the web app.\n"),
    writeFile(join(targetDir, "evals/CLAUDE.md"),
      "Read `docs/live.md` before changing the live evaluation harness.\n"),
    writeFile(join(targetDir, "claude_evals/variants/original/CLAUDE.md"),
      "Read `./docs/DESIGN.md` before changing the project.\n"),
    writeFile(join(targetDir, "claude_evals/variants/improved/CLAUDE.md"),
      "Read `./docs/DESIGN.md` before changing the project.\n"),
  ]);

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });
  const documentPaths = corpus.documents.map((item) => item.path);

  expect(documentPaths).toContain("apps/web/CLAUDE.md");
  expect(documentPaths).toContain("evals/CLAUDE.md");
  expect(documentPaths).not.toContain("claude_evals/variants/original/CLAUDE.md");
  expect(documentPaths).not.toContain("claude_evals/variants/improved/CLAUDE.md");
  expect(corpus.skipped).toEqual(expect.arrayContaining([
    {
      path: "claude_evals/variants/original/CLAUDE.md",
      reason: "inactive-evaluation-snapshot",
    },
    {
      path: "claude_evals/variants/improved/CLAUDE.md",
      reason: "inactive-evaluation-snapshot",
    },
  ]));
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path apps/web/docs/live.md.",
    result: "regular file exists",
  }));
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path evals/docs/live.md.",
    result: "regular file exists",
  }));
  expect(corpus.checks.some((item) =>
    item.description.includes("claude_evals/variants"))).toBeFalse();
  expect(report.recommendations).toEqual([]);
  expect(report.metrics.modelCalls).toBe(0);
});
