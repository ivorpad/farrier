import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";
import type { BackendCommandRunner } from "../src/engine/backend";

const fixtures = resolve(import.meta.dir, "fixtures/harness-audit");

function output(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}

describe("harness audit modes", () => {
  test("quick reports exact seeded layers without a model call", async () => {
    let calls = 0;
    const report = await auditHarness({
      targetDir: resolve(fixtures, "seeded"),
      mode: "quick",
      runner: async () => {
        calls += 1;
        throw new Error("quick audit must not call a model");
      },
    });

    expect(calls).toBe(0);
    expect(report.metrics.modelCalls).toBe(0);
    expect(new Set(report.recommendations.map((item) => item.layer))).toEqual(
      new Set(["guidance", "verification", "skill", "hook", "toolchain"]),
    );
    expect(report.recommendations.some((item) =>
      item.defect.includes(".agents/skills/release/scripts/release_check.py"))).toBeTrue();
    expect(report.recommendations[0]?.proposal.change).toBe(
      "Remove the stale .claude/hooks/guard.py command from this hook binding. Re-enable it only after the hook exists and has been reviewed.",
    );
    const uvFinding = report.recommendations.find((item) => item.title.includes("uv route"));
    expect(uvFinding?.proposal.change).toBe("Replace `pytest` with `uv run pytest` in AGENTS.md.");
    for (const recommendation of report.recommendations) {
      expect(recommendation.citations.length).toBeGreaterThan(0);
      expect(recommendation.citations.every((item) => item.path && item.line > 0)).toBeTrue();
      expect(recommendation.counterchecks.length).toBeGreaterThan(0);
      expect(recommendation.proposal.artifact).toBeTruthy();
      expect(recommendation.risk).toBeTruthy();
      expect(recommendation.uncertainty).toBeTruthy();
    }
  });

  test("quick stays silent on the clean fixture", async () => {
    const clean = await auditHarness({ targetDir: resolve(fixtures, "clean"), mode: "quick" });

    expect(clean.recommendations).toEqual([]);
  });

  test("Claude skills may inherit metadata when frontmatter is absent", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-claude-skill-name-"));
    const skillDir = join(targetDir, ".claude/skills/demo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), [
      "# Demo workflow", "", "Demonstrate the repository workflow.", "", "Run the workflow.", "",
    ].join("\n"));

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toEqual([]);
  });

  test("quick detects manifest-selected hooks whose bindings and entrypoints are absent", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-hooks-"));
    await writeFile(join(targetDir, ".farrier.json"), JSON.stringify({
      packIds: ["ts-base"],
      agents: ["claude", "codex"],
      hookIds: ["secret-shield", "write-guard"],
    }, null, 2));

    const report = await auditHarness({ targetDir, mode: "quick" });
    const finding = report.recommendations.find((item) => item.title.includes("safety hooks"));

    expect(report.metrics.modelCalls).toBe(0);
    expect(finding?.layer).toBe("hook");
    expect(finding?.severity).toBe("blocking");
    expect(finding?.citations.map((item) => item.path)).toEqual([".farrier.json", ".farrier.json"]);
    expect(finding?.counterchecks.map((item) => item.result).filter((item) => item === "missing")).toHaveLength(4);
  });

  test("baseline adds one evidence-bound model finding and records one call", async () => {
    const targetDir = resolve(fixtures, "seeded");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.find((line) => line.text.includes("Do not run the test suite"))!;
    const runner: BackendCommandRunner = async () => output({
      recommendations: [{
        id: "verification:test-suite-contradiction",
        layer: "verification",
        severity: "high",
        title: "Completion guidance disables the available test suite",
        defect: "The instructions allow success without the repository test suite even though a test task exists.",
        evidence: [evidence.id],
        counterchecks: ["check:package-scripts"],
        artifact: "AGENTS.md",
        change: "Require bun run check, including its test step, before reporting completion.",
        risk: "Changes can be reported complete without executing the repository tests.",
        uncertainty: "The audit did not execute the test task, so its current runtime health is unknown.",
      }],
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.metrics.modelCalls).toBe(1);
    expect(report.metrics.successfulModelCalls).toBe(1);
    expect(report.metrics.inputTokens).toBeGreaterThan(0);
    expect(report.metrics.outputTokens).toBeGreaterThan(0);
    expect(report.metrics.latencyMs).toBeGreaterThanOrEqual(report.metrics.cumulativeModelTimeMs);
    expect(report.recommendations.some((item) => item.id === "verification:test-suite-contradiction")).toBeTrue();
  });

  test("deep skips an unsupported specialist and keeps provider-pure bounded concurrency", async () => {
    let running = 0;
    let maximum = 0;
    const prompts: string[] = [];
    const commands: string[][] = [];
    const runner: BackendCommandRunner = async (input) => {
      running += 1;
      maximum = Math.max(maximum, running);
      prompts.push(input.stdin ?? input.cmd.at(-1) ?? "");
      commands.push(input.cmd);
      await Bun.sleep(10);
      running -= 1;
      return output({ recommendations: [] });
    };

    const report = await auditHarness({
      targetDir: resolve(fixtures, "deep-opportunities"),
      mode: "deep",
      backend: "codex",
      concurrency: 2,
      runner,
    });

    expect(report.metrics.modelCalls).toBe(3);
    expect(report.metrics.successfulModelCalls).toBe(3);
    expect(maximum).toBe(2);
    expect(prompts.every((prompt) => prompt.includes("Do not recommend creating guidance"))).toBeTrue();
    expect(commands.every((command) => command[0] === "codex"
      && command.includes("read-only")
      && command.includes("--ephemeral")
      && command.includes("--skip-git-repo-check"))).toBeTrue();
    expect(report.recommendations).toEqual([]);
    expect(report.coverage.find((item) => item.layer === "hook")?.status).toBe("not-run");
  });

  test("deep cancellation reaches active calls and starts no queued worker", async () => {
    const controller = new AbortController();
    let calls = 0;
    const runner: BackendCommandRunner = async (input) => {
      calls += 1;
      expect(input.signal).toBe(controller.signal);
      controller.abort(new Error("cancelled by test"));
      return output({ recommendations: [] });
    };

    await expect(auditHarness({
      targetDir: resolve(fixtures, "deep-opportunities"), mode: "deep", backend: "codex", runner,
      signal: controller.signal, concurrency: 3,
    })).rejects.toThrow("cancelled by test");
    expect(calls).toBeLessThanOrEqual(3);
  });

  test("model findings with invented artifacts or confidence claims are dropped", async () => {
    const targetDir = resolve(fixtures, "clean");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const line = corpus.lines.find((item) => item.path === "AGENTS.md")!;
    const runner: BackendCommandRunner = async () => output({
      recommendations: [
        {
          id: "guidance:invented-file",
          layer: "guidance",
          severity: "medium",
          title: "Add more guidance",
          defect: "This model confidence is high.",
          evidence: [line.id],
          counterchecks: ["check:audit-coverage"],
          artifact: "NEW_GUIDANCE.md",
          change: "Create a new guidance file.",
          risk: "None shown.",
          uncertainty: "None shown.",
        },
      ],
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("validation or confidence"))).toBeTrue();
  });

  test("model authority wording cannot bypass validation through titles or alternate confidence syntax", async () => {
    const targetDir = resolve(fixtures, "seeded");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.find((line) => line.text.includes("Do not run the test suite"))!;
    const runner: BackendCommandRunner = async () => output({
      recommendations: [{
        id: "verification:model-authority-bypass",
        layer: "verification",
        severity: "high",
        title: "Validated completion-gate defect",
        defect: "The instructions allow success without the repository test suite even though a test task exists.",
        evidence: [evidence.id],
        counterchecks: ["check:package-scripts"],
        artifact: "AGENTS.md",
        change: "Require the repository test task before reporting completion.",
        risk: "Confidence: high. Changes can be reported complete without tests.",
        uncertainty: "I am 95% confident; the task itself was not executed.",
      }],
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations.some((item) => item.id === "verification:model-authority-bypass")).toBeFalse();
    expect(report.notes.some((note) => note.includes("validation or confidence"))).toBeTrue();
  });

  test("model-only absence claims cannot create or declare work on a clean repository", async () => {
    const targetDir = resolve(fixtures, "clean");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const skillLine = corpus.lines.find((item) => item.path.endsWith("/SKILL.md"))!;
    const runner: BackendCommandRunner = async () => output({
      recommendations: [{
        id: "skill:release-workflow-absent",
        layer: "skill",
        severity: "medium",
        title: "Release workflow absent",
        defect: "The release skill has no detailed workflow.",
        evidence: [skillLine.id],
        counterchecks: [corpus.checks.find((item) => item.id.startsWith("check:skill-cases:"))!.id],
        artifact: skillLine.path,
        change: "Add a detailed workflow to the skill.",
        risk: "A release could require extra judgment.",
        uncertainty: "The current concise behavior may be intentional.",
      }],
    });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("a missing-import claim without an import countercheck is rejected", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-import-"));
    const skillDir = join(targetDir, ".agents/skills/demo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), [
      "---", "name: demo", "description: Demonstrate a component.", "---", "",
      "```tsx", "import {Sequence} from 'remotion';", "const frame = useCurrentFrame();", "```", "",
    ].join("\n"));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const line = corpus.lines.find((item) => item.text.includes("useCurrentFrame"))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "skill:missing-remotion-import",
      layer: "skill",
      severity: "high",
      title: "Example uses an unimported symbol",
      defect: "The example calls useCurrentFrame without importing it.",
      evidence: [line.id],
      counterchecks: [corpus.checks.find((item) => item.id.startsWith("check:skill-cases:"))!.id],
      artifact: line.path,
      change: "Add useCurrentFrame to the existing remotion import declaration.",
      risk: "Copying the example produces an unresolved identifier.",
      uncertainty: "The snippet was inspected statically and was not compiled.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations.some((item) => item.id === "skill:missing-remotion-import")).toBeFalse();
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("dependency floating claims are dropped when a repository lockfile exists", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-lock-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      devDependencies: { typescript: "latest" },
    }, null, 2));
    await writeFile(join(targetDir, "bun.lock"), "{\"lockfileVersion\":1}\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const line = corpus.lines.find((item) => item.text.includes("typescript"))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "toolchain:floating-typescript-dependency",
      layer: "toolchain",
      severity: "medium",
      title: "TypeScript dependency floats on latest",
      defect: "The TypeScript devDependency uses latest.",
      evidence: [line.id],
      counterchecks: ["check:lockfiles"],
      artifact: "package.json",
      change: "Replace latest with the currently resolved TypeScript version.",
      risk: "A later install could select a different compiler.",
      uncertainty: "Update policy was not supplied.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("dependency-policy countercheck"))).toBeTrue();
  });

  test("mypy override checks bind selectors to repository paths and configured invocations", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-mypy-"));
    await mkdir(join(targetDir, "scripts"), { recursive: true });
    await mkdir(join(targetDir, "fastapi"), { recursive: true });
    await writeFile(join(targetDir, "pyproject.toml"), [
      "[tool.mypy]", "strict = true", "", "[[tool.mypy.overrides]]",
      'module = "fastapi.tests.*"', "ignore_missing_imports = true", "",
    ].join("\n"));
    await writeFile(join(targetDir, "scripts/lint.sh"), "#!/bin/sh\nmypy fastapi\n");

    const corpus = await collectHarnessAuditCorpus(targetDir);
    const check = corpus.checks.find((item) => item.id.startsWith("check:mypy-override:"));

    expect(corpus.documents.map((item) => item.path)).toContain("scripts/lint.sh");
    expect(check?.result).toContain("module target fastapi/tests: missing");
    expect(check?.result).toContain("invocation targets: fastapi");
  });

  test("mypy selector defects cannot be routed to toolchain", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-mypy-layer-"));
    await mkdir(join(targetDir, "scripts"), { recursive: true });
    await mkdir(join(targetDir, "fastapi"), { recursive: true });
    await writeFile(join(targetDir, "pyproject.toml"), [
      "[tool.mypy]", "strict = true", "", "[[tool.mypy.overrides]]",
      'module = "fastapi.tests.*"', "ignore_missing_imports = true", "",
    ].join("\n"));
    await writeFile(join(targetDir, "scripts/lint.sh"), "#!/bin/sh\nmypy fastapi\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const line = corpus.lines.find((item) => item.text.includes("fastapi.tests"))!;
    const check = corpus.checks.find((item) => item.id.startsWith("check:mypy-override:"))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "toolchain:stale-mypy-selector",
      layer: "toolchain",
      severity: "medium",
      title: "Stale mypy override selector",
      defect: "The mypy override targets a missing module path.",
      evidence: [line.id],
      counterchecks: [check.id],
      artifact: "pyproject.toml",
      change: "Remove the stale mypy override.",
      risk: "The intended exception is not applied.",
      uncertainty: "The old selector may document retired behavior.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("mypy verification defect"))).toBeTrue();
  });

  test("link claims need a link check and verification gates cannot route to toolchain", async () => {
    const targetDir = resolve(fixtures, "clean");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const skillLine = corpus.lines.find((item) => item.path.endsWith("/SKILL.md"))!;
    const packageLine = corpus.lines.find((item) => item.path === "package.json" && item.text.includes("check"))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [
      {
        id: "skill:dead-doc-link",
        layer: "skill",
        severity: "medium",
        title: "Dead documentation link",
        defect: "The URL in the skill is unreachable.",
        evidence: [skillLine.id],
        counterchecks: ["check:audit-coverage"],
        artifact: skillLine.path,
        change: "Replace the URL.",
        risk: "Agents cannot read the reference.",
        uncertainty: "The endpoint could recover.",
      },
      {
        id: "toolchain:check-skips-tests",
        layer: "toolchain",
        severity: "high",
        title: "Check target omits tests",
        defect: "The check script skips test validation.",
        evidence: [packageLine.id],
        counterchecks: ["check:package-scripts"],
        artifact: "package.json",
        change: "Change the check target to run tests.",
        risk: "Completion misses failures.",
        uncertainty: "CI policy was not executed.",
      },
    ] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
    expect(report.notes.some((note) => note.includes("verification gate"))).toBeTrue();
  });

  test("repository path checks do not reinterpret URL suffixes as local files", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-url-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Docs: https://www.remotion.dev/docs/effects\n");

    const corpus = await collectHarnessAuditCorpus(targetDir);

    expect(corpus.checks.some((check) => check.description.includes("docs/effects"))).toBeFalse();
  });

  test("skill-relative scripts are checked inside their installed skill tree", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-skill-path-"));
    const skillDir = join(targetDir, ".agents/skills/video");
    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), [
      "---", "name: video", "description: Render a video.", "---", "",
      "Run `bash scripts/render.sh output.mp4`.", "",
    ].join("\n"));
    await writeFile(join(skillDir, "scripts/render.sh"), "#!/bin/sh\n");

    const report = await auditHarness({ targetDir, mode: "quick" });
    const corpus = await collectHarnessAuditCorpus(targetDir);

    expect(report.recommendations).toEqual([]);
    expect(corpus.checks.some((check) =>
      check.description.includes(".agents/skills/video/scripts/render.sh") && check.result === "regular file exists")).toBeTrue();
  });

  test("package-manager install commands are not treated as package script targets", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-install-"));
    await writeFile(join(targetDir, "AGENTS.md"), [
      "Install with `bun install`, then run `bun run check`.",
      "Install OpenCode with `npm i -g opencode-ai@latest`.",
      "",
    ].join("\n"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "bun@1.3.14", scripts: { check: "bun test" },
    }));

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toEqual([]);
  });

  test("package-manager workspace flags are not treated as package script targets", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-workspace-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Build with `pnpm --filter eve build:compiled`.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@10.12.1", scripts: { build: "turbo build" },
    }));

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toEqual([]);
  });

  test("package command placeholders and Bun builtins are not treated as script targets", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-placeholders-"));
    await writeFile(join(targetDir, "CLAUDE.md"), [
      "Use `bun run <script>` instead of `npm run <script>`.",
      "Use `bun test` to run tests.",
      "",
    ].join("\n"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ packageManager: "bun@1.3.14" }));

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toEqual([]);
  });

  test("repository secrets are redacted before model use and report materialization", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-redaction-"));
    const canary = "audit-secret-canary-value";
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      name: "redaction", packageManager: "bun@1.3.14", scripts: { check: "bun test" },
    }));
    await writeFile(join(targetDir, "AGENTS.md"), `# Instructions\n\nBefore completion run \`bun run check\`. token=${canary}\n`);
    let prompt = "";
    const runner: BackendCommandRunner = async (input) => {
      prompt = input.stdin ?? input.cmd.at(-1) ?? "";
      return output({ recommendations: [] });
    };

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(prompt).not.toContain(canary);
    expect(prompt).toContain("token=[REDACTED]");
    expect(JSON.stringify(report)).not.toContain(canary);
  });
});
