import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";

async function mismatchedHarness(): Promise<string> {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-manifest-stack-"));
  await writeFile(join(targetDir, "package.json"), JSON.stringify({
    name: "typescript-service",
    packageManager: "bun@1.3.14",
    devDependencies: { typescript: "latest" },
  }, null, 2));
  await writeFile(join(targetDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true },
  }, null, 2));
  await writeFile(join(targetDir, ".farrier.json"), JSON.stringify({
    farrierVersion: "0.3.0",
    packIds: ["python-uv", "python-fastapi"],
    agents: ["claude"],
    hookIds: ["secret-shield"],
  }, null, 2));
  return targetDir;
}

describe("manifest stack routing", () => {
  test("blocks hook regeneration when the selected pack contradicts the detected stack", async () => {
    const targetDir = await mismatchedHarness();
    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.metrics.modelCalls).toBe(0);
    expect(report.recommendations).toHaveLength(1);
    const finding = report.recommendations[0]!;
    expect(finding.layer).toBe("toolchain");
    expect(finding.severity).toBe("blocking");
    expect(finding.title).toBe("Manifest stack drift blocks safe harness recovery");
    expect(finding.citations.map((item) => `${item.path}:${item.line}`)).toEqual([
      ".farrier.json:4",
      ".farrier.json:5",
      "package.json:3",
      "tsconfig.json:2",
    ]);
    expect(finding.counterchecks.some((item) =>
      item.result.includes("manifest pack python-fastapi differs from detected stack ts-base"))).toBeTrue();
    expect(finding.proposal.artifact).toBe(".farrier.json");
    expect(finding.proposal.change).toContain(
      'replace `packIds: ["python-uv","python-fastapi"]` with `packIds: ["ts-base"]`',
    );
    expect(finding.proposal.change).toContain("Do not regenerate from the current manifest");
    expect(finding.proposal.change).not.toContain("If the controls were intentionally retired");
    expect(finding.risk).toContain("wrong toolchain");
    expect(finding.uncertainty).toContain("did not mutate");
  });

  test("keeps compatible explicit pack selections out of the drift finding", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-compatible-stack-"));
    await writeFile(join(targetDir, "package.json"), JSON.stringify({
      name: "typescript-service",
      packageManager: "bun@1.3.14",
      dependencies: { next: "latest" },
    }, null, 2));
    await writeFile(join(targetDir, "tsconfig.json"), "{\n  \"compilerOptions\": {}\n}\n");
    await writeFile(join(targetDir, ".farrier.json"), JSON.stringify({
      packIds: ["ts-base"],
      agents: ["claude"],
      hookIds: ["secret-shield"],
    }, null, 2));

    const report = await auditHarness({ targetDir, mode: "quick" });

    expect(report.metrics.modelCalls).toBe(0);
    expect(report.recommendations).toHaveLength(1);
    const finding = report.recommendations[0]!;
    expect(finding.layer).toBe("hook");
    expect(finding.title).toBe("Manifest-selected safety hooks are not installed");
    expect(finding.counterchecks.some((item) =>
      item.result.includes("manifest pack ts-base is an explicit or compatible selection for detected stack ts-nextjs"))).toBeTrue();
    expect(finding.proposal.change).toContain("farrier update --dir .");
    expect(finding.proposal.change).toContain("farrier doctor --dir .");
    expect(finding.proposal.change).not.toContain("intentionally retired");
  });
});
