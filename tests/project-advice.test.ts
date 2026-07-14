import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatAdviceReport, parseAdviseArgs } from "../src/cli/advise";
import { adviseProject } from "../src/engine/project-advice";
import type { AdviceCategory } from "../src/engine/advice-types";
import { defaultBackendRunner, type BackendCommandRunner, type BackendCommandRunnerInput } from "../src/engine/backend";

async function projectFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "farrier-project-advice-"));
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await mkdir(join(root, "src", "hooks", "__pycache__"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, "AGENTS.md"), "# Commands\n\nRun the checks.\n", "utf8");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md\n", "utf8");
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "bun test", check: "tsc --noEmit" }, devDependencies: { typescript: "latest" } }), "utf8");
  await writeFile(join(root, "tests", "unit.test.ts"), "export {};\n", "utf8");
  await writeFile(join(root, ".github", "workflows", "ci.yml"), "name: ci\n", "utf8");
  await writeFile(join(root, "src", "hooks", "__pycache__", "ignored.pyc"), "generated", "utf8");
  return root;
}

function queuedRunner(output: unknown): { runner: BackendCommandRunner; calls: BackendCommandRunnerInput[] } {
  const calls: BackendCommandRunnerInput[] = [];
  return {
    calls,
    runner: async (input) => {
      calls.push(input);
      return { exitCode: 0, stdout: JSON.stringify(output), stderr: "" };
    }
  };
}

function sequentialRunner(outputs: unknown[]): { runner: BackendCommandRunner; calls: BackendCommandRunnerInput[] } {
  const calls: BackendCommandRunnerInput[] = [];
  return {
    calls,
    runner: async (input) => {
      calls.push(input);
      return { exitCode: 0, stdout: JSON.stringify(outputs[calls.length - 1] ?? outputs.at(-1)), stderr: "" };
    }
  };
}

describe("project advice", () => {
  test("profiles code, validates evidence/catalog references, deduplicates, and caps categories", async () => {
    const root = await projectFixture();
    const hook = (id: string, reason: string) => ({
      id: `hooks:${id}`,
      category: "hooks",
      targetVendors: ["claude"],
      reason,
      benefit: "Makes verification consistent while removing a repeated manual step.",
      evidence: ["project:package-scripts"],
      confidence: "high",
      routeId: "hooks:shared-policy"
    });
    const { runner, calls } = queuedRunner({ recommendations: [
      hook("verify", "Run the established checks after changes."),
      hook("protect", "Protect the established project workflow."),
      hook("extra", "A third lower-value hook."),
      hook("verify", "Duplicate id."),
      hook("executable", "```bash\necho unsafe\n```"),
      {
        id: "mcp:unknown",
        category: "mcp",
        targetVendors: ["codex"],
        reason: "Use an invented integration.",
        evidence: ["project:root"],
        confidence: "low",
        routeId: "mcp:codex-project",
        registryRef: "mcp@invented"
      }
    ], coverage: [{ category: "guidance", reason: "The existing shared guidance already covers the observed workflow." }] });

    const progress: string[] = [];
    const controller = new AbortController();
    const report = await adviseProject({
      targetDir: root,
      backend: "claude",
      sessions: "none",
      runner,
      signal: controller.signal,
      search: async () => [],
      onProgress: (event) => progress.push(event.stage)
    });

    expect(report.reportOnly).toBe(true);
    expect(report.sessions.lookback).toBe("7d");
    expect(JSON.stringify(report.profile)).not.toContain("__pycache__");
    expect(report.profile.evidence.find((item) => item.path === "AGENTS.md")?.summary).toContain("headings: Commands");
    expect(report.profile.evidence.find((item) => item.path === "CLAUDE.md")?.summary).toContain("delegates to: AGENTS.md");
    expect(report.recommendations.map((item) => item.id)).toEqual(["hooks:verify", "hooks:protect"]);
    expect(report.coverage).toHaveLength(6);
    expect(report.coverage.find((item) => item.category === "hooks")?.status).toBe("accepted");
    expect(report.coverage.find((item) => item.category === "guidance")?.status).toBe("no-evidence");
    expect(report.coverage.find((item) => item.category === "guidance")?.reason).toContain("already covers");
    expect(report.notes.some((note) => note.includes("beyond the 2 hooks limit"))).toBe(true);
    expect(report.notes.some((note) => note.includes("executable hook content"))).toBe(true);
    expect(report.notes.some((note) => note.includes("mcp:unknown") && note.includes("invalid target vendors"))).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal).toBe(controller.signal);
    expect(calls[0]?.cmd).toContain("--no-session-persistence");
    expect(calls[0]?.stdin).toContain("Never output executable hook code");
    expect(calls[0]?.stdin).toContain("benefit must explain why implementing it is useful");
    expect(calls[0]?.stdin).toContain("A path-only summary proves existence only");
    expect(calls[0]?.stdin).toContain("Aim for 3–8 distinct recommendations overall");
    expect(calls[0]?.stdin).not.toContain('"source":"claude"');
    expect(calls[0]?.stdin).not.toContain('"source":"codex"');
    const human = formatAdviceReport(report);
    for (const recommendation of report.recommendations) {
      expect(human).toContain(recommendation.id);
      expect(human).toContain(recommendation.reason);
      expect(human).toContain(recommendation.benefit);
    }
    expect(human).toContain("report only");
    expect(progress).toEqual(["profile", "sessions", "sessions", "catalog", "backend", "validation", "complete"]);
  });

  test("propagates recommendation backend failure", async () => {
    const root = await projectFixture();
    const runner: BackendCommandRunner = async () => ({ exitCode: 2, stdout: "", stderr: "backend unavailable" });
    expect(adviseProject({ targetDir: root, backend: "claude", sessions: "none", runner, search: async () => [] })).rejects.toThrow(
      "claude backend exited with code 2: backend unavailable"
    );
  });

  test("aborting project advice terminates its running backend process", async () => {
    const root = await projectFixture();
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const runner: BackendCommandRunner = (input) => {
      markStarted?.();
      return defaultBackendRunner({ ...input, cmd: ["sleep", "30"] });
    };
    const beganAt = Date.now();
    const run = adviseProject({
      targetDir: root,
      backend: "claude",
      sessions: "none",
      only: ["guidance"],
      runner,
      signal: controller.signal,
      search: async () => []
    });

    await started;
    controller.abort();

    await expect(run).rejects.toThrow(/claude backend exited with code/);
    expect(Date.now() - beganAt).toBeLessThan(5_000);
  });

  test("falls back to codebase evidence when auto session discovery finds nothing", async () => {
    const root = await projectFixture();
    const { runner } = queuedRunner({ recommendations: [] });
    const report = await adviseProject({
      targetDir: root,
      backend: "claude",
      sessions: "auto",
      sessionEvidence: { sources: [{ source: "claude", count: 0 }, { source: "codex", count: 0 }], signals: [], notes: [] },
      runner,
      search: async () => []
    });

    expect(report.sessions.included).toBe(false);
    expect(report.notes).toContain("No matching project sessions were found; recommendations use codebase evidence only.");
  });

  test("allows up to five recommendations for a focused non-legacy category", async () => {
    const root = await projectFixture();
    const recommendations = Array.from({ length: 6 }, (_, index) => ({
      id: `guidance:route-${index}`,
      category: "guidance",
      targetVendors: ["claude"],
      reason: `Project guidance improvement ${index}.`,
      evidence: ["project:root"],
      confidence: "medium",
      routeId: "guidance:agents-md"
    }));
    const { runner } = queuedRunner({ recommendations });
    const report = await adviseProject({ targetDir: root, backend: "claude", sessions: "none", only: ["guidance"], runner, search: async () => [] });

    expect(report.recommendations).toHaveLength(5);
    expect(report.recommendations[0]?.benefit).toContain("persistent and visible");
    expect(report.notes.some((note) => note.includes("beyond the 5 guidance limit"))).toBe(true);
  });

  test("recovers only omitted evidence-supported categories in an evidence-rich 34-session run", async () => {
    const root = await projectFixture();
    const patterns = [
      { id: "p:verify", kind: "verification", allowedCategories: ["hooks", "guidance", "skills"] },
      { id: "p:correct", kind: "correction", allowedCategories: ["guidance", "skills"] },
      { id: "p:delegate", kind: "delegation", allowedCategories: ["subagents", "skills"] },
      { id: "p:lookup", kind: "external-lookup", allowedCategories: ["mcp", "plugins", "skills"] },
      { id: "p:release", kind: "manual-workflow", allowedCategories: ["skills", "subagents", "hooks"] },
      { id: "p:config", kind: "guidance-edit", allowedCategories: ["guidance", "skills"] }
    ].map((item, index) => ({
      ...item, source: "claude" as const,
      allowedCategories: item.allowedCategories as AdviceCategory[],
      summary: `Recurring actionable pattern ${index}`, occurrences: 6, distinctSessions: 5,
      targetVendors: ["claude" as const]
    }));
    const recommendation = (category: string, evidence: string, routeId: string) => ({
      id: `${category}:fixture`, category, targetVendors: ["claude"],
      reason: `Recurring ${category} evidence supports a bounded improvement.`,
      benefit: `Makes the repeated ${category} workflow more reliable.`, evidence: [evidence], confidence: "high", routeId
    });
    const { runner, calls } = sequentialRunner([
      { recommendations: [recommendation("guidance", "p:correct", "guidance:agents-md")], coverage: [] },
      { recommendations: [
        recommendation("hooks", "p:verify", "hooks:shared-policy"),
        recommendation("skills", "p:release", "skills:agents-shared"),
        recommendation("subagents", "p:delegate", "subagents:cross-vendor"),
        recommendation("mcp", "p:lookup", "mcp:shared-project")
      ], coverage: [] }
    ]);

    const report = await adviseProject({
      targetDir: root, backend: "claude", runner, search: async () => [],
      sessionEvidence: {
        sources: [{ source: "claude", count: 20 }, { source: "codex", count: 14 }], signals: patterns, notes: [],
        funnel: { sources: [], visibleEvents: 187, recurringPatterns: 6 }
      }
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.stdin).toContain("hooks, skills, subagents, plugins, mcp");
    expect(report.recommendations).toHaveLength(5);
    expect(new Set(report.recommendations.map((item) => item.category)).size).toBe(5);
    expect(report.sessions.funnel?.recommendation?.recoveryCalls).toBe(1);
    expect(formatAdviceReport(report)).toContain("20 sessions → 187 visible events → 6 recurring patterns → 5 supported recommendations");
  });

  test("stays sparse without recurring actionable evidence and does not call recovery", async () => {
    const root = await projectFixture();
    const { runner, calls } = sequentialRunner([{ recommendations: [], coverage: [] }]);
    const report = await adviseProject({
      targetDir: root, backend: "claude", runner, search: async () => [],
      sessionEvidence: {
        sources: [{ source: "claude", count: 20 }, { source: "codex", count: 14 }], signals: [], notes: [],
        funnel: { sources: [], visibleEvents: 34, recurringPatterns: 0 }
      }
    });

    expect(calls).toHaveLength(1);
    expect(report.recommendations).toEqual([]);
    expect(report.weakLeads).toEqual([]);
    expect(report.coverage.every((item) => item.status === "no-evidence")).toBe(true);
    expect(formatAdviceReport(report)).toContain("No visible recurring actionable evidence");
  });

  test("moves low-confidence candidates into weak leads with strengthening guidance", async () => {
    const root = await projectFixture();
    const { runner } = queuedRunner({ recommendations: [{
      id: "skills:possible-review", category: "skills", targetVendors: ["claude"],
      reason: "One session requested a review workflow.", benefit: "Could make reviews repeatable.",
      evidence: ["project:root"], confidence: "low", routeId: "skills:agents-shared"
    }], coverage: [] });
    const report = await adviseProject({ targetDir: root, backend: "claude", sessions: "none", runner, search: async () => [] });
    expect(report.recommendations).toEqual([]);
    expect(report.weakLeads?.map((item) => item.id)).toEqual(["skills:possible-review"]);
    const human = formatAdviceReport(report);
    expect(human).toContain("Weak leads");
    expect(human).toContain("Would strengthen: recurrence in another distinct session");
  });

  test("parses complete headless controls and preserves both legacy skill-only spellings", () => {
    const parsed = parseAdviseArgs(["--dir", ".", "--sessions", "none", "--since", "14d", "--targets", "codex", "--only", "guidance,hooks", "--backend", "codex", "--model", "gpt-x", "--json"]);
    expect(parsed.sessions).toBe("none");
    expect(parsed.since).toBe("14d");
    expect(parsed.targets).toEqual(["codex"]);
    expect(parsed.only).toEqual(["guidance", "hooks"]);
    expect(parsed.backend).toBe("codex");
    expect(parsed.model).toBe("gpt-x");
    expect(parsed.json).toBe(true);
    expect(parseAdviseArgs(["skills"]).legacySkills).toBe(true);
    expect(parseAdviseArgs(["--only", "skills"]).legacySkills).toBe(true);
    expect(() => parseAdviseArgs(["--since", "30d"])).toThrow("--since must be 7d, 14d, or all");
  });
});
