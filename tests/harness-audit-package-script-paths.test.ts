import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

test("missing local executable in a package task routes toolchain first and cleans up matching guidance", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-package-script-path-"));
  await mkdir(join(targetDir, "scripts"));
  await writeFile(join(targetDir, "scripts/existing.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(join(targetDir, "AGENTS.md"),
    "Restart through the desktop app or `scripts/restart.sh`.\n");
  await writeFile(join(targetDir, "package.json"), [
    "{",
    "  \"scripts\": {",
    "    \"restart\": \"bash scripts/restart.sh\",",
    "    \"existing\": \"bash scripts/existing.sh\",",
    "    \"fallback\": \"bash scripts/fallback.sh || bash scripts/existing.sh\"",
    "  }",
    "}",
    "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.metrics.modelCalls).toBe(0);
  expect(report.metrics.inputTokens).toBe(0);
  expect(report.metrics.outputTokens).toBe(0);
  expect(report.recommendations).toHaveLength(2);

  const toolchain = report.recommendations[0]!;
  expect(toolchain.layer).toBe("toolchain");
  expect(toolchain.severity).toBe("high");
  expect(toolchain.citations).toEqual([{
    path: "package.json",
    line: 3,
    excerpt: "\"restart\": \"bash scripts/restart.sh\",",
  }]);
  expect(toolchain.counterchecks.map((item) => item.result))
    .toEqual(["missing", "all selected harness files read"]);
  expect(toolchain.proposal).toEqual({
    artifact: "package.json",
    change: "Remove the `restart` task from `scripts` in package.json. Reintroduce it only after scripts/restart.sh exists and the command has been reviewed.",
  });
  expect(toolchain.risk).toContain("restart");
  expect(toolchain.uncertainty).toContain("removal, restoration, or replacement");

  const guidance = report.recommendations[1]!;
  expect(guidance.layer).toBe("guidance");
  expect(guidance.severity).toBe("medium");
  expect(guidance.defect).toBe(
    "AGENTS.md offers scripts/restart.sh as an operational option, but the contained path check found no such artifact.",
  );
  expect(guidance.citations).toEqual([{
    path: "AGENTS.md",
    line: 1,
    excerpt: "Restart through the desktop app or `scripts/restart.sh`.",
  }]);
  expect(guidance.proposal).toEqual({
    artifact: "AGENTS.md",
    change: "Remove `scripts/restart.sh` as an available option from every cited instruction in AGENTS.md while retaining verified alternatives. Reintroduce it only after the script exists and has been reviewed.",
  });

  expect(report.recommendations.some((item) => item.defect.includes("scripts/fallback.sh"))).toBeFalse();
  expect(report.recommendations.some((item) => item.defect.includes("scripts/existing.sh"))).toBeFalse();
  expect(report.recommendations.some((item) => /validated/i.test(JSON.stringify(item)))).toBeFalse();
});

test("a missing path used only in an ambiguous compound package task stays silent", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-package-script-compound-"));
  await writeFile(join(targetDir, "package.json"), [
    "{",
    "  \"scripts\": {",
    "    \"restart\": \"bash scripts/restart.sh || echo unavailable\"",
    "  }",
    "}",
    "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.recommendations).toEqual([]);
  expect(report.metrics.modelCalls).toBe(0);
});

test("a creation word in the package task key does not hide its invoked executable", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-package-create-task-"));
  await writeFile(join(targetDir, "AGENTS.md"),
    "Create `scripts/generated.js` only when the generated integration is requested.\n");
  await writeFile(join(targetDir, "package.json"), [
    "{",
    "  \"scripts\": {",
    "    \"create-plugin\": \"node scripts/create-plugin.js\"",
    "  }",
    "}",
    "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.recommendations).toHaveLength(1);
  expect(report.recommendations[0]).toEqual(expect.objectContaining({
    layer: "toolchain",
    severity: "high",
    defect: "package.json defines task create-plugin as `node scripts/create-plugin.js`, but the contained path check found no scripts/create-plugin.js artifact.",
    proposal: {
      artifact: "package.json",
      change: "Remove the `create-plugin` task from `scripts` in package.json. Reintroduce it only after scripts/create-plugin.js exists and the command has been reviewed.",
    },
  }));
  expect(report.recommendations[0]?.citations[0]).toEqual(expect.objectContaining({
    path: "package.json",
    line: 3,
  }));
  expect(report.recommendations.some((item) => item.defect.includes("scripts/generated.js"))).toBeFalse();
  expect(report.metrics.modelCalls).toBe(0);
});

test("a package task checks a two-segment local executable outside the known path roots", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-package-src-path-"));
  await mkdir(join(targetDir, "src"));
  await writeFile(join(targetDir, "src/existing.ts"), "export {};\n");
  await writeFile(join(targetDir, "package.json"), [
    "{",
    "  \"scripts\": {",
    "    \"missing\": \"node src/missing.ts\",",
    "    \"existing\": \"node src/existing.ts\"",
    "  }",
    "}",
    "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.recommendations).toHaveLength(1);
  expect(report.recommendations[0]).toEqual(expect.objectContaining({
    layer: "toolchain",
    severity: "high",
    defect: "package.json defines task missing as `node src/missing.ts`, but the contained path check found no src/missing.ts artifact.",
    proposal: {
      artifact: "package.json",
      change: "Remove the `missing` task from `scripts` in package.json. Reintroduce it only after src/missing.ts exists and the command has been reviewed.",
    },
  }));
  expect(report.recommendations.some((item) => item.defect.includes("src/existing.ts"))).toBeFalse();
  expect(report.metrics.modelCalls).toBe(0);
});

test("a tsx package task checks its local TypeScript entrypoint", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-package-tsx-path-"));
  await mkdir(join(targetDir, "src"));
  await writeFile(join(targetDir, "src/existing.ts"), "export {};\n");
  await writeFile(join(targetDir, "package.json"), [
    "{",
    "  \"scripts\": {",
    "    \"missing\": \"tsx composer/src/cli.ts\",",
    "    \"existing\": \"tsx src/existing.ts\"",
    "  }",
    "}",
    "",
  ].join("\n"));

  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(report.recommendations).toHaveLength(1);
  expect(report.recommendations[0]).toEqual(expect.objectContaining({
    layer: "toolchain",
    severity: "high",
    defect: "package.json defines task missing as `tsx composer/src/cli.ts`, but the contained path check found no composer/src/cli.ts artifact.",
    proposal: {
      artifact: "package.json",
      change: "Remove the `missing` task from `scripts` in package.json. Reintroduce it only after composer/src/cli.ts exists and the command has been reviewed.",
    },
  }));
  expect(report.recommendations.some((item) => item.defect.includes("src/existing.ts"))).toBeFalse();
  expect(report.metrics.modelCalls).toBe(0);
});

test("nested package tasks resolve local executables from their manifest directory", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-nested-package-existing-"));
  const packageDir = join(targetDir, "packages/app");
  await mkdir(join(packageDir, "scripts"), { recursive: true });
  await writeFile(join(packageDir, "scripts/validate-load-options-methods.js"), "export {};\n");
  await writeFile(join(packageDir, "scripts/validate-schema-versions.js"), "export {};\n");
  await writeFile(join(packageDir, "AGENTS.md"), "Run `pnpm lint` before completing changes in this package.\n");
  await writeFile(join(packageDir, "package.json"), JSON.stringify({
    scripts: {
      lint: "eslint nodes credentials utils test --quiet && node ./scripts/validate-load-options-methods.js && node ./scripts/validate-schema-versions.js",
    },
  }, null, 2));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick", maxModelCalls: 0 });

  expect(corpus.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      description: "Checked referenced path packages/app/scripts/validate-load-options-methods.js.",
      result: "regular file exists",
    }),
    expect.objectContaining({
      description: "Checked referenced path packages/app/scripts/validate-schema-versions.js.",
      result: "regular file exists",
    }),
  ]));
  expect(corpus.checks.some((check) =>
    check.description === "Checked referenced path scripts/validate-schema-versions.js.")).toBeFalse();
  expect(report.recommendations).toEqual([]);
  expect(report.metrics.modelCalls).toBe(0);
  expect(report.notes ?? []).not.toContain(expect.stringContaining("validated"));
});

test("a missing nested package executable targets its own manifest at the toolchain layer", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-nested-package-missing-"));
  const packageDir = join(targetDir, "packages/app");
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, "AGENTS.md"), "Run `pnpm check` before completing changes in this package.\n");
  await writeFile(join(packageDir, "package.json"), JSON.stringify({
    scripts: { check: "node ./scripts/missing.js" },
  }, null, 2));

  const report = await auditHarness({ targetDir, mode: "quick", maxModelCalls: 0 });

  expect(report.recommendations).toHaveLength(1);
  expect(report.recommendations[0]).toMatchObject({
    layer: "toolchain",
    severity: "high",
    citations: [expect.objectContaining({ path: "packages/app/package.json" })],
    proposal: { artifact: "packages/app/package.json" },
    source: "deterministic",
  });
  expect(report.recommendations[0]!.counterchecks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      description: "Checked referenced path packages/app/scripts/missing.js.",
      result: "missing",
    }),
  ]));
  expect(report.recommendations[0]!.risk).toContain("packages/app/scripts/missing.js");
  expect(report.recommendations[0]!.uncertainty).toContain("removal, restoration, or replacement");
});
