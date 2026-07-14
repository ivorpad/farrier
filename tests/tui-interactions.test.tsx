import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";
import { act } from "react";
import { CreateStep } from "../src/tui/CreateStep";
import { HooksStep } from "../src/tui/HooksStep";
import { RefineFreeTextInput } from "../src/tui/RefineScreen";
import { ReviewStep } from "../src/tui/ReviewStep";
import { EvalConfirmScreen, EvalVerdictScreen } from "../src/tui/create-eval";
import { CreateDoneScreen, CreateProgressScreen } from "../src/tui/create-progress";
import { LauncherApp } from "../src/tui/launcher";
import { AdviceApp } from "../src/tui/advise-app";
import { AdviceBatchFlow } from "../src/tui/AdviceBatchFlow";
import { createInitialAdviceBatchState } from "../src/engine/advice-batch";
import type { AdviceReport } from "../src/engine/advice-types";
import type { AgentAvailability } from "../src/engine/backend";

const renderOptions = { width: 120, height: 40 };

function emptyAdviceReport(backend: "claude" | "codex"): AdviceReport {
  return {
    schemaVersion: 1,
    targetDir: "/tmp/example",
    author: backend,
    backend,
    reportOnly: true,
    sessions: { mode: "none", lookback: "7d", included: false, sources: [], evidence: [] },
    profile: {
      targetDir: "/tmp/example",
      stacks: [],
      languages: [],
      tests: [],
      ci: [],
      services: [],
      structure: [],
      configuration: {},
      evidence: []
    },
    recommendations: [],
    coverage: [],
    notes: []
  };
}

function detailedAdviceReport(): AdviceReport {
  const report = emptyAdviceReport("codex");
  const recommendation = {
    id: "hooks:full-details",
    category: "hooks" as const,
    targetVendors: ["codex"] as const,
    reason: `${"Observed repeated verification work. ".repeat(4)}WHY-END`,
    benefit: `${"Automates that verification without losing project context. ".repeat(3)}VALUE-END`,
    evidence: ["project:details"],
    confidence: "high" as const,
    implementationRoute: {
      id: "hooks:shared-policy",
      description: `${"Create reviewed declarative configuration for both supported vendors. ".repeat(3)}CREATES-END`
    }
  };
  report.profile.evidence = [{
    id: "project:details",
    source: "project",
    kind: "commands",
    summary: `${"The project repeatedly runs its complete verification command. ".repeat(3)}EVIDENCE-END`,
    path: "package.json"
  }];
  report.recommendations = [{ ...recommendation, targetVendors: [...recommendation.targetVendors] }];
  return report;
}

function adviceAppProps(
  onRun: Parameters<typeof AdviceApp>[0]["onRun"],
  availability: AgentAvailability = { claude: true, codex: true }
): Parameters<typeof AdviceApp>[0] {
  return {
    sessionCounts: { "7d": [], "14d": [], all: [] },
    availability,
    onBack: () => undefined,
    onCancel: () => undefined,
    onRun,
    onPlan: async () => { throw new Error("not used"); },
    onPlanBatch: async (report) => ({ ...createInitialAdviceBatchState(report), phase: "done" }),
    onApply: async () => ({ written: [], unchanged: [], writtenFiles: [], unchangedFiles: [], backupDir: null }),
    onCreateSkill: () => undefined,
    onDone: () => undefined
  };
}

async function interact(view: TestRendererSetup, action: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await action();
    await view.flush();
  });
}

describe("TUI keyboard interactions", () => {
  test("launcher uses Up/Down and Enter without workflow letter shortcuts", async () => {
    let choice = "";
    const view = await testRender(<LauncherApp onChoice={(value) => { choice = value; }} />, renderOptions);
    try {
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressEnter());
      expect(choice).toBe("create");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("advice setup exposes a five-control focus loop and sends the selected Codex backend", async () => {
    const backends: Array<"claude" | "codex"> = [];
    let finishRun: (() => void) | undefined;
    const view = await testRender(
      <AdviceApp {...adviceAppProps(async (backend) => {
        backends.push(backend);
        return new Promise<AdviceReport>((resolve) => {
          finishRun = () => resolve(emptyAdviceReport(backend));
        });
      })} />,
      renderOptions
    );
    try {
      expect(await view.waitForFrame((frame) => frame.includes("▸ Artifact author: ‹ choose Claude or Codex › · Claude and Codex available"))).toContain(
        "▸ Artifact author: ‹ choose Claude or Codex › · Claude and Codex available"
      );
      await interact(view, async () => { await Bun.sleep(10); });
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((frame) => frame.includes("▸ Artifact author: ‹ Claude ›"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((frame) => frame.includes("▸ Artifact author: ‹ Codex ›"));
      await interact(view, () => view.mockInput.pressArrow("left"));
      await view.waitForFrame((frame) => frame.includes("▸ Artifact author: ‹ Claude ›"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((frame) => frame.includes("▸ Artifact author: ‹ Codex ›"));

      await interact(view, () => view.mockInput.pressTab());
      await view.waitForFrame((frame) => frame.includes("▸ [ ] Include project sessions"));
      await interact(view, () => view.mockInput.pressTab());
      await view.waitForFrame((frame) => frame.includes("▸ Session window:"));
      await interact(view, () => view.mockInput.pressTab());
      await view.waitForFrame((frame) => frame.includes("▸ Recommendation scope:"));
      await interact(view, () => view.mockInput.pressTab());
      await view.waitForFrame((frame) => frame.includes("▸ Analyze project"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => backends.length === 1);

      expect(backends).toEqual(["codex"]);
      await interact(view, () => finishRun?.());
      expect(await view.waitForFrame((frame) => frame.includes("Codex · 0 validated recommendation(s)"))).toContain("Codex · 0 validated recommendation(s)");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("advice failure names the selected backend and options allow switching without fallback", async () => {
    const backends: Array<"claude" | "codex"> = [];
    const view = await testRender(
      <AdviceApp {...adviceAppProps(async (backend) => {
        backends.push(backend);
        if (backend === "codex") throw new Error("Codex reasoning backend stopped before invocation.");
        return emptyAdviceReport(backend);
      })} />,
      renderOptions
    );
    try {
      await interact(view, () => view.mockInput.pressArrow("right"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      for (let index = 0; index < 4; index += 1) await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((frame) => frame.includes("Advice failed: Codex reasoning backend stopped before invocation."));
      expect(backends).toEqual(["codex"]);

      await interact(view, async () => { await Bun.sleep(10); });
      await interact(view, () => view.mockInput.typeText("r"));
      await view.waitForFrame((frame) => frame.includes("▸ Artifact author: ‹ Codex ›") && !frame.includes("Advice failed:"));
      await interact(view, () => view.mockInput.pressArrow("left"));
      for (let index = 0; index < 4; index += 1) await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => backends.length === 2);

      expect(backends).toEqual(["codex", "claude"]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("advice report renders complete focused recommendation details without truncation", async () => {
    let finishRun: (() => void) | undefined;
    const view = await testRender(
      <AdviceApp {...adviceAppProps(async () => new Promise<AdviceReport>((resolve) => {
        finishRun = () => resolve(detailedAdviceReport());
      }))} />,
      { width: 90, height: 50 }
    );
    try {
      await view.waitForFrame((frame) => frame.includes("Artifact author:"));
      await interact(view, async () => { await Bun.sleep(10); });
      await interact(view, () => view.mockInput.pressArrow("right"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      for (let index = 0; index < 4; index += 1) await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => finishRun !== undefined);
      await interact(view, () => finishRun?.());
      const frame = await view.waitForFrame((value) => value.includes("CREATES-END"));

      expect(frame).toContain("WHY-END");
      expect(frame).toContain("VALUE-END");
      expect(frame).toContain("EVIDENCE-END");
      expect(frame).toContain("CREATES-END");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("advice report focuses Create selected and Create all, and batch cancellation uses super+z or Ctrl+C", async () => {
    let finishRun: (() => void) | undefined;
    let selectedPlans = 0;
    const batchSignals: AbortSignal[] = [];
    const abortEvents: number[] = [];
    const report = detailedAdviceReport();
    const props = adviceAppProps(async () => new Promise<AdviceReport>((resolve) => {
      finishRun = () => resolve(report);
    }));
    const view = await testRender(
      <AdviceApp
        {...props}
        onPlan={async () => {
          selectedPlans += 1;
          throw new Error("selected plan test stop");
        }}
        onPlanBatch={async (activeReport, _previous, signal, onProgress) => new Promise((resolve) => {
          const signalIndex = batchSignals.length;
          batchSignals.push(signal);
          abortEvents.push(0);
          const planning = { ...createInitialAdviceBatchState(activeReport), phase: "planning" as const };
          onProgress(planning);
          signal.addEventListener("abort", () => {
            abortEvents[signalIndex] = abortEvents[signalIndex]! + 1;
            const initial = createInitialAdviceBatchState(activeReport);
            const cancelled = {
              ...initial,
              phase: "cancelled" as const,
              items: initial.items.map((item) => ({ ...item, status: "cancelled" as const, detail: "Cancelled" }))
            };
            onProgress(cancelled);
            resolve(cancelled);
          }, { once: true });
        })}
      />,
      { width: 110, height: 50, kittyKeyboard: true, exitOnCtrlC: false }
    );
    try {
      await view.waitForFrame((frame) => frame.includes("Artifact author:"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      for (let index = 0; index < 4; index += 1) await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => finishRun !== undefined);
      await interact(view, () => finishRun?.());
      let frame = await view.waitForFrame((value) => value.includes("▸ Create selected") && value.includes("Create all (1)"));
      expect(frame).toContain("▸ Create selected");
      expect(frame).toContain("Create all (1)");

      await interact(view, () => view.mockInput.pressArrow("right"));
      frame = await view.waitForFrame((value) => value.includes("▸ Create all (1)"));
      expect(frame).toContain("▸ Create all (1)");
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => batchSignals.length === 1);
      expect(await view.waitForFrame((value) => value.includes("Active author: Codex"))).toContain("cmd+z/ctrl+c cancel batch");

      await interact(view, () => view.mockInput.pressKey("z", { super: true }));
      await interact(view, () => view.mockInput.pressKey("z", { super: true }));
      await view.waitForFrame((value) => value.includes("Create all cancelled"));
      expect(batchSignals[0]?.aborted).toBe(true);
      expect(abortEvents[0]).toBe(1);

      await interact(view, () => view.mockInput.typeText("r"));
      await view.waitFor(() => batchSignals.length === 2);
      await interact(view, () => view.mockInput.pressCtrlC());
      await view.waitForFrame((value) => value.includes("Create all cancelled"));
      expect(batchSignals[1]?.aborted).toBe(true);
      expect(abortEvents[1]).toBe(1);

      await interact(view, () => view.mockInput.pressEscape());
      await view.waitForFrame((value) => value.includes("▸ Create all (1)"));
      await interact(view, () => view.mockInput.pressArrow("left"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => selectedPlans === 1);
      expect(selectedPlans).toBe(1);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("Create all shows the complete aggregated manifest before one confirmed apply", async () => {
    const report = detailedAdviceReport();
    const recommendationPlan = {
      recommendationId: report.recommendations[0]!.id,
      summary: "Create both reviewed files.",
      files: [
        { path: "AGENTS.md", content: "new guidance\n", purpose: "guidance" },
        { path: ".codex/config.toml", content: "[features]\nreview = true\n", purpose: "config" }
      ]
    };
    const aggregatePlan = { ...recommendationPlan, recommendationId: `batch:${recommendationPlan.recommendationId}` };
    let applies = 0;
    let finishPlan: (() => void) | undefined;
    const initial = createInitialAdviceBatchState(report);
    const review = {
      ...initial,
      phase: "review" as const,
      items: initial.items.map((item) => ({ ...item, status: "planned" as const, detail: "2 file(s) ready", plan: recommendationPlan })),
      plan: aggregatePlan,
      inspection: {
        targetDir: report.targetDir,
        existingHarness: true,
        files: [
          { path: "AGENTS.md", action: "replace" as const, purpose: "guidance", reason: "content differs", requiresForce: true, exists: true },
          { path: ".codex/config.toml", action: "create" as const, purpose: "config", reason: "missing", requiresForce: false, exists: false }
        ],
        counts: { create: 1, unchanged: 0, merge: 0, update: 0, replace: 1, blocked: 0 },
        replacementPaths: ["AGENTS.md"],
        replacements: ["AGENTS.md"],
        blockers: []
      }
    };
    const view = await testRender(
      <AdviceBatchFlow
        report={report}
        onPlan={async (_previous, _signal, onProgress) => new Promise((resolve) => {
          finishPlan = () => { onProgress(review); resolve(review); };
        })}
        onApply={async () => {
          applies += 1;
          return { written: ["AGENTS.md", ".codex/config.toml"], unchanged: [], writtenFiles: ["AGENTS.md", ".codex/config.toml"], unchangedFiles: [], backupDir: ".farrier-staging/backups/test" };
        }}
        onBack={() => undefined}
        onDone={() => undefined}
      />,
      renderOptions
    );
    try {
      await view.waitFor(() => finishPlan !== undefined);
      await interact(view, () => finishPlan?.());
      const frame = await view.waitForFrame((value) => value.includes("2 exact file(s)") && value.includes("AGENTS.md") && value.includes(".codex/config.toml"));
      expect(frame).toContain("nothing written yet");
      expect(applies).toBe(0);
      await interact(view, () => view.mockInput.pressEnter());
      expect(applies).toBe(0);
      expect(await view.waitForFrame((value) => value.includes("Replacement armed"))).toContain("Press y to apply with backups");
      await interact(view, () => view.mockInput.typeText("y"));
      await view.waitFor(() => applies === 1);
      expect(await view.waitForFrame((value) => value.includes("Create all complete"))).toContain("backups: .farrier-staging/backups/test");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("skill description keeps letters, Escape leaves the field, and only a visible action submits", async () => {
    let quits = 0;
    let submissions = 0;
    const view = await testRender(
      <CreateStep
        requests={[]}
        availability={{ claude: true, codex: true }}
        standalone
        onAddRequest={() => undefined}
        onRemoveRequest={() => undefined}
        onSubmit={() => { submissions += 1; }}
        onBack={() => undefined}
        onQuit={() => { quits += 1; }}
      />,
      renderOptions
    );
    try {
      await interact(view, () => view.mockInput.typeText("q skill"));
      expect(quits).toBe(0);
      await interact(view, () => view.mockInput.pressEnter());
      expect(submissions).toBe(0);
      await interact(view, () => view.mockInput.pressEnter());
      expect(submissions).toBe(0);
      await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressEnter());
      expect(submissions).toBe(1);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("refinement keeps ordinary letters in free text and Escape leaves the field", async () => {
    let value = "";
    let leaves = 0;
    const view = await testRender(
      <RefineFreeTextInput
        value={value}
        onInput={(next) => { value = next; }}
        onSubmit={() => undefined}
        onLeave={() => { leaves += 1; }}
      />,
      renderOptions
    );
    try {
      await interact(view, () => view.mockInput.typeText("q"));
      expect(value).toBe("q");
      expect(leaves).toBe(0);
      await interact(view, async () => {
        view.mockInput.pressEscape();
        await Bun.sleep(500);
      });
      expect(leaves).toBe(1);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("evaluation uses a visible list and destructive confirmation uses y/n/Escape", async () => {
    let picked = "";
    const verdict = {
      skillName: "test-skill",
      recommendedWinner: "claude" as const,
      rationale: "Claude is stronger.",
      copies: {
        claude: { path: ".claude/skills/test-skill", score: 9, rationale: "good", strengths: ["clear"], weaknesses: [] },
        codex: { path: ".agents/skills/test-skill", score: 8, rationale: "fine", strengths: ["short"], weaknesses: [] }
      },
      notes: []
    };
    const list = await testRender(
      <EvalVerdictScreen verdict={verdict} onPick={(value) => { picked = value; }} onKeepBoth={() => { picked = "both"; }} onQuit={() => undefined} />,
      renderOptions
    );
    try {
      await interact(list, () => list.mockInput.pressArrow("down"));
      await interact(list, () => list.mockInput.pressEnter());
      expect(picked).toBe("codex");
    } finally {
      await interact(list, () => list.renderer.destroy());
    }

    let confirmed = 0;
    let rejected = 0;
    const confirm = await testRender(
      <EvalConfirmScreen names={{ claude: "test-skill", codex: "test-skill" }} winner="claude" onConfirm={() => { confirmed += 1; }} onBack={() => { rejected += 1; }} onQuit={() => undefined} />,
      renderOptions
    );
    try {
      await interact(confirm, () => confirm.mockInput.typeText("r"));
      expect(confirmed).toBe(0);
      await interact(confirm, () => confirm.mockInput.typeText("n"));
      expect(rejected).toBe(1);
      await interact(confirm, () => confirm.mockInput.typeText("y"));
      expect(confirmed).toBe(1);
    } finally {
      await interact(confirm, () => confirm.renderer.destroy());
    }
  });

  test("Hooks keeps Claude and Codex on the existing step and selectable when a CLI is unavailable", async () => {
    const toggled: string[] = [];
    let continued = 0;
    const view = await testRender(
      <HooksStep
        availableHooks={["secret-shield"]}
        selectedHooks={["secret-shield"]}
        selectedAgents={["claude"]}
        agentAvailability={{ claude: false, codex: false }}
        toolPolicyRules={[]}
        onToggleHook={(hook) => toggled.push(hook)}
        onToggleAgent={(agent) => toggled.push(agent)}
        onNext={() => { continued += 1; }}
        onBack={() => undefined}
        onQuit={() => undefined}
      />,
      renderOptions
    );

    try {
      const frame = await view.waitForFrame((value) => value.includes("Targets") && value.includes("CLI unavailable"));
      expect(frame).toContain("[x] claude");
      expect(frame).toContain("[ ] codex");
      expect(frame).toContain("Protect");

      await interact(view, () => view.mockInput.typeText(" "));
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.typeText(" "));
      await interact(view, () => view.mockInput.pressEnter());

      expect(toggled).toEqual(["claude", "codex"]);
      expect(continued).toBe(1);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("review/collision confirmations and result actions follow the shared grammar", async () => {
    const confirmations: boolean[] = [];
    const review = await testRender(
      <ReviewStep
        agents={["claude", "codex"]}
        createRequests={[]}
        files={[{ path: "AGENTS.md", content: "new", action: "replace", purpose: "guidance", requiresForce: true }]}
        existingHarness={false}
        blockerCount={0}
        loading={false}
        canConfirm
        onConfirm={(force) => confirmations.push(force)}
        onBack={() => undefined}
        onQuit={() => undefined}
      />,
      renderOptions
    );
    try {
      await interact(review, () => review.mockInput.pressEnter());
      await interact(review, () => review.mockInput.typeText("r"));
      expect(confirmations).toEqual([]);
      await interact(review, () => review.mockInput.typeText("y"));
      expect(confirmations).toEqual([true]);
    } finally {
      await interact(review, () => review.renderer.destroy());
    }

    let collision = "";
    let cancelled = 0;
    const progress = await testRender(
      <CreateProgressScreen
        requests={[]}
        statuses={[]}
        cancelling={false}
        collision={{ path: "skills/existing", resolve: (decision) => { collision = decision; } }}
        onCancel={() => { cancelled += 1; }}
      />,
      renderOptions
    );
    try {
      await interact(progress, () => progress.mockInput.typeText("y"));
      expect(collision).toBe("replace");
      await interact(progress, () => progress.mockInput.pressCtrlC());
      expect(cancelled).toBe(1);
    } finally {
      await interact(progress, () => progress.renderer.destroy());
    }

    let evaluated = 0;
    let closed = 0;
    const done = await testRender(
      <CreateDoneScreen
        outcomes={[]}
        evalCandidate={{ skillName: "test-skill", names: { claude: "test-skill", codex: "test-skill" }, description: "test" }}
        onEvaluate={() => { evaluated += 1; }}
        onExit={() => { closed += 1; }}
      />,
      renderOptions
    );
    try {
      await interact(done, () => done.mockInput.pressEnter());
      expect(evaluated).toBe(1);
      await interact(done, () => done.mockInput.pressArrow("down"));
      await interact(done, () => done.mockInput.pressEnter());
      expect(closed).toBe(1);
    } finally {
      await interact(done, () => done.renderer.destroy());
    }
  });
});
