import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";

async function routedRepository(input: {
  guidance: string;
  packageManager?: string;
  scripts: Record<string, string>;
}): Promise<string> {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-script-manager-route-"));
  await writeFile(join(targetDir, "AGENTS.md"), `${input.guidance}\n`);
  await writeFile(join(targetDir, "package.json"), `${JSON.stringify({
    name: "manager-route",
    ...(input.packageManager ? { packageManager: input.packageManager } : {}),
    scripts: input.scripts,
  }, null, 2)}\n`);
  await writeFile(join(targetDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  return targetDir;
}

describe("root package-script manager route", () => {
  test("reports package scripts that bypass an exact pnpm-only policy", async () => {
    const targetDir = await routedRepository({
      guidance: "Always use pnpm instead of npm or yarn for installing dependencies and running scripts.",
      scripts: {
        version: "npm run version:sync && git add package.json",
        build: "npm run version:sync && npm run compile",
        verify: "pnpm run test",
      },
    });

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.metrics.modelCalls).toBe(0);
    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0]).toMatchObject({
      layer: "toolchain",
      severity: "high",
      title: "Root package scripts bypass the required package manager",
      proposal: { artifact: "package.json" },
      source: "deterministic",
    });
    expect(report.recommendations[0]!.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "AGENTS.md", line: 1 }),
      expect.objectContaining({ path: "package.json", excerpt: expect.stringContaining("npm run") }),
    ]));
    expect(report.recommendations[0]!.proposal.change).toContain("version");
    expect(report.recommendations[0]!.proposal.change).toContain("build");
    expect(report.recommendations[0]!.counterchecks).toContainEqual(expect.objectContaining({
      result: expect.stringContaining("pnpm required; npm invoked by scripts"),
    }));
  });

  test("stays silent when the manifest contradicts the guidance route", async () => {
    const targetDir = await routedRepository({
      guidance: "Always use pnpm instead of npm for running scripts.",
      packageManager: "npm@11.4.0",
      scripts: { build: "npm run compile" },
    });

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toEqual([]);
  });

  test("does not promote an illustrative manager comparison into policy", async () => {
    const targetDir = await routedRepository({
      guidance: "For example, use pnpm instead of npm when demonstrating a package command.",
      scripts: { build: "npm run compile" },
    });

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toEqual([]);
  });
});
