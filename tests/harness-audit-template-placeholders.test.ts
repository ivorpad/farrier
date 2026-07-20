import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

describe("harness template path placeholders", () => {
  test("does not turn authoring placeholders into missing repository artifacts", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-template-paths-"));
    await writeFile(join(targetDir, "CLAUDE.md"), [
      "## Adding a New Agent",
      "1. Create `plugins/demo/agents/new-agent.md`",
      "## Adding a New Command",
      "1. Create `plugins/demo/commands/new-command.md`",
      "1. Create skill directory: `plugins/demo/skills/skill-name/`",
      "- [ ] Link files as `[filename.md](./references/filename.md)`",
      "- [ ] Link files as `[filename](./assets/filename)`",
      "- [ ] No bare references like `references/file.md`; use markdown links",
      "Example registry source: `./plugins/plugin-name`",
      "See `docs/solutions/plugin-versioning-requirements.md` for the workflow.",
      "Read `docs/examples/check.md` before release.",
      "",
    ].join("\n"));
    await mkdir(join(targetDir, "docs/solutions"), { recursive: true });

    const before = await collectHarnessAuditCorpus(targetDir);
    const placeholderLine = before.lines.find((line) => line.text.includes("new-agent.md"));
    const placeholderCheck = before.checks.find((check) =>
      check.description.includes("plugins/demo/agents/new-agent.md"));
    expect(placeholderLine).toBeDefined();
    expect(placeholderCheck).toBeUndefined();
    const missingDescriptions = before.checks
      .filter((check) => check.id.startsWith("check:path:") && check.result === "missing")
      .map((check) => check.description);
    expect(missingDescriptions).toHaveLength(2);
    expect(missingDescriptions).toContain("Checked referenced path docs/solutions/plugin-versioning-requirements.md.");
    expect(missingDescriptions).toContain("Checked referenced path docs/examples/check.md.");

    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        recommendations: [{
          id: "guidance:template-placeholder",
          layer: "guidance",
          severity: "high",
          title: "Agent creation instruction names a missing template",
          defect: "CLAUDE.md requires plugins/demo/agents/new-agent.md, but the path is missing.",
          evidence: [placeholderLine!.id],
          counterchecks: placeholderCheck ? [placeholderCheck.id] : [],
          artifact: "CLAUDE.md",
          change: "Delete the new-agent.md creation instruction.",
          risk: "Maintainers could follow a path that is not present.",
          uncertainty: "The filename may be a placeholder for a future agent.",
        }],
      }),
    });
    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations.map((item) => item.id)).not.toContain("guidance:template-placeholder");
  });
});
