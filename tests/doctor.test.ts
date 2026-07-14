import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
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
import type { ResolvedPack } from "../src/packs/types";
import { builtinCatalog, type PackCatalog } from "../src/registry/catalog";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-doctor-"));
}

async function renderPack(dir: string, packId = "python-fastapi"): Promise<void> {
  const pack = resolvePack(packId);
  const plan = await createRenderPlan({ targetDir: dir, pack });
  await writeRenderPlan(plan);
}

function remoteDoctorCatalog(pack: ResolvedPack): PackCatalog {
  const base = builtinCatalog();
  return {
    ...base,
    packIds: () => [...base.packIds(), "@acme/demo"],
    listings: () => [...base.listings(), { id: "@acme/demo", source: "registry", cached: false }],
    resolvePack: (id) => (id === "@acme/demo" ? pack : base.resolvePack(id)),
    remoteHook: (id) => pack.remoteHooks.find((hook) => hook.id === id),
    registryPins: () => ({
      "@acme/demo": {
        type: "pack",
        version: "1.0.0",
        sha256: "pack".padEnd(64, "0")
      },
      "@acme/guard": {
        type: "hook",
        version: "1.0.0",
        sha256: "hook".padEnd(64, "0")
      }
    })
  };
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

  test("healthy Codex-only and dual-binding fixtures pass with static trust guidance", async () => {
    for (const agents of [["codex"] as const, ["claude", "codex"] as const]) {
      const dir = await tempDir();
      const plan = await createRenderPlan({
        targetDir: dir,
        pack: resolvePack("python-fastapi"),
        agents: [...agents]
      });
      await writeRenderPlan(plan);

      const report = await createDoctorReport({ targetDir: dir });
      expect(report.healthy).toBe(true);
      expect(report.problems).toEqual([]);
      expect(report.notes).toContainEqual(expect.stringContaining("inspect /hooks in Codex"));
    }
  });

  test("validates only selected vendor bindings", async () => {
    const claudeDir = await tempDir();
    await renderPack(claudeDir, "generic");
    await mkdir(join(claudeDir, ".codex"), { recursive: true });
    await writeFile(join(claudeDir, ".codex", "hooks.json"), "{not json", "utf8");
    const claudeManifest = await readJson(join(claudeDir, ".farrier.json"));
    expect(claudeManifest.agents).toEqual(["claude"]);
    expect((await createDoctorReport({ targetDir: claudeDir })).healthy).toBe(true);

    const codexDir = await tempDir();
    const codexPlan = await createRenderPlan({ targetDir: codexDir, pack: resolvePack("generic"), agents: ["codex"] });
    await writeRenderPlan(codexPlan);
    await writeFile(join(codexDir, ".claude", "settings.json"), "{not json", "utf8");
    const codexReport = await createDoctorReport({ targetDir: codexDir });
    expect(codexReport.healthy).toBe(true);
    expect(codexReport.problemsByGroup.settings).toEqual([]);
  });

  test("accepts unrelated user Codex hooks while requiring every Farrier binding", async () => {
    const dir = await tempDir();
    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("generic"), agents: ["codex"] });
    await writeRenderPlan(plan);
    const hooksPath = join(dir, ".codex", "hooks.json");
    const hooks = await readJson(hooksPath);
    const hookEvents = (hooks.hooks as Record<string, unknown[]>);
    hookEvents.PreToolUse!.push({
      matcher: "^mcp__example__tool$",
      hooks: [{ type: "command", command: "echo user-hook" }]
    });
    await writeJson(hooksPath, hooks);

    expect((await createDoctorReport({ targetDir: dir })).healthy).toBe(true);

    hookEvents.PreToolUse = hookEvents.PreToolUse!.slice(1);
    await writeJson(hooksPath, hooks);
    const missing = await createDoctorReport({ targetDir: dir });
    expect(missing.healthy).toBe(false);
    expectProblem(missing, "codex", {
      path: ".codex/hooks.json",
      message: expect.stringContaining("Expected Farrier PreToolUse")
    });
  });

  test("flags malformed or missing selected Codex hooks", async () => {
    const malformedDir = await tempDir();
    const malformedPlan = await createRenderPlan({
      targetDir: malformedDir,
      pack: resolvePack("generic"),
      agents: ["codex"]
    });
    await writeRenderPlan(malformedPlan);
    await writeFile(join(malformedDir, ".codex", "hooks.json"), "{not json", "utf8");
    expectProblem(await createDoctorReport({ targetDir: malformedDir }), "codex", {
      path: ".codex/hooks.json",
      message: expect.stringContaining("Unable to parse Codex hooks JSON")
    });
    await writeJson(join(malformedDir, ".codex", "hooks.json"), {
      hooks: { PreToolUse: [{ matcher: "^Bash$", hooks: [{}] }] }
    });
    expectProblem(await createDoctorReport({ targetDir: malformedDir }), "codex", {
      path: ".codex/hooks.json",
      message: expect.stringContaining("must use type command with a non-empty command")
    });

    const missingDir = await tempDir();
    const missingPlan = await createRenderPlan({ targetDir: missingDir, pack: resolvePack("generic"), agents: ["codex"] });
    await writeRenderPlan(missingPlan);
    await unlink(join(missingDir, ".codex", "hooks.json"));
    const missing = await createDoctorReport({ targetDir: missingDir });
    expectProblem(missing, "inventory", {
      path: ".codex/hooks.json",
      message: "Expected generated harness file is missing"
    });
    expectProblem(missing, "codex", {
      path: ".codex/hooks.json",
      message: expect.stringContaining("Unable to parse Codex hooks JSON")
    });
  });

  test("treats manifests without agents as legacy Claude selections", async () => {
    const dir = await tempDir();
    await renderPack(dir, "generic");
    const manifestPath = join(dir, ".farrier.json");
    const manifest = await readJson(manifestPath);
    delete manifest.agents;
    await writeJson(manifestPath, manifest);

    const report = await createDoctorReport({ targetDir: dir });
    expect(report.healthy).toBe(true);
    expect(report.problemsByGroup.codex).toEqual([]);
  });

  test("rejects an empty persisted enforcement-agent selection", async () => {
    const dir = await tempDir();
    await renderPack(dir, "generic");
    const manifestPath = join(dir, ".farrier.json");
    const manifest = await readJson(manifestPath);
    manifest.agents = [];
    await writeJson(manifestPath, manifest);

    const report = await createDoctorReport({ targetDir: dir });
    expectProblem(report, "manifest", {
      path: ".farrier.json",
      message: expect.stringContaining("agents must be a non-empty array")
    });
  });

  test("healthy rendered fixture with a remote bash hook passes", async () => {
    const dir = await tempDir();
    const basePack = resolvePack("generic");
    const pack: ResolvedPack = {
      ...basePack,
      id: "@acme/demo",
      packIds: ["generic", "@acme/demo"],
      hooks: [...basePack.hooks, "@acme/guard"],
      remoteHooks: [
        {
          id: "@acme/guard",
          version: "1.0.0",
          sha256: "hook".padEnd(64, "0"),
          fromCache: false,
          hookVersion: 1,
          events: [{ event: "PreToolUse", matcher: "Bash" }],
          entry: "guard.sh",
          runner: "bash",
          files: [{ path: "guard.sh", content: "echo guard\n" }]
        }
      ]
    };
    const catalog = remoteDoctorCatalog(pack);
    const plan = await createRenderPlan({
      targetDir: dir,
      pack,
      registryPins: catalog.registryPins()
    });
    await writeRenderPlan(plan);

    const report = await createDoctorReport({ targetDir: dir, catalog });

    expect(report.healthy).toBe(true);
    expect(report.problems).toEqual([]);
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

  test("statically flags missing hook test artifacts and aggregate coverage", async () => {
    const dir = await tempDir();
    await renderPack(dir);
    await unlink(join(dir, ".claude", "hooks", "test_tool_policy.py"));
    const justfile = join(dir, "justfile");
    await writeFile(justfile, (await readFile(justfile, "utf8")).replace(" && uv run --with pytest pytest .claude/hooks", ""), "utf8");

    const report = await createDoctorReport({ targetDir: dir });
    expectProblem(report, "inventory", {
      path: ".claude/hooks/test_tool_policy.py",
      message: "Expected generated harness file is missing"
    });
    expectProblem(report, "hooks", {
      path: "justfile",
      message: "The generated check aggregate does not invoke the generated hook test suite"
    });
    expect(report.notes).toContainEqual(expect.stringContaining("Doctor is static"));
  });

  test("statically flags missing bundled skill cases", async () => {
    const dir = await tempDir();
    await renderPack(dir);
    await unlink(join(dir, ".agents", "skills", "farrier-project-advisor", "evals", "cases.json"));

    const report = await createDoctorReport({ targetDir: dir });
    expectProblem(report, "skills", {
      path: ".agents/skills/farrier-project-advisor/evals/cases.json",
      message: "Bundled Farrier skill behavior cases are missing or invalid"
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


  test("statically rejects unsafe judge prompts and stop bounds without running checks", async () => {
    const dir = await tempDir();
    await renderPack(dir);
    const outside = join(await tempDir(), "outside.txt");
    await writeFile(outside, "prompt\n", "utf8");
    const promptPath = join(dir, ".claude", "hooks", "prompts", "quality-judge-v1.txt");
    await unlink(promptPath);
    await symlink(outside, promptPath);
    const manifestPath = join(dir, ".farrier.json");
    const manifest = await readJson(manifestPath);
    (manifest.judge as { stop: { maxDiffBytes: number } }).stop.maxDiffBytes = 120001;
    await writeJson(manifestPath, manifest);

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.healthy).toBe(false);
    expectProblem(report, "judge", {
      path: ".claude/hooks/prompts/quality-judge-v1.txt",
      message: expect.stringContaining("regular non-symlink")
    });
    expectProblem(report, "judge", {
      path: ".farrier.json",
      message: expect.stringContaining("maxDiffBytes exceeds")
    });
    expect(report.notes).toContainEqual(expect.stringContaining("Doctor is static"));
  });


  test("flags malformed konpy json when expected", async () => {
    const dir = await tempDir();
    await renderPack(dir);

    await writeFile(join(dir, "konpy.json"), "{not json", "utf8");

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.healthy).toBe(false);
    expectProblem(report, "konsistent", {
      path: "konpy.json",
      message: expect.stringContaining("Unable to parse konpy.json")
    });
  });
});
