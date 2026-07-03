import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyLearn,
  createLearnReport,
  deterministicRuleProposals,
  extractCandidateEvents,
  type LearnCommandRunner
} from "../src/engine/learn";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { resolvePack } from "../src/packs/index";
import type { ToolPolicyRule } from "../src/packs/types";

async function tempDir(prefix = "farrier-learn-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function renderPack(dir: string, packId = "python-fastapi"): Promise<void> {
  const pack = resolvePack(packId);
  const plan = await createRenderPlan({ targetDir: dir, pack });
  await writeRenderPlan(plan);
}

async function writeJsonl(path: string, records: Array<unknown | string>): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true }).catch(() => undefined);

  const lines = records.map((record) => (typeof record === "string" ? record : JSON.stringify(record)));
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

async function writeTranscript(dir: string, records: Array<unknown | string>, name = "session.jsonl"): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeJsonl(join(dir, name), records);
}

function bashUse(id: string, command: string): unknown {
  return {
    message: {
      content: [
        {
          type: "tool_use",
          id,
          name: "Bash",
          input: {
            command
          }
        }
      ]
    }
  };
}

function toolResult(id: string, content: string, isError = true): unknown {
  return {
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          is_error: isError,
          content
        }
      ]
    }
  };
}

async function readRules(dir: string): Promise<{ version: number; rules: ToolPolicyRule[] }> {
  return JSON.parse(await readFile(join(dir, ".claude", "hooks", "tool-policy-rules.json"), "utf8")) as {
    version: number;
    rules: ToolPolicyRule[];
  };
}

describe("learn transcript extraction", () => {
  test("extracts deny events, repeated failures, prefix-similar counts, and skips garbage lines", async () => {
    const transcripts = await tempDir("farrier-learn-transcripts-");

    await writeTranscript(transcripts, [
      bashUse("deny-1", "pip install requests"),
      toolResult("deny-1", "PermissionDecision: deny. blocked by hook: use uv instead."),
      "not json",
      bashUse("npm-1", "npm install lodash"),
      toolResult("npm-1", "exited with code 1: package manager policy failed"),
      bashUse("npm-2", "npm install express"),
      toolResult("npm-2", "failed with exit code 1")
    ]);

    const result = await extractCandidateEvents(transcripts);

    expect(result.notes).toContain("Skipped 1 malformed transcript line(s).");

    const pip = result.events.find((event) => event.command === "pip install requests");
    expect(pip).toBeDefined();
    expect(pip?.reason).toContain("blocked");

    const npmLodash = result.events.find((event) => event.command === "npm install lodash");
    const npmExpress = result.events.find((event) => event.command === "npm install express");

    expect(npmLodash).toBeDefined();
    expect(npmExpress).toBeDefined();
    expect(npmLodash!.count).toBeGreaterThanOrEqual(2);
    expect(npmExpress!.count).toBeGreaterThanOrEqual(2);
  });

  test("missing transcript directory returns a note and no candidates", async () => {
    const missing = join(await tempDir(), "missing-transcripts");

    const result = await extractCandidateEvents(missing);

    expect(result.events).toEqual([]);
    expect(result.notes[0]).toContain("Transcript directory not found or unreadable");
  });
});

describe("learn deterministic proposals", () => {
  test("synthesizes compiling ToolPolicyRule data only for repeated first-two-token prefixes", () => {
    const proposals = deterministicRuleProposals([
      {
        command: "pip install requests",
        reason: "blocked",
        count: 2
      },
      {
        command: "python",
        reason: "single token",
        count: 10
      },
      {
        command: "uv add pytest",
        reason: "single observation",
        count: 1
      }
    ]);

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      id: "learn-ban-pip-install",
      tool: "Bash",
      flags: "i"
    });

    const pattern = new RegExp(proposals[0]!.commandPattern, proposals[0]!.flags);
    expect(pattern.test("pip install requests")).toBe(true);
    expect(pattern.test("uv add requests")).toBe(false);
  });
});

describe("learn LLM proposal validation", () => {
  test("fake backend proposals keep valid matching ToolPolicyRules and drop duplicate, existing, bad regex, and missing-field rules", async () => {
    const project = await tempDir();
    const transcripts = await tempDir("farrier-learn-transcripts-");
    await renderPack(project, "python-fastapi");

    await writeTranscript(transcripts, [
      bashUse("rm-1", "rm -rf node_modules"),
      toolResult("rm-1", "exited with code 1: blocked by hook")
    ]);

    const calls: Array<{ cmd: string[]; cwd: string; stdin?: string }> = [];
    const runner: LearnCommandRunner = async (input) => {
      calls.push(input);

      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          rules: [
            {
              id: "learn-ban-rm-rf",
              description: "Avoid destructive remove commands.",
              tool: "Bash",
              commandPattern: "(^|\\s)rm\\s+-rf\\b",
              flags: "i",
              message: "Do not use rm -rf here.",
              redirect: "Ask the user before destructive removal."
            },
            {
              id: "learn-ban-rm-rf",
              description: "Duplicate proposal.",
              tool: "Bash",
              commandPattern: "rm",
              flags: "i",
              message: "duplicate",
              redirect: "duplicate"
            },
            {
              id: "python-use-uv-not-pip-install",
              description: "Existing pack-owned id.",
              tool: "Bash",
              commandPattern: "rm",
              flags: "i",
              message: "existing",
              redirect: "existing"
            },
            {
              id: "learn-bad-regex",
              description: "Bad regex.",
              tool: "Bash",
              commandPattern: "[",
              flags: "i",
              message: "bad",
              redirect: "bad"
            },
            {
              id: "learn-missing-message",
              description: "Missing message.",
              tool: "Bash",
              commandPattern: "rm"
            }
          ]
        })
      };
    };

    const report = await createLearnReport({
      targetDir: project,
      transcriptsDir: transcripts,
      runner
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toEqual(["claude", "-p", "--model", "haiku"]);
    expect(calls[0]!.cwd).toBe(project);
    expect(calls[0]!.stdin).toContain("Candidate events");

    expect(report.errors).toEqual([]);
    expect(report.proposedRules.map((rule) => rule.id)).toEqual(["learn-ban-rm-rf"]);
    expect(report.droppedProposals.map((proposal) => proposal.id)).toEqual([
      "learn-ban-rm-rf",
      "python-use-uv-not-pip-install",
      "learn-bad-regex",
      "learn-missing-message"
    ]);
    expect(report.droppedProposals.map((proposal) => proposal.reason)).toEqual([
      "rule id duplicates another proposal",
      "rule id already exists",
      expect.stringContaining("commandPattern does not compile"),
      "proposal is missing required string field message"
    ]);
  });

  test("codex learn passes reasoningEffort through to the spawned command", async () => {
    const project = await tempDir();
    const transcripts = await tempDir("farrier-learn-transcripts-");
    await renderPack(project, "python-fastapi");

    await writeTranscript(transcripts, [
      bashUse("rm-1", "rm -rf node_modules"),
      toolResult("rm-1", "exited with code 1: blocked by hook")
    ]);

    const calls: Array<{ cmd: string[]; cwd: string; stdin?: string }> = [];
    const runner: LearnCommandRunner = async (input) => {
      calls.push(input);
      return { exitCode: 0, stderr: "", stdout: JSON.stringify({ rules: [] }) };
    };

    await createLearnReport({
      targetDir: project,
      transcriptsDir: transcripts,
      backend: "codex",
      reasoningEffort: "xhigh",
      runner
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd[0]).toBe("codex");
    expect(calls[0]!.cmd.join(" ")).toContain("-c model_reasoning_effort=xhigh");
  });

  test("backend infrastructure failure falls back to deterministic proposals with a note", async () => {
    const project = await tempDir();
    const transcripts = await tempDir("farrier-learn-transcripts-");
    await renderPack(project, "python-fastapi");

    await writeTranscript(transcripts, [
      bashUse("brew-1", "brew install wget"),
      toolResult("brew-1", "exited with code 1"),
      bashUse("brew-2", "brew install jq"),
      toolResult("brew-2", "failed with exit code 1")
    ]);

    const runner: LearnCommandRunner = async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "claude: command not found"
    });

    const report = await createLearnReport({
      targetDir: project,
      transcriptsDir: transcripts,
      runner
    });

    expect(report.proposedRules.map((rule) => rule.id)).toContain("learn-ban-brew-install");
    expect(report.notes.some((note) => note.includes("fell back to deterministic proposals"))).toBe(true);
  });
});

describe("learn append behavior", () => {
  test("--yes appends accepted new rules, preserves existing rules, and does not duplicate on a second run", async () => {
    const project = await tempDir();
    const transcripts = await tempDir("farrier-learn-transcripts-");
    await renderPack(project, "python-fastapi");

    await writeTranscript(transcripts, [
      bashUse("brew-1", "brew install wget"),
      toolResult("brew-1", "exited with code 1"),
      bashUse("brew-2", "brew install jq"),
      toolResult("brew-2", "failed with exit code 1")
    ]);

    const before = await readRules(project);
    expect(before.rules.map((rule) => rule.id)).toEqual([
      "python-use-uv-not-python-m-pip",
      "python-use-uv-not-pip-install",
      "python-run-scripts-through-uv"
    ]);

    const result = await applyLearn({
      targetDir: project,
      transcriptsDir: transcripts,
      noLlm: true,
      yes: true
    });

    expect(result.appendedRules.map((rule) => rule.id)).toEqual(["learn-ban-brew-install"]);
    expect(result.rulesPath).toBe(join(project, ".claude", "hooks", "tool-policy-rules.json"));

    const after = await readRules(project);
    expect(after.version).toBe(1);
    expect(after.rules.slice(0, before.rules.length)).toEqual(before.rules);
    expect(after.rules.map((rule) => rule.id)).toEqual([
      ...before.rules.map((rule) => rule.id),
      "learn-ban-brew-install"
    ]);

    const second = await applyLearn({
      targetDir: project,
      transcriptsDir: transcripts,
      noLlm: true,
      yes: true
    });

    expect(second.appendedRules).toEqual([]);

    const finalRules = await readRules(project);
    expect(finalRules.rules.filter((rule) => rule.id === "learn-ban-brew-install")).toHaveLength(1);
  });

  test("report-only learn writes nothing", async () => {
    const project = await tempDir();
    const transcripts = await tempDir("farrier-learn-transcripts-");
    await renderPack(project, "python-fastapi");

    await writeTranscript(transcripts, [
      bashUse("brew-1", "brew install wget"),
      toolResult("brew-1", "exited with code 1"),
      bashUse("brew-2", "brew install jq"),
      toolResult("brew-2", "failed with exit code 1")
    ]);

    const beforeText = await readFile(join(project, ".claude", "hooks", "tool-policy-rules.json"), "utf8");

    const report = await createLearnReport({
      targetDir: project,
      transcriptsDir: transcripts,
      noLlm: true
    });

    const afterText = await readFile(join(project, ".claude", "hooks", "tool-policy-rules.json"), "utf8");

    expect(report.proposedRules.map((rule) => rule.id)).toEqual(["learn-ban-brew-install"]);
    expect(afterText).toBe(beforeText);
  });

  test("--yes creates a missing rules document and appends deterministic proposals", async () => {
    const project = await tempDir();
    const transcripts = await tempDir("farrier-learn-transcripts-");
    await renderPack(project, "python-fastapi");

    const rulesPath = join(project, ".claude", "hooks", "tool-policy-rules.json");
    await writeFile(rulesPath, "", "utf8");
    await Bun.$`rm ${rulesPath}`.quiet();

    await writeTranscript(transcripts, [
      bashUse("make-1", "make destroy"),
      toolResult("make-1", "exited with code 1"),
      bashUse("make-2", "make destroy"),
      toolResult("make-2", "failed with exit code 1")
    ]);

    expect(existsSync(rulesPath)).toBe(false);

    const result = await applyLearn({
      targetDir: project,
      transcriptsDir: transcripts,
      noLlm: true,
      yes: true
    });

    expect(result.appendedRules.map((rule) => rule.id)).toEqual(["learn-ban-make-destroy"]);

    const rules = await readRules(project);
    expect(rules).toMatchObject({
      version: 1
    });
    expect(rules.rules.map((rule) => rule.id)).toEqual(["learn-ban-make-destroy"]);
  });

  test("learn reports note and no proposals when transcripts are missing", async () => {
    const project = await tempDir();
    await renderPack(project, "python-fastapi");

    const report = await createLearnReport({
      targetDir: project,
      transcriptsDir: join(project, "missing-transcripts"),
      noLlm: true
    });

    expect(report.errors).toEqual([]);
    expect(report.candidateEvents).toEqual([]);
    expect(report.proposedRules).toEqual([]);
    expect(report.notes).toContain("No transcript candidates found.");
    expect(report.notes.some((note) => note.includes("Transcript directory not found or unreadable"))).toBe(true);
  });
});
