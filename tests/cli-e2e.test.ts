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

function serveRegistryDir(root: string) {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const name = new URL(request.url).pathname.replace(/^\//, "");
      try {
        const text = await readFile(join(root, name), "utf8");
        return new Response(text, {
          headers: { "content-type": "application/json" },
        });
      } catch {
        return new Response("missing", { status: 404 });
      }
    },
  });
}

describe("CLI e2e", () => {
  test("renders a remote registry stack and updates from cache after the fixture stops", async () => {
    const dir = await tempDir();
    const cacheDir = await tempDir();
    const registryIndex = {
      schemaVersion: 1,
      name: "@acme",
      items: [
        {
          name: "demo",
          type: "pack",
          version: "1.0.0",
          description: "Acme demo",
        },
        { name: "guard", type: "hook", version: "1.0.0" },
      ],
    };
    const demoPack = {
      schemaVersion: 1,
      type: "pack",
      name: "demo",
      version: "1.0.0",
      description: "Acme demo",
      pack: {
        extends: "generic",
        detect: {
          files: ["acme.toml"],
        },
        generator: {
          command: "bun",
          args: ["run", "setup"],
          onlyWhenEmptyDir: true,
        },
        skills: [],
        hooks: ["@acme/guard"],
      },
    };
    const guardHook = {
      schemaVersion: 1,
      type: "hook",
      name: "guard",
      version: "1.0.0",
      hook: {
        hookVersion: 4,
        events: [{ event: "PreToolUse", matcher: "Bash" }],
        entry: "guard.sh",
        runner: "bash",
        files: [{ path: "guard.sh", content: "echo guard\n" }],
      },
    };
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/registry.json") {
          return Response.json(registryIndex);
        }
        if (path === "/demo.json") {
          return Response.json(demoPack);
        }
        if (path === "/guard.json") {
          return Response.json(guardHook);
        }
        return new Response("missing", { status: 404 });
      },
    });
    const env = { FARRIER_CACHE_DIR: cacheDir };

    try {
      await writeFile(
        join(dir, "farrier.config.json"),
        `${JSON.stringify(
          {
            registries: {
              "@acme": `http://127.0.0.1:${server.port}/{name}.json`,
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const dryRun = await runCli(["--stack", "@acme/demo", "--dry-run", "--dir", dir], { env });
      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.stderr).toBe("");
      expect(dryRun.stdout).toContain("declared project generator: bun run setup (from @acme/demo); harness creation does not run it");
      expect(dryRun.stdout).toContain(".claude/hooks/@acme/guard/guard.sh");
      expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);

      const list = await runCli(["registry", "list", "--dir", dir], { env });
      expect(list.exitCode).toBe(0);
      expect(list.stderr).toBe("");
      expect(list.stdout).toContain("@acme: 2 items");

      const render = await runCli(["--stack", "@acme/demo", "--yes", "--dir", dir], { env });
      expect(render.exitCode).toBe(0);
      expect(render.stderr).toBe("");
      expect(existsSync(join(dir, ".claude", "hooks", "@acme", "guard", "guard.sh"))).toBe(true);

      const manifest = JSON.parse(await readFile(join(dir, ".farrier.json"), "utf8"));
      expect(manifest.packIds).toEqual(["generic", "@acme/demo"]);
      expect(manifest.hookIds).toContain("@acme/guard");
      expect(manifest.versions.hooks["@acme/guard"]).toBe(4);
      expect(manifest.registry.items["@acme/guard"].type).toBe("hook");
    } finally {
      await server.stop(true);
    }

    const update = await runCli(["update", "--dir", dir], { env });
    expect(update.exitCode).toBe(0);
    expect(update.stderr).toBe("");
    expect(update.stdout).toContain("(cached)");
  });

  test("renders the committed @acme example registry end to end", async () => {
    const dir = await tempDir();
    const cacheDir = await tempDir();
    const server = serveRegistryDir(join(repoRoot(), "examples", "registries", "acme"));
    const env = { FARRIER_CACHE_DIR: cacheDir };

    try {
      await writeFile(
        join(dir, "farrier.config.json"),
        `${JSON.stringify(
          {
            registries: {
              "@acme": `http://127.0.0.1:${server.port}/{name}.json`,
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const list = await runCli(["registry", "list", "--dir", dir], { env });
      expect(list.exitCode).toBe(0);
      expect(list.stderr).toBe("");
      expect(list.stdout).toContain("@acme: 3 items");

      const dryRun = await runCli(["--stack", "@acme/demo", "--dry-run", "--dir", dir], { env });
      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.stderr).toBe("");
      expect(dryRun.stdout).toContain(".claude/hooks/secret-shield.py");
      expect(dryRun.stdout).toContain(".claude/hooks/@acme/guard/guard.py");

      const render = await runCli(["--stack", "@acme/demo", "--yes", "--dir", dir], { env });
      expect(render.exitCode).toBe(0);
      expect(render.stderr).toBe("");

      const guardPath = join(dir, ".claude", "hooks", "@acme", "guard", "guard.py");
      expect(existsSync(guardPath)).toBe(true);
      expect(await readFile(guardPath, "utf8")).toContain("docker push");

      const manifest = JSON.parse(await readFile(join(dir, ".farrier.json"), "utf8"));
      expect(manifest.packIds).toEqual(["python-uv", "python-fastapi", "@acme/demo"]);
      expect(manifest.hookIds).toContain("@acme/guard");
      expect(manifest.registry.items["@acme/demo"].type).toBe("pack");
      expect(manifest.registry.items["@acme/guard"].type).toBe("hook");
      expect(manifest.registry.items["@acme/platform-skills"].type).toBe("skill");
    } finally {
      await server.stop(true);
    }
  });

  test("update fails before writing when a required registry has no cache", async () => {
    const dir = await tempDir();
    const cacheDir = await tempDir();
    await writeFile(join(dir, "farrier.config.json"), `${JSON.stringify({ registries: { "@acme": "http://127.0.0.1:9/{name}.json" } }, null, 2)}\n`, "utf8");
    await writeFile(
      join(dir, ".farrier.json"),
      `${JSON.stringify(
        {
          farrierVersion: "0.2.0",
          packIds: ["generic", "@acme/demo"],
          hookIds: ["@acme/guard"],
          skills: [],
          secondaryAcknowledged: [],
          learn: { enabled: false },
          judge: {},
          quality: {},
          versions: {
            farrierManifest: 1,
            hooks: { "@acme/guard": 1 },
            prompts: { qualityJudge: "v1", stopJudge: "v1" },
          },
          registry: {
            items: {
              "@acme/demo": {
                type: "pack",
                version: "1.0.0",
                sha256: "old".padEnd(64, "0"),
              },
              "@acme/guard": {
                type: "hook",
                version: "1.0.0",
                sha256: "old".padEnd(64, "0"),
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(join(dir, "AGENTS.md"), "keep\n", "utf8");

    const result = await runCli(["update", "--dir", dir, "--yes"], {
      env: { FARRIER_CACHE_DIR: cacheDir },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cannot resolve @acme/demo: registry @acme unreachable and no local cache");
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("keep\n");
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

    const result = await runCli(["learn", "--dir", dir, "--transcripts", join(dir, "missing-transcripts"), "--no-llm"]);

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
    expect(result.stdout).toContain("--force");
    expect(result.stdout).toContain("--no-skills");
    expect(result.stdout).toContain("Creation refuses existing Farrier projects");
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
