import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

test("remote skill commands and package-manager builtins do not inherit the repository route", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-command-owner-"));
  const remoteSkill = join(targetDir, ".agents/skills/remote-build");
  const localSkill = join(targetDir, ".agents/skills/local-build");
  await Promise.all([
    mkdir(remoteSkill, { recursive: true }),
    mkdir(localSkill, { recursive: true }),
    mkdir(join(targetDir, "scripts"), { recursive: true }),
  ]);
  await writeFile(join(targetDir, "scripts/view.mjs"), "export {};\n");
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    packageManager: "pnpm@10.3.0",
    scripts: { build: "tsc", verify: "vitest run", view: "node scripts/view.mjs" },
  }, null, 2));
  await writeFile(join(targetDir, "AGENTS.md"), "Before completion, run `npm run verify`.\n");
  await writeFile(join(remoteSkill, "SKILL.md"), [
    "---", "name: remote-build", "description: Run a build in a testbox.", "---", "",
    "If the guest needs artifacts, use `npm run build`.",
    "Re-run the build on the remote testbox before testing.",
    "Resolve the published tag with `npm view package@latest version`.", "",
  ].join("\n"));
  await writeFile(join(localSkill, "SKILL.md"), [
    "---", "name: local-build", "description: Build this repository.", "---", "",
    "Before completing this repository, run `npm run build`.", "",
    "Run the repository's `npm run view` script when checking its output.", "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });
  const toolchain = report.recommendations.filter((item) => item.layer === "toolchain");

  expect(toolchain.map((item) => item.citations[0]?.path).sort()).toEqual([
    ".agents/skills/local-build/SKILL.md",
    ".agents/skills/local-build/SKILL.md",
    "AGENTS.md",
  ]);
  expect(toolchain.some((item) => item.defect.includes("npm run view uses npm"))).toBeTrue();
  expect(toolchain.find((item) => item.citations[0]?.path === "AGENTS.md")?.proposal.change).toBe(
    "Replace `npm run verify` with `pnpm run verify` in AGENTS.md.",
  );
  expect(report.recommendations.some((item) => item.defect.includes("npm view"))).toBeFalse();
  expect(report.recommendations.some((item) => item.layer === "verification")).toBeFalse();
});

test("uv routing gives an exact execution fix without guessing a dependency workflow", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-uv-route-"));
  await writeFile(join(targetDir, "AGENTS.md"), [
    "Use uv for Python dependency and command execution.",
    "Run `pytest -q` before completion.",
    "Install the local package with `python -m pip install -e .`.", "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });
  const changes = report.recommendations.filter((item) => item.layer === "toolchain")
    .map((item) => item.proposal.change);

  expect(changes).toContain("Replace `pytest -q` with `uv run pytest -q` in AGENTS.md.");
  expect(changes).toContain("Rewrite the dependency command through the repository's intended uv dependency workflow.");
  expect(changes.some((change) => change.includes("uv run python -m pip"))).toBeFalse();
});

test("example commands do not override the declared route while mandatory commands still do", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-command-example-"));
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    packageManager: "pnpm@10.22.0", scripts: { check: "vitest", typecheck: "tsc --noEmit" },
  }, null, 2));
  await writeFile(join(targetDir, "AGENTS.md"), [
    "Treat repository gates (e.g., `pnpm run check`, `bun run typecheck`) as mandatory.",
    "Before completion, run `bun run check`.", "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });
  const toolchain = report.recommendations.filter((item) => item.layer === "toolchain");

  expect(toolchain.map((item) => item.citations[0]?.line)).toEqual([2]);
  expect(toolchain[0]?.defect).toContain("bun run check uses bun");
});

test("nested guidance uses its nearest package manager instead of the root manager", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-command-scope-"));
  const webDir = join(targetDir, "web");
  await mkdir(webDir, { recursive: true });
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    packageManager: "pnpm@10.22.0", scripts: { verify: "vitest run" },
  }, null, 2));
  await writeFile(join(targetDir, "AGENTS.md"), "Before completion, run `npm run verify`.\n");
  await writeFile(join(webDir, "package.json"), JSON.stringify({
    packageManager: "npm@11.4.0", scripts: { verify: "vitest run" },
  }, null, 2));
  await writeFile(join(webDir, "AGENTS.md"), "Before completing this package, run `npm run verify`.\n");

  const report = await auditHarness({ targetDir, mode: "quick" });
  const toolchain = report.recommendations.filter((item) => item.layer === "toolchain");

  expect(toolchain.map((item) => item.citations[0]?.path)).toEqual(["AGENTS.md"]);
  expect(toolchain[0]?.citations[1]?.path).toBe("package.json");
  expect(report.recommendations.some((item) => item.layer === "verification")).toBeFalse();
});

test("manager drift does not propose another invalid missing-target command", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-command-conflict-"));
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    packageManager: "bun@1.3.14", scripts: { check: "bun test", test: "bun test" },
  }, null, 2));
  await writeFile(join(targetDir, "AGENTS.md"), "Before completion, run `npm run verify`.\n");

  const report = await auditHarness({ targetDir, mode: "quick" });
  const toolchain = report.recommendations.find((item) => item.layer === "toolchain");
  const verification = report.recommendations.find((item) => item.layer === "verification");

  expect(toolchain?.proposal.change).toBe(
    "Remove the invalid `npm run verify` instruction from AGENTS.md. If the intended task is restored, route it through bun.",
  );
  expect(toolchain?.proposal.change).not.toContain("`bun run verify`");
  expect(verification?.proposal.change).toContain("Remove the invalid `npm run verify` instruction");
});

test("missing package targets use a proved body match without guessing alternatives", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-target-proposal-"));
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    packageManager: "pnpm@10.22.0",
    scripts: { build: "tsc", check: "vitest", format: "oxfmt --write", "format:check": "oxfmt --check" },
  }, null, 2));
  await writeFile(join(targetDir, "AGENTS.md"), [
    "Format fix: `pnpm format:fix` (oxfmt --write)",
    "Before completion, run `pnpm run verify:full`.", "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });
  const verification = report.recommendations.filter((item) => item.layer === "verification");

  expect(verification.find((item) => item.defect.includes("format:fix"))?.proposal.change).toBe(
    "Replace `pnpm format:fix` with `pnpm format` in AGENTS.md; its inspected script body matches `oxfmt --write` on the cited line.",
  );
  expect(verification.find((item) => item.defect.includes("verify:full"))?.proposal.change).toBe(
    "Remove the invalid `pnpm run verify:full` instruction from AGENTS.md. Reintroduce it only after the intended task exists and has been reviewed.",
  );
  expect(verification.some((item) => item.proposal.change.includes("build, check"))).toBeFalse();
  expect(verification.find((item) => item.defect.includes("format:fix"))?.counterchecks
    .some((check) => check.description.includes("script definitions") && check.result.includes("format=oxfmt --write")))
    .toBeTrue();
});

test("Yarn dependency binaries are not treated as absent package scripts", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-yarn-binary-"));
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    packageManager: "yarn@4.11.0",
    scripts: { test: "vitest run" },
    devDependencies: { typescript: "^5.9.3" },
  }, null, 2));
  await writeFile(join(targetDir, "AGENTS.md"), "Check types with TypeScript: `yarn tsc`.\n");

  const quick = await auditHarness({ targetDir, mode: "quick" });
  const corpus = await collectHarnessAuditCorpus(targetDir);
  const line = corpus.lines.find((item) => item.text.includes("yarn tsc"))!;
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [{
      id: "verification:yarn-tsc",
      layer: "verification",
      severity: "high",
      title: "The tsc target is missing",
      defect: "The `tsc` script is absent from package.json.",
      evidence: [line.id],
      counterchecks: ["check:package-scripts", "check:package-script-definitions"],
      artifact: "AGENTS.md",
      change: "Remove the yarn tsc instruction.",
      risk: "The documented check could fail.",
      uncertainty: "The command was not executed.",
    }] }),
  });
  const baseline = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

  expect(quick.recommendations).toEqual([]);
  expect(baseline.recommendations).toEqual([]);
  expect(baseline.notes.some((note) => note.includes("dependency-provided binary"))).toBeTrue();
});
