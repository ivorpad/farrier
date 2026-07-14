import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { resolvePack } from "../src/packs/index";
import type { ResolvedPack } from "../src/packs/types";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-render-"));
}

const allHooks = [
  "secret-shield",
  "tool-policy",
  "write-guard",
  "verb-runner",
  "quality-judge",
  "stop-judge"
] as const;

const advisorInventory = [
  ".claude/skills/harness-advisor/SKILL.md",
  ".claude/skills/claude-automation-recommender/SKILL.md",
  ".agents/skills/farrier-project-advisor/SKILL.md",
  ".claude/skills/claude-automation-recommender/UPSTREAM.md",
  ".claude/skills/claude-automation-recommender/upstream/SKILL.md",
  ".claude/skills/claude-automation-recommender/upstream/LICENSE.txt",
  ".claude/skills/claude-automation-recommender/upstream/references/hooks-patterns.md",
  ".claude/skills/claude-automation-recommender/upstream/references/mcp-servers.md",
  ".claude/skills/claude-automation-recommender/upstream/references/plugins-reference.md",
  ".claude/skills/claude-automation-recommender/upstream/references/skills-reference.md",
  ".claude/skills/claude-automation-recommender/upstream/references/subagent-templates.md"
];

const pythonFastapiInventory = [
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/settings.json",
  ...advisorInventory,
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
  ".gitignore"
];

// ts-react-vite renders the same inventory as python-fastapi except the
// structure-check config is konsistent.json (npm konsistent) instead of konpy.json.
const tsReactViteInventory = pythonFastapiInventory.map((path) =>
  path === "konpy.json" ? "konsistent.json" : path
);

const railsInventory = [
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/settings.json",
  ...advisorInventory,
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

const genericInventory = [
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/settings.json",
  ...advisorInventory,
  ".claude/hooks/secret-shield.py",
  ".claude/hooks/test_secret_shield.py",
  ".claude/hooks/tool-policy.py",
  ".claude/hooks/test_tool_policy.py",
  ".claude/hooks/write-guard.py",
  ".claude/hooks/test_write_guard.py",
  ".claude/hooks/quality-judge.py",
  ".claude/hooks/test_quality_judge.py",
  ".claude/hooks/tool-policy-rules.json",
  ".claude/hooks/prompts/quality-judge-v1.txt",
  "justfile",
  ".farrier.json",
  ".gitignore"
];

describe("render engine", () => {
  test("creates the complete python-fastapi inventory", async () => {
    const dir = await tempDir();
    const pack = resolvePack("python-fastapi");

    const plan = await createRenderPlan({ targetDir: dir, pack });

    expect(plan.files.map((file) => file.path)).toEqual(pythonFastapiInventory);
    expect(plan.files).toHaveLength(33);
  });

  test("renders harness-advisor skill into every pack inventory", async () => {
    const dir = await tempDir();
    const pack = resolvePack("python-fastapi");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    const skill = plan.files.find((file) => file.path === ".claude/skills/harness-advisor/SKILL.md");

    expect(skill).toBeDefined();
    expect(skill?.content).toContain("name: harness-advisor");
    expect(skill?.content).toContain("farrier update --dir .");
    expect(skill?.content).toContain("Never edit `.farrier.json` by hand");
    expect(skill?.content).toContain("skills find <query>");
    expect(skill?.content).toContain("skill-creator");
  });

  test("renders both advice wrappers and the pinned attributed Anthropic snapshot", async () => {
    const dir = await tempDir();
    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("generic") });
    const byPath = new Map(plan.files.map((file) => [file.path, file.content]));
    const claude = byPath.get(".claude/skills/claude-automation-recommender/SKILL.md") ?? "";
    const codex = byPath.get(".agents/skills/farrier-project-advisor/SKILL.md") ?? "";
    const provenance = byPath.get(".claude/skills/claude-automation-recommender/UPSTREAM.md") ?? "";

    expect(claude).toContain("farrier advise --dir . --sessions auto --since 7d --targets claude");
    expect(codex).toContain("farrier advise --dir . --sessions auto --since 7d --targets codex");
    expect(provenance).toContain("a5c7fb5d86a4cd34c4f47819658654c3d8f08dda");
    expect(provenance).toContain("Apache-2.0");

    for (const path of advisorInventory.filter((path) => path.includes("/upstream/"))) {
      const content = byPath.get(path);
      expect(content).toBeDefined();
      const hash = createHash("sha256").update(content!).digest("hex");
      expect(provenance).toContain(`\`${hash}\``);
    }
  });

  test("renders AGENTS.md with required sections and pack-owned Python hard rules", async () => {
    const dir = await tempDir();
    const pack = resolvePack("python-fastapi");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    const agents = plan.files.find((file) => file.path === "AGENTS.md")?.content ?? "";

    expect(agents).toContain("# Project Agent Instructions");
    expect(agents).toContain("## Commands");
    expect(agents).toContain("## Hard Rules");
    expect(agents).toContain("- Konpy: `uv run --with /Users/ivor/src/tries/2026-07-02-konsistent-python konpy check`");
    expect(agents).toContain("tracked examples such as `.env.example` are allowed");
    expect(agents).toContain("Use `uv` for Python dependency and command execution");
    expect(agents).toContain("Do not use `pip install`, `pip3 install`, or `python -m pip`");
    expect(agents).toContain("Run Python scripts through `uv run python ...`");
    expect(agents).toContain("lockfiles, `.git/`, `skills-lock.json`, or `.farrier.json`");
    expect(agents).toContain("Run `just konpy` before stopping");
    expect(agents).toContain("quality.maxFileLines");
    expect(agents).toContain("LLM semantic judge hooks are present but disabled by default");
    expect(agents).toContain("## Accepted Risks");
    expect(agents).toContain("/Users/ivor/src/tries/2026-07-02-konsistent-python");
    expect(agents).toContain("git dependency, then PyPI");
  });

  test("renders Claude settings with exact hook commands matchers and ordering", async () => {
    const dir = await tempDir();
    const pack = resolvePack("python-fastapi");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    const settingsFile = plan.files.find((file) => file.path === ".claude/settings.json");
    expect(settingsFile).toBeDefined();

    const settings = JSON.parse(settingsFile!.content);

    expect(settings.hooks.PreToolUse.map((entry: { matcher: string }) => entry.matcher)).toEqual([
      "Read|Bash|Grep",
      "Bash",
      "Edit|Write|MultiEdit|NotebookEdit"
    ]);
    expect(settings.hooks.PreToolUse.map((entry: { hooks: { command: string }[] }) => entry.hooks[0].command)).toEqual([
      'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/secret-shield.py"',
      'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/tool-policy.py"',
      'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/write-guard.py"'
    ]);

    expect(settings.hooks.PostToolUse.map((entry: { matcher: string }) => entry.matcher)).toEqual([
      "Edit|Write|MultiEdit|NotebookEdit",
      "Edit|Write|MultiEdit|NotebookEdit"
    ]);
    expect(settings.hooks.PostToolUse.map((entry: { hooks: { command: string }[] }) => entry.hooks[0].command)).toEqual([
      'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verb-runner.py"',
      'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/quality-judge.py"'
    ]);

    expect(settings.hooks.Stop.map((entry: { hooks: { command: string }[] }) => entry.hooks[0].command)).toEqual([
      'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verb-runner.py"',
      'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-judge.py"'
    ]);
    expect(settings.hooks.Stop[0].matcher).toBeUndefined();
    expect(settings.hooks.Stop[1].matcher).toBeUndefined();
  });

  test("renders Claude-only by default and persists the normalized selection", async () => {
    const dir = await tempDir();
    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("generic") });
    const paths = plan.files.map((file) => file.path);
    const manifest = JSON.parse(plan.files.find((file) => file.path === ".farrier.json")!.content);

    expect(paths).toContain(".claude/settings.json");
    expect(paths).not.toContain(".codex/hooks.json");
    expect(manifest.agents).toEqual(["claude"]);
  });

  test("renders the released Codex hook mappings without a second policy system", async () => {
    const dir = await tempDir();
    const plan = await createRenderPlan({
      targetDir: dir,
      pack: resolvePack("python-fastapi"),
      agents: ["codex"]
    });
    const paths = plan.files.map((file) => file.path);
    const hooks = JSON.parse(plan.files.find((file) => file.path === ".codex/hooks.json")!.content).hooks;
    const bindings = Object.entries(hooks).flatMap(([event, entries]) =>
      (entries as Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>).map((entry) => ({
        event,
        matcher: entry.matcher,
        handlers: entry.hooks
      }))
    );

    expect(paths).not.toContain(".claude/settings.json");
    expect(paths).toContain(".codex/hooks.json");
    expect(paths.filter((path) => path === ".claude/hooks/tool-policy-rules.json")).toHaveLength(1);
    expect(paths.some((path) => path.endsWith(".rules"))).toBe(false);
    expect(paths).not.toContain(".codex/config.toml");
    expect(bindings).toEqual([
      {
        event: "PreToolUse",
        matcher: "^Bash$",
        handlers: [{ type: "command", command: 'python3 "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/hooks/secret-shield.py"' }]
      },
      {
        event: "PreToolUse",
        matcher: "^Bash$",
        handlers: [{ type: "command", command: 'python3 "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/hooks/tool-policy.py"' }]
      },
      {
        event: "PreToolUse",
        matcher: "^apply_patch$",
        handlers: [{ type: "command", command: 'python3 "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/hooks/write-guard.py"' }]
      },
      {
        event: "PostToolUse",
        matcher: "^apply_patch$",
        handlers: [{ type: "command", command: 'python3 "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/hooks/verb-runner.py"' }]
      },
      {
        event: "PostToolUse",
        matcher: "^apply_patch$",
        handlers: [{ type: "command", command: 'python3 "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/hooks/quality-judge.py"' }]
      },
      {
        event: "Stop",
        matcher: undefined,
        handlers: [{ type: "command", command: 'python3 "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/hooks/verb-runner.py"' }]
      },
      {
        event: "Stop",
        matcher: undefined,
        handlers: [{ type: "command", command: 'python3 "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/hooks/stop-judge.py"' }]
      }
    ]);

    const manifest = JSON.parse(plan.files.find((file) => file.path === ".farrier.json")!.content);
    expect(manifest.agents).toEqual(["codex"]);
  });

  test("renders both native bindings while sharing scripts and rules", async () => {
    const dir = await tempDir();
    const plan = await createRenderPlan({
      targetDir: dir,
      pack: resolvePack("python-fastapi"),
      agents: ["codex", "claude"]
    });
    const paths = plan.files.map((file) => file.path);
    const manifest = JSON.parse(plan.files.find((file) => file.path === ".farrier.json")!.content);
    const agents = plan.files.find((file) => file.path === "AGENTS.md")!.content;

    expect(paths).toContain(".claude/settings.json");
    expect(paths).toContain(".codex/hooks.json");
    expect(paths.filter((path) => path === ".claude/hooks/tool-policy-rules.json")).toHaveLength(1);
    expect(manifest.agents).toEqual(["claude", "codex"]);
    expect(agents).toContain("project and hook definitions require trust");
    expect(agents).toContain("`/hooks` shows runtime status");
    expect(agents).toContain("`unified_exec` interception remains incomplete");
    expect(agents).toContain("native reads, search, WebSearch");
    expect(agents).toContain("PostToolUse feedback cannot undo");
  });

  test("renders Claude settings and hook files from selected hooks only", async () => {
    const dir = await tempDir();
    const basePack = resolvePack("python-fastapi");
    const pack: ResolvedPack = {
      ...basePack,
      hooks: ["secret-shield"]
    };

    const plan = await createRenderPlan({ targetDir: dir, pack });
    const settingsFile = plan.files.find((file) => file.path === ".claude/settings.json");
    expect(settingsFile).toBeDefined();

    const settings = JSON.parse(settingsFile!.content);

    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe(
      'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/secret-shield.py"'
    );
    expect(settings.hooks.PostToolUse).toBeUndefined();
    expect(settings.hooks.Stop).toBeUndefined();
    expect(settingsFile!.content).not.toContain("verb-runner.py");
    expect(settingsFile!.content).not.toContain("tool-policy.py");
    expect(settingsFile!.content).not.toContain("quality-judge.py");
    expect(settingsFile!.content).not.toContain("stop-judge.py");

    expect(plan.files.map((file) => file.path)).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      ".claude/settings.json",
      ...advisorInventory,
      ".claude/hooks/secret-shield.py",
      ".claude/hooks/test_secret_shield.py",
      "justfile",
      "konpy.json",
      ".farrier.json",
      ".gitignore"
    ]);
  });

  test("renders tool-policy rules JSON from pack-owned inherited Python rules", async () => {
    const dir = await tempDir();
    const pack = resolvePack("python-fastapi");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    const rulesFile = plan.files.find((file) => file.path === ".claude/hooks/tool-policy-rules.json");
    expect(rulesFile).toBeDefined();

    const rules = JSON.parse(rulesFile!.content);

    expect(rules.version).toBe(1);
    expect(rules.rules.map((rule: { id: string }) => rule.id)).toEqual([
      "python-use-uv-not-python-m-pip",
      "python-use-uv-not-pip-install",
      "python-run-scripts-through-uv"
    ]);
    expect(rules.rules[0].tool).toBe("Bash");
    expect(rules.rules[0].redirect).toContain("uv add");
    expect(rules.rules[2].redirect).toContain("uv run python");
  });

  test("renders prompt templates when judge hooks are selected", async () => {
    const dir = await tempDir();
    const pack = resolvePack("python-fastapi");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    const qualityPrompt = plan.files.find((file) => file.path === ".claude/hooks/prompts/quality-judge-v1.txt");
    const stopPrompt = plan.files.find((file) => file.path === ".claude/hooks/prompts/stop-judge-v1.txt");

    expect(qualityPrompt?.content).toContain("Farrier's per-edit semantic quality judge");
    expect(stopPrompt?.content).toContain("Farrier's full-turn semantic stop judge");
  });

  test("renders manifest with pack hook ids skills judge quality and version defaults", async () => {
    const dir = await tempDir();
    const pack = resolvePack("python-fastapi");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    const manifestFile = plan.files.find((file) => file.path === ".farrier.json");
    expect(manifestFile).toBeDefined();

    const manifest = JSON.parse(manifestFile!.content);

    expect(manifest.farrierVersion).toBe("0.3.0");
    expect(manifest.agents).toEqual(["claude"]);
    expect(manifest.packIds).toEqual(["python-uv", "python-fastapi"]);
    expect(manifest.hookIds).toEqual([...allHooks]);
    expect(manifest.skills).toEqual(pack.skills);
    expect(manifest.secondaryAcknowledged).toEqual([]);
    expect(manifest.learn).toEqual({ enabled: false });
    expect(manifest.judge).toEqual({
      perEdit: {
        enabled: false,
        backend: "claude",
        model: "haiku",
        timeoutMs: 15000,
        prompt: ".claude/hooks/prompts/quality-judge-v1.txt"
      },
      stop: {
        enabled: false,
        backend: "claude",
        model: "sonnet",
        timeoutMs: 30000,
        prompt: ".claude/hooks/prompts/stop-judge-v1.txt",
        maxDiffBytes: 120000,
        maxUntrackedFiles: 50
      }
    });
    expect(manifest.quality).toEqual({ maxFileLines: 500 });
    expect(manifest.versions.farrierManifest).toBe(2);
    expect(manifest.versions.hooks).toEqual({
      "secret-shield": 2,
      "tool-policy": 1,
      "write-guard": 2,
      "verb-runner": 2,
      "quality-judge": 2,
      "stop-judge": 1
    });
    expect(manifest.versions.prompts).toEqual({
      qualityJudge: "v1",
      stopJudge: "v1"
    });
    expect(manifest.registry).toBeUndefined();
  });

  test("renders remote hook settings files versions and registry pins", async () => {
    const dir = await tempDir();
    const basePack = resolvePack("generic");
    const pack: ResolvedPack = {
      ...basePack,
      hooks: [...basePack.hooks, "@acme/guard"],
      remoteHooks: [
        {
          id: "@acme/guard",
          version: "1.2.3",
          sha256: "abc123".padEnd(64, "0"),
          fromCache: false,
          hookVersion: 7,
          events: [
            { event: "PreToolUse", matcher: "Bash" },
            { event: "Stop" }
          ],
          entry: "guard.sh",
          runner: "bash",
          files: [
            { path: "guard.sh", content: "#!/usr/bin/env bash\necho guard\n" },
            { path: "lib/helper.sh", content: "echo helper\n", executable: true }
          ]
        }
      ]
    };

    const plan = await createRenderPlan({
      targetDir: dir,
      pack,
      agents: ["claude", "codex"],
      registryPins: {
        "@acme/guard": {
          type: "hook",
          version: "1.2.3",
          sha256: "abc123".padEnd(64, "0")
        },
        "@acme/demo": {
          type: "pack",
          version: "2.0.0",
          sha256: "def456".padEnd(64, "0")
        }
      }
    });

    const settings = JSON.parse(plan.files.find((file) => file.path === ".claude/settings.json")!.content);
    expect(settings.hooks.PreToolUse.at(-1)).toEqual({
      matcher: "Bash",
      hooks: [
        {
          type: "command",
          command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/@acme/guard/guard.sh"'
        }
      ]
    });
    expect(settings.hooks.Stop.at(-1)).toEqual({
      hooks: [
        {
          type: "command",
          command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/@acme/guard/guard.sh"'
        }
      ]
    });
    const codexHooks = plan.files.find((file) => file.path === ".codex/hooks.json")!.content;
    expect(codexHooks).not.toContain("@acme/guard");
    expect(codexHooks).not.toContain("guard.sh");

    const remoteEntry = plan.files.find((file) => file.path === ".claude/hooks/@acme/guard/guard.sh");
    const remoteHelper = plan.files.find((file) => file.path === ".claude/hooks/@acme/guard/lib/helper.sh");
    expect(remoteEntry).toMatchObject({
      content: "#!/usr/bin/env bash\necho guard\n",
      mode: 0o755
    });
    expect(remoteHelper).toMatchObject({
      content: "echo helper\n",
      mode: 0o755
    });

    const manifest = JSON.parse(plan.files.find((file) => file.path === ".farrier.json")!.content);
    expect(manifest.hookIds).toEqual([...basePack.hooks, "@acme/guard"]);
    expect(manifest.versions.hooks["@acme/guard"]).toBe(7);
    expect(manifest.registry.items).toEqual({
      "@acme/guard": {
        type: "hook",
        version: "1.2.3",
        sha256: "abc123".padEnd(64, "0")
      },
      "@acme/demo": {
        type: "pack",
        version: "2.0.0",
        sha256: "def456".padEnd(64, "0")
      }
    });
  });

  test("renders manifest with wizard-selected hooks skills and learn toggle", async () => {
    const dir = await tempDir();
    const basePack = resolvePack("python-fastapi");
    const pack: ResolvedPack = {
      ...basePack,
      hooks: ["secret-shield"]
    };

    const selectedSkills = ["owner/repo@custom-skill"];
    const plan = await createRenderPlan({
      targetDir: dir,
      pack,
      skills: selectedSkills,
      learnEnabled: true
    });

    const manifestFile = plan.files.find((file) => file.path === ".farrier.json");
    expect(manifestFile).toBeDefined();

    const manifest = JSON.parse(manifestFile!.content);

    expect(manifest.farrierVersion).toBe("0.3.0");
    expect(manifest.packIds).toEqual(["python-uv", "python-fastapi"]);
    expect(manifest.hookIds).toEqual(["secret-shield"]);
    expect(manifest.skills).toEqual(selectedSkills);
    expect(manifest.secondaryAcknowledged).toEqual([]);
    expect(manifest.learn).toEqual({ enabled: true });
    expect(manifest.versions.farrierManifest).toBe(2);
    expect(manifest.versions.hooks).toEqual({
      "secret-shield": 2
    });
    expect(manifest.judge.perEdit.enabled).toBe(false);
    expect(manifest.judge.stop.enabled).toBe(false);
    expect(manifest.quality.maxFileLines).toBe(500);
  });

  test("preserves existing manifest judge quality skills learn and secondary acknowledgement inputs", async () => {
    const dir = await tempDir();
    const pack = resolvePack("rails");
    const plan = await createRenderPlan({
      targetDir: dir,
      pack,
      existingManifest: {
        skills: ["owner/repo@rails-skill"],
        secondaryAcknowledged: ["rails-hotwire"],
        learn: {
          enabled: true
        },
        judge: {
          perEdit: {
            enabled: true
          }
        },
        quality: {
          maxFileLines: 250
        }
      }
    });

    const manifest = JSON.parse(plan.files.find((file) => file.path === ".farrier.json")!.content);

    expect(manifest.skills).toEqual(["owner/repo@rails-skill"]);
    expect(manifest.secondaryAcknowledged).toEqual(["rails-hotwire"]);
    expect(manifest.learn).toEqual({ enabled: true });
    expect(manifest.judge).toEqual({
      perEdit: {
        enabled: true
      }
    });
    expect(manifest.quality).toEqual({
      maxFileLines: 250
    });
    expect(manifest.farrierVersion).toBe("0.3.0");
  });

  test("renders real konpy v1 grammar with templated package name", async () => {
    const dir = join(await tempDir(), "My FastAPI App");
    const pack = resolvePack("python-fastapi");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    const file = plan.files.find((item) => item.path === "konpy.json");
    expect(file).toBeDefined();

    const konsistent = JSON.parse(file!.content);

    expect(konsistent.version).toBe("v1");
    expect(konsistent.conventions).toHaveLength(2);
    expect(konsistent.conventions[0].paths).toEqual(["src/my_fastapi_app"]);
    expect(konsistent.conventions[0].must).toEqual({
      haveType: "directory",
      haveFiles: ["__init__.py"]
    });
    expect(konsistent.conventions[1].mustNot).toEqual({
      importFrom: "my_fastapi_app.api"
    });
  });

  test("renders ts-react-vite full inventory with TypeScript rules and konsistent support", async () => {
    const dir = await tempDir();
    const pack = resolvePack("ts-react-vite");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    expect(plan.files.map((file) => file.path)).toEqual(tsReactViteInventory);
    expect(plan.files).toHaveLength(33);

    const agents = plan.files.find((file) => file.path === "AGENTS.md")?.content ?? "";
    expect(agents).toContain("Use Bun for TypeScript package and script execution");
    expect(agents).toContain("Do not use `npx`; use `bunx` or `pnpm dlx` instead");
    expect(agents).toContain("Keep React components small and focused");
    expect(agents).toContain("- Konsistent: `bunx konsistent@1.0.0-beta.1 check`");
    expect(agents).not.toContain("Python konsistent currently uses a local path dependency");
    expect(agents).not.toContain("/Users/ivor/src/tries/2026-07-02-konsistent-python");

    const justfile = plan.files.find((file) => file.path === "justfile")?.content ?? "";
    expect(justfile).toContain("check:\n  bunx tsc --noEmit && bun test");
    expect(justfile).toContain("test:\n  bun test");
    expect(justfile).toContain("fmt:\n  bunx prettier --write .");
    expect(justfile).toContain("konsistent:\n  bunx konsistent@1.0.0-beta.1 check");
    expect(justfile).not.toContain("Temporary local path dependency");

    const konsistent = JSON.parse(plan.files.find((file) => file.path === "konsistent.json")!.content);
    expect(konsistent).toEqual({
      version: "v1",
      conventions: [
        {
          name: "src-directory-exists",
          description: "TypeScript application code lives under src.",
          paths: "src",
          must: {
            haveType: "directory"
          }
        }
      ]
    });

    const rulesFile = plan.files.find((file) => file.path === ".claude/hooks/tool-policy-rules.json");
    const rules = JSON.parse(rulesFile!.content);
    expect(rules.rules.map((rule: { id: string }) => rule.id)).toEqual([
      "typescript-use-bunx-not-npx",
      "typescript-use-bun-add-not-npm-yarn-pnpm-install"
    ]);
    expect(rules.rules[0].commandPattern).toContain("npx");
    expect(rules.rules[1].redirect).toContain("bun add");

    const manifest = JSON.parse(plan.files.find((file) => file.path === ".farrier.json")!.content);
    expect(manifest.packIds).toEqual(["ts-base", "ts-react-vite"]);
    expect(manifest.hookIds).toEqual([...allHooks]);
    expect(manifest.farrierVersion).toBe("0.3.0");
    expect(manifest.secondaryAcknowledged).toEqual([]);
  });

  test("renders rails without konsistent artifacts while retaining full hook inventory", async () => {
    const dir = await tempDir();
    const pack = resolvePack("rails");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    expect(plan.files.map((file) => file.path)).toEqual(railsInventory);
    expect(plan.files).toHaveLength(32);
    expect(plan.files.some((file) => file.path === "konsistent.json")).toBe(false);

    const justfile = plan.files.find((file) => file.path === "justfile")?.content ?? "";
    expect(justfile).toContain("check:\n  bundle exec rails test && bundle exec rubocop");
    expect(justfile).toContain("test:\n  bundle exec rails test");
    expect(justfile).toContain("fmt:\n  bundle exec rubocop -A");
    expect(justfile).not.toContain("konsistent:");

    const agents = plan.files.find((file) => file.path === "AGENTS.md")?.content ?? "";
    expect(agents).toContain("Use `bundle exec` for Rails and Ruby project commands");
    expect(agents).toContain("Prefer Rails generators and framework conventions");
    expect(agents).not.toContain("- Konsistent:");
    expect(agents).not.toContain("Run `just konsistent` before stopping");
    expect(agents).not.toContain("## Accepted Risks");
    expect(agents).not.toContain("Python konsistent currently uses a local path dependency");

    const settings = JSON.parse(plan.files.find((file) => file.path === ".claude/settings.json")!.content);
    expect(settings.hooks.Stop.map((entry: { hooks: { command: string }[] }) => entry.hooks[0].command)).toEqual([
      'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verb-runner.py"',
      'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-judge.py"'
    ]);

    const rules = JSON.parse(plan.files.find((file) => file.path === ".claude/hooks/tool-policy-rules.json")!.content);
    expect(rules.rules.map((rule: { id: string }) => rule.id)).toEqual([
      "rails-use-bundle-add-not-gem-install",
      "rails-avoid-npx"
    ]);

    const manifest = JSON.parse(plan.files.find((file) => file.path === ".farrier.json")!.content);
    expect(manifest.packIds).toEqual(["rails"]);
    expect(manifest.hookIds).toEqual([...allHooks]);
    expect(manifest.farrierVersion).toBe("0.3.0");
    expect(manifest.secondaryAcknowledged).toEqual([]);
  });

  test("renders generic minimal inventory without konsistent or Stop hooks", async () => {
    const dir = await tempDir();
    const pack = resolvePack("generic");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    expect(plan.files.map((file) => file.path)).toEqual(genericInventory);
    expect(plan.files).toHaveLength(27);
    expect(plan.files.some((file) => file.path === "konsistent.json")).toBe(false);
    expect(plan.files.some((file) => file.path.includes("verb-runner.py"))).toBe(false);
    expect(plan.files.some((file) => file.path.includes("stop-judge.py"))).toBe(false);
    expect(plan.files.some((file) => file.path === ".claude/hooks/prompts/stop-judge-v1.txt")).toBe(false);

    const justfile = plan.files.find((file) => file.path === "justfile")?.content ?? "";
    expect(justfile).toContain('check:\n  echo "farrier generic pack: configure check in justfile"');
    expect(justfile).toContain('test:\n  echo "farrier generic pack: configure test in justfile"');
    expect(justfile).toContain('fmt:\n  echo "farrier generic pack: configure fmt in justfile"');
    expect(justfile).not.toContain("konsistent:");

    const agents = plan.files.find((file) => file.path === "AGENTS.md")?.content ?? "";
    expect(agents).toContain("Replace placeholder justfile commands with real project commands");
    expect(agents).not.toContain("- Konsistent:");
    expect(agents).not.toContain("## Accepted Risks");

    const settings = JSON.parse(plan.files.find((file) => file.path === ".claude/settings.json")!.content);
    expect(settings.hooks.Stop).toBeUndefined();
    expect(settings.hooks.PostToolUse.map((entry: { hooks: { command: string }[] }) => entry.hooks[0].command)).toEqual([
      'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/quality-judge.py"'
    ]);

    const rules = JSON.parse(plan.files.find((file) => file.path === ".claude/hooks/tool-policy-rules.json")!.content);
    expect(rules).toEqual({
      version: 1,
      rules: []
    });

    const manifest = JSON.parse(plan.files.find((file) => file.path === ".farrier.json")!.content);
    expect(manifest.packIds).toEqual(["generic"]);
    expect(manifest.hookIds).toEqual(["secret-shield", "tool-policy", "write-guard", "quality-judge"]);
    expect(manifest.farrierVersion).toBe("0.3.0");
    expect(manifest.secondaryAcknowledged).toEqual([]);
  });

  test("render plan creation does not write files", async () => {
    const dir = await tempDir();
    const pack = resolvePack("python-fastapi");

    await createRenderPlan({ targetDir: dir, pack });

    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(false);
  });

  test("writeRenderPlan writes all files and makes hook scripts executable", async () => {
    const dir = await tempDir();
    const pack = resolvePack("python-fastapi");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    await writeRenderPlan(plan);

    for (const path of pythonFastapiInventory) {
      expect(existsSync(join(dir, path))).toBe(true);
    }

    for (const path of [
      ".claude/hooks/secret-shield.py",
      ".claude/hooks/tool-policy.py",
      ".claude/hooks/write-guard.py",
      ".claude/hooks/verb-runner.py",
      ".claude/hooks/quality-judge.py",
      ".claude/hooks/stop-judge.py"
    ]) {
      const mode = (await stat(join(dir, path))).mode;
      expect(mode & 0o111).not.toBe(0);
    }
  });

  test("gitignore is created with env protections", async () => {
    const dir = await tempDir();
    const pack = resolvePack("python-fastapi");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    const gitignore = plan.files.find((file) => file.path === ".gitignore")?.content ?? "";

    expect(gitignore).toContain(".env");
    expect(gitignore).toContain(".env.*");
    expect(gitignore).toContain("!.env.example");
  });

  test("gitignore appends only missing env protection lines", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, ".gitignore"), "node_modules/\n.env\n", "utf8");

    const pack = resolvePack("python-fastapi");
    const plan = await createRenderPlan({ targetDir: dir, pack });

    const gitignore = plan.files.find((file) => file.path === ".gitignore")?.content ?? "";

    expect(gitignore).toContain("node_modules/");
    expect(gitignore.match(/^\.env$/gm)?.length).toBe(1);
    expect(gitignore).toContain(".env.*");
    expect(gitignore).toContain("!.env.example");

    await writeRenderPlan(plan);
    const written = await readFile(join(dir, ".gitignore"), "utf8");
    expect(written).toBe(gitignore);
  });
});
