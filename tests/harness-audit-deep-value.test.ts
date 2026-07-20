import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { scoreHarnessAudit, type HarnessAuditGroundTruth } from "../src/engine/harness-audit-evaluation";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

const fixtures = resolve(import.meta.dir, "fixtures/harness-audit");

test("deep can report the seeded test prohibition with its script-definition countercheck", async () => {
  const targetDir = resolve(fixtures, "seeded");
  const corpus = await collectHarnessAuditCorpus(targetDir);
  const evidence = (text: string) => corpus.lines.find((line) => line.text.includes(text))!.id;
  const verification = {
      id: "verification:completion-policy-bypasses-tests",
      layer: "verification",
      severity: "high",
      title: "Completion policy bypasses the test suite",
      defect: "AGENTS.md makes the package.json check script authoritative but then prohibits tests, even though the check script runs bun test.",
      evidence: [
        evidence("source of truth for completion"),
        evidence("Do not run the test suite"),
        evidence("bun test && tsc"),
      ],
      counterchecks: ["check:package-script-definitions"],
      artifact: "AGENTS.md",
      change: "Remove the test prohibition and require bun run check before reporting completion.",
      risk: "Agents can report success after type checking without executing the repository test suite.",
      uncertainty: "The script bodies were inspected but not executed.",
  };
  const toolchain = {
    id: "toolchain:floating-package-manager",
    layer: "toolchain",
    severity: "high",
    title: "Package manager version floats",
    defect: "packageManager is floating because bun@latest does not pin an exact version.",
    evidence: [evidence("bun@latest")],
    counterchecks: ["check:package-manager"],
    artifact: "package.json",
    change: "Replace bun@latest with the exact Bun version used by the repository.",
    risk: "The install toolchain can change between otherwise identical agent runs.",
    uncertainty: "The intended Bun version was not inferred from an absent lockfile.",
  };
  const runner: BackendCommandRunner = async (input) => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [
      (input.stdin ?? input.cmd.at(-1) ?? "").includes("Audit only these layers: toolchain")
        ? toolchain
        : verification,
    ] }),
  });
  const truthDocument = JSON.parse(await readFile(resolve(fixtures, "ground-truth.json"), "utf8")) as {
    repositories: Record<string, Omit<HarnessAuditGroundTruth, "repository">>;
  };
  const truth = { repository: "seeded", issues: truthDocument.repositories.seeded!.issues };

  const quick = await auditHarness({ targetDir, mode: "quick" });
  const deep = await auditHarness({ targetDir, mode: "deep", backend: "codex", runner });
  const quickScore = scoreHarnessAudit(quick, truth);
  const deepScore = scoreHarnessAudit(deep, truth);

  expect(quickScore.missedIssues).toEqual([
    "seed-verification-bypassed-tests",
    "seed-toolchain-floating-manager",
  ]);
  expect(deep.recommendations.map((item) => item.id))
    .toContain("verification:completion-policy-bypasses-tests");
  expect(deep.recommendations.map((item) => item.id)).toContain("toolchain:floating-package-manager");
  expect(deepScore.missedIssues).toEqual([]);
  expect(deepScore.precision).toBe(1);
  expect(deepScore.correctLayerRate).toBe(1);
  expect(deep.metrics.modelCalls).toBe(2);
});
