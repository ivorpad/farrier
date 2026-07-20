import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";
import { validateHarnessAuditResponse } from "../src/engine/harness-audit-model";

describe("prospective harness paths", () => {
  test("does not treat a skill's creation target as a missing current artifact", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-prospective-path-"));
    await mkdir(join(targetDir, ".claude/skills/add-telegram"), { recursive: true });
    await mkdir(join(targetDir, "src/channels"), { recursive: true });
    await mkdir(join(targetDir, "container/skills/agent-browser"), { recursive: true });
    await writeFile(join(targetDir, "src/channels/whatsapp.ts"), "export class WhatsAppChannel {}\n");
    await writeFile(join(targetDir, "container/skills/agent-browser/SKILL.md"), "# Agent Browser\n");
    await writeFile(join(targetDir, "CLAUDE.md"), [
      "| File | Purpose |",
      "| --- | --- |",
      "| `container/skills/agent-browser.md` | Browser automation |",
      "",
    ].join("\n"));
    await writeFile(join(targetDir, ".claude/skills/add-telegram/SKILL.md"), [
      "---",
      "name: add-telegram",
      "description: Add Telegram as an optional channel.",
      "---",
      "# Add Telegram",
      "Create `src/channels/telegram.ts` implementing the channel interface.",
      "Use `src/channels/whatsapp.ts` as the reference implementation.",
      "",
    ].join("\n"));

    const corpus = await collectHarnessAuditCorpus(targetDir);
    const prospectiveLine = corpus.lines.find((line) => line.text.startsWith("Create `src/channels/telegram.ts`"))!;
    const staleLine = corpus.lines.find((line) => line.text.includes("container/skills/agent-browser.md"))!;
    const prospectiveCheck = corpus.checks.find((check) =>
      check.description === "Checked referenced path src/channels/telegram.ts.");
    const staleCheck = corpus.checks.find((check) =>
      check.description === "Checked referenced path container/skills/agent-browser.md.")!;

    expect(prospectiveCheck).toBeUndefined();
    expect(staleCheck.result).toBe("missing");
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ recommendations: [
        {
          id: "skill:telegram-file-missing",
          layer: "skill",
          severity: "high",
          title: "Telegram channel file is missing",
          defect: "The skill requires src/channels/telegram.ts, but the file is missing.",
          evidence: [prospectiveLine.id],
          counterchecks: prospectiveCheck ? [prospectiveCheck.id] : [],
          artifact: prospectiveLine.path,
          change: "Delete the instruction that creates src/channels/telegram.ts.",
          risk: "The optional integration procedure could be mistaken for an installed feature.",
          uncertainty: "The Telegram integration may not have been requested.",
        },
        {
          id: "guidance:agent-browser-path-stale",
          layer: "guidance",
          severity: "high",
          title: "Agent Browser guidance names a stale path",
          defect: "CLAUDE.md names missing container/skills/agent-browser.md instead of the installed skill path.",
          evidence: [staleLine.id],
          counterchecks: [staleCheck.id],
          artifact: staleLine.path,
          change: "Replace `container/skills/agent-browser.md` with `container/skills/agent-browser/SKILL.md`.",
          risk: "Maintainers cannot open the documented Agent Browser definition.",
          uncertainty: "The path was checked statically; the skill was not executed.",
        },
      ] }),
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations.map((item) => item.id)).toEqual(["guidance:agent-browser-path-stale"]);
  });

  test("resolves a shortened path only from the same document's exact existing reference", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-short-path-"));
    await mkdir(join(targetDir, ".claude/skills/add-parallel"), { recursive: true });
    await mkdir(join(targetDir, "container/agent-runner/src"), { recursive: true });
    await writeFile(join(targetDir, "container/agent-runner/src/index.ts"), "export const runner = true;\n");
    await writeFile(join(targetDir, ".claude/skills/add-parallel/SKILL.md"), [
      "---",
      "name: add-parallel",
      "description: Add the optional Parallel integration.",
      "---",
      "Update `container/agent-runner/src/index.ts` when installing the integration.",
      "To uninstall it, revert changes to agent-runner/src/index.ts.",
      "Read `docs/missing-runbook.md` before changing production settings.",
      "",
    ].join("\n"));

    const corpus = await collectHarnessAuditCorpus(targetDir);
    const shortened = corpus.checks.find((check) =>
      check.description === "Checked referenced path agent-runner/src/index.ts.");
    const positive = corpus.checks.find((check) =>
      check.description.endsWith("docs/missing-runbook.md."));

    expect(shortened?.result).toBe(
      "short path missing; same-document full path container/agent-runner/src/index.ts: regular file exists",
    );
    expect(positive?.result).toBe("missing");
  });

  test("does not treat a workflow input as currently missing when the guide creates or obtains it first", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-prospective-input-"));
    await mkdir(join(targetDir, ".taskmaster"), { recursive: true });
    await writeFile(join(targetDir, ".taskmaster/CLAUDE.md"), [
      "# Project Setup",
      "task-master parse-prd .taskmaster/docs/prd.md",
      "",
      "# Detailed Setup",
      "# Create or obtain PRD, then parse it",
      "task-master parse-prd .taskmaster/docs/prd.md",
      "Read `.taskmaster/docs/required.md` before changing configured tasks.",
      ...Array.from({ length: 400 }, (_, index) => `Workflow note ${index + 1}.`),
      "",
    ].join("\n"));

    const corpus = await collectHarnessAuditCorpus(targetDir);
    const prdLine = corpus.lines.find((line) => line.line === 6)!;
    const requiredLine = corpus.lines.find((line) => line.text.includes("docs/required.md"))!;
    const prdCheck = corpus.checks.find((check) =>
      check.description === "Checked referenced path .taskmaster/docs/prd.md.")!;
    const requiredCheck = corpus.checks.find((check) =>
      check.description === "Checked referenced path .taskmaster/docs/required.md.")!;
    const recommendations = [
      {
        id: "guidance:prd-input-missing",
        layer: "guidance",
        severity: "high",
        title: "PRD input is missing",
        defect: "The setup guide consumes .taskmaster/docs/prd.md, but that path is missing.",
        evidence: [prdLine.id],
        counterchecks: [prdCheck.id],
        artifact: prdLine.path,
        change: "Remove the PRD parse step until the input exists.",
        risk: "The setup command cannot run without its input.",
        uncertainty: "The workflow was inspected statically and was not executed.",
      },
      {
        id: "guidance:required-input-missing",
        layer: "guidance",
        severity: "high",
        title: "Required task input is missing",
        defect: "The guide requires .taskmaster/docs/required.md, but that path is missing.",
        evidence: [requiredLine.id],
        counterchecks: [requiredCheck.id],
        artifact: requiredLine.path,
        change: "Remove the cited prerequisite until its file exists and has been reviewed.",
        risk: "Maintainers cannot complete the documented prerequisite.",
        uncertainty: "The repository path was checked statically; intent was not executed.",
      },
    ];
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ recommendations }),
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });
    const preCorrection = validateHarnessAuditResponse({
      parsed: { recommendations },
      corpus: {
        ...corpus,
        checks: corpus.checks.map((check) => check.id === prdCheck.id ? { ...check, result: "missing" } : check),
      },
      deterministic: [],
    });

    expect(corpus.skipped).toContainEqual({ path: ".taskmaster/CLAUDE.md", reason: "line-limit" });
    expect(preCorrection.recommendations.map((item) => item.id)).toContain("guidance:prd-input-missing");
    expect(prdCheck.result).toBe(
      "missing; .taskmaster/CLAUDE.md:5 creates or obtains the input before .taskmaster/CLAUDE.md:6 uses it",
    );
    expect(requiredCheck.result).toBe("missing");
    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0]?.defect).toContain(".taskmaster/docs/required.md");
    expect(report.notes.some((note) => note.includes("prd-input-missing"))).toBeTrue();
  });

  test("does not treat an optional add-to target as a missing current configuration", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-add-to-target-"));
    await writeFile(join(targetDir, "CLAUDE.md"), [
      "### Claude Code Integration Files",
      "- `.claude/settings.json` - Claude Code tool allowlist and preferences",
      "## Tool Allowlist Recommendations",
      "Add to `.claude/settings.json`:",
      "Read `.claude/required.json` before changing required hooks.",
      "",
    ].join("\n"));

    const corpus = await collectHarnessAuditCorpus(targetDir);
    const settingsLine = corpus.lines.find((line) => line.text.startsWith("Add to"))!;
    const requiredLine = corpus.lines.find((line) => line.text.includes("required.json"))!;
    const settingsCheck = corpus.checks.find((check) =>
      check.description === "Checked referenced path .claude/settings.json.")!;
    const requiredCheck = corpus.checks.find((check) =>
      check.description === "Checked referenced path .claude/required.json.")!;
    const recommendations = [
      {
        id: "guidance:optional-settings-missing",
        layer: "guidance",
        severity: "high",
        title: "Optional settings file is missing",
        defect: "The recommendations name .claude/settings.json, but that path is missing.",
        evidence: [settingsLine.id],
        counterchecks: [settingsCheck.id],
        artifact: settingsLine.path,
        change: "Remove the allowlist recommendation until the target exists.",
        risk: "Maintainers could mistake the optional setup for installed configuration.",
        uncertainty: "The optional setup was not executed.",
      },
      {
        id: "guidance:required-settings-missing",
        layer: "guidance",
        severity: "high",
        title: "Required settings file is missing",
        defect: "The guide requires .claude/required.json, but that path is missing.",
        evidence: [requiredLine.id],
        counterchecks: [requiredCheck.id],
        artifact: requiredLine.path,
        change: "Remove the cited prerequisite until its file exists and has been reviewed.",
        risk: "Maintainers cannot complete the documented prerequisite.",
        uncertainty: "The repository path was checked statically; intent was not executed.",
      },
    ];
    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ recommendations }),
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });
    const preCorrection = validateHarnessAuditResponse({
      parsed: { recommendations },
      corpus: {
        ...corpus,
        checks: corpus.checks.map((check) =>
          check.id === settingsCheck.id ? { ...check, result: "missing" } : check),
      },
      deterministic: [],
    });

    expect(preCorrection.recommendations.map((item) => item.id)).toContain("guidance:optional-settings-missing");
    expect(settingsCheck.result).toBe("missing; CLAUDE.md:4 treats this path as an add-to workflow target");
    expect(requiredCheck.result).toBe("missing");
    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0]?.defect).toContain(".claude/required.json");
    expect(report.notes.some((note) => note.includes("optional-settings-missing"))).toBeTrue();
  });
});
