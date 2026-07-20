import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";
import type { BackendCommandRunner } from "../src/engine/backend";

function output(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}

describe("harness audit claim counterchecks", () => {
  test("rejects a missing-path claim when the performed path check found the file", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-existing-skill-path-"));
    const skillDir = join(targetDir, ".agents/skills/demo");
    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), [
      "---", "name: demo", "description: Exercise a checked script.", "---", "",
      "Run `bash scripts/check.sh` before completion.", "",
    ].join("\n"));
    await writeFile(join(skillDir, "scripts/check.sh"), "#!/bin/sh\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.find((item) => item.text.includes("scripts/check.sh"))!;
    const check = corpus.checks.find((item) =>
      item.description.includes(".agents/skills/demo/scripts/check.sh"))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "skill:missing-checked-script",
      layer: "skill",
      severity: "high",
      title: "Required skill script is missing",
      defect: "The skill requires scripts/check.sh, but that referenced file is missing.",
      evidence: [evidence.id],
      counterchecks: [check.id],
      artifact: evidence.path,
      change: "Remove the stale scripts/check.sh instruction.",
      risk: "Agents cannot complete the documented skill procedure.",
      uncertainty: "The script could be generated outside the inspected repository.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(check.result).toBe("regular file exists");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("does not invent a missing package target without a package task inventory", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-no-package-"));
    const skillDir = join(targetDir, ".agents/skills/demo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), [
      "---", "name: demo", "description: Exercise coverage.", "---", "",
      "Run `bun run test:coverage` before completion.", "",
    ].join("\n"));

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toEqual([]);
  });

  test("does not treat an external mypy namespace as a stale local selector", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-external-mypy-"));
    await mkdir(join(targetDir, "scripts"), { recursive: true });
    await writeFile(join(targetDir, "pyproject.toml"), [
      "[tool.mypy]", "strict = true", "", "[[tool.mypy.overrides]]",
      'module = "sounddevice.*"', "ignore_missing_imports = true", "",
    ].join("\n"));
    await writeFile(join(targetDir, "scripts/lint.sh"), "#!/bin/sh\nmypy .\n");

    const corpus = await collectHarnessAuditCorpus(targetDir);

    expect(corpus.checks.some((item) => item.id.startsWith("check:mypy-override:"))).toBeFalse();
  });

  test("compares mandatory verification scopes with documented exemptions", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-scope-"));
    await writeFile(join(targetDir, "AGENTS.md"), [
      "Run the verification skill when you change:",
      "- CI workflows.",
      "",
      "You can skip it for repo-meta changes such as `.github/`.",
      "",
    ].join("\n"));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const check = corpus.checks.find((item) => item.id.startsWith("check:verification-scope:"));

    expect(check?.result).toContain("CI workflow changes require verification");
  });

  test("rejects a branch-policy claim backed only by Makefile target enumeration", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-irrelevant-check-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Before release, synchronize the branch with upstream.\n");
    await writeFile(join(targetDir, "Makefile"), "test:\n\tpytest\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const line = corpus.lines.find((item) => item.path === "AGENTS.md")!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "verification:unsafe-branch-sync",
      layer: "verification",
      severity: "high",
      title: "Branch synchronization lacks divergence protection",
      defect: "The release instruction can overwrite local divergence during branch synchronization.",
      evidence: [line.id],
      counterchecks: ["check:make-targets"],
      artifact: "AGENTS.md",
      change: "Replace the synchronization instruction with a non-destructive branch comparison procedure.",
      risk: "A release operator could lose unpushed changes.",
      uncertainty: "The repository's intended branch policy is not supplied.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("accepts a scope contradiction backed by the scope comparison", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-scope-model-"));
    await writeFile(join(targetDir, "AGENTS.md"), [
      "Run it when you change:",
      "- CI workflows.",
      "",
      "You can skip it for repo-meta changes such as `.github/`.",
      "",
    ].join("\n"));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) => item.path === "AGENTS.md" && /CI workflows|skip it/.test(item.text));
    const check = corpus.checks.find((item) => item.id.startsWith("check:verification-scope:"))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "verification:ci-scope-contradiction",
      layer: "verification",
      severity: "high",
      title: "CI workflow verification scope contradicts its exemption",
      defect: "CI workflow changes require verification but .github changes are exempted.",
      evidence: evidence.map((item) => item.id),
      counterchecks: [check.id],
      artifact: "AGENTS.md",
      change: "Remove CI workflow files from the repo-meta exemption.",
      risk: "CI changes can bypass the verification procedure that explicitly covers them.",
      uncertainty: "The intended treatment of non-workflow .github files remains unspecified.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations.map((item) => item.id)).toContain("verification:ci-scope-contradiction");
  });

  test("rejects exact-version policy inferred only from an absent lockfile", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-version-policy-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "bun@1.3.14",
      devDependencies: { typescript: "^5.9.0" },
    }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const line = corpus.lines.find((item) => item.text.includes("typescript"))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "toolchain:pin-typescript-version",
      layer: "toolchain",
      severity: "medium",
      title: "TypeScript resolution is not reproducible",
      defect: "The TypeScript devDependency uses a caret version range and no lockfile fixes it.",
      evidence: [line.id],
      counterchecks: ["check:lockfiles", "check:package-manager"],
      artifact: "package.json",
      change: "Pin devDependencies.typescript to an exact version.",
      risk: "Fresh installs could resolve another compiler release.",
      uncertainty: "The repository's dependency update policy is not supplied.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("dependency-policy countercheck"))).toBeTrue();
  });

  test("allocates the line budget to root harness files before installed skills", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-priority-"));
    await writeFile(join(targetDir, "AGENTS.md"), "ROOT_COMPLETION_RULE\n");
    for (const name of ["alpha", "bravo", "charlie", "delta"]) {
      const skillDir = join(targetDir, ".agents/skills", name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), Array.from({ length: 400 }, (_, index) =>
        `skill ${name} line ${index + 1}`).join("\n"));
    }
    const generated = join(targetDir, ".eve/snapshot");
    await mkdir(generated, { recursive: true });
    await writeFile(join(generated, "AGENTS.md"), "GENERATED_RULE\n");
    const temporary = join(targetDir, "tmp/cache");
    await mkdir(temporary, { recursive: true });
    await writeFile(join(temporary, "AGENTS.md"), "TEMPORARY_RULE\n");
    const nestedSkill = join(targetDir, ".claude/skills/productivity/demo");
    await mkdir(nestedSkill, { recursive: true });
    await writeFile(join(nestedSkill, "SKILL.md"), "Nested skill entrypoint.\n");

    const corpus = await collectHarnessAuditCorpus(targetDir);

    expect(corpus.lines.some((item) => item.text === "ROOT_COMPLETION_RULE")).toBeTrue();
    expect(corpus.documents.some((item) => item.path.startsWith(".eve/"))).toBeFalse();
    expect(corpus.documents.some((item) => item.path.startsWith("tmp/"))).toBeFalse();
    expect(corpus.documents.map((item) => item.path)).toContain(".claude/skills/productivity/demo/SKILL.md");
    expect(corpus.documents.filter((item) => item.kind === "skill").length).toBeLessThanOrEqual(64);
  });

  test("rejects package-runner drift routed to verification", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-runner-layer-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Evaluate with `npx eve eval`.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@11.5.2", scripts: { test: "vitest" },
    }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const line = corpus.lines.find((item) => item.text.includes("npx eve"))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "verification:package-runner-drift",
      layer: "verification",
      severity: "medium",
      title: "Verification uses an unpinned package runner",
      defect: "npx may resolve a different executable than the pinned pnpm toolchain.",
      evidence: [line.id],
      counterchecks: ["check:package-manager", "check:package-scripts"],
      artifact: "AGENTS.md",
      change: "Route the executable through pnpm exec.",
      risk: "The command can run another CLI version.",
      uncertainty: "The local npx resolution was not executed.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("package-runner defect"))).toBeTrue();
  });

  test("gate-composition claims require inspected script definitions", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-gate-body-"));
    await mkdir(join(targetDir, "scripts"));
    await writeFile(join(targetDir, "scripts/validate-secrets.js"), "process.exit(0);\n");
    await writeFile(join(targetDir, "AGENTS.md"), "Full CI requires tests and secret validation.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ scripts: {
      ci: "npm run test", test: "vitest", "validate:secrets": "node scripts/validate-secrets.js",
    } }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) =>
      item.path === "AGENTS.md" || item.text.includes('"ci"') || item.text.includes('"validate:secrets"'));
    const recommendation = (countercheck: string) => ({
      id: "verification:ci-omits-secrets",
      layer: "verification",
      severity: "high",
      title: "Full CI omits secret validation",
      defect: "The required CI gate never invokes the declared secret validation script.",
      evidence: evidence.map((item) => item.id),
      counterchecks: [countercheck],
      artifact: "package.json",
      change: "Add npm run validate:secrets to the existing ci script.",
      risk: "The required gate can pass without its declared secret check.",
      uncertainty: "A workflow outside this corpus may run the script separately.",
    });
    const namesRunner: BackendCommandRunner = async () => output({
      recommendations: [recommendation("check:package-scripts")],
    });
    const definitionsRunner: BackendCommandRunner = async () => output({
      recommendations: [recommendation("check:package-script-definitions")],
    });

    const rejected = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner: namesRunner });
    const accepted = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner: definitionsRunner });

    expect(rejected.recommendations).toEqual([]);
    expect(accepted.recommendations.map((item) => item.id)).toContain("verification:ci-omits-secrets");
  });

  test("rejects an omitted-stage claim when the inspected gate invokes that stage", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-gate-contains-stage-"));
    await mkdir(join(targetDir, "scripts"));
    await writeFile(join(targetDir, "scripts/validate-secrets.js"), "process.exit(0);\n");
    await writeFile(join(targetDir, "AGENTS.md"), "Full CI requires tests and secret validation.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ scripts: {
      ci: "npm run test; npm run validate:secrets",
      test: "vitest",
      "validate:secrets": "node scripts/validate-secrets.js",
    } }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) => item.path === "AGENTS.md" || item.path === "package.json");
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "verification:ci-omits-secrets",
      layer: "verification",
      severity: "high",
      title: "Full CI omits secret validation",
      defect: "The required CI gate never invokes the declared secret validation script.",
      evidence: evidence.map((item) => item.id),
      counterchecks: ["check:package-script-definitions"],
      artifact: "package.json",
      change: "Add npm run validate:secrets to the existing ci script.",
      risk: "The required gate can pass without its declared secret check.",
      uncertainty: "A workflow outside this corpus may run another gate.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("rejects check-only policy inferred from an auto-fixing script", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-fix-policy-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Run lint before completion.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ scripts: { lint: "oxlint --fix" } }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) => item.path === "AGENTS.md" || item.text.includes("oxlint --fix"));
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "verification:lint-auto-fixes",
      layer: "verification",
      severity: "medium",
      title: "Lint gate auto-fixes files",
      defect: "The completion command mutates files through --fix.",
      evidence: evidence.map((item) => item.id),
      counterchecks: ["check:package-script-definitions"],
      artifact: "package.json",
      change: "Remove --fix from the lint script.",
      risk: "The command can leave unreviewed edits.",
      uncertainty: "No dirty-tree policy was supplied.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("check-only policy countercheck"))).toBeTrue();
  });

  test("does not create package-manager policy from absence alone", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-manager-absence-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ scripts: { ci: "npm test" } }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const line = corpus.lines.find((item) => item.text.includes('"ci"'))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "toolchain:package-manager-unpinned",
      layer: "toolchain",
      severity: "medium",
      title: "npm version is not pinned",
      defect: "package.json does not declare a packageManager value.",
      evidence: [line.id],
      counterchecks: ["check:package-manager", "check:lockfiles"],
      artifact: "package.json",
      change: "Add a packageManager field pinned to an npm version.",
      risk: "npm behavior can differ across machines.",
      uncertainty: "The intended npm version is not supplied.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("speculative absence"))).toBeTrue();
  });

  test("rejects an unpinned-manager claim when packageManager has an exact version", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-manager-pinned-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      packageManager: "pnpm@10.3.0",
      scripts: { test: "vitest" },
    }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const line = corpus.lines.find((item) => item.text.includes('"packageManager"'))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "toolchain:package-manager-unpinned",
      layer: "toolchain",
      severity: "high",
      title: "Package manager version is unpinned",
      defect: "The packageManager field does not pin pnpm to an exact version.",
      evidence: [line.id],
      counterchecks: ["check:package-manager"],
      artifact: "package.json",
      change: "Replace packageManager with an exact pnpm release.",
      risk: "Installs can use different pnpm behavior across machines.",
      uncertainty: "The preferred pnpm patch release was not executed.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(corpus.checks.find((item) => item.id === "check:package-manager")?.result).toBe("pnpm@10.3.0");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("rejects a stale mypy selector claim when its module target exists", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-live-mypy-selector-"));
    await mkdir(join(targetDir, "scripts"), { recursive: true });
    await mkdir(join(targetDir, "fastapi/tests"), { recursive: true });
    await writeFile(join(targetDir, "pyproject.toml"), [
      "[tool.mypy]", "strict = true", "", "[[tool.mypy.overrides]]",
      'module = "fastapi.tests.*"', "ignore_missing_imports = true", "",
    ].join("\n"));
    await writeFile(join(targetDir, "scripts/lint.sh"), "#!/bin/sh\nmypy fastapi\n");
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const line = corpus.lines.find((item) => item.text.includes("fastapi.tests"))!;
    const check = corpus.checks.find((item) => item.id.startsWith("check:mypy-override:"))!;
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "verification:stale-mypy-selector",
      layer: "verification",
      severity: "high",
      title: "Stale mypy override selector",
      defect: "The fastapi.tests override targets a missing module path.",
      evidence: [line.id],
      counterchecks: [check.id],
      artifact: "pyproject.toml",
      change: "Remove the stale fastapi.tests override.",
      risk: "The intended exception is not applied.",
      uncertainty: "Generated modules outside the repository were not inspected.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(check.result).toContain("module target fastapi/tests: directory exists");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("accepts a stale mypy selector claim when its module target is missing", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-stale-mypy-selector-"));
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
      id: "verification:stale-mypy-selector",
      layer: "verification",
      severity: "high",
      title: "Stale mypy override selector",
      defect: "The fastapi.tests override targets a missing module path.",
      evidence: [line.id],
      counterchecks: [check.id],
      artifact: "pyproject.toml",
      change: "Remove the stale fastapi.tests override.",
      risk: "The intended exception is not applied.",
      uncertainty: "Generated modules outside the repository were not inspected.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(check.result).toContain("module target fastapi/tests: missing");
    expect(report.recommendations.map((item) => item.id)).toContain("verification:stale-mypy-selector");
  });

  test("rejects a runs-without-tests claim when the named gate invokes tests", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-gate-with-tests-"));
    await writeFile(join(targetDir, "AGENTS.md"), "Before completion, run `bun run check`.\n");
    await writeFile(join(targetDir, "package.json"), JSON.stringify({ scripts: {
      check: "bun test && tsc --noEmit", test: "bun test",
    } }, null, 2));
    const corpus = await collectHarnessAuditCorpus(targetDir);
    const evidence = corpus.lines.filter((item) => item.path === "AGENTS.md" || item.path === "package.json");
    const runner: BackendCommandRunner = async () => output({ recommendations: [{
      id: "verification:check-runs-without-tests",
      layer: "verification",
      severity: "high",
      title: "Completion gate runs without tests",
      defect: "The check script leaves the test suite outside the completion gate.",
      evidence: evidence.map((item) => item.id),
      counterchecks: ["check:package-script-definitions"],
      artifact: "package.json",
      change: "Replace the check body with bun test followed by tsc --noEmit.",
      risk: "Agents can report completion without exercising the test suite.",
      uncertainty: "A separate external workflow was not inspected.",
    }] });

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

    expect(corpus.checks.find((item) => item.id === "check:package-script-definitions")?.result)
      .toContain("check=bun test && tsc --noEmit");
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });
});
