import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditHarness } from "../src/engine/harness-audit";

async function withSkill(body: string[], run: (targetDir: string) => Promise<void>): Promise<void> {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-skill-sensitive-dump-"));
  try {
    const skillDir = join(targetDir, ".agents", "skills", "request-debug");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), [
      "---",
      "name: request-debug",
      "description: Diagnose failures in a local request proxy.",
      "---",
      "# Request debugging",
      ...body,
    ].join("\n"));
    await run(targetDir);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

describe("skill request-dump safety", () => {
  test("reports an instruction that writes request bodies to a shared temporary path", async () => {
    await withSkill([
      "To inspect failures, add this code to dump every request body:",
      "```js",
      "fs.writeFileSync(`/tmp/proxy_${reqNum}.json`, bodyStr);",
      "```",
      "Revert the debug code before committing.",
    ], async (targetDir) => {
      const report = await auditHarness({ targetDir, mode: "quick", maxModelCalls: 0 });

      expect(report.metrics.modelCalls).toBe(0);
      expect(report.recommendations).toHaveLength(1);
      expect(report.recommendations[0]).toMatchObject({
        layer: "skill",
        severity: "blocking",
        proposal: { artifact: ".agents/skills/request-debug/SKILL.md" },
        source: "deterministic",
      });
      expect(report.recommendations[0]!.citations).toEqual([
        expect.objectContaining({ path: ".agents/skills/request-debug/SKILL.md", line: 8 }),
      ]);
      expect(report.recommendations[0]!.counterchecks).toEqual(expect.arrayContaining([
        expect.objectContaining({ result: "writes request body data to predictable shared path /tmp/proxy_${reqNum}.json" }),
        expect.objectContaining({ result: "no required redaction found" }),
        expect.objectContaining({ result: "no restrictive file mode found" }),
      ]));
      expect(report.recommendations[0]!.proposal.change).toContain("redacted metadata");
      expect(report.recommendations[0]!.proposal.change).toContain("0o600");
      expect(report.recommendations[0]!.risk).toContain("prompts, messages, or tool inputs");
      expect(report.recommendations[0]!.uncertainty).toContain("contents were not inspected");
    });
  });

  test("stays silent for prohibitions, non-sensitive metadata, and redacted private dumps", async () => {
    for (const body of [
      ["Never dump request bodies to `/tmp`; record only status and size."],
      [
        "The old implementation used this unsafe snippet; do not restore it:",
        "```js",
        "fs.writeFileSync(`/tmp/proxy_${reqNum}.json`, bodyStr);",
        "```",
      ],
      [
        "Record non-sensitive request metrics for comparison:",
        "```js",
        "fs.writeFileSync(`/tmp/proxy_status_${reqNum}.json`, JSON.stringify(requestMetrics));",
        "```",
      ],
      [
        "If a full diagnostic is essential, redact it and restrict the file to the current user:",
        "```js",
        "fs.writeFileSync(`/tmp/proxy_${reqNum}.json`, redactRequestBody(bodyStr), { mode: 0o600 });",
        "```",
      ],
    ]) {
      await withSkill(body, async (targetDir) => {
        const report = await auditHarness({ targetDir, mode: "quick", maxModelCalls: 0 });
        expect(report.recommendations).toEqual([]);
      });
    }
  });
});
