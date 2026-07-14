import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatAdviceReport, parseAdviseArgs } from "../src/cli/advise";
import { adviseProject } from "../src/engine/project-advice";
import type { AdviceSessionEpisode, AdviceSessionEvidence, AdviceVendor } from "../src/engine/advice-types";
import { defaultBackendRunner, type BackendCommandRunner, type BackendCommandRunnerInput } from "../src/engine/backend";
import { formatAdviceTuiReportLines } from "../src/tui/advise-app";

async function projectFixture(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "farrier-project-advice-"));
  const root = join(parent, "project");
  await cp(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "advice", "typescript-drizzle"), root, { recursive: true });
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

function capturedPrompt(call: BackendCommandRunnerInput | undefined): string {
  return call?.stdin ?? call?.cmd.at(-1) ?? "";
}

function recommendation(provider: AdviceVendor, input: {
  id: string; category: string; evidence: string; routeId: string; confidence?: string; registryRef?: string;
}) {
  return {
    id: input.id,
    category: input.category,
    targetVendors: [provider],
    reason: `The cited ${input.id} evidence describes a reusable project opportunity.`,
    benefit: `Makes the ${input.category} workflow repeatable for this repository.`,
    evidence: [input.evidence],
    confidence: input.confidence ?? "high",
    routeId: input.routeId,
    ...(input.registryRef ? { registryRef: input.registryRef } : {})
  };
}

function episode(provider: AdviceVendor, request: string): AdviceSessionEpisode {
  return {
    id: `session:${provider}:episode:metaprompt`, provider, sessionId: "one", turnId: "turn-1", request,
    corrections: [], actions: [], outcome: "Created the requested metaprompt.", occurrences: 1,
    distinctSessions: 1, truncated: false, allowedCategories: ["skills"]
  };
}

function sessionEvidence(provider: AdviceVendor, item: AdviceSessionEpisode): AdviceSessionEvidence {
  return {
    sources: [{ source: provider, count: 1 }], episodes: [item],
    signals: [{
      id: item.id, source: provider, kind: "session-episode", summary: item.request, sessionId: item.sessionId,
      occurrences: 1, distinctSessions: 1, allowedCategories: item.allowedCategories, targetVendors: [provider]
    }], notes: [],
    funnel: { sources: [], visibleEvents: 2, recurringPatterns: 0, retainedEpisodes: 1, omittedEpisodes: 0, truncatedEpisodes: 0 }
  };
}

describe("project advice", () => {
  test("profiles a no-session Drizzle project, plans capability searches, and preserves bounded opportunities", async () => {
    const root = await projectFixture();
    const verifiedRef = "acme/database-skills@drizzle-review";
    const { runner, calls } = queuedRunner({ recommendations: [
      recommendation("codex", { id: "skills:verified-drizzle-review", category: "skills", evidence: "project:capability:orm:drizzle", routeId: "skills:agents-shared", registryRef: verifiedRef }),
      recommendation("codex", { id: "skills:migration-procedure", category: "skills", evidence: "project:capability:migrations:database-migrations", routeId: "skills:agents-shared" }),
      recommendation("codex", { id: "skills:schema-review", category: "skills", evidence: "project:capability:database:postgresql", routeId: "skills:agents-shared" }),
      recommendation("codex", { id: "hooks:post-change-check", category: "hooks", evidence: "project:capability:testing:automated-tests", routeId: "hooks:codex-hooks-json" })
    ], coverage: [] });
    const searches: string[] = [];
    const report = await adviseProject({
      targetDir: root, backend: "codex", sessions: "none", runner,
      search: async (query) => {
        searches.push(query);
        return query === "typescript drizzle postgres" ? [{ source: "acme/database-skills", skillId: "drizzle-review", name: "Drizzle review", installs: 12 }] : [];
      }
    });

    expect(report.sessions.included).toBe(false);
    expect(report.policy).toEqual({ provider: "codex", id: "codex-official-manual-2026-07" });
    expect(report.profile.dependencies?.map((item) => item.name)).toEqual(expect.arrayContaining(["typescript", "drizzle-orm", "drizzle-kit", "pg"]));
    expect(report.profile.capabilities?.map((item) => item.name)).toEqual(expect.arrayContaining(["TypeScript", "PostgreSQL", "Drizzle", "Database migrations", "Automated tests", "CI workflows"]));
    expect(report.profile.workflows?.map((item) => item.name)).toEqual(expect.arrayContaining(["db:generate", "db:migrate", "test", "CI"]));
    expect(searches).toEqual(expect.arrayContaining(["typescript drizzle postgres", "drizzle migrations", "postgres schema review"]));
    expect(report.registry?.verifiedMatches).toContain(verifiedRef);
    expect(report.recommendations.map((item) => item.id)).toEqual(["skills:verified-drizzle-review", "skills:migration-procedure", "hooks:post-change-check"]);
    expect(report.omittedRecommendations?.map((item) => item.recommendation.id)).toEqual(["skills:schema-review"]);
    expect(report.recommendations[0]?.evidenceOrigin).toBe("codebase");
    expect(report.recommendations[0]?.creates).toEqual([{ vendor: "shared", path: ".agents/skills/<name>/SKILL.md", kind: "skill" }]);
    expect(calls).toHaveLength(1);
    expect(capturedPrompt(calls[0])).toContain("Never add filler or target a global recommendation count");
    expect(capturedPrompt(calls[0])).not.toContain("Aim for 3–8");
    expect(formatAdviceReport(report)).toContain("Omitted by presentation bounds");
  });

  test("keeps one wrapped metaprompt task as Codex skill evidence without recurrence", async () => {
    const root = await projectFixture();
    const item = episode("codex", "Create a reusable goal-oriented metaprompt for planning difficult work.");
    const { runner, calls } = queuedRunner({ recommendations: [recommendation("codex", {
      id: "skills:goal-metaprompt", category: "skills", evidence: item.id, routeId: "skills:agents-shared"
    })], coverage: [] });
    const report = await adviseProject({ targetDir: root, backend: "codex", only: ["skills"], runner, search: async () => [], sessionEvidence: sessionEvidence("codex", item) });

    expect(report.recommendations.map((entry) => entry.id)).toEqual(["skills:goal-metaprompt"]);
    expect(report.recommendations[0]?.evidenceOrigin).toBe("sessions");
    expect(report.sessions.funnel?.recurringPatterns).toBe(0);
    expect(capturedPrompt(calls[0])).toContain("goal-oriented metaprompt");
    expect(capturedPrompt(calls[0])).toContain("A single useful episode can justify a recommendation");
  });

  test("isolates provider sessions and policy routes before backend invocation", async () => {
    for (const provider of ["claude", "codex"] as const) {
      const opposite = provider === "claude" ? "codex" : "claude";
      const selected = episode(provider, `${provider} release checklist`);
      const other = episode(opposite, `${opposite} private task`);
      const routeId = provider === "claude" ? "guidance:claude-md" : "guidance:agents-md";
      const { runner, calls } = queuedRunner({ recommendations: [recommendation(provider, { id: `guidance:${provider}-release`, category: "guidance", evidence: selected.id, routeId })], coverage: [] });
      const mixed: AdviceSessionEvidence = {
        sources: [{ source: provider, count: 1 }, { source: opposite, count: 9 }], episodes: [selected, other],
        signals: [selected, other].map((entry) => ({ id: entry.id, source: entry.provider, kind: "session-episode", summary: entry.request, targetVendors: [entry.provider] })), notes: []
      };
      const report = await adviseProject({ targetDir: await projectFixture(), backend: provider, runner, search: async () => [], sessionEvidence: mixed });
      const prompt = capturedPrompt(calls[0]);
      expect(report.sessions.sources).toEqual([{ source: provider, count: 1 }]);
      expect(prompt).toContain(selected.request);
      expect(prompt).not.toContain(other.request);
      expect(JSON.stringify(report.recommendations)).not.toContain(`.${opposite}/`);
    }
  });

  test("rejects invented registry refs, opposite-provider routes, and side-effecting hooks", async () => {
    const root = await projectFixture();
    const { runner } = queuedRunner({ recommendations: [
      recommendation("codex", { id: "skills:invented", category: "skills", evidence: "project:root", routeId: "skills:agents-shared", registryRef: "invented/repo@skill" }),
      recommendation("codex", { id: "skills:claude-path", category: "skills", evidence: "project:root", routeId: "skills:claude-local" }),
      { ...recommendation("codex", { id: "hooks:auto-deploy", category: "hooks", evidence: "project:root", routeId: "hooks:codex-hooks-json" }), reason: "Automatically deploy after each edit." }
    ], coverage: [] });
    const report = await adviseProject({ targetDir: root, backend: "codex", sessions: "none", runner, search: async () => [] });
    expect(report.recommendations).toEqual([]);
    expect(report.notes.join(" ")).toContain("registry ref 'invented/repo@skill' is unsupported");
    expect(report.notes.join(" ")).toContain("unsupported implementation route for codex");
    expect(report.notes.join(" ")).toContain("unsafe or executable hook behavior");
  });

  test("focused advice accepts five and reports the sixth as an omission", async () => {
    const root = await projectFixture();
    const recs = Array.from({ length: 6 }, (_, index) => recommendation("claude", {
      id: `guidance:route-${index}`, category: "guidance", evidence: "project:root", routeId: "guidance:agents-md"
    }));
    const { runner } = queuedRunner({ recommendations: recs, coverage: [] });
    const report = await adviseProject({ targetDir: root, backend: "claude", sessions: "none", only: ["guidance"], runner, search: async () => [] });
    expect(report.recommendations).toHaveLength(5);
    expect(report.omittedRecommendations).toHaveLength(1);
    expect(report.omittedRecommendations?.[0]?.reason).toContain("top 5");
  });

  test("does not recover categories or require sessions", async () => {
    const root = await projectFixture();
    const { runner, calls } = queuedRunner({ recommendations: [], coverage: [] });
    const report = await adviseProject({ targetDir: root, backend: "claude", sessions: "none", runner, search: async () => [] });
    expect(calls).toHaveLength(1);
    expect(report.coverage.every((item) => item.status === "no-evidence")).toBe(true);
    expect(report.notes).toContain("Project sessions were disabled; recommendations use codebase evidence only.");
  });

  test("prefers a verified release capability and rejects an automatic deployment hook", async () => {
    const root = await projectFixture();
    const item = episode("codex", "Commit the current changes, push the branch, and monitor the deployment until it finishes.");
    const verifiedRef = "acme/release-skills@ship-and-monitor";
    const { runner, calls } = queuedRunner({ recommendations: [
      recommendation("codex", { id: "skills:verified-release", category: "skills", evidence: item.id, routeId: "skills:agents-shared", registryRef: verifiedRef }),
      { ...recommendation("codex", { id: "hooks:auto-deploy", category: "hooks", evidence: item.id, routeId: "hooks:codex-hooks-json" }), reason: "Commit, push, and deploy automatically after each change." }
    ], coverage: [] });
    const report = await adviseProject({
      targetDir: root,
      backend: "codex",
      runner,
      sessionEvidence: sessionEvidence("codex", item),
      search: async (query) => query === "release deployment github actions"
        ? [{ source: "acme/release-skills", skillId: "ship-and-monitor", name: "Ship and monitor", installs: 20 }]
        : []
    });

    expect(capturedPrompt(calls[0])).toContain(item.request);
    expect(report.recommendations.map((entry) => entry.id)).toEqual(["skills:verified-release"]);
    expect(report.recommendations[0]?.registryRef).toBe(verifiedRef);
    expect(report.notes.join(" ")).toContain("unsafe or executable hook behavior");
  });

  test("removes wrappers and seeded credentials from every report rendering", async () => {
    const root = await projectFixture();
    const canary = "sk-farrier-secret-canary-123456";
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    packageJson.scripts.secretCheck = `TOKEN=${canary} run-check`;
    packageJson.dependencies["private-helper"] = canary;
    await writeFile(join(root, "package.json"), JSON.stringify(packageJson), "utf8");
    const item = episode("codex", `<in-app-browser-context>page ${canary}</in-app-browser-context>\n## My request for Codex:\nCreate a reusable release checklist with token=${canary}.`);
    item.corrections = [`Use authorization ${canary} when testing.`];
    item.actions = [{ type: "command", summary: `TOKEN=${canary} deploy`, status: "completed" }];
    item.outcome = `Finished with password=${canary}.`;
    const { runner, calls } = queuedRunner({ recommendations: [recommendation("codex", {
      id: "skills:release-checklist", category: "skills", evidence: item.id, routeId: "skills:agents-shared"
    })], coverage: [] });
    const report = await adviseProject({ targetDir: root, backend: "codex", runner, search: async () => [], sessionEvidence: sessionEvidence("codex", item) });
    const surfaces = [
      capturedPrompt(calls[0]),
      JSON.stringify(report),
      formatAdviceReport(report),
      formatAdviceTuiReportLines(report).join("\n")
    ].join("\n");

    expect(surfaces).not.toContain(canary);
    expect(surfaces).not.toContain("<in-app-browser-context>");
    expect(surfaces).toContain("[REDACTED");
  });

  test("propagates backend failure and aborts a running backend", async () => {
    const root = await projectFixture();
    const failure: BackendCommandRunner = async () => ({ exitCode: 2, stdout: "", stderr: "backend unavailable" });
    await expect(adviseProject({ targetDir: root, backend: "claude", sessions: "none", runner: failure, search: async () => [] })).rejects.toThrow("backend unavailable");

    const controller = new AbortController();
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const runner: BackendCommandRunner = (input) => { started(); return defaultBackendRunner({ ...input, cmd: ["sleep", "30"] }); };
    const run = adviseProject({ targetDir: root, backend: "claude", sessions: "none", only: ["guidance"], runner, signal: controller.signal, search: async () => [] });
    await began;
    controller.abort();
    await expect(run).rejects.toThrow(/claude backend exited with code/);
  });

  test("parses project-focused skills separately from the legacy subcommand", () => {
    const parsed = parseAdviseArgs(["--sessions", "none", "--since", "14d", "--targets", "codex", "--only", "skills", "--backend", "codex", "--json"]);
    expect(parsed.only).toEqual(["skills"]);
    expect(parsed.legacySkills).toBe(false);
    expect(parseAdviseArgs(["skills"]).legacySkills).toBe(true);
    expect(() => parseAdviseArgs(["--since", "30d"])).toThrow("--since must be 7d, 14d, or all");
    expect(() => parseAdviseArgs(["--targets", "claude,codex"])).toThrow("--targets must be exactly one provider");
  });
});
