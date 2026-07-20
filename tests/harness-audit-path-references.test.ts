import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

test("task-category shorthand is not treated as a path while explicit code paths remain checked", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-path-reference-"));
  const skillDir = join(targetDir, ".agents/skills/review");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), [
    "---",
    "name: review",
    "description: Review a change before completion.",
    "---",
    "",
    "Run existing tests/lint/build. Then run `scripts/check` before completion.",
    "Any `cart add/set/set-many/clear` or `checkout create/set-delivery/submit` over the cap must stop.",
    "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });
  const checkedPaths = corpus.checks
    .filter((check) => check.id.startsWith("check:path:"))
    .map((check) => check.description);

  expect(checkedPaths.some((description) => description.includes("tests/lint/build"))).toBeFalse();
  expect(checkedPaths.some((description) => description.includes("add/set/set-many/clear"))).toBeFalse();
  expect(checkedPaths.some((description) => description.includes("create/set-delivery/submit"))).toBeFalse();
  expect(checkedPaths.some((description) => description.includes("scripts/check"))).toBeTrue();
  expect(report.recommendations).toHaveLength(1);
  expect(report.recommendations[0]?.defect).toContain(".agents/skills/review/scripts/check");
});

test("cross-skill references are resolved as full sibling paths instead of suffixes", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-sibling-reference-"));
  const current = join(targetDir, ".agents/skills/faceless");
  const creative = join(targetDir, ".agents/skills/hyperframes-creative/references");
  const media = join(targetDir, ".agents/skills/hyperframes-media/scripts");
  await Promise.all([
    mkdir(current, { recursive: true }),
    mkdir(creative, { recursive: true }),
    mkdir(media, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(creative, "design-spec.md"), "# Design spec\n"),
    writeFile(join(media, "wait-bgm.mjs"), "export {};\n"),
    writeFile(join(current, "SKILL.md"), [
      "---",
      "name: faceless",
      "description: Render a faceless explainer.",
      "---",
      "",
      "Read `../hyperframes-creative/references/design-spec.md` before choosing a preset.",
      "Run `hyperframes-media/scripts/wait-bgm.mjs` before the final render.",
      "",
    ].join("\n")),
  ]);

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });
  const pathChecks = corpus.checks.filter((check) => check.id.startsWith("check:path:"));

  expect(pathChecks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      description: "Checked referenced path .agents/skills/hyperframes-creative/references/design-spec.md.",
      result: "regular file exists",
    }),
    expect.objectContaining({
      description: "Checked referenced path .agents/skills/hyperframes-media/scripts/wait-bgm.mjs.",
      result: "regular file exists",
    }),
  ]));
  expect(report.recommendations).toEqual([]);
});

test("nested skill guides resolve declared shared resources from the installed tree root", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-shared-skill-root-"));
  const tree = join(targetDir, ".agents/skills/search-suite");
  const nested = join(tree, "search/launchpad");
  await mkdir(join(tree, "scripts"), { recursive: true });
  await mkdir(join(nested, "references"), { recursive: true });
  await writeFile(join(tree, "scripts/ops.py"), "print('ok')\n");
  await writeFile(join(nested, "references/local.md"), "# Local reference\n");
  await writeFile(join(tree, "SKILL.md"), [
    "---", "name: search-suite", "description: Search tools.", "---", "",
    "Shared resources include `scripts/ops.py`.", "",
  ].join("\n"));
  await writeFile(join(nested, "SKILL.md"), [
    "---", "name: launchpad", "description: Launch search.", "---", "",
    "All operations use shared scripts at the skill root.",
    "Run `scripts/ops.py` before launch.",
    "Read `references/local.md` for nested details.", "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(corpus.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({ description: "Checked referenced path .agents/skills/search-suite/scripts/ops.py.", result: "regular file exists" }),
    expect.objectContaining({ description: "Checked referenced path .agents/skills/search-suite/search/launchpad/references/local.md.", result: "regular file exists" }),
  ]));
  expect(report.recommendations).toEqual([]);
});

test("a guidance filename containing check does not determine the recommendation layer", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-path-layer-"));
  await writeFile(join(targetDir, "AGENTS.md"), [
    "Read `docs/check.md` before editing repository guidance.",
    "Run `scripts/check.sh` before completion.", "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });
  const byPath = new Map(report.recommendations.map((item) => [
    item.defect.includes("docs/check.md") ? "document" : "script", item.layer,
  ]));

  expect(byPath.get("document")).toBe("guidance");
  expect(byPath.get("script")).toBe("verification");
});

test("nested guidance resolves local paths from its scoped directory", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-nested-guidance-"));
  const webDir = join(targetDir, "web");
  const docsDir = join(webDir, "node_modules/next/dist/docs");
  await mkdir(docsDir, { recursive: true });
  await writeFile(join(webDir, "AGENTS.md"), [
    "# Web instructions",
    "",
    "Read `node_modules/next/dist/docs/` before writing web code.",
    "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });
  const pathChecks = corpus.checks.filter((check) => check.id.startsWith("check:path:"));

  expect(pathChecks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path web/node_modules/next/dist/docs.",
    result: "directory exists",
  }));
  expect(report.recommendations).toEqual([]);
});

test("provider permissions are not treated as configured hook entrypoints", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-hook-permissions-"));
  await mkdir(join(targetDir, ".claude"), { recursive: true });
  await writeFile(join(targetDir, ".claude/settings.json"), JSON.stringify({
    permissions: { allow: ["Bash(mkdir -p .claude/plans)", "Write(.claude/plans/*)"] },
    hooks: {
      PreToolUse: [{ hooks: [{ type: "command", command: "uv run .claude/hooks/guard.py" }] }],
    },
  }, null, 2));

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.recommendations).toHaveLength(1);
  expect(report.recommendations[0]?.defect).toContain(".claude/hooks/guard.py");
  expect(report.recommendations[0]?.defect).not.toContain(".claude/plans");
});

test("nested guidance checks commands against its nearest package manifest", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-package-scope-"));
  const packageDir = join(targetDir, "packages/worker");
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    scripts: { test: "bun test" },
  }));
  await writeFile(join(packageDir, "package.json"), JSON.stringify({
    scripts: { "test:integration": "vitest run integration" },
  }));
  await writeFile(join(packageDir, "AGENTS.md"), "Run `pnpm test:integration` before completion.\n");

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(corpus.documents.map((item) => item.path)).toContain("packages/worker/package.json");
  expect(report.recommendations).toEqual([]);
});

test("paths inside a remote execution payload are not resolved into the skill tree", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-remote-payload-"));
  const skillDir = join(targetDir, ".agents/skills/testbox");
  await mkdir(join(skillDir, "scripts"), { recursive: true });
  await writeFile(join(skillDir, "scripts/local-check.py"), "print('ok')\n");
  await writeFile(join(skillDir, "SKILL.md"), [
    "---", "name: testbox", "description: Run checks in a remote testbox.", "---", "",
    'blacksmith testbox run --id <ID> "python -m pytest tests/test_api.py -k test_auth"',
    "Run `scripts/local-check.py` before reporting the local skill ready.", "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });
  const checked = corpus.checks.filter((check) => check.id.startsWith("check:path:"));

  expect(checked.some((check) => check.description.includes("tests/test_api.py"))).toBeFalse();
  expect(checked).toContainEqual(expect.objectContaining({
    description: "Checked referenced path .agents/skills/testbox/scripts/local-check.py.",
    result: "regular file exists",
  }));
  expect(report.recommendations).toEqual([]);
});

test("home-directory documentation is not checked as a nested repository path", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-home-path-"));
  await mkdir(join(targetDir, "docs/references"), { recursive: true });
  await writeFile(join(targetDir, "docs/references/schema.md"), "# Storage schema\n");
  await writeFile(join(targetDir, "docs/AGENTS.md"), [
    "Storage locations:",
    "- macOS: `~/Library/Application Support/opencode/storage/`",
    "- Repository schema: `references/schema.md`",
    "",
  ].join("\n"));
  const corpus = await collectHarnessAuditCorpus(targetDir);
  const line = corpus.lines.find((item) => item.path === "docs/AGENTS.md" && item.line === 2)!;
  const check = corpus.checks.find((item) =>
    item.description === "Checked referenced path docs/Support/opencode/storage.");
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [{
      id: "guidance:external-macos-home-path",
      layer: "guidance",
      severity: "high",
      title: "Documented storage path is missing",
      defect: "docs/Support/opencode/storage is a missing repository artifact.",
      evidence: [line.id],
      counterchecks: [check?.id ?? "check:audit-coverage"],
      artifact: "docs/AGENTS.md",
      change: "Remove the stale docs/Support/opencode/storage reference.",
      risk: "Agents cannot inspect the documented storage location.",
      uncertainty: "The storage directory may be created outside the repository.",
    }] }),
  });

  const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

  expect(report.recommendations).toEqual([]);
  expect(check).toBeUndefined();
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path docs/references/schema.md.",
    result: "regular file exists",
  }));
});

test("directory references with trailing slashes keep their contained path identity", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-trailing-directory-"));
  await mkdir(join(targetDir, ".github/workflows"), { recursive: true });
  await mkdir(join(targetDir, "docs/i18n"), { recursive: true });
  await writeFile(join(targetDir, ".github/copilot-instructions.md"), [
    "Review `.github/workflows/` changes line by line.",
    "Translated docs live in `docs/i18n/`.",
    "",
  ].join("\n"));
  const corpus = await collectHarnessAuditCorpus(targetDir);

  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path .github/workflows.",
    result: "directory exists",
  }));
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path docs/i18n.",
    result: "directory exists",
  }));
});

test("a generated build output consumed after its build task is not reported as stale", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-generated-output-"));
  await mkdir(join(targetDir, "scripts"), { recursive: true });
  await writeFile(join(targetDir, "scripts/build-java.sh"), "mvn -B clean package -P release\n");
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    scripts: {
      "build-java": "bash scripts/build-java.sh",
      "export-options": "npm run build-java && java -jar java/cli/target/cli-0.0.0.jar --export-options",
    },
  }, null, 2));

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.recommendations).toEqual([]);
});

test("a non-build task does not excuse a missing artifact later in the command chain", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-stale-output-"));
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    scripts: {
      lint: "eslint .",
      "export-options": "npm run lint && java -jar java/cli/target/missing.jar --export-options",
    },
  }, null, 2));

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.recommendations).toHaveLength(1);
  expect(report.recommendations[0]?.defect).toContain("java/cli/target/missing.jar");
});

test("an uninstalled dependency path is not reported as a stale harness artifact", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-uninstalled-dependency-"));
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    devDependencies: { "@types/bun": "latest" },
  }, null, 2));
  await writeFile(join(targetDir, "CLAUDE.md"), [
    "# Bun",
    "",
    "For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.",
    "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.recommendations).toEqual([]);
});

test("skill paths distinguish provider roots and ignore repository output examples", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-skill-path-roots-"));
  const skillDir = join(targetDir, ".agents/skills/hyperframes");
  await mkdir(join(skillDir, "scripts"), { recursive: true });
  await writeFile(join(skillDir, "scripts/animation-map.mjs"), "export {};\n");
  await writeFile(join(skillDir, "SKILL.md"), [
    "---",
    "name: hyperframes",
    "description: Build a motion composition.",
    "---",
    "",
    "Run `node skills/hyperframes/scripts/animation-map.mjs demo` after authoring animations.",
    "Read the installed file (e.g., `compositions/components/grain-overlay.html`).",
    "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path .agents/skills/hyperframes/scripts/animation-map.mjs.",
    result: "regular file exists",
  }));
  expect(corpus.checks.some((check) => check.description.includes("grain-overlay.html"))).toBeFalse();
  expect(report.recommendations).toEqual([]);

  const evidence = corpus.lines.find((line) => line.text.includes("animation-map.mjs"))!;
  const scriptCheck = corpus.checks.find((check) => check.description.includes("animation-map.mjs"))!;
  const scriptPath = scriptCheck.description.match(/^Checked referenced path (.+)\.$/)![1]!;
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [{
      id: "skill:missing-animation-map",
      layer: "skill",
      severity: "high",
      title: "Animation-map script is missing",
      defect: `The skill requires ${scriptPath}, but that referenced file is missing.`,
      evidence: [evidence.id],
      counterchecks: [scriptCheck.id],
      artifact: evidence.path,
      change: "Correct the command or restore the referenced script.",
      risk: "The documented choreography check cannot run.",
      uncertainty: "The script might be generated by an uninspected process.",
    }] }),
  });
  const baseline = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

  expect(baseline.recommendations).toEqual([]);
  expect(baseline.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
});

test("example code identifiers are not checked as repository paths", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-example-identifiers-"));
  const skillDir = join(targetDir, "skills/caveman-review");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), [
    "---", "name: caveman-review", "description: Show terse review examples.", "---", "",
    "## Examples", "", "✅ `L88-140: nit: 50-line fn does 4 things. Extract validate/normalize/persist.`", "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const evidence = corpus.lines.find((line) => line.text.includes("validate/normalize/persist"))!;
  const check = corpus.checks.find((item) => item.description.includes("validate/normalize/persist"));
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [{
      id: "skill:missing-example-functions",
      layer: "skill",
      severity: "high",
      title: "Review helpers are missing",
      defect: "The skill requires validate/normalize/persist, but that referenced path is missing.",
      evidence: [evidence.id],
      counterchecks: [check?.id ?? "check:path:illustrative-example"],
      artifact: evidence.path,
      change: "Add the missing review helpers.",
      risk: "The review workflow cannot run.",
      uncertainty: "The helpers might be generated elsewhere.",
    }] }),
  });
  const baseline = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

  expect(baseline.recommendations).toEqual([]);
  expect(check).toBeUndefined();
});

test("archived harness files cannot produce findings or displace live provider hooks", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-archived-guidance-"));
  await mkdir(join(targetDir, "_archive"), { recursive: true });
  await mkdir(join(targetDir, ".claude/hooks"), { recursive: true });
  await writeFile(
    join(targetDir, "_archive/AGENTS.md"),
    "Run `scripts/removed-check.sh` before completion.\n",
  );
  await writeFile(join(targetDir, ".claude/hooks/live-check.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(join(targetDir, ".claude/settings.json"), JSON.stringify({
    hooks: { PostToolUse: [{ hooks: [{
      type: "command",
      command: "${CLAUDE_PROJECT_DIR}/.claude/hooks/live-check.sh",
    }] }] },
  }));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const evidence = corpus.lines.find((item) => item.path === "_archive/AGENTS.md");
  const check = corpus.checks.find((item) => item.description.includes("removed-check.sh"));
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [{
      id: "guidance:restore-archived-check",
      layer: "guidance",
      severity: "high",
      title: "Required archived check is missing",
      defect: "_archive/AGENTS.md requires _archive/scripts/removed-check.sh, but the path is missing.",
      evidence: [evidence?.id ?? "line:archived"],
      counterchecks: [check?.id ?? "check:path:archived"],
      artifact: "_archive/AGENTS.md",
      change: "Restore the archived check script.",
      risk: "Agents cannot follow the archived verification workflow.",
      uncertainty: "The check may have moved elsewhere.",
    }] }),
  });
  const baseline = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

  expect(corpus.documents.map((item) => item.path)).toContain(".claude/hooks/live-check.sh");
  expect(baseline.recommendations).toEqual([]);
  expect(corpus.documents.some((item) => item.path.startsWith("_archive/"))).toBeFalse();
});

test("nested project roots and placeholder shorthands keep distinct path identities", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-nested-project-root-"));
  const codexDir = join(targetDir, "workspace/downloads/codex");
  await mkdir(join(codexDir, "references"), { recursive: true });
  await mkdir(join(targetDir, "workspace/tests/test_domain"), { recursive: true });
  await mkdir(join(targetDir, ".agents/skills/review"), { recursive: true });
  await writeFile(join(codexDir, "references/setup.md"), "# Setup\n");
  await writeFile(join(codexDir, "AGENTS.md"), [
    "Codex may be launched with `-C downloads/codex`, so shell commands can",
    "report this directory as `pwd`. For project work, treat the intended project",
    "root as `../..` from this workspace.",
    "Read `downloads/codex/references/setup.md` before editing.",
    "Tests live in `tests/test_domain/`.",
    "",
  ].join("\n"));
  await writeFile(join(targetDir, "CLAUDE.md"), [
    "Scaffolds use Cruft (`cruft create/check/update`).",
    "Use `worktree create/set/rm` or `terminal read/send/wait/stop` through the public CLI.",
    "The external source is `wave-ux-designagent/.../kb/`.",
    "Run `.venv/bin/python` inside the local environment.",
    "",
  ].join("\n"));
  await writeFile(join(targetDir, ".agents/skills/review/SKILL.md"), [
    "---", "name: review", "description: Parse review JSON.", "---", "",
    "The payload maps `path/to/file.go` to its comments.",
    "Only use `node out/cli/index.js` if the public command is missing.", "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const checks = corpus.checks.filter((item) => item.id.startsWith("check:path:"));

  expect(checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path workspace/downloads/codex/references/setup.md.",
    result: "regular file exists",
  }));
  expect(checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path workspace/tests/test_domain.",
    result: "directory exists",
  }));
  for (const shorthand of [
    "create/check/update", "create/set/rm", "read/send/wait/stop", "wave-ux-designagent/.../kb",
    ".venv/bin/python", "path/to/file.go", "out/cli/index.js",
  ]) {
    expect(checks.some((item) => item.description.includes(shorthand))).toBeFalse();
  }
});
