import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { auditHarness, harnessAuditFailed } from "../src/engine/harness-audit";
import type { BackendCommandRunner } from "../src/engine/backend";

const fixtures = resolve(import.meta.dir, "fixtures/harness-audit");

test("a failed deep generalist makes the audit fail", async () => {
  const runner: BackendCommandRunner = async (input) => {
    const prompt = input.stdin ?? input.cmd.at(-1) ?? "";
    return prompt.includes("The deep generalist receives")
      ? { exitCode: 2, stdout: "", stderr: "generalist unavailable" }
      : { exitCode: 0, stdout: JSON.stringify({ recommendations: [] }), stderr: "" };
  };

  const report = await auditHarness({
    targetDir: resolve(fixtures, "deep-opportunities"),
    mode: "deep",
    backend: "codex",
    runner,
  });

  expect(report.metrics.failedModelCalls).toBe(1);
  expect(report.notes.some((note) => note.includes("generalist model call failed"))).toBeTrue();
  expect(harnessAuditFailed(report)).toBeTrue();
});
