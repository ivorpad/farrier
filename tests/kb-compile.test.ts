import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyKbCompilePlan,
  buildKbCompileFiles,
  compileKbPlan,
  upsertMarkedLine,
  withTomlInstructions,
  type KbCompilePlan
} from "../src/engine/kb-compile";
import {
  buildTasteGuardPrompt,
  validateTasteGuardPatterns,
  type TasteGuardRule
} from "../src/engine/kb-taste-authoring";
import type { PreferenceKb, PreferenceRule, PreferenceTier } from "../src/engine/preference-kb";
import { renderClaudeSubagentMd, renderSubagentToml } from "../src/engine/render-playbook";
import { createRenderPlan } from "../src/engine/render";
import { resolvePack } from "../src/packs/index";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "kb-compile-"));
}

function rule(id: string, tier: PreferenceTier, overrides: Partial<PreferenceRule> = {}): PreferenceRule {
  return {
    id,
    rule: overrides.rule ?? `Rule ${id} in one sentence.`,
    tier,
    ...(overrides.owner ? { owner: overrides.owner } : {}),
    evidence: overrides.evidence ?? ["steer 1"],
    addedAt: overrides.addedAt ?? "2026-07-27"
  };
}

function kb(rules: PreferenceRule[]): PreferenceKb {
  return { version: 1, rules };
}

async function writeSubagent(dir: string, name: string, opts: { claude?: boolean; codex?: boolean } = { claude: true, codex: true }): Promise<void> {
  const subagent = {
    name,
    description: "Reviews proposed changes against the team's conventions before they land.",
    developerInstructions: `You are the ${name} reviewer.\n\nJudge each diff against the team's conventions and call out violations.`
  };
  if (opts.claude) {
    await mkdir(join(dir, ".claude", "agents"), { recursive: true });
    await writeFile(join(dir, ".claude", "agents", `${name}.md`), renderClaudeSubagentMd(subagent), "utf8");
  }
  if (opts.codex) {
    await mkdir(join(dir, ".codex", "agents"), { recursive: true });
    await writeFile(join(dir, ".codex", "agents", `${name}.toml`), renderSubagentToml(subagent), "utf8");
  }
}

async function writeManifestWithTastePatterns(dir: string, rules: TasteGuardRule[]): Promise<void> {
  const manifest = {
    packIds: ["generic"],
    hookIds: ["taste-guard"],
    guards: { tasteGuard: { rules } }
  };
  await writeFile(join(dir, ".farrier.json"), JSON.stringify(manifest, null, 2), "utf8");
}

describe("compileKbPlan routing", () => {
  test("routes each tier to its primitive and skips with reasons", async () => {
    const dir = await tempDir();
    await writeSubagent(dir, "code-reviewer");
    await writeManifestWithTastePatterns(dir, [
      { ruleId: "no-inline-imports", patterns: ["def \\w+\\("], message: "imports at module top" }
    ]);

    const plan = await compileKbPlan({
      targetDir: dir,
      kb: kb([
        rule("declarative-global", "declarative"),
        rule("declarative-owned", "declarative", { owner: "code-reviewer" }),
        rule("declarative-missing-owner", "declarative", { owner: "ghost-agent" }),
        rule("judgment-owned", "judgment", { owner: "code-reviewer" }),
        rule("judgment-orphan", "judgment"),
        rule("no-inline-imports", "lintable"),
        rule("lintable-unpatterned", "lintable")
      ])
    });

    expect(plan.targets).toContainEqual({ kind: "agents-md-rule", ruleId: "declarative-global", line: "Rule declarative-global in one sentence." });
    expect(plan.targets).toContainEqual({ kind: "subagent-rule", owner: "code-reviewer", ruleId: "declarative-owned", line: "Rule declarative-owned in one sentence." });
    expect(plan.targets).toContainEqual({ kind: "reviewer-checklist", owner: "code-reviewer", ruleId: "judgment-owned", item: "Rule judgment-owned in one sentence." });
    expect(plan.targets).toContainEqual({ kind: "taste-guard", ruleId: "no-inline-imports" });

    const skipReason = (id: string): string | undefined => plan.skipped.find((entry) => entry.ruleId === id)?.reason;
    expect(skipReason("declarative-missing-owner")).toContain('owner subagent "ghost-agent" does not exist');
    expect(skipReason("judgment-orphan")).toContain("judgment rule needs a reviewer");
    expect(skipReason("lintable-unpatterned")).toBe("no reviewed patterns yet — author patterns first");
    expect(plan.targets).toHaveLength(4);
    expect(plan.skipped).toHaveLength(3);
  });

  test("a subagent present on only one side still counts as existing", async () => {
    const dir = await tempDir();
    await writeSubagent(dir, "codex-only", { codex: true });

    const plan = await compileKbPlan({ targetDir: dir, kb: kb([rule("owned", "declarative", { owner: "codex-only" })]) });
    expect(plan.targets).toContainEqual({ kind: "subagent-rule", owner: "codex-only", ruleId: "owned", line: "Rule owned in one sentence." });
  });

  test("a KB version other than 1 fails loud", async () => {
    const dir = await tempDir();
    const badKb = { version: 2, rules: [] } as unknown as PreferenceKb;
    await expect(compileKbPlan({ targetDir: dir, kb: badKb })).rejects.toThrow("only understands version 1");
  });

  test("no manifest means every lintable rule is skipped for lack of patterns", async () => {
    const dir = await tempDir();
    const plan = await compileKbPlan({ targetDir: dir, kb: kb([rule("lint", "lintable")]) });
    expect(plan.targets).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe("no reviewed patterns yet — author patterns first");
  });
});

describe("buildKbCompileFiles rendering", () => {
  test("declarative rule with no owner renders one AGENTS.md Hard Rules line", async () => {
    const dir = await tempDir();
    const plan: KbCompilePlan = { targets: [{ kind: "agents-md-rule", ruleId: "r", line: "Prefer composition over inheritance." }], skipped: [] };
    const files = await buildKbCompileFiles({ targetDir: dir, kb: kb([rule("r", "declarative", { rule: "Prefer composition over inheritance." })]), plan });

    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("AGENTS.md");
    expect(files[0]!.content).toContain("## Hard Rules");
    expect(files[0]!.content).toContain("- Prefer composition over inheritance.");
  });

  test("taste-guard target mirrors the rule text into AGENTS.md", async () => {
    const dir = await tempDir();
    const kbData = kb([rule("no-inline-imports", "lintable", { rule: "Do not import inside function bodies." })]);
    const plan: KbCompilePlan = { targets: [{ kind: "taste-guard", ruleId: "no-inline-imports" }], skipped: [] };
    const files = await buildKbCompileFiles({ targetDir: dir, kb: kbData, plan });

    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("AGENTS.md");
    expect(files[0]!.content).toContain("- Do not import inside function bodies.");
  });

  test("subagent-rule writes both the Claude .md and the Codex .toml", async () => {
    const dir = await tempDir();
    await writeSubagent(dir, "code-reviewer");
    const plan: KbCompilePlan = { targets: [{ kind: "subagent-rule", owner: "code-reviewer", ruleId: "reuse", line: "Reuse existing helpers before writing new ones." }], skipped: [] };
    const files = await buildKbCompileFiles({ targetDir: dir, kb: kb([rule("reuse", "declarative", { owner: "code-reviewer" })]), plan });

    const md = files.find((file) => file.path === ".claude/agents/code-reviewer.md");
    const toml = files.find((file) => file.path === ".codex/agents/code-reviewer.toml");
    expect(md?.content).toContain("## Rules");
    expect(md?.content).toContain("- Reuse existing helpers before writing new ones. <!-- kb:reuse -->");
    expect(toml?.content).toContain("## Rules");
    expect(toml?.content).toContain("- Reuse existing helpers before writing new ones. <!-- kb:reuse -->");
    // The mirrored TOML is still a valid developer_instructions block.
    expect(toml?.content).toContain('developer_instructions = """');
  });

  test("reviewer-checklist appends under a Review checklist heading", async () => {
    const dir = await tempDir();
    await writeSubagent(dir, "code-reviewer", { claude: true });
    const plan: KbCompilePlan = { targets: [{ kind: "reviewer-checklist", owner: "code-reviewer", ruleId: "tests", item: "Every new module has a direct test." }], skipped: [] };
    const files = await buildKbCompileFiles({ targetDir: dir, kb: kb([rule("tests", "judgment", { owner: "code-reviewer" })]), plan });

    const md = files.find((file) => file.path === ".claude/agents/code-reviewer.md");
    expect(md?.content).toContain("## Review checklist");
    expect(md?.content).toContain("- Every new module has a direct test. <!-- kb:tests -->");
  });
});

describe("applyKbCompilePlan atomic + idempotent", () => {
  test("applying the same plan twice leaves byte-identical files", async () => {
    const dir = await tempDir();
    await writeSubagent(dir, "code-reviewer");
    await writeManifestWithTastePatterns(dir, [{ ruleId: "no-inline-imports", patterns: ["import"], message: "top-level imports" }]);
    const kbData = kb([
      rule("global-rule", "declarative", { rule: "Keep functions short." }),
      rule("owned-rule", "declarative", { owner: "code-reviewer", rule: "Name booleans as predicates." }),
      rule("review-rule", "judgment", { owner: "code-reviewer", rule: "Confirm error paths are tested." }),
      rule("no-inline-imports", "lintable", { rule: "Do not import inside functions." })
    ]);

    const plan = await compileKbPlan({ targetDir: dir, kb: kbData });
    await applyKbCompilePlan({ targetDir: dir, kb: kbData, plan, force: true });
    const snapshot = await Promise.all(
      ["AGENTS.md", ".claude/agents/code-reviewer.md", ".codex/agents/code-reviewer.toml"].map((path) => readFile(join(dir, path), "utf8"))
    );

    const secondPlan = await compileKbPlan({ targetDir: dir, kb: kbData });
    const result = await applyKbCompilePlan({ targetDir: dir, kb: kbData, plan: secondPlan, force: true });
    const after = await Promise.all(
      ["AGENTS.md", ".claude/agents/code-reviewer.md", ".codex/agents/code-reviewer.toml"].map((path) => readFile(join(dir, path), "utf8"))
    );

    expect(after).toEqual(snapshot);
    expect(result.written).toHaveLength(0);
    // Each marked line appears exactly once after two applies.
    expect(after[1]!.split("<!-- kb:owned-rule -->").length - 1).toBe(1);
    expect(after[2]!.split("<!-- kb:owned-rule -->").length - 1).toBe(1);
  });

  test("recompiling a changed rule text replaces the marked line in place", async () => {
    const dir = await tempDir();
    await writeSubagent(dir, "code-reviewer");
    const first = kb([rule("owned", "declarative", { owner: "code-reviewer", rule: "Old wording." })]);
    let plan = await compileKbPlan({ targetDir: dir, kb: first });
    await applyKbCompilePlan({ targetDir: dir, kb: first, plan, force: true });

    const second = kb([rule("owned", "declarative", { owner: "code-reviewer", rule: "New wording." })]);
    plan = await compileKbPlan({ targetDir: dir, kb: second });
    await applyKbCompilePlan({ targetDir: dir, kb: second, plan, force: true });

    const md = await readFile(join(dir, ".claude", "agents", "code-reviewer.md"), "utf8");
    expect(md).toContain("- New wording. <!-- kb:owned -->");
    expect(md).not.toContain("Old wording");
    expect(md.split("<!-- kb:owned -->").length - 1).toBe(1);
  });
});

describe("upsert + toml helpers", () => {
  test("upsertMarkedLine replaces by ruleId and is idempotent", () => {
    const once = upsertMarkedLine("Body text.", "## Rules", "a", "First rule.");
    expect(once).toContain("## Rules");
    expect(upsertMarkedLine(once, "## Rules", "a", "First rule.")).toBe(once);
    const updated = upsertMarkedLine(once, "## Rules", "a", "First rule reworded.");
    expect(updated).toContain("- First rule reworded. <!-- kb:a -->");
    expect(updated.split("<!-- kb:a -->").length - 1).toBe(1);
    const added = upsertMarkedLine(updated, "## Rules", "b", "Second rule.");
    expect(added).toContain("- First rule reworded. <!-- kb:a -->");
    expect(added).toContain("- Second rule. <!-- kb:b -->");
  });

  test("withTomlInstructions round-trips a body containing backslashes and triple quotes", () => {
    const toml = renderSubagentToml({
      name: "r",
      description: "d that is long enough to be a real description here",
      developerInstructions: 'Escape \\ and """ carefully in instructions.'
    });
    const out = withTomlInstructions(toml, (body) => `${body}\n\n## Rules\n\n- x <!-- kb:x -->`);
    expect(out).toBeDefined();
    expect(out).toContain("- x <!-- kb:x -->");
    // Re-reading the block must un-escape back to the exact original body plus edit.
    let captured = "";
    withTomlInstructions(out!, (body) => {
      captured = body;
      return body;
    });
    expect(captured).toContain('Escape \\ and """ carefully in instructions.');
    expect(captured).toContain("- x <!-- kb:x -->");
    // A file without the block returns undefined so the caller can fail loud.
    expect(withTomlInstructions("name = \"r\"\n", () => "x")).toBeUndefined();
  });
});

describe("taste-guard hook render + fail-open", () => {
  test("selecting the hook renders its script and binding", async () => {
    const dir = await tempDir();
    const base = resolvePack("generic");
    const pack = { ...base, hooks: [...base.hooks, "taste-guard" as const] };
    const plan = await createRenderPlan({ targetDir: dir, pack, agents: ["claude", "codex"] });

    const hookFile = plan.files.find((file) => file.path === ".farrier/hooks/taste-guard.py");
    expect(hookFile).toBeDefined();
    expect(hookFile!.content).toContain('HOOK_NAME = "taste-guard"');
    const settings = plan.files.find((file) => file.path === ".claude/settings.json");
    expect(settings!.content).toContain("taste-guard.py");
    // Claude-side only: codex hook dispatch is unreliable, so no codex binding.
    const codexHooks = plan.files.find((file) => file.path === ".codex/hooks.json");
    expect(codexHooks?.content ?? "").not.toContain("taste-guard.py");
    // The manifest seeds an empty tasteGuard rules record for the user to fill.
    const manifest = plan.files.find((file) => file.path === ".farrier.json");
    expect(manifest!.content).toContain("tasteGuard");
  });

  test("the rendered hook fails open with no manifest and denies a matching edit", async () => {
    const dir = await tempDir();
    const base = resolvePack("generic");
    const pack = { ...base, hooks: [...base.hooks, "taste-guard" as const] };
    const plan = await createRenderPlan({ targetDir: dir, pack, agents: ["claude"] });
    await mkdir(join(dir, ".farrier", "hooks"), { recursive: true });
    for (const name of ["taste-guard.py", "_hook_runtime.py"]) {
      const file = plan.files.find((entry) => entry.path === `.farrier/hooks/${name}`);
      await writeFile(join(dir, ".farrier", "hooks", name), file!.content, "utf8");
    }
    const hookPath = join(dir, ".farrier", "hooks", "taste-guard.py");
    const payload = (newString: string): string =>
      JSON.stringify({ cwd: dir, hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { new_string: newString, old_string: "" } });

    const run = (json: string) => Bun.spawnSync(["python3", hookPath], { cwd: dir, stdin: Buffer.from(json) });

    // No manifest at all: the guard must fail open (empty stdout = allow).
    const noManifest = run(payload("def handler():\n    import os"));
    expect(noManifest.exitCode).toBe(0);
    expect(noManifest.stdout.toString()).toBe("");

    // With a reviewed rule, a matching edit is denied and cites the ruleId.
    await writeManifestWithTastePatterns(dir, [
      { ruleId: "no-inline-imports", patterns: ["def \\w+\\([^)]*\\):\\n\\s+import "], message: "Put imports at module top." }
    ]);
    const denied = run(payload("def handler():\n    import os"));
    expect(denied.exitCode).toBe(0);
    const decision = JSON.parse(denied.stdout.toString());
    expect(decision.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain("no-inline-imports");

    // A clean edit passes.
    const allowed = run(payload("import os\n\ndef handler():\n    return os"));
    expect(allowed.stdout.toString()).toBe("");
  });
});

describe("taste-guard pattern validation (validate-or-drop)", () => {
  const known = new Set(["no-inline-imports", "no-broad-except"]);

  test("accepts a well-formed pattern set", () => {
    const { patterns, dropped } = validateTasteGuardPatterns(
      [{ ruleId: "no-inline-imports", patterns: ["def \\w+\\(", "import \\w"], message: "Put imports at the top." }],
      known
    );
    expect(dropped).toHaveLength(0);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.patterns).toHaveLength(2);
  });

  test("drops unknown ruleIds, uncompilable regexes, oversize patterns, long messages, and empty sets", () => {
    const { patterns, dropped } = validateTasteGuardPatterns(
      [
        { ruleId: "does-not-exist", patterns: ["x"], message: "m" },
        { ruleId: "no-inline-imports", patterns: ["([unterminated"], message: "m" },
        { ruleId: "no-broad-except", patterns: ["a".repeat(201)], message: "m" },
        { ruleId: "no-inline-imports", patterns: ["ok"], message: "m".repeat(201) },
        { ruleId: "no-broad-except", patterns: [], message: "m" },
        { ruleId: "no-broad-except", patterns: ["1", "2", "3", "4", "5", "6"], message: "m" }
      ],
      known
    );
    expect(patterns).toHaveLength(0);
    expect(dropped).toHaveLength(6);
    expect(dropped.map((entry) => entry.reason)).toEqual([
      expect.stringContaining("not one of the lintable rules"),
      expect.stringContaining("not a valid regular expression"),
      expect.stringContaining("exceeds 200 characters"),
      expect.stringContaining("message exceeds 200 characters"),
      expect.stringContaining("non-empty array"),
      expect.stringContaining("at most 5 patterns")
    ]);
  });

  test("keeps the first of a duplicated ruleId and drops the rest", () => {
    const { patterns, dropped } = validateTasteGuardPatterns(
      [
        { ruleId: "no-inline-imports", patterns: ["first"], message: "m" },
        { ruleId: "no-inline-imports", patterns: ["second"], message: "m" }
      ],
      known
    );
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.patterns).toEqual(["first"]);
    expect(dropped[0]?.reason).toContain("duplicate ruleId");
  });

  test("the prompt names only the rules being authored and forbids code fences", () => {
    const prompt = buildTasteGuardPrompt([{ ruleId: "no-inline-imports", rule: "No imports inside functions.", evidence: ["cluster 2"] }]);
    expect(prompt).toContain("no-inline-imports");
    expect(prompt).toContain("No imports inside functions.");
    expect(prompt).toContain("JSON only");
  });
});
