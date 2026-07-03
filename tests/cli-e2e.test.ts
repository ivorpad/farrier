import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-cli-"));
}

function repoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

async function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", join(repoRoot(), "src", "cli.ts"), ...args],
    cwd: repoRoot(),
    stdout: "pipe",
    stderr: "pipe"
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ]);

  return { exitCode, stdout, stderr };
}

const pythonFastapiFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/settings.json",
  ".claude/skills/harness-advisor/SKILL.md",
  ".claude/hooks/secret-shield.py",
  ".claude/hooks/test_secret_shield.py",
  ".claude/hooks/tool-policy.py",
  ".claude/hooks/test_tool_policy.py",
  ".claude/hooks/write-guard.py",
  ".claude/hooks/test_write_guard.py",
  ".claude/hooks/verb-runner.py",
  ".claude/hooks/test_verb_runner.py",
  ".claude/hooks/quality-judge.py",
  ".claude/hooks/test_quality_judge.py",
  ".claude/hooks/stop-judge.py",
  ".claude/hooks/test_stop_judge.py",
  ".claude/hooks/tool-policy-rules.json",
  ".claude/hooks/prompts/quality-judge-v1.txt",
  ".claude/hooks/prompts/stop-judge-v1.txt",
  "justfile",
  "konsistent.json",
  ".farrier.json",
  ".gitignore"
];

const railsFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/settings.json",
  ".claude/skills/harness-advisor/SKILL.md",
  ".claude/hooks/secret-shield.py",
  ".claude/hooks/test_secret_shield.py",
  ".claude/hooks/tool-policy.py",
  ".claude/hooks/test_tool_policy.py",
  ".claude/hooks/write-guard.py",
  ".claude/hooks/test_write_guard.py",
  ".claude/hooks/verb-runner.py",
  ".claude/hooks/test_verb_runner.py",
  ".claude/hooks/quality-judge.py",
  ".claude/hooks/test_quality_judge.py",
  ".claude/hooks/stop-judge.py",
  ".claude/hooks/test_stop_judge.py",
  ".claude/hooks/tool-policy-rules.json",
  ".claude/hooks/prompts/quality-judge-v1.txt",
  ".claude/hooks/prompts/stop-judge-v1.txt",
  "justfile",
  ".farrier.json",
  ".gitignore"
];

describe("CLI e2e", () => {
  test("writes python-fastapi harness into target directory", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "python-fastapi", "--yes", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Wrote 23 farrier harness files");

    for (const file of pythonFastapiFiles) {
      expect(existsSync(join(dir, file))).toBe(true);
    }

    const manifest = JSON.parse(await readFile(join(dir, ".farrier.json"), "utf8"));
    expect(manifest.farrierVersion).toBe("0.1.0");
    expect(manifest.secondaryAcknowledged).toEqual([]);
  });

  test("dry-run prints python-fastapi inventory and writes nothing", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "python-fastapi", "--dry-run", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Dry run: would write 23 files");

    for (const file of pythonFastapiFiles) {
      expect(result.stdout).toContain(file);
      expect(existsSync(join(dir, file))).toBe(false);
    }
  });

  test("--detect writes most-specific FastAPI harness", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "pyproject.toml"),
      `[project]
name = "example"
dependencies = [
  "fastapi>=0.110",
  "pytest"
]
`,
      "utf8"
    );

    const result = await runCli(["--detect", "--yes", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Wrote 23 farrier harness files");

    for (const file of pythonFastapiFiles) {
      expect(existsSync(join(dir, file))).toBe(true);
    }

    const manifest = JSON.parse(await readFile(join(dir, ".farrier.json"), "utf8"));
    expect(manifest.packIds).toEqual(["python-uv", "python-fastapi"]);
  });

  test("--detect dry-run prints FastAPI inventory and writes nothing", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "pyproject.toml"),
      `[project]
name = "example"
dependencies = ["fastapi"]
`,
      "utf8"
    );

    const result = await runCli(["--detect", "--dry-run", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Dry run: would write 23 files");
    expect(result.stdout).toContain(".claude/skills/harness-advisor/SKILL.md");
    expect(result.stdout).toContain("konsistent.json");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  test("--detect errors clearly when no stack matches", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "README.md"), "# unknown\n", "utf8");

    const result = await runCli(["--detect", "--dry-run", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No stack detected");
    expect(result.stderr).toContain("Use --stack generic");
  });

  test("rejects --detect combined with --stack", async () => {
    const dir = await tempDir();

    const result = await runCli(["--detect", "--stack", "generic", "--dry-run", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--detect and --stack are mutually exclusive");
  });

  test("dry-run rails omits konsistent artifacts", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "rails", "--dry-run", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Dry run: would write 22 files");

    for (const file of railsFiles) {
      expect(result.stdout).toContain(file);
      expect(existsSync(join(dir, file))).toBe(false);
    }

    expect(result.stdout).not.toContain("konsistent.json");
  });

  test("dry-run generic omits stop hook and konsistent inventory", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "generic", "--dry-run", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Dry run: would write 17 files");
    expect(result.stdout).toContain("AGENTS.md");
    expect(result.stdout).toContain(".claude/skills/harness-advisor/SKILL.md");
    expect(result.stdout).toContain(".claude/hooks/quality-judge.py");
    expect(result.stdout).toContain(".claude/hooks/tool-policy-rules.json");
    expect(result.stdout).not.toContain("konsistent.json");
    expect(result.stdout).not.toContain(".claude/hooks/verb-runner.py");
    expect(result.stdout).not.toContain(".claude/hooks/stop-judge.py");

    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  test("rejects writes without --yes", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "python-fastapi", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Refusing to write without --yes");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  test("rejects unsupported stacks and lists registered M4 packs", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "unknown", "--dry-run", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unsupported stack 'unknown'");
    expect(result.stderr).toContain("generic");
    expect(result.stderr).toContain("python-lambda-powertools");
    expect(result.stderr).toContain("rails");
    expect(result.stderr).toContain("ts-react-vite");
    expect(result.stderr).toContain("ts-nextjs");
    expect(result.stderr).toContain("ts-lambda");
  });

  test("update errors for non-farrier projects", async () => {
    const dir = await tempDir();

    const result = await runCli(["update", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("not a farrier project; run farrier first");
  });

  test("doctor errors for non-farrier projects with grouped report", async () => {
    const dir = await tempDir();

    const result = await runCli(["doctor", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Farrier doctor report");
    expect(result.stdout).toContain("Health: unhealthy");
    expect(result.stdout).toContain("not a farrier project; run farrier first");
  });

  test("update --json emits machine-readable report", async () => {
    const dir = await tempDir();

    const render = await runCli(["--stack", "generic", "--yes", "--dir", dir]);
    expect(render.exitCode).toBe(0);

    const result = await runCli(["update", "--dir", dir, "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    const report = JSON.parse(result.stdout);
    expect(report.currentPackId).toBe("generic");
    expect(report.outdatedOwnedFiles).toEqual([]);
    expect(report.outdatedUserFiles).toEqual([]);
    expect(report.missingInventoryFiles).toEqual([]);
  });

  test("doctor --json emits machine-readable health report", async () => {
    const dir = await tempDir();

    const render = await runCli(["--stack", "generic", "--yes", "--dir", dir]);
    expect(render.exitCode).toBe(0);

    const result = await runCli(["doctor", "--dir", dir, "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    const report = JSON.parse(result.stdout);
    expect(report.healthy).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.problemsByGroup.manifest).toEqual([]);
    expect(report.problemsByGroup["tool-policy"]).toEqual([]);
  });

  test("learn report-only mode exits successfully and writes nothing", async () => {
    const dir = await tempDir();

    const render = await runCli(["--stack", "generic", "--yes", "--dir", dir]);
    expect(render.exitCode).toBe(0);

    const rulesPath = join(dir, ".claude", "hooks", "tool-policy-rules.json");
    const before = await readFile(rulesPath, "utf8");

    const result = await runCli([
      "learn",
      "--dir",
      dir,
      "--transcripts",
      join(dir, "missing-transcripts"),
      "--no-llm"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Farrier learn report");
    expect(result.stdout).toContain("No transcript candidates found.");
    expect(result.stdout).toContain("No files were changed");

    const after = await readFile(rulesPath, "utf8");
    expect(after).toBe(before);
  });

  test("help documents update learn doctor and detect", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("farrier update --dir <target> [--yes] [--json]");
    expect(result.stdout).toContain("farrier learn --dir <target>");
    expect(result.stdout).toContain("farrier doctor --dir <target> [--json]");
    expect(result.stdout).toContain("--detect");
    expect(result.stdout).toContain("--transcripts");
    expect(result.stdout).toContain("--no-llm");
    expect(result.stdout).toContain("--json");
  });

  test("learn and doctor subcommand help show usage", async () => {
    const learn = await runCli(["learn", "--help"]);
    expect(learn.exitCode).toBe(0);
    expect(learn.stderr).toBe("");
    expect(learn.stdout).toContain("farrier learn --dir <target>");
    expect(learn.stdout).toContain("ToolPolicyRule");

    const doctor = await runCli(["doctor", "--help"]);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stderr).toBe("");
    expect(doctor.stdout).toContain("farrier doctor --dir <target> [--json]");
    expect(doctor.stdout).toContain("farrier doctor exits 0 when healthy");
  });

  test("bare CLI reports TTY boundary in non-TTY mode", async () => {
    const result = await runCli([]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Bare TUI wizard mode requires a TTY");
  });
});
