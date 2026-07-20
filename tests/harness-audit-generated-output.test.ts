import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";
import { validateHarnessAuditResponse } from "../src/engine/harness-audit-model";

const jarPath = "java/cli/target/cli-0.0.0.jar";

async function auditMissingJar(buildTask: string) {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-model-generated-output-"));
  await mkdir(join(targetDir, "scripts"));
  await writeFile(join(targetDir, "scripts/build-java.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    scripts: {
      [buildTask]: "bash scripts/build-java.sh",
      "export-options": `npm run ${buildTask} && java -jar ${jarPath} --export-options`,
    },
  }, null, 2));
  const corpus = await collectHarnessAuditCorpus(targetDir);
  const evidence = corpus.lines.find((line) => line.text.includes(jarPath))!;
  const check = corpus.checks.find((item) => item.description === `Checked referenced path ${jarPath}.`)!;
  const recommendation = {
    id: "toolchain:missing-generated-jar",
    layer: "toolchain",
    severity: "high",
    title: "Export command references a missing JAR",
    defect: `The export command requires ${jarPath}, but that artifact is missing.`,
    evidence: [evidence.id],
    counterchecks: [check.id],
    artifact: "package.json",
    change: `Remove or correct the stale ${jarPath} reference in export-options.`,
    risk: "The documented export command cannot start the Java CLI.",
    uncertainty: "The JAR could be produced by an uninspected build outside this snapshot.",
  };
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [recommendation] }),
  });
  const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });
  return { report, corpus, recommendation };
}

async function auditTypeScriptOutput(withSource: boolean, multipleSourceRoots = true) {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-typescript-output-"));
  const output = "dist/nodes/Widget/Widget.node.js";
  const source = "nodes/Widget/Widget.node.ts";
  const companionOutput = "dist/credentials/Widget.credentials.js";
  const companionSource = "credentials/Widget.credentials.ts";
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    scripts: { build: "rimraf dist && tsc" },
    files: ["dist"],
    n8n: {
      nodes: [output],
      ...(multipleSourceRoots ? { credentials: [companionOutput] } : {}),
    },
  }, null, 2));
  await writeFile(join(targetDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { outDir: "./dist/" },
    include: multipleSourceRoots ? ["nodes/**/*", "credentials/**/*"] : ["nodes/**/*"],
  }, null, 2));
  if (withSource) {
    await mkdir(join(targetDir, "nodes/Widget"), { recursive: true });
    await writeFile(join(targetDir, source), "export class Widget {}\n");
    if (multipleSourceRoots) {
      await mkdir(join(targetDir, "credentials"), { recursive: true });
      await writeFile(join(targetDir, companionSource), "export class WidgetCredentials {}\n");
    }
  }
  const corpus = await collectHarnessAuditCorpus(targetDir);
  const evidence = corpus.lines.find((line) => line.text.includes(output))!;
  const check = corpus.checks.find((item) => item.description === `Checked referenced path ${output}.`)!;
  const recommendation = {
    id: "toolchain:missing-typescript-output",
    layer: "toolchain",
    severity: "high",
    title: "Package metadata references a missing JavaScript file",
    defect: `${output} is missing, so the package metadata is stale.`,
    evidence: [evidence.id],
    counterchecks: [check.id],
    artifact: "package.json",
    change: `Remove ${output} from the n8n nodes list.`,
    risk: "The published package could expose a missing node implementation.",
    uncertainty: "The file could be generated during an uninspected build.",
  };
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [recommendation] }),
  });
  const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });
  return { check, report };
}

test("a model cannot call a post-build generated output stale", async () => {
  const { report } = await auditMissingJar("build-java");

  expect(report.recommendations).toEqual([]);
  expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
});

test("a non-build predecessor does not excuse the same missing output", async () => {
  const { corpus, recommendation } = await auditMissingJar("prepare");
  const result = validateHarnessAuditResponse({
    parsed: { recommendations: [recommendation] },
    corpus,
    deterministic: [],
  });

  expect(result.recommendations.map((item) => item.id)).toEqual(["toolchain:missing-generated-jar"]);
});

test("a declared TypeScript output with an existing source is not stale before build", async () => {
  const { check, report } = await auditTypeScriptOutput(true);

  expect(check.result).toContain("source nodes/Widget/Widget.node.ts is a regular file");
  expect(check.result).toContain("build runs tsc into tsconfig.json outDir dist");
  expect(report.recommendations).toEqual([]);
  expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
});

test("a declared TypeScript output with no source remains reportable", async () => {
  const { check, report } = await auditTypeScriptOutput(false);

  expect(check.result).toBe("missing");
  expect(report.recommendations.map((item) => item.id)).toEqual(["toolchain:missing-typescript-output"]);
});

test("one inferred TypeScript source root is not enough to excuse a missing output", async () => {
  const { check, report } = await auditTypeScriptOutput(true, false);

  expect(check.result).toBe("missing");
  expect(report.recommendations.map((item) => item.id)).toEqual(["toolchain:missing-typescript-output"]);
});
