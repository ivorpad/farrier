import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillEvalArgs } from "../src/cli/skill-eval";
import { isGrillFinish, parseSkillNewArgs, resolveRefineAnswer } from "../src/cli/skill-new";
import { loadFarrierConfig, resolveModelSettings } from "../src/config/farrier-config";
import { createSkill } from "../src/engine/create-skill";
import type { BackendCommandRunner, BackendCommandRunnerInput } from "../src/engine/backend";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-skill-new-"));
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

describe("parseSkillNewArgs", () => {
  test("takes a positional description and both flag forms", () => {
    const options = parseSkillNewArgs([
      "Extract IBANs",
      "--dir",
      "/tmp/x",
      "--agents=claude,codex",
      "--mode",
      "per-agent",
      "--name=iban-extractor",
      "--model",
      "sonnet",
      "--no-llm",
      "--refine",
      "--force",
      "--no-install",
      "--dry-run",
      "-y",
      "--eval",
      "--json"
    ]);

    expect(options.description).toBe("Extract IBANs");
    expect(options.dir).toBe("/tmp/x");
    expect(options.agents).toEqual(["claude", "codex"]);
    expect(options.mode).toBe("per-agent");
    expect(options.name).toBe("iban-extractor");
    expect(options.model).toBe("sonnet");
    expect(options.noLlm).toBe(true);
    expect(options.refine).toBe(true);
    expect(options.force).toBe(true);
    expect(options.noInstall).toBe(true);
    expect(options.dryRun).toBe(true);
    expect(options.yes).toBe(true);
    expect(options.eval).toBe(true);
    expect(options.json).toBe(true);
  });

  test("resolveRefineAnswer maps blank to creator-decides, numbers to options, text to itself", () => {
    const options = ["pdfplumber", "camelot"];
    expect(resolveRefineAnswer("", options)).toBe("");
    expect(resolveRefineAnswer("  ", options)).toBe("");
    expect(resolveRefineAnswer("1", options)).toBe("pdfplumber");
    expect(resolveRefineAnswer("2", options)).toBe("camelot");
    expect(resolveRefineAnswer("3", options)).toBe("3");
    expect(resolveRefineAnswer("use tabula instead", options)).toBe("use tabula instead");
  });

  test("isGrillFinish treats a bare q (any case, trimmed) as done and nothing else", () => {
    expect(isGrillFinish("q")).toBe(true);
    expect(isGrillFinish(" Q ")).toBe(true);
    expect(isGrillFinish("")).toBe(false);
    expect(isGrillFinish("quit it")).toBe(false);
    expect(isGrillFinish("1")).toBe(false);
  });

  test("rejects unknown flags, second positionals, and bad enum values", () => {
    expect(() => parseSkillNewArgs(["desc", "--wat"])).toThrow("Unknown skill new argument: --wat");
    expect(() => parseSkillNewArgs(["one", "two"])).toThrow("single description");
    expect(() => parseSkillNewArgs(["desc", "--mode", "freestyle"])).toThrow("--mode must be");
    expect(() => parseSkillNewArgs(["desc", "--agents", "claude,cursor"])).toThrow("--agents accepts");
    expect(() => parseSkillNewArgs(["desc", "--dir"])).toThrow("--dir requires a value");
  });
});

describe("parseSkillEvalArgs", () => {
  test("takes a skill name and both flag forms", () => {
    const options = parseSkillEvalArgs([
      "pii-masker",
      "--dir",
      "/tmp/x",
      "--backend=codex",
      "--model",
      "gpt-5",
      "--description=Mask PII",
      "--apply-winner",
      "claude",
      "--delete-loser-and-link",
      "--json"
    ]);

    expect(options.skillName).toBe("pii-masker");
    expect(options.dir).toBe("/tmp/x");
    expect(options.backend).toBe("codex");
    expect(options.model).toBe("gpt-5");
    expect(options.description).toBe("Mask PII");
    expect(options.applyWinner).toBe("claude");
    expect(options.deleteLoserAndLink).toBe(true);
    expect(options.json).toBe(true);
  });

  test("takes per-agent name overrides in both flag forms", () => {
    const options = parseSkillEvalArgs(["pdf-tables", "--claude-name", "pdf-tables", "--codex-name=convert-tables"]);

    expect(options.skillName).toBe("pdf-tables");
    expect(options.claudeName).toBe("pdf-tables");
    expect(options.codexName).toBe("convert-tables");
    expect(() => parseSkillEvalArgs(["pdf-tables", "--codex-name"])).toThrow("--codex-name requires a value");
  });

  test("accepts --apply-winner recommended and still rejects tie", () => {
    expect(parseSkillEvalArgs(["x", "--apply-winner", "recommended"]).applyWinner).toBe("recommended");
    expect(parseSkillEvalArgs(["x", "--apply-winner=codex"]).applyWinner).toBe("codex");
    expect(() => parseSkillEvalArgs(["x", "--apply-winner", "tie"])).toThrow("must be claude, codex, or recommended");
  });

  test("rejects unknown flags, second names, and bad enum values", () => {
    expect(() => parseSkillEvalArgs(["pii-masker", "--wat"])).toThrow("Unknown skill eval argument: --wat");
    expect(() => parseSkillEvalArgs(["one", "two"])).toThrow("single skill name");
    expect(() => parseSkillEvalArgs(["pii-masker", "--backend", "cursor"])).toThrow("--backend must be");
    expect(() => parseSkillEvalArgs(["pii-masker", "--apply-winner", "tie"])).toThrow("--apply-winner must be");
    expect(() => parseSkillEvalArgs(["pii-masker", "--dir"])).toThrow("--dir requires a value");
  });
});

describe("farrier skill new e2e (scaffold paths)", () => {
  test("--eval refuses non-per-agent runs before any authoring", async () => {
    const dir = await tempDir();
    const result = await runCli(["skill", "new", "Summarize PR diffs", "--no-llm", "--yes", "--eval", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--eval compares per-agent copies");
  });

  test("scaffolds a SKILL.md with --no-llm --yes --no-install", async () => {
    const dir = await tempDir();
    const result = await runCli(["skill", "new", "Summarize PR diffs before review", "--no-llm", "--yes", "--no-install", "--dir", dir]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);

    const skillMd = await readFile(join(dir, "skills", "summarize-pr-diffs-before-review", "SKILL.md"), "utf8");
    expect(skillMd).toStartWith("---\nname: summarize-pr-diffs-before-review\n");
    expect(skillMd).toContain("description: Summarize PR diffs before review");
    expect(skillMd).toContain("## Steps");
  });

  test("refuses to write without --yes and writes nothing", async () => {
    const dir = await tempDir();
    const result = await runCli(["skill", "new", "Some skill", "--no-llm", "--no-install", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("refusing to write without --yes");
    expect(existsSync(join(dir, "skills"))).toBe(false);
  });

  test("dry-run previews without writing", async () => {
    const dir = await tempDir();
    const result = await runCli(["skill", "new", "Some skill", "--no-llm", "--dry-run", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("skills/some-skill/SKILL.md");
    expect(result.stdout).toContain("nothing written");
    expect(existsSync(join(dir, "skills"))).toBe(false);
  });

  test("collision exits 1 and --force overwrites", async () => {
    const dir = await tempDir();
    const args = ["skill", "new", "Some skill", "--no-llm", "--yes", "--no-install", "--dir", dir];

    expect((await runCli(args)).exitCode).toBe(0);

    const collision = await runCli(args);
    expect(collision.exitCode).toBe(1);
    expect(collision.stderr).toContain("already exists");

    expect((await runCli([...args, "--force"])).exitCode).toBe(0);
  });

  test("honors --name and emits parseable --json", async () => {
    const dir = await tempDir();
    const result = await runCli([
      "skill",
      "new",
      "Whatever text",
      "--no-llm",
      "--yes",
      "--no-install",
      "--name",
      "my-skill",
      "--json",
      "--dir",
      dir
    ]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { name: string; mode: string; files: string[]; installed: boolean };
    expect(parsed.name).toBe("my-skill");
    expect(parsed.mode).toBe("scaffold");
    expect(parsed.files).toEqual(["skills/my-skill/SKILL.md", "skills/my-skill/evals/cases.json"]);
    expect(parsed.installed).toBe(false);
  });

  test("requires a description and rejects unknown skill subcommands", async () => {
    const missing = await runCli(["skill", "new", "--no-llm"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("a description is required");

    const unknown = await runCli(["skill", "delete", "x"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("unknown skill subcommand");

    const help = await runCli(["skill", "new", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("farrier skill new");
  });

  test("skill eval refuses destructive apply without the explicit delete+link flag before backend work", async () => {
    const dir = await tempDir();
    const result = await runCli(["skill", "eval", "pii-masker", "--apply-winner", "claude", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--apply-winner requires --delete-loser-and-link");
  });
});

// The e2e CLI subprocess spawns real claude/codex, so the LLM authoring path has
// no runner injection point. This exercises the exact config→cmd wiring the CLI
// uses (loadFarrierConfig → resolveModelSettings → createSkills deps) while
// injecting a fake backend runner, proving a farrier.config.json on disk drives
// the authoring model.
describe("farrier skill new model config wiring", () => {
  test("a farrier.config.json models entry drives the authoring backend model", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "farrier.config.json"),
      `${JSON.stringify({ models: { claude: { skillCreation: "opus-4-1" } } }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const models = (await loadFarrierConfig({ projectDir: dir, env: { HOME: await tempDir() } })).config.models;
    const modelSettings = {
      claude: resolveModelSettings({ models, backend: "claude", role: "skillCreation" }),
      codex: resolveModelSettings({ models, backend: "codex", role: "skillCreation" })
    };

    const calls: BackendCommandRunnerInput[] = [];
    const runner: BackendCommandRunner = async (input) => {
      calls.push(input);
      const match = `${input.stdin ?? ""} ${input.cmd.join(" ")}`.match(/under (\S+)\/ only/);
      const root = match![1]!;
      await mkdir(join(input.cwd, root, "config-skill", "evals"), { recursive: true });
      await writeFile(
        join(input.cwd, root, "config-skill", "SKILL.md"),
        "---\nname: config-skill\ndescription: Does a thing. Use when testing.\n---\n\nBody.\n",
        "utf8"
      );
      await writeFile(join(input.cwd, root, "config-skill", "evals", "cases.json"), JSON.stringify({ version: 1, cases: [
        { id: "expected", kind: "positive", prompt: "Use it", expectedBehavior: "Use it" },
        { id: "unrelated", kind: "negative", prompt: "Do something else", expectedBehavior: "Do not use it" }
      ] }));
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const outcome = await createSkill(
      { description: "Author from config file", agents: ["claude"], mode: "author-claude" },
      dir,
      { backendRunner: runner, skillsRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }), install: false, modelSettings }
    );

    expect(outcome.error).toBeUndefined();
    const modelIndex = calls[0]!.cmd.indexOf("--model");
    expect(calls[0]!.cmd[modelIndex + 1]).toBe("opus-4-1");
  });
});
