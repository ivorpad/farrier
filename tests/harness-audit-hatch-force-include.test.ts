import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

const source = "docs/reference/predicates.md";
const destination = "pkgname/_docs/reference/predicates.md";

async function auditMapping(input: {
  section: string;
  sourceExists: boolean;
  claimedPath: string;
}) {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-hatch-force-include-"));
  await writeFile(join(targetDir, "pyproject.toml"), [
    `[${input.section}]`,
    `"${source}" = "${destination}"`,
    "",
  ].join("\n"));
  if (input.sourceExists) {
    await mkdir(join(targetDir, "docs/reference"), { recursive: true });
    await writeFile(join(targetDir, source), "# Predicates\n");
  }
  const corpus = await collectHarnessAuditCorpus(targetDir);
  const evidence = corpus.lines.find((line) => line.text.includes(destination))!;
  const check = corpus.checks.find((item) =>
    item.description === `Checked referenced path ${input.claimedPath}.`)!;
  const recommendation = {
    id: "toolchain:stale-force-include-path",
    layer: "toolchain",
    severity: "high",
    title: "Package metadata references a missing file",
    defect: `${input.claimedPath} is missing, so the package metadata is stale.`,
    evidence: [evidence.id],
    counterchecks: [check.id],
    artifact: "pyproject.toml",
    change: `Correct the ${input.claimedPath} file reference in pyproject.toml.`,
    risk: "The package metadata could refer to a file that is not available.",
    uncertainty: "The mapping could describe a generated build destination.",
  };
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [recommendation] }),
  });
  const report = await auditHarness({
    targetDir,
    mode: "baseline",
    backend: "codex",
    runner,
  });
  return { corpus, report };
}

test("a missing Hatch force-include destination is not treated as stale source metadata", async () => {
  const { corpus, report } = await auditMapping({
    section: "tool.hatch.build.targets.wheel.force-include",
    sourceExists: true,
    claimedPath: destination,
  });
  const sourceCheck = corpus.checks.find((item) =>
    item.description === `Checked referenced path ${source}.`)!;
  const destinationCheck = corpus.checks.find((item) =>
    item.description === `Checked referenced path ${destination}.`)!;

  expect(sourceCheck.result).toBe("regular file exists");
  expect(destinationCheck.result).toContain("Hatch wheel build destination");
  expect(destinationCheck.result).toContain(`source ${source}: regular file exists`);
  expect(report.recommendations).toEqual([]);
  expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
});

test("a missing Hatch force-include source remains reportable", async () => {
  const { corpus, report } = await auditMapping({
    section: "tool.hatch.build.targets.wheel.force-include",
    sourceExists: false,
    claimedPath: source,
  });
  const destinationCheck = corpus.checks.find((item) =>
    item.description === `Checked referenced path ${destination}.`)!;

  expect(destinationCheck.result).toContain(`source ${source}: missing`);
  expect(report.recommendations.map((item) => item.id)).toEqual([
    "toolchain:stale-force-include-path",
  ]);
});

test("an unrelated TOML path assignment keeps ordinary missing-path checks", async () => {
  const { corpus } = await auditMapping({
    section: "tool.example.paths",
    sourceExists: true,
    claimedPath: destination,
  });
  const destinationCheck = corpus.checks.find((item) =>
    item.description === `Checked referenced path ${destination}.`)!;

  expect(destinationCheck.result).toBe("missing");
});
