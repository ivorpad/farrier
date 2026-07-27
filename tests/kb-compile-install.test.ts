import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyKbCompilePlan, compileKbPlan } from "../src/engine/kb-compile";
import { installTasteGuard } from "../src/engine/kb-compile-install";
import type { PreferenceKb } from "../src/engine/preference-kb";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { resolvePack } from "../src/packs/index";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kb-install-"));
}

async function createProject(hooks: string[] = []): Promise<string> {
  const targetDir = await tempDir();
  const base = resolvePack("python-fastapi");
  const pack = { ...base, hooks: [...base.hooks, ...hooks] as typeof base.hooks };
  await writeRenderPlan(await createRenderPlan({ targetDir, pack, agents: ["claude", "codex"] }));
  return targetDir;
}

async function writeKb(targetDir: string, kb: PreferenceKb): Promise<void> {
  await writeFile(join(targetDir, ".farrier", "preferences.json"), JSON.stringify(kb, null, 2), "utf8");
}

async function readJson(targetDir: string, path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(targetDir, path), "utf8")) as Record<string, unknown>;
}

const lintableKb: PreferenceKb = {
  version: 1,
  rules: [{ id: "no-broad-except", rule: "Do not catch bare Exception.", tier: "lintable", evidence: ["cluster 1"], addedAt: "2026-07-27" }]
};

describe("taste-context hook render", () => {
  test("renders the UserPromptSubmit hook Claude-side only", async () => {
    const targetDir = await tempDir();
    const base = resolvePack("generic");
    const pack = { ...base, hooks: [...base.hooks, "taste-context" as const] };
    const plan = await createRenderPlan({ targetDir, pack, agents: ["claude", "codex"] });

    const hook = plan.files.find((file) => file.path === ".farrier/hooks/taste-context.py");
    expect(hook).toBeDefined();
    expect(hook!.content).toContain('HOOK_NAME = "taste-context"');

    const settings = plan.files.find((file) => file.path === ".claude/settings.json");
    expect(settings!.content).toContain("UserPromptSubmit");
    expect(settings!.content).toContain("taste-context.py");

    const codexHooks = plan.files.find((file) => file.path === ".codex/hooks.json");
    expect(codexHooks?.content ?? "").not.toContain("taste-context.py");
  });
});

describe("installTasteGuard lifecycle", () => {
  test("a lintable rule is skipped until patterns are installed, then compiles to a taste-guard target", async () => {
    const targetDir = await createProject();
    await writeKb(targetDir, lintableKb);

    // Before authoring: no patterns, so the lintable rule is skipped.
    const before = await compileKbPlan({ kb: lintableKb, targetDir });
    expect(before.targets).toHaveLength(0);
    expect(before.skipped[0]?.reason).toBe("no reviewed patterns yet — author patterns first");

    // The review step: install the reviewed patterns + wire the hook.
    const result = await installTasteGuard({
      targetDir,
      patterns: [{ ruleId: "no-broad-except", patterns: ["except\\s*:"], message: "Catch a specific exception." }]
    });
    expect(result.written.length).toBeGreaterThan(0);

    const manifest = await readJson(targetDir, ".farrier.json");
    expect(manifest.hookIds).toContain("taste-guard");
    const guards = manifest.guards as { tasteGuard?: { rules?: Array<{ ruleId: string }> } };
    expect(guards.tasteGuard?.rules?.[0]?.ruleId).toBe("no-broad-except");
    const hookExists = await readFile(join(targetDir, ".farrier", "hooks", "taste-guard.py"), "utf8");
    expect(hookExists).toContain('HOOK_NAME = "taste-guard"');

    // After installing: the lintable rule now compiles to a taste-guard target.
    const after = await compileKbPlan({ kb: lintableKb, targetDir });
    expect(after.targets).toContainEqual({ kind: "taste-guard", ruleId: "no-broad-except" });

    // Applying the plan mirrors the rule text into AGENTS.md (the codex words layer).
    await applyKbCompilePlan({ targetDir, kb: lintableKb, plan: after, force: true });
    const agentsMd = await readFile(join(targetDir, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("- Do not catch bare Exception.");
  });

  test("installing over existing patterns is idempotent and keeps them", async () => {
    const targetDir = await createProject();
    await installTasteGuard({
      targetDir,
      patterns: [{ ruleId: "no-broad-except", patterns: ["except\\s*:"], message: "Catch a specific exception." }]
    });
    await installTasteGuard({ targetDir }); // no new patterns — just re-assert the hook

    const manifest = await readJson(targetDir, ".farrier.json");
    const rules = (manifest.guards as { tasteGuard: { rules: unknown[] } }).tasteGuard.rules;
    expect(rules).toHaveLength(1);
  });

  test("re-authoring a ruleId replaces its patterns instead of accumulating stale ones", async () => {
    const targetDir = await createProject();
    await installTasteGuard({ targetDir, patterns: [{ ruleId: "x", patterns: ["aaa"], message: "old" }] });
    await installTasteGuard({ targetDir, patterns: [{ ruleId: "x", patterns: ["bbb"], message: "new" }] });

    const manifest = await readJson(targetDir, ".farrier.json");
    const rules = (manifest.guards as { tasteGuard: { rules: Array<{ ruleId: string; patterns: string[]; message: string }> } }).tasteGuard.rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({ ruleId: "x", patterns: ["bbb"], message: "new" });
  });

  test("a second ruleId is appended alongside the first, each kept once", async () => {
    const targetDir = await createProject();
    await installTasteGuard({ targetDir, patterns: [{ ruleId: "x", patterns: ["aaa"], message: "mx" }] });
    await installTasteGuard({ targetDir, patterns: [{ ruleId: "y", patterns: ["bbb"], message: "my" }] });

    const manifest = await readJson(targetDir, ".farrier.json");
    const rules = (manifest.guards as { tasteGuard: { rules: Array<{ ruleId: string }> } }).tasteGuard.rules;
    expect(rules.map((rule) => rule.ruleId)).toEqual(["x", "y"]);
  });
});
