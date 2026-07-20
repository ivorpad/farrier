import { expect, test } from "bun:test";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adviseProject } from "../src/engine/project-advice";
import type { BackendCommandRunner } from "../src/engine/backend";

async function projectFixture(): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), "farrier-advice-orchestration-")), "project");
  await cp(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "advice", "typescript-drizzle"), root, { recursive: true });
  return root;
}

function promptCategory(prompt: string): string {
  return prompt.match(/Use only requested categories \(([^,)]+)\)/)?.[1] ?? "unknown";
}

test("focused advice calls run in parallel and one failed category preserves the others", async () => {
  const targetDir = await projectFixture();
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const runner: BackendCommandRunner = async (input) => {
    calls += 1;
    const prompt = input.stdin ?? input.cmd.at(-1) ?? "";
    if (prompt.includes("advice coordinator")) {
      return { exitCode: 0, stdout: JSON.stringify({ selectedIds: ["skills:focused-review"], omissions: [] }), stderr: "" };
    }
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Bun.sleep(5);
    active -= 1;
    const category = promptCategory(prompt);
    if (category === "hooks") return { exitCode: 1, stdout: "", stderr: "hook branch failed" };
    const recommendations = category === "skills" ? [{
      id: "skills:focused-review",
      category: "skills",
      evidence: ["project:root"],
      routeId: "skills:claude-local",
      reason: "Turn repository review into a reusable procedure."
    }] : [];
    return {
      exitCode: 0,
      stdout: JSON.stringify({ recommendations, coverage: [{ category, reason: recommendations.length ? "Found one." : "No evidence." }] }),
      stderr: ""
    };
  };

  const report = await adviseProject({
    targetDir,
    backend: "claude",
    sessions: "none",
    only: ["guidance", "hooks", "skills", "subagents", "plugins", "mcp"],
    runner,
    search: async () => []
  });

  expect(calls).toBe(7);
  expect(maxActive).toBe(3);
  expect(report.recommendations.map((item) => item.id)).toEqual(["skills:focused-review"]);
  expect(report.coverage.find((item) => item.category === "hooks")?.status).toBe("backend-omission");
  expect(report.analysis).toMatchObject({ status: "partial", concurrency: 3, workerCalls: 6, coordinatorCalls: 1 });
  expect(report.sessions.funnel?.recommendation).toMatchObject({
    modelCalls: 7,
    successfulModelCalls: 6,
    failedModelCalls: 1,
    returned: 1,
    accepted: 1,
    recoveryCalls: 0
  });
});

test("invalid coordinator output receives one repair call", async () => {
  const targetDir = await projectFixture();
  let coordinatorCalls = 0;
  const runner: BackendCommandRunner = async (input) => {
    const prompt = input.stdin ?? input.cmd.at(-1) ?? "";
    if (prompt.includes("advice coordinator")) {
      coordinatorCalls += 1;
      return coordinatorCalls === 1
        ? { exitCode: 0, stdout: JSON.stringify({ selectedIds: [], omissions: [] }), stderr: "" }
        : { exitCode: 0, stdout: JSON.stringify({ selectedIds: ["skills:focused-review"], omissions: [] }), stderr: "" };
    }
    const category = promptCategory(prompt);
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        recommendations: category === "skills" ? [{
          id: "skills:focused-review",
          category: "skills",
          evidence: ["project:root"],
          routeId: "skills:claude-local",
          reason: "Turn repository review into a reusable procedure.",
        }] : [],
        coverage: [{ category, reason: "Worker complete." }],
      }),
      stderr: "",
    };
  };

  const report = await adviseProject({
    targetDir,
    backend: "claude",
    sessions: "none",
    runner,
    search: async () => [],
  });

  expect(coordinatorCalls).toBe(2);
  expect(report.recommendations.map((item) => item.id)).toEqual(["skills:focused-review"]);
  expect(report.analysis).toMatchObject({ coordinatorCalls: 1, recoveryCalls: 1 });
  expect(report.sessions.funnel?.recommendation?.modelCalls).toBe(8);
});

test("a second invalid coordinator response fails instead of bypassing coordination", async () => {
  const targetDir = await projectFixture();
  const runner: BackendCommandRunner = async (input) => {
    const prompt = input.stdin ?? input.cmd.at(-1) ?? "";
    if (prompt.includes("advice coordinator")) {
      return { exitCode: 0, stdout: JSON.stringify({ selectedIds: [], omissions: [] }), stderr: "" };
    }
    const category = promptCategory(prompt);
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        recommendations: category === "skills" ? [{
          id: "skills:focused-review",
          category: "skills",
          evidence: ["project:root"],
          routeId: "skills:claude-local",
        }] : [],
        coverage: [],
      }),
      stderr: "",
    };
  };

  await expect(adviseProject({
    targetDir,
    backend: "claude",
    sessions: "none",
    runner,
    search: async () => [],
  })).rejects.toThrow("coordinator response is invalid");
});
