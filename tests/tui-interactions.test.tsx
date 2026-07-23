import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";
import { act } from "react";
import { AgentStep } from "../src/tui/AgentStep";
import { CreateStep } from "../src/tui/CreateStep";
import { HooksStep } from "../src/tui/HooksStep";
import { RefineFreeTextInput } from "../src/tui/RefineScreen";
import { DoneStep, ReviewStep } from "../src/tui/ReviewStep";
import { EvalConfirmScreen, EvalVerdictScreen } from "../src/tui/create-eval";
import { CreateDoneScreen, CreateProgressScreen } from "../src/tui/create-progress";
import { LauncherApp } from "../src/tui/launcher";
import { AdviceApp } from "../src/tui/advise-app";
import { AdviceBatchFlow } from "../src/tui/AdviceBatchFlow";
import { createInitialAdviceBatchState, type AdviceBatchState } from "../src/engine/advice-batch";
import type { SessionConsent } from "../src/engine/advice-sessions";
import type { AdviceReport } from "../src/engine/advice-types";
import type { AgentAvailability } from "../src/engine/backend";

const renderOptions = { width: 120, height: 40 };

function emptyAdviceReport(backend: "claude" | "codex"): AdviceReport {
  return {
    schemaVersion: 1,
    targetDir: "/tmp/example",
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
    targetVendors: ["claude", "codex"] as const,
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
    sessionInventory: {
      entries: [],
      notes: [],
      limits: [],
      projectRootDigest: "project-digest"
    },
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
      expect(await view.waitForFrame((frame) => frame.includes("▸ Analyze with: ‹ Claude Code › / Codex"))).toContain(
        "▸ Analyze with: ‹ Claude Code › / Codex"
      );
      await interact(view, async () => { await Bun.sleep(10); });
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((frame) => frame.includes("▸ Analyze with: Claude Code / ‹ Codex ›"));
      await interact(view, () => view.mockInput.pressArrow("left"));
      await view.waitForFrame((frame) => frame.includes("▸ Analyze with: ‹ Claude Code › / Codex"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((frame) => frame.includes("▸ Analyze with: Claude Code / ‹ Codex ›"));

      await interact(view, () => view.mockInput.pressTab());
      await view.waitForFrame((frame) => frame.includes("▸ [ ] Use recent Codex sessions"));
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
      const emptyReport = await view.waitForFrame((frame) => frame.includes("Codex · 0 validated recommendation(s)"));
      expect(emptyReport).toContain("No supported recommendation passed");
      expect(emptyReport).toContain("Show technical details");
      expect(emptyReport).not.toContain("Codebase profile");
      expect(emptyReport).not.toContain("Create selected");
      expect(emptyReport).not.toContain("Create all (0)");

      // The diagnostics dump (codebase profile, funnels) lives behind a toggle now.
      await interact(view, () => view.mockInput.typeText("t"));
      const details = await view.waitForFrame((frame) => frame.includes("Codebase profile"));
      expect(details).toContain("Codebase profile");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("advice session control enables a bounded sample and focuses Analyze", async () => {
    const consents: Array<SessionConsent | undefined> = [];
    const props = adviceAppProps(async (backend, consent) => {
      consents.push(consent);
      return emptyAdviceReport(backend);
    });
    props.sessionCounts = {
      "7d": [{ source: "claude", count: 21 }, { source: "codex", count: 1 }],
      "14d": [{ source: "claude", count: 21 }, { source: "codex", count: 1 }],
      all: [{ source: "claude", count: 21 }, { source: "codex", count: 1 }]
    };
    const now = Date.now();
    props.sessionInventory = {
      entries: [
        ...Array.from({ length: 21 }, (_, index) => ({
          opaqueId: `claude-session-${index + 1}`,
          provider: "claude" as const,
          updatedAt: new Date(now - index).toISOString(),
          projectMatch: "directory" as const,
          sourceFingerprint: `claude-fingerprint-${index + 1}`
        })),
        {
          opaqueId: "codex-session-1",
          provider: "codex" as const,
          updatedAt: new Date(now).toISOString(),
          projectMatch: "provider-index" as const,
          sourceFingerprint: "codex-fingerprint-1"
        }
      ],
      notes: [],
      limits: [
        { provider: "claude", discovered: 21, retained: 21, omitted: 0, invalid: 0 },
        { provider: "codex", discovered: 1, retained: 1, omitted: 0, invalid: 0 }
      ],
      projectRootDigest: "project-digest"
    };
    const view = await testRender(<AdviceApp {...props} />, renderOptions);
    try {
      await view.waitForFrame((frame) => frame.includes("Analyze with:"));
      await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressEnter());
      // The picker preselects the 20 most recent of 21; Enter confirms it.
      const picker = await view.waitForFrame((frame) => frame.includes("Choose Claude sessions"));
      expect(picker).toContain("20 of 21 selected");
      // Space excludes the focused session and space again re-includes it.
      await interact(view, () => view.mockInput.typeText(" "));
      await view.waitForFrame((frame) => frame.includes("19 of 21 selected"));
      await interact(view, () => view.mockInput.typeText(" "));
      await view.waitForFrame((frame) => frame.includes("20 of 21 selected"));
      await interact(view, () => view.mockInput.pressEnter());
      const enabled = await view.waitForFrame((frame) =>
        frame.includes("▸ Analyze project") && frame.includes("[x] Use 20 selected Claude sessions"));
      expect(enabled).toContain("Enabled 20 selected Claude session(s). See what will be sent, then press Enter to analyze.");
      expect(enabled).toContain("will be sent to Claude");
      expect(enabled).not.toContain("Review locally extracted requests");
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => consents.length === 1);

      expect(consents[0]?.selected).toHaveLength(20);
      expect(consents[0]?.selected.every((selection) => selection.provider === "claude")).toBe(true);
      expect(consents[0]?.selected.map((selection) => selection.opaqueId)).not.toContain("claude-session-21");
      expect(consents[0]?.selected.every((selection) =>
        selection.maxBytes === 250_000 && selection.maxTurns === 20)).toBe(true);
      expect(consents[0]?.categories).toEqual(["requests", "corrections", "commands", "files", "outcomes"]);
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
      for (let index = 0; index < 4; index += 1) await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((frame) => frame.includes("Advice failed: Codex reasoning backend stopped before invocation."));
      expect(backends).toEqual(["codex"]);

      await interact(view, async () => { await Bun.sleep(10); });
      await interact(view, () => view.mockInput.typeText("r"));
      await view.waitForFrame((frame) => frame.includes("▸ Analyze with: Claude Code / ‹ Codex ›") && !frame.includes("Advice failed:"));
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
      await view.waitForFrame((frame) => frame.includes("Analyze with:"));
      await interact(view, async () => { await Bun.sleep(10); });
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

  test("verified registry recommendations open a useful read-only inspection", async () => {
    const report = emptyAdviceReport("claude");
    const registryRef = "anthropics/claude-plugins-official@hookify";
    report.profile.evidence = [{
      id: "project:registry-fit",
      source: "project",
      kind: "capability",
      summary: "The project needs a reviewed Claude hook workflow.",
      path: "package.json"
    }];
    report.registry = { queries: [], verifiedMatches: [registryRef] };
    report.recommendations = [{
      id: "plugins:hookify",
      category: "plugins",
      targetVendors: ["claude"],
      reason: "This exact plugin matches the observed hook workflow.",
      benefit: "It avoids rebuilding an existing plugin inside the project.",
      evidence: ["project:registry-fit"],
      confidence: "high",
      registryRef,
      implementationRoute: {
        id: "plugins:claude-install",
        description: "Review the verified Claude plugin before installing it separately."
      }
    }];
    let finishRun: (() => void) | undefined;
    const view = await testRender(
      <AdviceApp {...adviceAppProps(async () => new Promise<AdviceReport>((resolve) => {
        finishRun = () => resolve(report);
      }))} />,
      { width: 120, height: 50 }
    );
    try {
      await view.waitForFrame((frame) => frame.includes("Analyze with:"));
      for (let index = 0; index < 4; index += 1) await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => finishRun !== undefined);
      await interact(view, () => finishRun?.());
      await view.waitForFrame((frame) => frame.includes("▸ Inspect registry item"));

      await interact(view, () => view.mockInput.pressEnter());
      const inspection = await view.waitForFrame((frame) => frame.includes("Registry inspection"));
      expect(inspection).toContain(registryRef);
      expect(inspection).toContain("verified for this report");
      expect(inspection).toContain("This exact plugin matches the observed hook workflow.");
      expect(inspection).toContain("project:registry-fit: The project needs a reviewed Claude hook workflow.");
      expect(inspection).toContain("Inspection is read-only");

      await interact(view, () => view.mockInput.pressEnter());
      expect(await view.waitForFrame((frame) => frame.includes("▸ Inspect registry item"))).toContain("Advice report");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("advice report does not overlap wrapped text in a short terminal", async () => {
    let finishRun: (() => void) | undefined;
    const report = detailedAdviceReport();
    const view = await testRender(
      <AdviceApp {...adviceAppProps(async () => new Promise<AdviceReport>((resolve) => {
        finishRun = () => resolve(report);
      }))} />,
      { width: 120, height: 29 }
    );
    try {
      await view.waitForFrame((frame) => frame.includes("Analyze with:"));
      for (let index = 0; index < 4; index += 1) await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => finishRun !== undefined);
      await interact(view, () => finishRun?.());
      for (let index = 0; index < 5; index += 1) await interact(view, () => view.mockInput.pressKey("\x1B[6~"));
      await view.waitForVisualIdle();
      const frame = view.captureCharFrame();
      const normalized = frame.replace(/│/g, " ").replace(/\s+/g, " ");
      const recommendation = report.recommendations[0]!;

      expect(normalized).toContain(`Why: ${recommendation.reason}`);
      expect(normalized).toContain(`Value: ${recommendation.benefit}`);
      expect(normalized).toContain(`Creates: ${recommendation.implementationRoute.description}`);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("advice setup and running states keep text intact in a short terminal", async () => {
    let progress: ((event: { message: string }) => void) | undefined;
    const now = Date.now();
    const props = adviceAppProps((_backend, _consent, _lookback, _scope, onProgress) => {
      progress = onProgress;
      return new Promise<AdviceReport>(() => undefined); // never resolves — stay in "running"
    });
    props.sessionCounts = {
      "7d": [{ source: "claude", count: 21 }, { source: "codex", count: 0 }],
      "14d": [{ source: "claude", count: 21 }, { source: "codex", count: 0 }],
      all: [{ source: "claude", count: 21 }, { source: "codex", count: 0 }]
    };
    props.sessionInventory = {
      entries: Array.from({ length: 21 }, (_, index) => ({
        opaqueId: `claude-session-${index + 1}`,
        provider: "claude" as const,
        updatedAt: new Date(now - index).toISOString(),
        projectMatch: "directory" as const,
        sourceFingerprint: `claude-fingerprint-${index + 1}`
      })),
      notes: [],
      limits: [{ provider: "claude", discovered: 21, retained: 21, omitted: 0, invalid: 0 }],
      projectRootDigest: "project-digest"
    };
    // A real terminal is routinely shorter than this screen's full content; opentui
    // overlaps overflowing flex siblings (spaces render transparent, so old glyphs
    // bleed through) unless the body is a bounded scroll region.
    const view = await testRender(<AdviceApp {...props} />, { width: 110, height: 26 });
    try {
      await view.waitForFrame((frame) => frame.includes("Analyze with:"));
      // Turn on sessions: the consent notice is the text most prone to overlap.
      await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((frame) => frame.includes("Choose Claude sessions"));
      await interact(view, () => view.mockInput.pressEnter());
      const setup = await view.waitForFrame((frame) => frame.includes("[x] Use 20 selected Claude sessions"));
      expect(setup).toContain("Passwords, tokens, and keys are removed on this computer first.");
      expect(setup).not.toMatch(/Passwords,\S/);

      // Start the run and stream progress; the live worker line must stay legible.
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => progress !== undefined);
      for (const message of [
        "Starting Claude analysis…",
        "Settled skills recommendation worker (1/6 settled)",
        "Running mcp recommendation worker (3/6 settled)"
      ]) await interact(view, () => progress?.({ message }));
      await view.waitForVisualIdle();
      const running = view.captureCharFrame();
      expect(running).toContain("Reading your project and asking Claude Code for suggestions…");
      expect(running).toContain("▸ Running mcp recommendation worker (3/6 settled)");
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
      await view.waitForFrame((frame) => frame.includes("Analyze with:"));
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
      expect(await view.waitForFrame((value) => value.includes("Active backend: Codex"))).toContain("cmd+z/ctrl+c cancel and stop");

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
      // Outcome-first: the header states what will happen in plain words, the
      // roster and file rows name the concrete files, nothing is written yet.
      const frame = await view.waitForFrame((value) => value.includes("Review what will be saved") && value.includes("AGENTS.md") && value.includes(".codex/config.toml"));
      expect(frame).toContain("Will create 1 new file and overwrite 1 existing file.");
      expect(frame).toContain("Nothing is saved to your project yet.");
      expect(applies).toBe(0);
      await interact(view, () => view.mockInput.pressEnter());
      expect(applies).toBe(0);
      // Enter on an overwrite arms it; the confirm line names the backup and the y/n choice.
      expect(await view.waitForFrame((value) => value.includes("a backup is kept first"))).toContain("Press y to save");
      await interact(view, () => view.mockInput.typeText("y"));
      await view.waitFor(() => applies === 1);
      expect(await view.waitForFrame((value) => value.includes("Create all complete"))).toContain("backups: .farrier-staging/backups/test");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("Create all humanizes a timeout failure, surfaces inline retry, and only re-runs the unfinished item", async () => {
    const report = emptyAdviceReport("codex");
    report.recommendations = [
      { id: "guidance:reuse", category: "guidance", targetVendors: ["claude", "codex"], reason: "r", benefit: "b", evidence: [], confidence: "high", implementationRoute: { id: "guidance:agents-md", description: "d" } },
      { id: "skills:deploy", category: "skills", targetVendors: ["codex"], reason: "r", benefit: "b", evidence: [], confidence: "high", implementationRoute: { id: "skills:agents-shared", description: "d" } }
    ];
    const filePlan = { recommendationId: "guidance:reuse", summary: "s", files: [{ path: "AGENTS.md", content: "x\n", purpose: "p" }] };
    let planCalls = 0;
    const view = await testRender(
      <AdviceBatchFlow
        report={report}
        onPlan={(previous, _signal, onProgress) => {
          planCalls += 1;
          const initial = createInitialAdviceBatchState(report);
          if (!previous) {
            // First run: item 0 created, item 1 timed out.
            const done = {
              ...initial,
              phase: "done" as const,
              items: initial.items.map((item, index) => index === 0
                ? { ...item, status: "created" as const, detail: "done", plan: filePlan }
                : { ...item, status: "failed" as const, detail: "external execution timed out after 600000ms" })
            };
            onProgress(done);
            return Promise.resolve(done);
          }
          // Retry run: only the failed item re-runs; the created one is kept.
          const retrying = {
            ...initial,
            phase: "planning" as const,
            items: initial.items.map((item, index) => index === 0
              ? { ...item, status: "planned" as const, detail: "kept", plan: filePlan }
              : { ...item, status: "running" as const, detail: "working" })
          };
          onProgress(retrying);
          return new Promise<AdviceBatchState>(() => undefined); // stay in planning
        }}
        onApply={async () => ({ written: [], unchanged: [], writtenFiles: [], unchangedFiles: [], backupDir: null })}
        onBack={() => undefined}
        onDone={() => undefined}
      />,
      renderOptions
    );
    try {
      const done = await view.waitForFrame((value) => value.includes("Create all complete"));
      // Milliseconds are humanized; the dead-end retry is advertised inline near the failure.
      expect(done).toContain("Codex ran out of time (10 minutes).");
      expect(done).not.toContain("600000ms");
      expect(done).toContain("1 failed · press r to retry just those");

      await interact(view, () => view.mockInput.typeText("r"));
      await view.waitFor(() => planCalls === 2);
      const retrying = await view.waitForFrame((value) => value.includes("Retrying the items that didn't finish"));
      // The re-run item reads "Retrying"; the kept one stays "Ready".
      expect(retrying).toContain("Retrying");
      expect(retrying).toContain("Ready");
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

  test("Agent step starts on Claude Code and Enter selects the focused target", async () => {
    const selected: string[][] = [];
    let advanced = 0;
    const view = await testRender(
      <AgentStep
        selectedAgents={["claude"]}
        onSelectAgents={(agents) => selected.push([...agents])}
        onNext={() => { advanced += 1; }}
        onCancel={() => undefined}
      />,
      renderOptions
    );

    try {
      const frame = await view.waitForFrame((value) => value.includes("Which agent is this harness for?"));
      expect(frame).toContain("Claude Code");
      expect(frame).toContain("Codex");
      expect(frame).toContain("Both");

      // Move the cursor to "Both" and confirm with Enter.
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressEnter());

      expect(selected.at(-1)).toEqual(["claude", "codex"]);
      expect(advanced).toBe(1);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("Hooks no longer owns target selection and toggles hooks on the existing step", async () => {
    const toggled: string[] = [];
    let continued = 0;
    const view = await testRender(
      <HooksStep
        availableHooks={["secret-shield"]}
        selectedHooks={["secret-shield"]}
        toolPolicyRules={[]}
        onToggleHook={(hook) => toggled.push(hook)}
        onNext={() => { continued += 1; }}
        onBack={() => undefined}
        onQuit={() => undefined}
      />,
      renderOptions
    );

    try {
      const frame = await view.waitForFrame((value) => value.includes("Protect"));
      expect(frame).not.toContain("Targets");
      expect(frame).toContain("[x] secret-shield");

      await interact(view, () => view.mockInput.typeText(" "));
      await interact(view, () => view.mockInput.pressEnter());

      expect(toggled).toEqual(["secret-shield"]);
      expect(continued).toBe(1);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });


  test("review exposes remote executable provenance and exact payload", async () => {
    const review = await testRender(
      <ReviewStep
        agents={["claude"]}
        createRequests={[]}
        files={[
          {
            path: ".claude/hooks/@acme/guard/guard.sh",
            content: "echo reviewed-payload  \n\n",
            action: "create",
            purpose: "Executable hook supplied by a configured registry.",
            requiresForce: false,
            executableProvenance: {
              registryRef: "@acme/guard",
              version: "1.2.3",
              sourceIdentity: "source-identity",
              itemSha256: "a".repeat(64),
              contentSha256: "b".repeat(64)
            }
          }
        ]}
        existingHarness={false}
        blockerCount={0}
        loading={false}
        canConfirm
        onConfirm={() => undefined}
        onBack={() => undefined}
        onQuit={() => undefined}
      />,
      renderOptions
    );
    try {
      // Purpose and exact payload lead the pane; registry provenance pages in last.
      const first = await review.waitForFrame((value) => value.includes('1: "echo reviewed-payload  "'));
      expect(first).toContain("new file — Executable hook supplied");
      expect(first).toContain('2: ""');
      await interact(review, () => review.mockInput.pressKey("\x1B[6~"));
      const second = await review.waitForFrame((value) => value.includes("registry @acme/guard v1.2.3"));
      expect(second).toContain("source source-identity");
      await interact(review, () => review.mockInput.pressKey("\x1B[6~"));
      await review.waitForFrame((value) => value.includes("content sha256"));
    } finally {
      await interact(review, () => review.renderer.destroy());
    }
  });

  test("write failure visibly renders rollback state, recovery path, and remediation", async () => {
    const view = await testRender(
      <DoneStep
        writeStatus={{
          ok: false,
          message: "rollback conflicted",
          mutationState: "rollback-incomplete",
          recoveryPath: ".farrier-staging/backups/recovery",
          remediation: "Run `farrier doctor --dir /tmp/project` before retrying."
        }}
        installResults={[]}
        createOutcomes={[]}
        agents={["claude"]}
        hookCount={0}
        skillCount={0}
        ruleCount={0}
        onExit={() => undefined}
      />,
      renderOptions
    );
    try {
      const frame = await view.waitForFrame((value) => value.includes("Some changes may remain — run the repair command below."));
      expect(frame).toContain("Backup saved to: .farrier-staging/backups/recovery");
      expect(frame).toContain("Run `farrier doctor --dir /tmp/project` before retrying.");
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
