import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adviceCreationSupport,
  applyAdviceCreationPlan,
  inspectAdviceCreationPlan,
  planAdviceRecommendation,
  planAdviceSkillRecommendation
} from "../src/engine/advice-apply";
import type { AdviceRecommendation, AdviceReport } from "../src/engine/advice-types";
import type { BackendCommandRunner } from "../src/engine/backend";

function hookRecommendation(routeId = "hooks:claude-settings"): AdviceRecommendation {
  return {
    id: "hooks:verify-before-done",
    category: "hooks",
    targetVendors: ["claude"],
    reason: "Run the existing verification command before work is treated as done.",
    benefit: "Prevents completed work from skipping the project's established checks.",
    evidence: ["project:commands"],
    confidence: "high",
    implementationRoute: { id: routeId, description: "Configure a declarative Claude lifecycle hook." }
  };
}

function report(targetDir: string, recommendation: AdviceRecommendation): AdviceReport {
  return {
    schemaVersion: 1,
    targetDir,
    backend: "claude",
    reportOnly: true,
    sessions: { mode: "none", lookback: "7d", included: false, sources: [], evidence: [] },
    profile: {
      targetDir,
      stacks: ["ts-base"],
      languages: ["TypeScript"],
      tests: [],
      ci: [],
      services: [],
      structure: [],
      configuration: {},
      evidence: [{ id: "project:commands", source: "project", kind: "commands", summary: "check command: bun test", path: "package.json" }]
    },
    recommendations: [recommendation],
    coverage: [{ category: "hooks", status: "recommended", reason: "Repeated verification evidence." }],
    notes: []
  };
}

test("reviewed hook creation plans stay declarative and apply transactionally to existing harnesses", async () => {
  const root = await mkdtemp(join(tmpdir(), "farrier-advice-apply-"));
  await mkdir(join(root, ".claude"));
  await writeFile(join(root, ".farrier.json"), "{}\n");
  await writeFile(join(root, ".claude", "settings.json"), '{"permissions":{"allow":["Read"]}}\n');
  const recommendation = hookRecommendation();
  let sawPrompt = "";
  const runner: BackendCommandRunner = async (input) => {
    sawPrompt = input.stdin ?? "";
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        summary: "Add a reviewed Stop verification hook.",
        files: [{
          path: ".claude/settings.json",
          purpose: "Run the existing test command before completion.",
          content: '{"permissions":{"allow":["Read"]},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"bun test"}]}]}}\n'
        }]
      }),
      stderr: ""
    };
  };

  const inputReport = report(root, recommendation);
  inputReport.profile.evidence[0]!.summary = "token=seeded-secret dev@example.com sk-abcdefghijklmnop";
  Object.assign(inputReport.profile.evidence[0]!, {
    token: "object-secret",
    nested: { password: "long object secret with spaces" },
    credential: "github_pat_123456789012345678901234567890"
  });
  const plan = await planAdviceRecommendation({ report: inputReport, recommendation, backend: "claude", runner });
  const inspection = await inspectAdviceCreationPlan(root, plan);

  expect(sawPrompt).toContain("declarative JSON/TOML configuration only");
  expect(sawPrompt).not.toContain("seeded-secret");
  expect(sawPrompt).not.toContain("dev@example.com");
  expect(sawPrompt).not.toContain("sk-abcdefghijklmnop");
  expect(sawPrompt).not.toContain("object-secret");
  expect(sawPrompt).not.toContain("long object secret with spaces");
  expect(sawPrompt).not.toContain("github_pat_123456789012345678901234567890");
  expect(JSON.stringify(plan)).not.toContain("object-secret");
  expect(plan.evidence).toMatchObject({ result: "inconclusive" });
  expect(inspection.existingHarness).toBe(true);
  expect(inspection.replacementPaths).toEqual([".claude/settings.json"]);
  await expect(applyAdviceCreationPlan(root, plan, false)).rejects.toThrow("without --force");

  const result = await applyAdviceCreationPlan(root, plan, true);
  expect(result.written).toEqual([".claude/settings.json"]);
  expect(result.backupDir).toContain(".farrier-staging/backups/");
  expect(await readFile(join(root, ".claude", "settings.json"), "utf8")).toContain('"command":"bun test"');

  const destructiveRunner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stdout: JSON.stringify({
      summary: "Drop unrelated settings.",
      files: [{ path: ".claude/settings.json", purpose: "unsafe replacement", content: '{"hooks":{}}\n' }]
    }),
    stderr: ""
  });
  await expect(planAdviceRecommendation({ report: report(root, recommendation), recommendation, backend: "claude", runner: destructiveRunner })).rejects.toThrow("changed unrelated top-level key 'permissions'");
});

test("hook creation rejects executable files and unsupported plugin installs", async () => {
  const root = await mkdtemp(join(tmpdir(), "farrier-advice-apply-reject-"));
  const recommendation = hookRecommendation();
  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stdout: JSON.stringify({ summary: "Unsafe plan.", files: [{ path: ".claude/hooks/verify.sh", purpose: "script", content: "#!/bin/sh\nbun test\n" }] }),
    stderr: ""
  });

  await expect(planAdviceRecommendation({ report: report(root, recommendation), recommendation, backend: "claude", runner })).rejects.toThrow("outside the selected route policy");

  const outside = await mkdtemp(join(tmpdir(), "farrier-advice-apply-outside-"));
  await mkdir(join(root, ".claude"));
  await writeFile(join(outside, "settings.json"), '{"private":"outside project"}\n');
  await symlink(join(outside, "settings.json"), join(root, ".claude", "settings.json"));
  let unsafeReadPlannerCalls = 0;
  await expect(planAdviceRecommendation({
    report: report(root, recommendation),
    recommendation,
    backend: "claude",
    runner: async () => {
      unsafeReadPlannerCalls += 1;
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  })).rejects.toThrow("Refusing to read .claude/settings.json for backend planning (symlink)");
  expect(unsafeReadPlannerCalls).toBe(0);

  const plugin: AdviceRecommendation = {
    ...recommendation,
    id: "plugins:hookify",
    category: "plugins",
    registryRef: "anthropics/claude-plugins-official@hookify",
    implementationRoute: { id: "plugins:claude-install", description: "Install Hookify." }
  };
  expect(adviceCreationSupport(plugin).kind).toBe("inspect");
  let plannerCalls = 0;
  const guardedRunner: BackendCommandRunner = async () => {
    plannerCalls += 1;
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  await expect(planAdviceRecommendation({
    report: report(root, plugin),
    recommendation: plugin,
    backend: "claude",
    runner: guardedRunner
  })).rejects.toThrow("Inspect the verified registry plugin");
  await expect(planAdviceSkillRecommendation({
    report: report(root, plugin),
    recommendation: plugin,
    request: { description: "replace it", agents: ["claude"], mode: "author-codex" },
    modelSettings: {},
    runner: guardedRunner
  })).rejects.toThrow("Inspect the verified registry plugin");
  expect(plannerCalls).toBe(0);
});

test("codex hooks.json route has a constrained creator and stays config-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "farrier-advice-apply-codex-"));
  await mkdir(join(root, ".codex"));
  await writeFile(join(root, ".farrier.json"), "{}\n");
  await writeFile(join(root, ".codex", "hooks.json"), '{"hooks":[]}\n');
  const recommendation: AdviceRecommendation = {
    ...hookRecommendation("hooks:codex-hooks-json"),
    targetVendors: ["codex"],
    implementationRoute: {
      id: "hooks:codex-hooks-json",
      description: "Configure a Codex-native hook in .codex/hooks.json with project trust review."
    }
  };
  const support = adviceCreationSupport(recommendation);
  expect(support.kind).toBe("files");
  expect(support.description).toBe(".codex/hooks.json only");

  const runner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stdout: JSON.stringify({
      summary: "Add a reviewed post-change verification hook.",
      files: [{
        path: ".codex/hooks.json",
        purpose: "Run the existing check command after code changes.",
        content: '{"hooks":[{"event":"post-change","command":"bun test"}]}\n'
      }]
    }),
    stderr: ""
  });
  const plan = await planAdviceRecommendation({ report: report(root, recommendation), recommendation, backend: "codex", runner });
  const result = await applyAdviceCreationPlan(root, plan, true);
  expect(result.written).toEqual([".codex/hooks.json"]);
  expect(await readFile(join(root, ".codex", "hooks.json"), "utf8")).toContain('"command":"bun test"');

  // The catalog maps .farrier/hooks/codex_verify.py to this route, but the
  // creator must keep refusing to author scripts.
  const scriptRunner: BackendCommandRunner = async () => ({
    exitCode: 0,
    stdout: JSON.stringify({
      summary: "Unsafe plan.",
      files: [{ path: ".farrier/hooks/codex_verify.py", purpose: "script", content: "print('verify')\n" }]
    }),
    stderr: ""
  });
  await expect(planAdviceRecommendation({ report: report(root, recommendation), recommendation, backend: "codex", runner: scriptRunner })).rejects.toThrow("outside the selected route policy");
});

test("batch skill authoring uses the report backend and leaves only a review plan before confirmation", async () => {
  const root = await mkdtemp(join(tmpdir(), "farrier-advice-skill-plan-"));
  const recommendation: AdviceRecommendation = {
    id: "skills:verification-helper",
    category: "skills",
    targetVendors: ["claude"],
    reason: "Verification steps recur.",
    benefit: "The verified workflow becomes reusable.",
    evidence: ["project:commands"],
    confidence: "high",
    implementationRoute: { id: "skills:agents-shared", description: "Create one shared project skill." }
  };
  const skillReport = report(root, recommendation);
  skillReport.backend = "codex";
  let command: string[] = [];
  let receivedSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const runner: BackendCommandRunner = async (input) => {
    command = input.cmd;
    receivedSignal = input.signal;
    const prompt = input.stdin ?? input.cmd.at(-1) ?? "";
    const stagingRoot = prompt.match(/under (\S+)\/ only/)?.[1];
    if (!stagingRoot) throw new Error("missing staging root in skill prompt");
    const skillDir = join(input.cwd, stagingRoot, "verification-helper");
    await mkdir(join(skillDir, "references"), { recursive: true });
    await mkdir(join(skillDir, "evals"), { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: verification-helper\ndescription: Reuse the project verification workflow.\n---\n\nRun the project checks.\n");
    await writeFile(join(skillDir, "references", "checks.md"), "# Checks\n\nRun `bun test`.\n");
    await writeFile(join(skillDir, "evals", "cases.json"), JSON.stringify({ version: 1, cases: [
      { id: "run-verification", kind: "positive", prompt: "Run verification", expectedBehavior: "Run project checks" },
      { id: "unrelated", kind: "negative", prompt: "Write a poem", expectedBehavior: "Do not use this skill" }
    ] }));
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const plan = await planAdviceSkillRecommendation({
    report: skillReport,
    recommendation,
    request: {
      description: recommendation.reason,
      agents: recommendation.targetVendors,
      mode: "author-codex",
      nameOverride: "verification-helper"
    },
    modelSettings: { model: "codex-skill", reasoningEffort: "high" },
    runner,
    signal: controller.signal,
    creatorReady: true
  });

  expect(command).toContain("codex-skill");
  expect(command).toContain("model_reasoning_effort=high");
  expect(receivedSignal).toBeDefined();
  expect(receivedSignal?.aborted).toBe(false);
  expect(plan.files.map((file) => file.path)).toEqual([
    ".agents/skills/verification-helper/SKILL.md",
    ".agents/skills/verification-helper/evals/cases.json",
    ".agents/skills/verification-helper/references/checks.md"
  ]);
  expect(existsSync(join(root, ".agents"))).toBe(false);
  expect(existsSync(join(root, ".farrier-staging"))).toBe(false);

  const inspection = await inspectAdviceCreationPlan(root, plan);
  expect(inspection.files.map((file) => file.action)).toEqual(["create", "create", "create"]);
  await applyAdviceCreationPlan(root, plan, false);
  expect(await readFile(join(root, ".agents", "skills", "verification-helper", "SKILL.md"), "utf8")).toContain("Reuse the project verification workflow");

  await expect(planAdviceSkillRecommendation({
    report: skillReport,
    recommendation,
    request: { description: recommendation.reason, agents: ["codex"], mode: "author-claude" },
    modelSettings: {},
    runner,
    creatorReady: true
  })).rejects.toThrow("must come from the codex report backend");
});

test("cancelled batch skill authoring removes disposable staging and writes no destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "farrier-advice-skill-cancel-"));
  const recommendation: AdviceRecommendation = {
    id: "skills:cancelled-helper",
    category: "skills",
    targetVendors: ["codex"],
    reason: "A workflow could be packaged.",
    benefit: "The workflow becomes reusable.",
    evidence: ["project:commands"],
    confidence: "high",
    implementationRoute: { id: "skills:agents-shared", description: "Create one shared project skill." }
  };
  const skillReport = report(root, recommendation);
  skillReport.backend = "codex";
  const controller = new AbortController();
  let started!: () => void;
  const backendStarted = new Promise<void>((resolve) => { started = resolve; });
  const runner: BackendCommandRunner = async (input) => new Promise((_resolve, reject) => {
    expect(input.signal).toBeDefined();
    started();
    input.signal?.addEventListener("abort", () => reject(new Error("backend cancelled")), { once: true });
  });
  const planning = planAdviceSkillRecommendation({
    report: skillReport,
    recommendation,
    request: { description: recommendation.reason, agents: ["codex"], mode: "author-codex", nameOverride: "cancelled-helper" },
    modelSettings: { reasoningEffort: "high" },
    runner,
    signal: controller.signal,
    creatorReady: true
  });
  await backendStarted;
  controller.abort();

  await expect(planning).rejects.toThrow(/aborted|cancelled/i);
  expect(existsSync(join(root, ".farrier-staging"))).toBe(false);
  expect(existsSync(join(root, ".agents"))).toBe(false);
});
