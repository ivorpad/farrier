import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

test("nested guidance counterchecks localized mandatory resource paths", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-localized-guidance-paths-"));
  await mkdir(join(targetDir, "audicon/referencias/auditoria"), { recursive: true });
  await writeFile(join(targetDir, "audicon/CLAUDE.md"), [
    "# Asistente",
    "",
    "Consulta SIEMPRE estas referencias antes de responder:",
    "",
    "- Auditoría: `referencias/auditoria/`",
    "- Legal: `referencias/legal/`",
    "",
  ].join("\n"));
  const corpus = await collectHarnessAuditCorpus(targetDir);
  const existingPath = "audicon/referencias/auditoria";
  const missingPath = "audicon/referencias/legal";
  const existing = corpus.checks.find((item) =>
    item.description === `Checked referenced path ${existingPath}.`);
  const missing = corpus.checks.find((item) =>
    item.description === `Checked referenced path ${missingPath}.`);

  expect(existing?.result).toBe("directory exists");
  expect(missing?.result).toBe("missing");
  const evidence = corpus.lines.find((line) => line.text.includes("referencias/legal"))!;
  const recommendation = {
    id: "guidance:missing-localized-reference",
    layer: "guidance",
    severity: "high",
    title: "Mandatory legal reference is missing",
    defect: `${missingPath} is missing even though the guidance requires it before answering.`,
    evidence: [evidence.id],
    counterchecks: [missing!.id],
    artifact: "audicon/CLAUDE.md",
    change: `Correct or remove the ${missingPath} entry in audicon/CLAUDE.md.`,
    risk: "Agents can answer legal questions without the required source material.",
    uncertainty: "The intended reference directory may exist outside the bounded repository snapshot.",
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

  expect(report.recommendations.map((item) => item.id)).toEqual([
    "guidance:missing-localized-reference",
  ]);
});

test("skill-local localized references resolve without treating prose as a path", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-localized-skill-paths-"));
  const skillDir = join(targetDir, ".agents/skills/revision");
  await mkdir(join(skillDir, "referencias"), { recursive: true });
  await writeFile(join(skillDir, "referencias/checklist.md"), "# Checklist\n");
  await writeFile(join(skillDir, "SKILL.md"), [
    "---",
    "name: revision",
    "description: Revisa documentos con una lista local.",
    "---",
    "",
    "Lee `referencias/checklist.md` antes de revisar.",
    "Las referencias/generales ayudan a mantener el contexto.",
    "",
  ].join("\n"));
  const corpus = await collectHarnessAuditCorpus(targetDir);

  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path .agents/skills/revision/referencias/checklist.md.",
    result: "regular file exists",
  }));
  expect(corpus.checks.some((item) =>
    item.description.includes("referencias/generales"))).toBeFalse();
});
