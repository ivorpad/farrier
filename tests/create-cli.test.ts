import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-create-cli-"));
}

function repoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

async function runCli(args: string[], options: { env?: Record<string, string | undefined> } = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", join(repoRoot(), "src", "cli.ts"), ...args],
    cwd: repoRoot(),
    env: {
      ...process.env,
      FARRIER_SKILLS_BIN: `bun run ${join(repoRoot(), "tests", "fixtures", "fake-skills.ts")}`,
      ...options.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

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
  "konpy.json",
  ".farrier.json",
  ".gitignore",
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
  ".gitignore",
];

describe("creation CLI e2e", () => {
  test("writes python-fastapi harness into target directory", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "python-fastapi", "--yes", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Applied 23 file change(s); 0 unchanged.");
    expect(result.stdout).toContain("Skills: installed 3 of 3");

    for (const file of pythonFastapiFiles) {
      expect(existsSync(join(dir, file))).toBe(true);
    }

    const manifest = JSON.parse(await readFile(join(dir, ".farrier.json"), "utf8"));
    expect(manifest.farrierVersion).toBe("0.1.0");
    expect(manifest.secondaryAcknowledged).toEqual([]);
    expect(existsSync(join(dir, "skills-lock.json"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills", "python-code-style", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents", "skills", "python-code-style", "SKILL.md"))).toBe(true);
  });

  test("dry-run prints python-fastapi inventory and writes nothing", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "python-fastapi", "--dry-run", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("File actions: 23 create");
    expect(result.stdout).toContain("Dry run: nothing was written.");

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
      "utf8",
    );

    const result = await runCli(["--detect", "--yes", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Selected stack: python-fastapi (detected");
    expect(result.stdout).toContain("Applied 23 file change(s); 0 unchanged.");

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
      "utf8",
    );

    const result = await runCli(["--detect", "--dry-run", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("File actions: 23 create");
    expect(result.stdout).toContain("pyproject.toml dependency: fastapi");
    expect(result.stdout).toContain(".claude/skills/harness-advisor/SKILL.md");
    expect(result.stdout).toContain("konpy.json");
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

  test("--json keeps preflight failures machine-readable", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "README.md"), "# unknown\n", "utf8");

    const result = await runCli(["--detect", "--dry-run", "--json", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ schemaVersion: 1, operation: "create", ok: false, written: false });
    expect(report.error).toContain("No stack detected");
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
    expect(result.stdout).toContain("File actions: 22 create");

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
    expect(result.stdout).toContain("File actions: 17 create");
    expect(result.stdout).toContain("AGENTS.md");
    expect(result.stdout).toContain(".claude/skills/harness-advisor/SKILL.md");
    expect(result.stdout).toContain(".claude/hooks/quality-judge.py");
    expect(result.stdout).toContain(".claude/hooks/tool-policy-rules.json");
    expect(result.stdout).not.toContain("konsistent.json");
    expect(result.stdout).not.toContain(".claude/hooks/verb-runner.py");
    expect(result.stdout).not.toContain(".claude/hooks/stop-judge.py");

    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  test("dry-run classifies existing files and confirmed creation refuses replacements before any write", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "AGENTS.md"), "# Team instructions\nNever deploy on Friday.\n", "utf8");
    await writeFile(join(dir, "justfile"), "check:\n  go test ./...\n", "utf8");

    const preview = await runCli(["--stack", "generic", "--dry-run", "--dir", dir]);

    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain("2 replace");
    expect(preview.stdout).toContain("! AGENTS.md");
    expect(preview.stdout).toContain("! justfile");
    expect(preview.stdout).toContain("require explicit replacement");

    const apply = await runCli(["--stack", "generic", "--yes", "--dir", dir]);

    expect(apply.exitCode).toBe(1);
    expect(apply.stderr).toContain("--force");
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# Team instructions\nNever deploy on Friday.\n");
    expect(await readFile(join(dir, "justfile"), "utf8")).toBe("check:\n  go test ./...\n");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);

    const jsonApply = await runCli(["--stack", "generic", "--yes", "--json", "--dir", dir]);
    const report = JSON.parse(jsonApply.stdout);
    expect(jsonApply.exitCode).toBe(1);
    expect(jsonApply.stderr).toBe("");
    expect(report).toMatchObject({ ok: false, written: false, mutationState: "not-started", retainedBackupDir: null });
  });

  test("--force replaces reviewed conflicts and keeps recoverable backups", async () => {
    const dir = await tempDir();
    const originalAgents = "# Team instructions\nNever deploy on Friday.\n";
    await writeFile(join(dir, "AGENTS.md"), originalAgents, "utf8");

    const result = await runCli(["--stack", "generic", "--yes", "--force", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Backups:");
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toContain("# Project Agent Instructions");

    const backupRoots = await readdir(join(dir, ".farrier-staging", "backups"));
    expect(backupRoots).toHaveLength(1);
    expect(await readFile(join(dir, ".farrier-staging", "backups", backupRoots[0]!, "AGENTS.md"), "utf8")).toBe(originalAgents);
  });

  test("creation refuses an existing Farrier manifest even with --force and preserves lifecycle settings", async () => {
    const dir = await tempDir();
    const first = await runCli(["--stack", "generic", "--yes", "--dir", dir]);
    expect(first.exitCode).toBe(0);

    const manifestPath = join(dir, ".farrier.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.learn.enabled = true;
    manifest.quality.maxFileLines = 123;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const before = await readFile(manifestPath, "utf8");

    const result = await runCli(["--stack", "generic", "--yes", "--force", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already a Farrier project");
    expect(result.stderr).toContain("farrier update");
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  });

  test("path blockers are reported before force can partially mutate the repository", async () => {
    const dir = await tempDir();
    const originalAgents = "# Keep me\n";
    await writeFile(join(dir, "AGENTS.md"), originalAgents, "utf8");
    await writeFile(join(dir, ".claude"), "not a directory\n", "utf8");

    const result = await runCli(["--stack", "generic", "--yes", "--force", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("blocked");
    expect(result.stderr).toContain(".claude");
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe(originalAgents);
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
  });

  test("creation dry-run JSON exposes selection evidence harness behavior and file actions", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "pyproject.toml"), `[project]\nname = "example"\ndependencies = ["fastapi"]\n`, "utf8");

    const result = await runCli(["--detect", "--dry-run", "--json", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.operation).toBe("create");
    expect(report.mode).toBe("preview");
    expect(report.stack.selected).toBe("python-fastapi");
    expect(report.stack.detected[0].evidence).toContain("pyproject.toml dependency: fastapi");
    expect(report.harnessBehavior.skillAction).toBe("install");
    expect(report.summary.create).toBe(23);
    expect(report.applicable).toBe(true);
    expect(report.files.find((file: { path: string }) => file.path === "AGENTS.md").purpose).toContain("instructions");
    expect(report.written).toBe(false);
  });

  test("creation apply JSON reports the applied files and final state", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "generic", "--yes", "--json", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ mode: "apply", ok: true, written: true, applicable: true });
    expect(report.applied.writtenFiles).toHaveLength(17);
    expect(report.applied.unchangedFiles).toEqual([]);
    expect(report.applied.backupDir).toBeNull();
  });

  test("headless skill failure is an explicit partial result with a retry command", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "python-fastapi", "--yes", "--dir", dir], {
      env: { FARRIER_SKILLS_BIN: "false" },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Applied 23 file change(s)");
    expect(result.stdout).toContain("Skills: installed 0 of 3");
    expect(result.stdout).toContain("retry: skills add");
    expect(existsSync(join(dir, ".farrier.json"))).toBe(true);
  });

  test("JSON skill failures preserve the partial-write state and include per-skill retries", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "python-fastapi", "--yes", "--json", "--dir", dir], {
      env: { FARRIER_SKILLS_BIN: "false" },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ ok: false, written: true });
    expect(report.skills.results).toHaveLength(3);
    expect(report.skills.results.every((skill: { retryCommand?: string }) => skill.retryCommand?.startsWith("skills add "))).toBe(true);
  });

  test("--no-skills keeps offline headless creation deterministic and says what was skipped", async () => {
    const dir = await tempDir();

    const result = await runCli(["--stack", "python-fastapi", "--yes", "--no-skills", "--dir", dir], {
      env: { FARRIER_SKILLS_BIN: "false" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Skills: skipped 3 selected skill(s) by request.");
    expect(existsSync(join(dir, "skills-lock.json"))).toBe(false);
    const manifest = JSON.parse(await readFile(join(dir, ".farrier.json"), "utf8"));
    expect(manifest.skills).toHaveLength(3);
  });
});
