import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createDoctorReport,
  doctorExitCode,
  formatDoctorReport,
  type DoctorGroup,
  type DoctorReport
} from "../src/engine/doctor";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { resolvePack } from "../src/packs/index";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-doctor-"));
}

async function renderPack(dir: string, packId = "python-fastapi"): Promise<void> {
  const pack = resolvePack(packId);
  const plan = await createRenderPlan({ targetDir: dir, pack });
  await writeRenderPlan(plan);
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function expectProblem(
  report: DoctorReport,
  group: DoctorGroup,
  partial: {
    path?: string;
    id?: string;
    message?: unknown;
  } = {}
): void {
  expect(report.problems).toContainEqual(
    expect.objectContaining({
      group,
      severity: "error",
      ...partial
    })
  );
}

describe("doctor engine", () => {
  test("healthy rendered fixture passes", async () => {
    const dir = await tempDir();
    await renderPack(dir);

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.healthy).toBe(true);
    expect(report.problems).toEqual([]);
    expect(doctorExitCode(report)).toBe(0);
    expect(formatDoctorReport(report)).toContain("Health: healthy");
  });

  test("flags missing generated hook file", async () => {
    const dir = await tempDir();
    await renderPack(dir);

    await unlink(join(dir, ".claude", "hooks", "tool-policy.py"));

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.healthy).toBe(false);
    expect(doctorExitCode(report)).toBe(1);
    expectProblem(report, "inventory", {
      path: ".claude/hooks/tool-policy.py",
      message: "Expected generated harness file is missing"
    });
    expectProblem(report, "settings", {
      path: ".claude/settings.json",
      message: expect.stringContaining("Hook command references a missing file")
    });
  });

  test("flags non-executable hook script", async () => {
    const dir = await tempDir();
    await renderPack(dir);

    await chmod(join(dir, ".claude", "hooks", "secret-shield.py"), 0o644);

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.healthy).toBe(false);
    expectProblem(report, "hooks", {
      path: ".claude/hooks/secret-shield.py",
      message: "Hook script is not executable"
    });
    expectProblem(report, "settings", {
      path: ".claude/hooks/secret-shield.py",
      message: "Hook command references a non-executable hook file"
    });
  });

  test("flags dangling settings hook reference", async () => {
    const dir = await tempDir();
    await renderPack(dir);

    const settingsPath = join(dir, ".claude", "settings.json");
    const settings = await readJson(settingsPath);
    const hooks = settings.hooks as {
      PreToolUse: Array<{
        matcher?: string;
        hooks: Array<{ type: "command"; command: string }>;
      }>;
    };

    hooks.PreToolUse.push({
      matcher: "Bash",
      hooks: [
        {
          type: "command",
          command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/missing-policy.py"'
        }
      ]
    });

    await writeJson(settingsPath, settings);

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.healthy).toBe(false);
    expectProblem(report, "settings", {
      path: ".claude/settings.json",
      message: expect.stringContaining(".claude/hooks/missing-policy.py")
    });
  });

  test("flags invalid tool-policy rule regex", async () => {
    const dir = await tempDir();
    await renderPack(dir);

    const rulesPath = join(dir, ".claude", "hooks", "tool-policy-rules.json");
    const rulesDocument = await readJson(rulesPath);
    const rules = rulesDocument.rules as Array<Record<string, unknown>>;
    rules[0] = {
      ...rules[0],
      commandPattern: "["
    };
    await writeJson(rulesPath, rulesDocument);

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.healthy).toBe(false);
    expectProblem(report, "tool-policy", {
      path: ".claude/hooks/tool-policy-rules.json",
      id: "python-use-uv-not-python-m-pip",
      message: expect.stringContaining("commandPattern does not compile")
    });
  });

  test("flags duplicate tool-policy rule ids", async () => {
    const dir = await tempDir();
    await renderPack(dir);

    const rulesPath = join(dir, ".claude", "hooks", "tool-policy-rules.json");
    const rulesDocument = await readJson(rulesPath);
    const rules = rulesDocument.rules as Array<Record<string, unknown>>;
    rules.push({ ...rules[0] });
    await writeJson(rulesPath, rulesDocument);

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.healthy).toBe(false);
    expectProblem(report, "tool-policy", {
      path: ".claude/hooks/tool-policy-rules.json",
      id: "python-use-uv-not-python-m-pip",
      message: "rule id duplicates another proposal"
    });
  });

  test("flags corrupt manifest", async () => {
    const dir = await tempDir();
    await renderPack(dir);

    await writeFile(join(dir, ".farrier.json"), "{not json", "utf8");

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.healthy).toBe(false);
    expect(doctorExitCode(report)).toBe(1);
    expectProblem(report, "manifest", {
      path: ".farrier.json",
      message: expect.stringContaining("invalid .farrier.json")
    });
    expect(formatDoctorReport(report)).toContain("Health: unhealthy");
  });

  test("flags invalid manifest learn judge and quality shapes", async () => {
    const dir = await tempDir();
    await renderPack(dir);

    const manifestPath = join(dir, ".farrier.json");
    const manifest = await readJson(manifestPath);
    manifest.learn = { enabled: "yes" };
    manifest.judge = {
      perEdit: {
        enabled: "no",
        backend: "other",
        model: "",
        timeoutMs: -1,
        prompt: ""
      },
      stop: {
        enabled: true,
        maxDiffBytes: 0,
        maxUntrackedFiles: -2
      }
    };
    manifest.quality = {
      maxFileLines: 0
    };
    await writeJson(manifestPath, manifest);

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.healthy).toBe(false);
    expectProblem(report, "learn", {
      path: ".farrier.json",
      message: "learn.enabled must be a boolean"
    });
    expectProblem(report, "judge", {
      path: ".farrier.json",
      message: "judge.perEdit.enabled must be a boolean"
    });
    expectProblem(report, "judge", {
      path: ".farrier.json",
      message: 'judge.perEdit.backend must be "claude" or "codex"'
    });
    expectProblem(report, "quality", {
      path: ".farrier.json",
      message: "quality.maxFileLines must be a positive number"
    });
  });

  test("flags malformed konsistent json when expected", async () => {
    const dir = await tempDir();
    await renderPack(dir);

    await writeFile(join(dir, "konsistent.json"), "{not json", "utf8");

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.healthy).toBe(false);
    expectProblem(report, "konsistent", {
      path: "konsistent.json",
      message: expect.stringContaining("Unable to parse konsistent.json")
    });
  });
});
