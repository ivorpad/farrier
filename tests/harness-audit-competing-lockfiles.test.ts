import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";

async function repositoryWithPackage(
  input: Record<string, unknown>,
  lockfiles = ["package-lock.json", "pnpm-lock.yaml"],
): Promise<string> {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-competing-lockfiles-"));
  await writeFile(join(targetDir, "package.json"), `${JSON.stringify(input, null, 2)}\n`);
  for (const path of lockfiles) await writeFile(join(targetDir, path), "lockfileVersion: '9.0'\n");
  return targetDir;
}

async function writeGuidance(targetDir: string, text: string): Promise<void> {
  await writeFile(join(targetDir, "AGENTS.md"), text);
}

describe("deterministic competing lockfiles", () => {
  test("routes a repeated pnpm package workflow to the competing npm lockfile", async () => {
    const targetDir = await repositoryWithPackage({
      name: "pnpm-routed",
      scripts: {
        build: "pnpm run compile",
        start: "pnpm run build && node dist/index.js",
      },
      pnpm: { onlyBuiltDependencies: ["esbuild"] },
    });

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.metrics.modelCalls).toBe(0);
    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0]).toMatchObject({
      layer: "toolchain",
      severity: "high",
      title: "Root package route conflicts with a second JavaScript lockfile",
      proposal: { artifact: "package-lock.json" },
      source: "deterministic",
    });
    expect(report.recommendations[0]!.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "package.json", excerpt: expect.stringContaining("pnpm run") }),
      expect.objectContaining({ path: "package.json", excerpt: expect.stringContaining('"pnpm"') }),
    ]));
    expect(report.recommendations[0]!.counterchecks).toContainEqual(expect.objectContaining({
      description: "Checked repository lockfiles before assessing dependency pinning.",
      result: "package-lock.json, pnpm-lock.yaml",
    }));
    expect(report.recommendations[0]!.proposal.change).toContain("Remove package-lock.json");
    expect(report.recommendations[0]!.uncertainty).toContain("does not declare packageManager");
  });

  test("stays silent when two lockfiles do not establish the intended manager", async () => {
    const targetDir = await repositoryWithPackage({
      name: "manager-unknown",
      scripts: { build: "vite build", test: "vitest run" },
    });

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toEqual([]);
    expect(report.metrics.modelCalls).toBe(0);
  });

  test("uses an exact packageManager declaration when scripts do not contradict it", async () => {
    const targetDir = await repositoryWithPackage({
      name: "declared-pnpm",
      packageManager: "pnpm@10.12.1",
      scripts: { build: "vite build", test: "vitest run" },
    });

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0]!.proposal.artifact).toBe("package-lock.json");
    expect(report.recommendations[0]!.citations).toContainEqual(expect.objectContaining({
      path: "package.json",
      excerpt: expect.stringContaining('"packageManager": "pnpm@10.12.1"'),
    }));
  });

  test("does not choose a lockfile while package routes contradict each other", async () => {
    const targetDir = await repositoryWithPackage({
      name: "route-conflict",
      packageManager: "pnpm@10.12.1",
      scripts: { build: "npm run compile", test: "vitest run" },
    });

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toEqual([]);
  });

  test("does not treat a Python lockfile as a competing JavaScript lockfile", async () => {
    const targetDir = await repositoryWithPackage({
      name: "polyglot",
      packageManager: "pnpm@10.12.1",
      scripts: { build: "vite build" },
    }, ["pnpm-lock.yaml", "uv.lock"]);

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toEqual([]);
  });

  test("uses an exact root guidance command when packageManager is absent", async () => {
    const targetDir = await repositoryWithPackage({
      name: "guided-npm",
      scripts: {
        dev: "next dev",
        lint: "eslint .",
        "lint:fix": "npm run lint -- --fix",
        format: "npm run lint:fix",
      },
    });
    await writeGuidance(targetDir, [
      "# Local development",
      "",
      "Start the repository with `npm run dev`.",
      "",
    ].join("\n"));

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0]!.proposal.artifact).toBe("pnpm-lock.yaml");
    expect(report.recommendations[0]!.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "AGENTS.md", excerpt: expect.stringContaining("npm run dev") }),
      expect.objectContaining({ path: "package.json", excerpt: expect.stringContaining("npm run") }),
    ]));
    expect(report.recommendations[0]!.uncertainty).toContain("exact root guidance");
  });

  test("does not choose from conflicting root guidance routes", async () => {
    const targetDir = await repositoryWithPackage({
      name: "conflicting-guidance",
      scripts: { dev: "next dev", build: "next build" },
    });
    await writeGuidance(targetDir, [
      "Run `npm run dev` for development.",
      "Run `pnpm run build` for release output.",
      "",
    ].join("\n"));

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.recommendations).toEqual([]);
  });
});
