import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

describe("tsconfig path aliases", () => {
  test("routes a single-target dead alias to an exact deterministic toolchain removal", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-tsconfig-path-"));
    await mkdir(join(targetDir, "packages/demo/src"), { recursive: true });
    await writeFile(join(targetDir, "packages/demo/src/entry.ts"), "export const value = 1;\n");
    await writeFile(join(targetDir, "AGENTS.md"), "Read `docs/required.md` before changing policy.\n");
    await writeFile(join(targetDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@demo/missing": ["./packages/demo/src/index.ts"],
          "@demo/existing": ["./packages/demo/src/entry.ts"],
          "@demo/fallback": ["./packages/demo/src/missing.ts", "./packages/demo/src/entry.ts"],
        },
      },
    }, null, 2));

    const corpus = await collectHarnessAuditCorpus(targetDir);
    const missingAlias = corpus.checks.find((check) =>
      check.description === "Checked referenced path packages/demo/src/index.ts.")!;
    const existingAlias = corpus.checks.find((check) =>
      check.description === "Checked referenced path packages/demo/src/entry.ts.")!;
    const guidance = corpus.checks.find((check) =>
      check.description === "Checked referenced path docs/required.md.")!;
    const report = await auditHarness({ targetDir, mode: "quick" });
    const finding = report.recommendations.find((item) => item.layer === "toolchain")!;

    expect(missingAlias.layers).toEqual(["toolchain"]);
    expect(existingAlias.layers).toEqual(["toolchain"]);
    expect(guidance.layers).toEqual(["guidance"]);
    expect(finding.defect).toContain("@demo/missing");
    expect(finding.defect).toContain("packages/demo/src/index.ts");
    expect(finding.citations.some((item) => item.path === "tsconfig.json"
      && item.excerpt.includes("@demo/missing"))).toBeTrue();
    expect(finding.citations.some((item) => item.path === "tsconfig.json"
      && item.excerpt.includes("./packages/demo/src/index.ts"))).toBeTrue();
    expect(finding.counterchecks).toContainEqual(expect.objectContaining({
      description: "Checked referenced path packages/demo/src/index.ts.",
      result: "missing",
    }));
    expect(finding.proposal.artifact).toBe("tsconfig.json");
    expect(finding.proposal.change).toContain("Remove the `@demo/missing` path mapping");
    expect(finding.proposal.change).toContain("./packages/demo/src/index.ts");
    expect(report.recommendations.some((item) => item.defect.includes("@demo/existing"))).toBeFalse();
    expect(report.recommendations.some((item) => item.defect.includes("@demo/fallback"))).toBeFalse();
    expect(report.metrics.modelCalls).toBe(0);
  });

  test("does not treat an uninstalled dependency alias as a dead repository path", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-tsconfig-dependency-path-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      dependencies: { markdansi: "0.2.1" },
      packageManager: "pnpm@10.23.0",
    }, null, 2));
    await writeFile(join(targetDir, "pnpm-lock.yaml"), [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "      markdansi:",
      "        specifier: 0.2.1",
      "        version: 0.2.1",
      "",
    ].join("\n"));
    await writeFile(join(targetDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { markdansi: ["./node_modules/markdansi/dist/index"] },
      },
    }, null, 2));

    const corpus = await collectHarnessAuditCorpus(targetDir);
    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(corpus.checks.some((check) =>
      check.description === "Checked referenced path node_modules/markdansi/dist/index."))
      .toBeFalse();
    expect(report.recommendations).toEqual([]);
    expect(report.metrics.modelCalls).toBe(0);
  });
});
