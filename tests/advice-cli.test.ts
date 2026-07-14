import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const repoRoot = join(import.meta.dir, "..");

async function runCli(args: string[], env: Record<string, string>): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn({
    cmd: [process.execPath, join(repoRoot, "src", "cli.ts"), ...args],
    cwd: repoRoot,
    env: { ...Bun.env, ...env },
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  return { exitCode, stdout, stderr };
}

test("headless advice accepts realistic Claude and Codex final JSON in human and JSON modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "farrier-advice-cli-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  await Bun.write(join(root, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
  await Bun.write(join(root, "AGENTS.md"), "Run the test suite before stopping.\n");
  const payload = (author: "claude" | "codex") => `JSON.stringify({ recommendations: [{
  id: "guidance:cli-parity",
  category: "guidance",
  targetVendors: ["${author}"],
  reason: "Keep the discovered verification command in shared guidance.",
  benefit: "Gives every supported agent the same completion standard without repeated prompting.",
  evidence: ["project:root"],
  confidence: "high",
  routeId: "guidance:agents-md"
}], coverage: [{ category: "guidance", reason: "One shared-guidance improvement is strongly supported." }] })`;
  const claude = join(bin, "claude");
  await writeFile(claude, `#!/usr/bin/env bun
await Bun.stdin.text();
console.log(${payload("claude")});
`, "utf8");
  await chmod(claude, 0o755);
  const codex = join(bin, "codex");
  await writeFile(codex, `#!/usr/bin/env bun
console.log("I inspected the bounded project evidence.\\n\\n\`\`\`json");
console.log(${payload("codex")});
console.log("\`\`\`");
`, "utf8");
  await chmod(codex, 0o755);
  const env = { PATH: `${bin}${delimiter}${Bun.env.PATH ?? ""}` };

  for (const backend of ["claude", "codex"] as const) {
    const common = ["advise", "--dir", root, "--sessions", "none", "--only", "guidance", "--author", backend];
    const human = await runCli(common, env);
    const json = await runCli([...common, "--json"], env);

    expect(human.exitCode).toBe(0);
    expect(json.exitCode).toBe(0);
    for (const stderr of [human.stderr, json.stderr]) {
      expect(stderr).toContain("Profiling project structure");
      expect(stderr).toContain(`Asking ${backend} for bounded recommendations`);
      expect(stderr).toContain("Report ready with 1 validated recommendation");
    }
    const report = JSON.parse(json.stdout);
    expect(report.reportOnly).toBe(true);
    expect(report.author).toBe(backend);
    expect(report.backend).toBe(backend);
    expect(report.targets).toEqual([backend]);
    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0].benefit).toBe("Gives every supported agent the same completion standard without repeated prompting.");
    expect(report.coverage).toEqual([{ category: "guidance", status: "accepted", reason: "One shared-guidance improvement is strongly supported." }]);
    expect(human.stdout).toContain(report.recommendations[0].id);
    expect(human.stdout).toContain(report.recommendations[0].reason);
    expect(human.stdout).toContain(report.recommendations[0].benefit);
    expect(human.stdout).toContain(report.recommendations[0].implementationRoute.description);
  }
});
