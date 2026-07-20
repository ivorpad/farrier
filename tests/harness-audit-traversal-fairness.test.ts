import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkHarnessAuditCandidates } from "../src/engine/harness-audit-candidate-walk";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";
import { openContainedRepository } from "../src/engine/repository-paths";

test("ordinary source files cannot starve later live guidance", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-traversal-fairness-"));
  await mkdir(join(targetDir, "alpha/deep/one"), { recursive: true });
  await mkdir(join(targetDir, "dist"), { recursive: true });
  await mkdir(join(targetDir, "zeta/docs"), { recursive: true });
  for (let index = 0; index < 20; index += 1) {
    await writeFile(join(targetDir, "alpha/deep", `source-${index}.ts`), "export {};\n");
  }
  await writeFile(join(targetDir, "dist/AGENTS.md"), "Generated guidance.\n");
  await writeFile(join(targetDir, "zeta/AGENTS.md"), "Read `docs/required.md` before changing Zeta.\n");
  await writeFile(join(targetDir, "zeta/docs/required.md"), "# Required\n");

  const repository = await openContainedRepository(targetDir);
  const bounded = await walkHarnessAuditCandidates(repository, {
    maxEntries: 5,
    ignoredDirectoryNames: new Set(["dist"]),
    excludedDirectoryPaths: new Set(),
    isCandidatePath: (path) => /(?:^|\/)AGENTS\.md$/.test(path),
  });
  const corpus = await collectHarnessAuditCorpus(targetDir);
  const report = await auditHarness({ targetDir, mode: "quick" });

  expect(bounded.paths).toEqual(["zeta/AGENTS.md"]);
  expect(bounded.skipped).toEqual([{ path: "alpha/deep/one", reason: "entry-limit" }]);
  expect(corpus.documents.map((document) => document.path)).toContain("zeta/AGENTS.md");
  expect(corpus.documents.some((document) => document.path.startsWith("dist/"))).toBeFalse();
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path zeta/docs/required.md.",
    result: "regular file exists",
  }));
  expect(report.recommendations).toEqual([]);
  expect(report.metrics.modelCalls).toBe(0);
});
