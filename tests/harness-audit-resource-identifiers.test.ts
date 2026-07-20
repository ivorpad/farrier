import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

test("AWS resource labels and log streams are not repository paths", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-aws-identifiers-"));
  const skillDir = join(targetDir, ".agents/skills/aws-operations");
  await mkdir(join(skillDir, "scripts"), { recursive: true });
  await writeFile(join(skillDir, "scripts/check.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(join(skillDir, "SKILL.md"), [
    "---", "name: aws-operations", "description: Inspect AWS service health.", "---", "",
    "```json", '"ResourceLabel": "app/my-alb/abc123/targetgroup/myapp-tg/def456"', "```", "",
    "```bash", 'aws logs get-log-events --log-stream-name "ecs/myapp/abc123def456"',
    "./scripts/check.sh", "```", "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const evidence = corpus.lines.find((line) => line.text.includes("--log-stream-name"))!;
  const resourceCheck = corpus.checks.find((item) => item.description.includes("app/my-alb"));
  const streamCheck = corpus.checks.find((item) => item.description.includes("ecs/myapp"));
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [{
      id: "skill:missing-log-stream",
      layer: "skill",
      severity: "high",
      title: "Required log stream path is missing",
      defect: "The skill requires ecs/myapp/abc123def456, but that repository path is missing.",
      evidence: [evidence.id],
      counterchecks: [streamCheck?.id ?? "check:path:aws-log-stream"],
      artifact: ".agents/skills/aws-operations/SKILL.md",
      change: "Remove the stale log stream path from the command example.",
      risk: "Agents can invoke a command against a nonexistent path.",
      uncertainty: "The identifier may refer to an external AWS resource.",
    }] }),
  });

  const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

  expect(report.recommendations).toEqual([]);
  expect(resourceCheck).toBeUndefined();
  expect(streamCheck).toBeUndefined();
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path .agents/skills/aws-operations/scripts/check.sh.",
    result: "regular file exists",
  }));
});
