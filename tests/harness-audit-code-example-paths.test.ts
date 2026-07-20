import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendCommandRunner } from "../src/engine/backend";
import { auditHarness } from "../src/engine/harness-audit";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

test("a fenced code filename label is not a required repository path", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-code-filename-"));
  const skillDir = join(targetDir, ".agents/skills/next-patterns");
  await mkdir(join(skillDir, "scripts"), { recursive: true });
  await writeFile(join(skillDir, "scripts/check.ts"), "export const check = true;\n");
  await writeFile(join(skillDir, "SKILL.md"), [
    "---", "name: next-patterns", "description: Show an App Router example.", "---", "",
    "```typescript", "// app/products/page.tsx", 'await import("./scripts/check.ts")', "```", "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const evidence = corpus.lines.find((line) => line.text === "// app/products/page.tsx")!;
  const check = corpus.checks.find((item) => item.description.includes("app/products/page.tsx"));
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [{
      id: "skill:missing-example-page",
      layer: "skill",
      severity: "high",
      title: "Required example page is missing",
      defect: "The skill requires .agents/skills/next-patterns/app/products/page.tsx, but the file is missing.",
      evidence: [evidence.id],
      counterchecks: [check?.id ?? "check:path:code-filename"],
      artifact: ".agents/skills/next-patterns/SKILL.md",
      change: "Remove the stale filename label from the example.",
      risk: "Agents may try to open a file that does not exist.",
      uncertainty: "The example may describe a consumer repository layout.",
    }] }),
  });

  const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

  expect(report.recommendations).toEqual([]);
  expect(check).toBeUndefined();
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path .agents/skills/next-patterns/scripts/check.ts.",
    result: "regular file exists",
  }));
});

test("a fenced structured output path is not a repository requirement", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-sample-output-path-"));
  await mkdir(join(targetDir, "scripts"));
  await writeFile(join(targetDir, "scripts/check.js"), "export {};\n");
  await writeFile(join(targetDir, "CLAUDE.md"), [
    "Run the query and inspect its output:",
    "",
    "```console",
    "node scripts/check.js",
    "# Output: [{\"docid\":\"#abc123\",\"file\":\"docs/readme.md\"}]",
    "```",
    "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);
  const evidence = corpus.lines.find((line) => line.text.includes("docs/readme.md"))!;
  const falseCheck = corpus.checks.find((item) => item.description.includes("docs/readme.md"));
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ recommendations: [{
      id: "guidance:missing-sample-output",
      layer: "guidance",
      severity: "high",
      title: "Required output document is missing",
      defect: "CLAUDE.md requires docs/readme.md, but the contained path check found it missing.",
      evidence: [evidence.id],
      counterchecks: [falseCheck?.id ?? "check:path:sample-output"],
      artifact: "CLAUDE.md",
      change: "Remove the stale docs/readme.md requirement.",
      risk: "Agents may attempt to open a missing document.",
      uncertainty: "The document could be generated outside the inspected workflow.",
    }] }),
  });

  const report = await auditHarness({ targetDir, mode: "baseline", backend: "codex", runner });

  expect(report.recommendations).toEqual([]);
  expect(falseCheck).toBeUndefined();
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path scripts/check.js.",
    result: "regular file exists",
  }));
});

test("fence title metadata and equivalent-path comments stay illustrative", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-fence-metadata-path-"));
  const skillDir = join(targetDir, ".agents/skills/ui-patterns");
  await mkdir(join(skillDir, "scripts"), { recursive: true });
  await writeFile(join(skillDir, "scripts/check.ts"), "export {};\n");
  await writeFile(join(skillDir, "SKILL.md"), [
    "---", "name: ui-patterns", "description: Show UI examples.", "---", "",
    "```tsx title=\"components/ai-elements/message.tsx\" highlight=\"8\"",
    "export const Message = () => null;", "```", "",
    "```ts", "// app/api/cron/route.ts (or equivalent in your framework)",
    "export async function GET() {}", "```", "",
    "Run `scripts/check.ts` before publishing the skill.", "",
  ].join("\n"));

  const corpus = await collectHarnessAuditCorpus(targetDir);

  expect(corpus.checks.some((item) => item.description.includes("components/ai-elements/message.tsx")))
    .toBeFalse();
  expect(corpus.checks.some((item) => item.description.includes("app/api/cron/route.ts")))
    .toBeFalse();
  expect(corpus.checks).toContainEqual(expect.objectContaining({
    description: "Checked referenced path .agents/skills/ui-patterns/scripts/check.ts.",
    result: "regular file exists",
  }));
});
