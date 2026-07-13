import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function repoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

describe("advice package inventory", () => {
  test("keeps the attributed Anthropic snapshot byte-exact", async () => {
    const snapshotRoot = join(repoRoot(), "src", "templates", "skills", "claude-automation-recommender", "upstream");
    const expected = {
      "SKILL.md": "441c57e26f0931b64dd085deaad9213c4e3efea27d916dd7443cd33c7e338227",
      "references/hooks-patterns.md": "7b6e91b53aa0f1ed471fd66e177de17a88c1d6620ce95f5c8e8cdfebd20d939e",
      "references/mcp-servers.md": "0f62bf84869d7e982e5dc15ebc789bb4734175b7d7b824051548c615ba79aa97",
      "references/plugins-reference.md": "6570ff4c853253b3f15fb62e5d540cbf0ce3371936437791dde8fb53b7d444f3",
      "references/skills-reference.md": "b4b57d953526a07146d5757ca5332034b9b4b4eeba839e4bb08111398c94556f",
      "references/subagent-templates.md": "7f9a107d8619ff96fea07d5a17da31b269cec0ee343e5a9ff643c0d6cb4ba944",
      "LICENSE.txt": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
    };

    for (const [path, hash] of Object.entries(expected)) {
      const contents = await readFile(join(snapshotRoot, path));
      expect(createHash("sha256").update(contents).digest("hex")).toBe(hash);
    }
  });

  test("includes both wrappers, provenance, license, and every upstream reference in the npm package", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "pm", "pack", "--dry-run"],
      cwd: repoRoot(),
      stdout: "pipe",
      stderr: "pipe"
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text()
    ]);
    const output = `${stdout}\n${stderr}`;

    expect(exitCode).toBe(0);
    for (const path of [
      "src/templates/skills/claude-automation-recommender/SKILL.md",
      "src/templates/skills/claude-automation-recommender/UPSTREAM.md",
      "src/templates/skills/claude-automation-recommender/upstream/LICENSE.txt",
      "src/templates/skills/claude-automation-recommender/upstream/SKILL.md",
      "src/templates/skills/claude-automation-recommender/upstream/references/hooks-patterns.md",
      "src/templates/skills/claude-automation-recommender/upstream/references/mcp-servers.md",
      "src/templates/skills/claude-automation-recommender/upstream/references/plugins-reference.md",
      "src/templates/skills/claude-automation-recommender/upstream/references/skills-reference.md",
      "src/templates/skills/claude-automation-recommender/upstream/references/subagent-templates.md",
      "src/templates/skills/farrier-project-advisor/SKILL.md"
    ]) {
      expect(output).toContain(path);
    }
    expect(output).not.toContain(join(".agents", "skills", "remotion-best-practices"));
  });
});
