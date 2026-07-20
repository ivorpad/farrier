import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
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
  const payload = (provider: "claude" | "codex") => `JSON.stringify({ recommendations: [{
  id: "guidance:cli-parity",
  category: "guidance",
  targetVendors: ["${provider}"],
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
    const common = ["advise", "--dir", root, "--sessions", "none", "--only", "guidance", "--backend", backend];
    const human = await runCli(common, env);
    const json = await runCli([...common, "--json"], env);

    expect(human.exitCode).toBe(0);
    expect(json.exitCode).toBe(0);
    for (const stderr of [human.stderr, json.stderr]) {
      expect(stderr).toContain("Profiling dependencies, workflows, services, and installed automation");
      expect(stderr).toContain("Running one focused");
      expect(stderr).toContain("recommendation call");
      expect(stderr).toContain("Report ready with 1 supported recommendation");
    }
    const report = JSON.parse(json.stdout);
    expect(report.reportOnly).toBe(true);
    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0].benefit).toBe("Gives every supported agent the same completion standard without repeated prompting.");
    expect(report.coverage).toEqual([{ category: "guidance", status: "accepted", reason: "One shared-guidance improvement is strongly supported." }]);
    expect(human.stdout).toContain(report.recommendations[0].id);
    expect(human.stdout).toContain(report.recommendations[0].reason);
    expect(human.stdout).toContain(report.recommendations[0].benefit);
    expect(human.stdout).toContain(report.recommendations[0].implementationRoute.description);
  }

  const home = join(root, "home");
  const canonicalRoot = await realpath(root);
  const transcriptDir = join(home, ".claude", "projects", canonicalRoot.replaceAll("\\", "/").replaceAll("/", "-"));
  await mkdir(transcriptDir, { recursive: true });
  await writeFile(join(transcriptDir, "recent.jsonl"), `${JSON.stringify({
    cwd: root,
    type: "user",
    message: { content: "Keep the verification command in project guidance" },
  })}\n`);
  const auto = await runCli([
    "advise", "--dir", root, "--sessions", "auto", "--only", "guidance", "--backend", "claude", "--json",
  ], { ...env, HOME: home });
  expect(auto.exitCode).toBe(0);
  expect(auto.stderr).toContain("consented 1 fingerprinted claude session(s)");
  const autoReport = JSON.parse(auto.stdout);
  expect(autoReport.sessions.included).toBe(true);
  expect(autoReport.sessions.sources).toEqual([{ source: "claude", count: 1 }]);
});

test("headless advice prints a partial report and exits nonzero", async () => {
  const root = await mkdtemp(join(tmpdir(), "farrier-advice-cli-partial-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  await Bun.write(join(root, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
  const claude = join(bin, "claude");
  await writeFile(claude, `#!/usr/bin/env bun
const prompt = await Bun.stdin.text();
if (prompt.includes("advice coordinator")) {
  console.log(JSON.stringify({ selectedIds: ["skills:cli-review"], omissions: [] }));
  process.exit(0);
}
const category = prompt.match(/Use only requested categories \\(([^,)]+)\\)/)?.[1];
if (category === "hooks") {
  console.error("hook worker failed");
  process.exit(4);
}
console.log(JSON.stringify({
  recommendations: category === "skills" ? [{
    id: "skills:cli-review",
    category: "skills",
    evidence: ["project:root"],
    routeId: "skills:claude-local",
    reason: "Keep repository review as a reusable procedure."
  }] : [],
  coverage: [{ category, reason: "Worker complete." }]
}));
`, "utf8");
  await chmod(claude, 0o755);
  const result = await runCli(
    ["advise", "--dir", root, "--sessions", "none", "--backend", "claude", "--json"],
    { PATH: `${bin}${delimiter}${Bun.env.PATH ?? ""}` },
  );

  expect(result.exitCode).toBe(1);
  const report = JSON.parse(result.stdout);
  expect(report.analysis.status).toBe("partial");
  expect(report.analysis.categories.find((item: { category: string }) => item.category === "hooks").status).toBe("failed");
  expect(report.recommendations.map((item: { id: string }) => item.id)).toEqual(["skills:cli-review"]);
});
