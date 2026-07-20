import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

async function rubyFixture(withTarget: boolean) {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-ruby-reference-"));
  const path = "lib/jumpstart/lib/jumpstart/configuration";
  await writeFile(join(targetDir, "Gemfile"), `require_relative "${path}"\n`);
  if (withTarget) {
    await mkdir(join(targetDir, "lib/jumpstart/lib/jumpstart"), { recursive: true });
    await writeFile(join(targetDir, `${path}.rb`), "module Jumpstart; end\n");
  }
  const corpus = await collectHarnessAuditCorpus(targetDir);
  const evidence = corpus.lines.find((line) => line.text.includes("require_relative"))!;
  const check = corpus.checks.find((item) => item.description.includes(path))!;
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [{
      id: "toolchain:missing-relative-require",
      layer: "toolchain",
      severity: "high",
      title: "Relative Ruby file is missing",
      defect: `Gemfile requires ${path}, but that local Ruby file is missing.`,
      evidence: [evidence.id],
      counterchecks: [check.id],
      artifact: "Gemfile",
      change: `Remove the stale require_relative expression for ${path}.`,
      risk: "Bundler cannot evaluate the repository Gemfile.",
      uncertainty: "The target could be generated before Bundler runs.",
    }] }),
  });
  return { targetDir, corpus, check, runner };
}

describe("Ruby relative references", () => {
  test("an existing implicit .rb target rejects a missing-file recommendation", async () => {
    const { targetDir, corpus, check, runner } = await rubyFixture(true);

    expect(check.result).toBe("lib/jumpstart/lib/jumpstart/configuration.rb: regular file exists");
    expect(check.layers).toContain("toolchain");
    expect(corpus.checks.some((item) => item.result === "missing" && item.description.includes("configuration"))).toBeFalse();

    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });
    expect(report.recommendations).toEqual([]);
    expect(report.notes.some((note) => note.includes("counterchecks do not test"))).toBeTrue();
  });

  test("a missing exact, .rb, and .so target remains model-admissible", async () => {
    const { targetDir, check, runner } = await rubyFixture(false);

    expect(check.result).toBe("missing; exact, .rb, and .so targets are absent");
    const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });
    expect(report.recommendations.map((item) => item.id)).toEqual(["toolchain:missing-relative-require"]);
  });
});
