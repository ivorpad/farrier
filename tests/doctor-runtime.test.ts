import { describe, expect, test } from "bun:test";
import { appendFile, chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRuntimeReport, runLiveCodexProbe } from "../src/engine/doctor-runtime";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { resolvePack } from "../src/packs/index";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-doctor-runtime-"));
}

async function renderTsFixture(dir: string, agents: Array<"claude" | "codex">): Promise<void> {
  await writeFile(join(dir, "bun.lock"), "", "utf8");
  const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("ts-base"), agents });
  await writeRenderPlan(plan);
}

describe("doctor runtime probes", () => {
  test("probes deny the forbidden fixtures, allow the benign one, and verify the event log", async () => {
    const dir = await tempDir();
    await renderTsFixture(dir, ["claude", "codex"]);

    const report = await createRuntimeReport({ targetDir: dir, includeHookTests: false });

    expect(report.healthy).toBe(true);
    const byId = new Map(report.probes.map((probe) => [probe.id, probe]));
    expect(byId.get("tool-policy:typescript-use-bun-add-not-npm-yarn-pnpm-install")?.ok).toBe(true);
    expect(byId.get("secret-shield:env-read")?.ok).toBe(true);
    expect(byId.get("write-guard:protected-file")?.ok).toBe(true);
    expect(byId.get("allow:benign-command")?.ok).toBe(true);

    const events = (await readFile(join(dir, ".farrier", "runtime", "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toContainEqual({
      hook: "tool-policy",
      event: "PreToolUse",
      result: "blocked",
      rule: "typescript-use-bun-add-not-npm-yarn-pnpm-install"
    });
    expect(events.some((event) => event.result === "allowed")).toBe(true);
  }, 30000);

  test("a hook that stopped firing is a runtime error, not a silent pass", async () => {
    const dir = await tempDir();
    await renderTsFixture(dir, ["claude"]);

    // Dead hook: exits cleanly without denying anything.
    const hookPath = join(dir, ".farrier", "hooks", "tool-policy.py");
    await writeFile(hookPath, "#!/usr/bin/env python3\nraise SystemExit(0)\n", "utf8");
    await chmod(hookPath, 0o755);

    const report = await createRuntimeReport({ targetDir: dir, includeHookTests: false });

    expect(report.healthy).toBe(false);
    const failed = report.probes.filter((probe) => !probe.ok).map((probe) => probe.id);
    expect(failed).toContain("tool-policy:typescript-use-bunx-not-npx");
    expect(report.problems.some((problem) => problem.group === "runtime")).toBe(true);
  }, 30000);

  test("denies without event-log output are flagged as pre-logging hooks", async () => {
    const dir = await tempDir();
    await renderTsFixture(dir, ["claude"]);

    // A hook that denies correctly but never writes the event log.
    const hookPath = join(dir, ".farrier", "hooks", "secret-shield.py");
    await writeFile(
      hookPath,
      '#!/usr/bin/env python3\nimport json,sys\nsys.stdin.read()\nprint(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked secret access."}}))\n',
      "utf8"
    );
    await chmod(hookPath, 0o755);
    // Remove the other guards so no instrumented hook writes events.
    for (const name of ["tool-policy.py", "write-guard.py"]) {
      const path = join(dir, ".farrier", "hooks", name);
      await writeFile(path, "#!/usr/bin/env python3\nimport sys\nsys.stdin.read()\nraise SystemExit(0)\n", "utf8");
      await chmod(path, 0o755);
    }

    const report = await createRuntimeReport({ targetDir: dir, includeHookTests: false });

    expect(report.problems.some((problem) => problem.path === ".farrier/runtime/events.jsonl")).toBe(true);
  }, 30000);
});

describe("live codex probe", () => {
  test("passes when the session produces a blocked event", async () => {
    const dir = await tempDir();
    await renderTsFixture(dir, ["codex"]);

    const result = await runLiveCodexProbe({
      targetDir: dir,
      runner: async () => {
        await mkdir(join(dir, ".farrier", "runtime"), { recursive: true });
        await appendFile(
          join(dir, ".farrier", "runtime", "events.jsonl"),
          '{"hook": "tool-policy", "event": "PreToolUse", "result": "blocked", "rule": "typescript-use-bunx-not-npx"}\n'
        );
        return { exitCode: 0, stdout: "BLOCKED" };
      }
    });

    expect(result.ran).toBe(true);
    expect(result.ok).toBe(true);
  });

  test("fails when the session completes without any blocked event", async () => {
    const dir = await tempDir();
    await renderTsFixture(dir, ["codex"]);

    const result = await runLiveCodexProbe({
      targetDir: dir,
      runner: async () => ({ exitCode: 0, stdout: "RAN" })
    });

    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("no blocked event");
  });
});
