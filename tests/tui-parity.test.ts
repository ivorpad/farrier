import { describe, expect, test } from "bun:test";
import type { ApplyHarnessChangePlanResult } from "../src/engine/create-plan";
import type { DetectedPackEvidence } from "../src/engine/detect";
import type { Pack, ResolvedPack } from "../src/packs/types";
import { builtinCatalog } from "../src/registry/catalog";
import { createInitialWizardState, wizardReducer } from "../src/tui/machine";
import { detectedPackPresentations, generatorPresentation, selectedPackForWizard, stackSelectionAssumption } from "../src/tui/pack-presentation";
import { wizardWriteExitCode } from "../src/tui/wizard-done";
import { currentHarnessReview, type HarnessReviewInput, type StoredHarnessReview } from "../src/tui/use-harness-review";
import { reviewPreviewOffset, type ReviewFile } from "../src/tui/ReviewStep";

const detected: DetectedPackEvidence[] = [
  { packId: "python-fastapi", evidence: ["pyproject.toml dependency: fastapi"] },
  { packId: "python-uv", evidence: ["pyproject.toml"] },
];

const applyResult: ApplyHarnessChangePlanResult = {
  written: ["AGENTS.md"],
  unchanged: ["CLAUDE.md"],
  writtenFiles: ["AGENTS.md"],
  unchangedFiles: ["CLAUDE.md"],
  backupDir: ".farrier-staging/backups/2030-01-02T03-04-05-678Z",
};

function writingState() {
  let state = createInitialWizardState({ availablePackIds: ["python-fastapi"], fallbackPackId: "python-fastapi" });
  for (let index = 0; index < 5; index += 1) state = wizardReducer(state, { type: "NEXT" });
  return wizardReducer(state, { type: "START_WRITING" });
}

describe("TUI pack presentation", () => {
  test("shows the detector's actual evidence for every match in most-specific-first order", () => {
    expect(detectedPackPresentations(detected)).toEqual([
      { ...detected[0], rank: 0, label: "detected" },
      { ...detected[1], rank: 1, label: "also detected" },
    ]);
    expect(stackSelectionAssumption("python-fastapi", detected)).toContain("first, most-specific match");
    expect(stackSelectionAssumption("python-uv", detected)).toBe("Explicit override: python-uv selected; detected signals for python-fastapi did not override your choice.");
  });

  test("attributes built-in and inherited generators to the pack that declared them", () => {
    const builtins = builtinCatalog();
    const fastapi = builtins.resolvePack("python-fastapi");
    expect(generatorPresentation(fastapi, builtins)).toEqual({ source: "python-fastapi", command: "uv init --package" });

    const remote: Pack = {
      id: "@acme/demo",
      extends: "python-fastapi",
      detect: {},
      skills: [],
      hooks: [],
      verbs: fastapi.verbs,
    };
    const inherited: ResolvedPack = { ...fastapi, id: remote.id, extends: remote.extends, packIds: [...fastapi.packIds, remote.id] };
    const catalog = { getPack: (id: string) => (id === remote.id ? remote : builtins.getPack(id)) };

    expect(generatorPresentation(inherited, catalog)).toEqual({ source: "python-fastapi", command: "uv init --package" });

    const override = { command: "bun", args: ["run", "setup"], onlyWhenEmptyDir: true };
    const definingRemote: Pack = { ...remote, generator: override };
    const overridden: ResolvedPack = { ...inherited, generator: override };
    expect(generatorPresentation(overridden, { getPack: (id) => (id === remote.id ? definingRemote : builtins.getPack(id)) })).toEqual({ source: "@acme/demo", command: "bun run setup" });
  });

  test("removes deselected registry hook payloads as well as their hook ids", () => {
    const base = builtinCatalog().resolvePack("python-fastapi");
    const registryHook = {
      id: "@acme/guard" as const,
      version: "1.0.0",
      sha256: "abc",
      fromCache: false,
      hookVersion: 1,
      events: [{ event: "PreToolUse" as const }],
      entry: "guard.sh",
      runner: "bash" as const,
      files: [{ path: "guard.sh", content: "#!/bin/sh\n" }],
    };
    const pack = { ...base, hooks: [...base.hooks, registryHook.id], remoteHooks: [registryHook] };
    const selected = selectedPackForWizard(pack, base.hooks);

    expect(selected.hooks).toEqual(base.hooks);
    expect(selected.remoteHooks).toEqual([]);
  });
});

describe("TUI write outcomes", () => {
  test("carries apply evidence and turns a skill-install partial result into a nonzero exit", () => {
    const state = wizardReducer(writingState(), {
      type: "WRITE_DONE",
      message: "Harness files applied; one skill failed.",
      partial: true,
      applyResult,
      installResults: [],
    });

    expect(state.step).toBe("Done");
    expect(state.applyResult).toEqual(applyResult);
    expect(state.writeStatus).toEqual({ ok: false, partial: true, message: "Harness files applied; one skill failed." });
    expect(wizardWriteExitCode(state.writeStatus)).toBe(1);
  });
});

describe("TUI review acceptance", () => {
  test("a completed replacement review becomes unconfirmable when any reviewed input changes", () => {
    const catalog = builtinCatalog();
    const pack = catalog.resolvePack("python-fastapi");
    const input: HarnessReviewInput = {
      active: true,
      targetDir: "/tmp/project",
      catalog,
      pack,
      packId: pack.id,
      selectedSkills: pack.skills,
      selectedHooks: pack.hooks,
      agents: ["claude"],
      learnEnabled: false,
      ruleCount: 3,
    };
    const stored: StoredHarnessReview = {
      input,
      plan: { targetDir: input.targetDir, files: [{ path: "AGENTS.md", content: "replacement\n" }] },
      files: [{ path: "AGENTS.md", content: "replacement\n", action: "replace", purpose: "guidance", requiresForce: true }],
      existingHarness: false,
      blockerCount: 0,
    };
    const changes: HarnessReviewInput[] = [
      { ...input, active: false },
      { ...input, targetDir: "/tmp/other" },
      { ...input, catalog: builtinCatalog() },
      { ...input, pack: catalog.resolvePack("generic") },
      { ...input, packId: "generic" },
      { ...input, selectedSkills: [...input.selectedSkills] },
      { ...input, selectedHooks: [...input.selectedHooks] },
      { ...input, agents: [...input.agents] },
      { ...input, learnEnabled: true },
      { ...input, ruleCount: 4 },
    ];

    expect(currentHarnessReview(stored, input).plan).toBe(stored.plan);
    for (const changed of changes) {
      expect(currentHarnessReview(stored, changed).plan).toBeNull();
    }
  });

  test("review paging clamps at both ends instead of accumulating overshoot", () => {
    const file: ReviewFile = {
      path: "hook.py",
      content: Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n"),
      action: "create",
      purpose: "hook",
      requiresForce: false,
    };
    const end = reviewPreviewOffset(file, 0, 10_000);

    expect(end).toBeGreaterThan(0);
    expect(reviewPreviewOffset(file, end, 10_000)).toBe(end);
    expect(reviewPreviewOffset(file, end, -10_000)).toBe(0);
  });
});
