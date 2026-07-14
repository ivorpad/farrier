import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyHarnessChangePlan, assertHarnessChangePlanWritable, filePurpose, HarnessApplyError, harnessChangeActions, inspectHarnessChangePlan } from "../src/engine/create-plan";
import type { RenderedFile, RenderPlan } from "../src/engine/render";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-create-plan-"));
}

function renderPlan(targetDir: string, files: RenderedFile[]): RenderPlan {
  return { targetDir, files };
}

describe("harness creation plans", () => {
  test("classifies fresh, identical, append-only, permission, and replacement changes", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "same.txt"), "same\n");
    await writeFile(join(dir, ".gitignore"), ".env\n");
    await writeFile(join(dir, "hook.py"), "#!/usr/bin/env python3\n");
    await chmod(join(dir, "hook.py"), 0o644);
    await writeFile(join(dir, "replace.txt"), "local edits\n");

    const plan = await inspectHarnessChangePlan(
      renderPlan(dir, [
        { path: "fresh.txt", content: "fresh\n" },
        { path: "same.txt", content: "same\n" },
        { path: ".gitignore", content: ".env\n.farrier-staging/\n" },
        { path: "hook.py", content: "#!/usr/bin/env python3\n", mode: 0o755 },
        { path: "replace.txt", content: "generated\n" },
      ]),
      { ruleCount: 9 },
    );

    expect(harnessChangeActions).toEqual(["create", "unchanged", "merge", "update", "replace", "blocked"]);
    expect(plan.files.map(({ path, action }) => [path, action])).toEqual([
      ["fresh.txt", "create"],
      ["same.txt", "unchanged"],
      [".gitignore", "merge"],
      ["hook.py", "update"],
      ["replace.txt", "replace"],
    ]);
    expect(plan.counts).toEqual({
      create: 1,
      unchanged: 1,
      merge: 1,
      update: 1,
      replace: 1,
      blocked: 0,
    });
    expect(plan.replacementPaths).toEqual(["replace.txt"]);
    expect(plan.files.find((file) => file.path === "replace.txt")?.requiresForce).toBe(true);
    expect(plan.files.find((file) => file.path === "fresh.txt")?.exists).toBe(false);
    expect(filePurpose("AGENTS.md", { ruleCount: 9 })).toContain("9 agent rules");
    expect(filePurpose(".codex/hooks.json", { hookCount: 6 })).toBe("Wires 6 shared hooks into Codex.");
  });

  test("requires force for replacements and keeps timestamped backups", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "AGENTS.md"), "local instructions\n");
    await writeFile(join(dir, ".gitignore"), ".env\n");
    const rendered = renderPlan(dir, [
      { path: "AGENTS.md", content: "generated instructions\n" },
      { path: ".gitignore", content: ".env\n.farrier-staging/\n" },
    ]);

    const inspected = await inspectHarnessChangePlan(rendered);
    expect(() => assertHarnessChangePlanWritable(inspected, { force: false })).toThrow("--force");
    await expect(applyHarnessChangePlan(rendered, { force: false })).rejects.toThrow("--force");

    const result = await applyHarnessChangePlan(rendered, {
      force: true,
      now: new Date("2030-01-02T03:04:05.678Z"),
    });

    expect(result.written).toEqual(["AGENTS.md", ".gitignore"]);
    expect(result.unchanged).toEqual([]);
    expect(result.backupDir).toBe(join(".farrier-staging", "backups", "2030-01-02T03-04-05-678Z"));
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("generated instructions\n");
    expect(await readFile(join(dir, result.backupDir!, "AGENTS.md"), "utf8")).toBe("local instructions\n");
    expect(existsSync(join(dir, result.backupDir!, ".gitignore"))).toBe(false);
    expect(await readFile(join(dir, ".farrier-staging", ".gitignore"), "utf8")).toBe("*\n");
  });

  test("refuses an existing manifest even when force is enabled", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, ".farrier.json"), '{"farrierVersion":"old"}\n');
    const rendered = renderPlan(dir, [{ path: "new.txt", content: "new\n" }]);
    const plan = await inspectHarnessChangePlan(rendered);

    expect(plan.existingHarness).toBe(true);
    expect(() => assertHarnessChangePlanWritable(plan, { force: true })).toThrow("already a Farrier project");
    expect(() => assertHarnessChangePlanWritable(plan, { force: true })).toThrow("farrier update");
    await expect(applyHarnessChangePlan(rendered, { force: true })).rejects.toThrow("farrier update");
    expect(existsSync(join(dir, "new.txt"))).toBe(false);
  });

  test("blocks file and symlink parents plus symlink and directory targets", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "file-parent"), "not a directory\n");
    await mkdir(join(dir, "real-parent"));
    await symlink("real-parent", join(dir, "linked-parent"));
    await writeFile(join(dir, "real-target.txt"), "keep\n");
    await symlink("real-target.txt", join(dir, "target-link"));
    await mkdir(join(dir, "target-directory"));
    const rendered = renderPlan(dir, [
      { path: "file-parent/child.txt", content: "blocked\n" },
      { path: "linked-parent/child.txt", content: "blocked\n" },
      { path: "target-link", content: "blocked\n" },
      { path: "target-directory", content: "blocked\n" },
    ]);

    const plan = await inspectHarnessChangePlan(rendered);
    expect(plan.files.map((file) => file.action)).toEqual(["blocked", "blocked", "blocked", "blocked"]);
    expect(plan.blockers.map((blocker) => blocker.reason).join(" ")).toMatch(/not a directory/);
    expect(plan.blockers.map((blocker) => blocker.reason).join(" ")).toMatch(/symbolic link/);
    expect(() => assertHarnessChangePlanWritable(plan, { force: true })).toThrow("force cannot bypass");
    await expect(applyHarnessChangePlan(rendered, { force: true })).rejects.toThrow("blocked harness paths");
    expect(existsSync(join(dir, "real-parent", "child.txt"))).toBe(false);
    expect(await readFile(join(dir, "real-target.txt"), "utf8")).toBe("keep\n");
  });

  test("rolls back earlier replacements and creations after a later write fails", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "existing.txt"), "before\n");
    await chmod(join(dir, "existing.txt"), 0o600);
    const rendered = renderPlan(dir, [
      { path: "existing.txt", content: "after\n", mode: 0o644 },
      { path: "created.txt", content: "temporary\n" },
      { path: "nested/failure.txt", content: "never written\n" },
    ]);
    const timestamp = new Date("2031-02-03T04:05:06.789Z");

    await expect(
      applyHarnessChangePlan(
        rendered,
        { force: true, now: timestamp },
        {
          beforeWrite: ({ index }) => {
            if (index === 2) throw new Error("injected write failure");
          },
        },
      ),
    ).rejects.toThrow("injected write failure");

    expect(await readFile(join(dir, "existing.txt"), "utf8")).toBe("before\n");
    expect((await stat(join(dir, "existing.txt"))).mode & 0o777).toBe(0o600);
    expect(existsSync(join(dir, "created.txt"))).toBe(false);
    expect(existsSync(join(dir, "nested"))).toBe(false);
    const backup = join(dir, ".farrier-staging", "backups", "2031-02-03T04-05-06-789Z", "existing.txt");
    expect(existsSync(backup)).toBe(false);
  });

  test("normalizes exact hook permissions without mutating a hard-linked peer", async () => {
    const dir = await tempDir();
    const peerDir = await tempDir();
    const peer = join(peerDir, "hook.py");
    const target = join(dir, "hook.py");
    await writeFile(peer, "#!/usr/bin/env python3\n");
    await chmod(peer, 0o777);
    await link(peer, target);
    const rendered = renderPlan(dir, [{ path: "hook.py", content: "#!/usr/bin/env python3\n", mode: 0o755 }]);

    const plan = await inspectHarnessChangePlan(rendered);
    expect(plan.files[0]?.action).toBe("update");
    await applyHarnessChangePlan(rendered, { force: false });

    expect((await stat(target)).mode & 0o777).toBe(0o755);
    expect((await stat(peer)).mode & 0o777).toBe(0o777);
    expect((await stat(target)).ino).not.toBe((await stat(peer)).ino);
  });

  test("safe gitignore merge breaks hard links instead of mutating an outside peer", async () => {
    const dir = await tempDir();
    const peerDir = await tempDir();
    const peer = join(peerDir, "shared-ignore");
    const target = join(dir, ".gitignore");
    await writeFile(peer, ".env\n");
    await link(peer, target);
    const rendered = renderPlan(dir, [{ path: ".gitignore", content: ".env\n.farrier-staging/\n" }]);

    await applyHarnessChangePlan(rendered, { force: false });

    expect(await readFile(peer, "utf8")).toBe(".env\n");
    expect(await readFile(target, "utf8")).toBe(".env\n.farrier-staging/\n");
    expect((await stat(target)).ino).not.toBe((await stat(peer)).ino);
  });

  test("a reviewed target swapped to a symlink cannot redirect a write outside the repository", async () => {
    const dir = await tempDir();
    const peerDir = await tempDir();
    const target = join(dir, "AGENTS.md");
    const victim = join(peerDir, "victim.txt");
    await writeFile(target, "reviewed original\n");
    await writeFile(victim, "outside stays unchanged\n");
    const rendered = renderPlan(dir, [{ path: "AGENTS.md", content: "generated\n" }]);

    await expect(
      applyHarnessChangePlan(
        rendered,
        { force: true },
        {
          beforeWrite: async () => {
            await rm(target);
            await symlink(victim, target);
          },
        },
      ),
    ).rejects.toBeInstanceOf(HarnessApplyError);

    expect(await readFile(victim, "utf8")).toBe("outside stays unchanged\n");
  });

  test("a parent directory swapped to a symlink cannot redirect a staged creation", async () => {
    const dir = await tempDir();
    const peerDir = await tempDir();
    const parent = join(dir, ".claude");
    await mkdir(parent);
    const rendered = renderPlan(dir, [{ path: ".claude/settings.json", content: "{}\n" }]);

    await expect(
      applyHarnessChangePlan(
        rendered,
        { force: false },
        {
          beforeWrite: async () => {
            await rm(parent, { recursive: true });
            await symlink(peerDir, parent);
          },
        },
      ),
    ).rejects.toBeInstanceOf(HarnessApplyError);

    expect(existsSync(join(peerDir, "settings.json"))).toBe(false);
  });

  test("stale merge input aborts and preserves the concurrent edit", async () => {
    const dir = await tempDir();
    const target = join(dir, ".gitignore");
    await writeFile(target, ".env\n");
    const rendered = renderPlan(dir, [{ path: ".gitignore", content: ".env\n.farrier-staging/\n" }]);

    await expect(
      applyHarnessChangePlan(
        rendered,
        { force: false },
        {
          beforeWrite: () => writeFile(target, "concurrent edit\n"),
        },
      ),
    ).rejects.toThrow("changed");
    expect(await readFile(target, "utf8")).toBe("concurrent edit\n");
  });

  test("rollback preserves a concurrent edit and exposes retained recovery evidence", async () => {
    const dir = await tempDir();
    const first = join(dir, "first.txt");
    await writeFile(first, "first original\n");
    await writeFile(join(dir, "second.txt"), "second original\n");
    const rendered = renderPlan(dir, [
      { path: "first.txt", content: "first generated\n" },
      { path: "second.txt", content: "second generated\n" },
    ]);

    let caught: unknown;
    try {
      await applyHarnessChangePlan(
        rendered,
        { force: true, now: new Date("2032-03-04T05:06:07.890Z") },
        {
          beforeWrite: async ({ index }) => {
            if (index === 1) {
              await writeFile(first, "concurrent edit\n");
              throw new Error("later failure");
            }
          },
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HarnessApplyError);
    expect((caught as HarnessApplyError).mutationState).toBe("rollback-incomplete");
    expect((caught as HarnessApplyError).backupDir).toContain(".farrier-staging/backups/");
    expect((caught as HarnessApplyError).message).toContain((caught as HarnessApplyError).backupDir!);
    expect(await readFile(first, "utf8")).toBe("concurrent edit\n");
    expect(await readFile(join(dir, "second.txt"), "utf8")).toBe("second original\n");
    expect(await readFile(join(dir, (caught as HarnessApplyError).backupDir!, "first.txt"), "utf8")).toBe("first original\n");
    expect(await readFile(join(dir, ".farrier-staging", ".gitignore"), "utf8")).toBe("*\n");
  });
});
