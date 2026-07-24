import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";
import { act } from "react";
import type { AdviceCreationPlan } from "../src/engine/advice-apply";
import type { PrimitiveProposal } from "../src/engine/failure-router";
import type { PlannedProposal, ProposalMiningResult } from "../src/engine/proposal-apply";
import { LearnApp, proposalKindNoun } from "../src/tui/learn-app";

// kittyKeyboard makes a lone Escape unambiguous, so tests can press it directly.
const renderOptions = { width: 120, height: 40, kittyKeyboard: true };

function guardProposal(): PrimitiveProposal {
  return {
    kind: "guard-instance",
    id: "guard-large-file-commit",
    title: "Deny committing oversized files (large-file-commit-guard)",
    hookId: "large-file-commit-guard",
    guardsPatch: { largeFileCommit: { maxBytes: 5 * 1024 * 1024 } },
    message: "A PreToolUse guard on git add/commit makes this unrepeatable at the moment of error.",
    evidence: [{
      class: "oversized-commit",
      key: "history-rewrite",
      count: 3,
      sessionCount: 2,
      dates: ["2026-07-19", "2026-07-21"],
      sessionRefs: ["session-a", "session-b"],
      samples: ["git filter-repo --strip-blobs-bigger-than 50M"]
    }]
  };
}

function ruleProposal(): PrimitiveProposal {
  return {
    kind: "rules-line",
    id: "rule-rejected-push",
    title: "Teach the push discipline that failed before",
    line: "Before `git push`, fetch and rebase onto the remote branch.",
    message: "One declarative line is the cheapest primitive.",
    evidence: [{
      class: "rejected-push",
      key: "rejected-push",
      count: 2,
      sessionCount: 2,
      dates: ["2026-07-20"],
      sessionRefs: ["session-a", "session-b"],
      samples: ["! [rejected] main -> main (fetch first)"]
    }]
  };
}

function skillProposal(): PrimitiveProposal {
  return {
    kind: "skill-suggestion",
    id: "skill-npm-deploy",
    title: "Capture the working procedure around `npm deploy`",
    query: "npm deploy",
    message: "Search the skill registry or author a skill documenting the working procedure.",
    evidence: [{
      class: "repeated-failure",
      key: "npm deploy",
      count: 5,
      sessionCount: 3,
      dates: ["2026-07-18", "2026-07-21"],
      sessionRefs: ["session-a", "session-b", "session-c"],
      samples: ["npm deploy"]
    }]
  };
}

function miningResult(proposals: PrimitiveProposal[]): ProposalMiningResult {
  return {
    transcriptsDir: "/tmp/transcripts",
    signals: proposals.flatMap((proposal) => proposal.evidence),
    proposals,
    harnessPresent: true,
    existingAgentFiles: [],
    notes: []
  };
}

function plannedFiles(proposal: PrimitiveProposal): PlannedProposal {
  const files = [{ path: "AGENTS.md", content: "reviewed content\n", purpose: "guidance" }];
  return {
    kind: "files",
    plan: { recommendationId: proposal.id, summary: "Reviewed summary.", files },
    inspection: {
      targetDir: "/tmp/example",
      existingHarness: true,
      files: [{ path: "AGENTS.md", action: "update", purpose: "guidance", reason: "content differs", requiresForce: false, exists: true }],
      counts: { create: 0, unchanged: 0, merge: 0, update: 1, replace: 0, blocked: 0 },
      replacementPaths: [],
      replacements: [],
      blockers: []
    }
  };
}

function learnAppProps(overrides: Partial<Parameters<typeof LearnApp>[0]> = {}): Parameters<typeof LearnApp>[0] {
  return {
    onMine: async () => miningResult([guardProposal(), ruleProposal(), skillProposal()]),
    onPlan: async (proposal) => plannedFiles(proposal),
    onApply: async () => ({ written: ["AGENTS.md"], unchanged: [], writtenFiles: ["AGENTS.md"], unchangedFiles: [], backupDir: null }),
    onExit: () => undefined,
    ...overrides
  };
}

async function interact(view: TestRendererSetup, action: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await action();
    await view.flush();
  });
}

/** Render LearnApp and resolve the mining promise inside act, keeping React updates wrapped. */
async function renderLearn(
  overrides: Partial<Parameters<typeof LearnApp>[0]> = {},
  options: { width: number; height: number; kittyKeyboard?: boolean } = renderOptions
): Promise<TestRendererSetup> {
  const props = learnAppProps(overrides);
  const mine = props.onMine;
  let release: (() => void) | undefined;
  props.onMine = () => new Promise((resolve, reject) => {
    release = () => mine().then(resolve, reject);
  });
  const view = await testRender(<LearnApp {...props} />, options);
  await view.waitFor(() => release !== undefined);
  await interact(view, () => release?.());
  return view;
}

describe("learn proposal surface", () => {
  test("kinds map to ecosystem nouns only", () => {
    expect(proposalKindNoun("guard-instance")).toBe("hook");
    expect(proposalKindNoun("rules-line")).toBe("AGENTS.md rule");
    expect(proposalKindNoun("skill-suggestion")).toBe("skill");
  });

  test("lists proposals with nouns, evidence counts, and sample excerpts", async () => {
    const view = await renderLearn();
    try {
      const frame = await view.waitForFrame((value) => value.includes("3 proposal(s)"));
      expect(frame).toContain("Deny committing oversized files (large-file-commit-guard)");
      expect(frame).toContain("hook");
      expect(frame).toContain("AGENTS.md rule");
      expect(frame).toContain("skill");
      // Evidence line for the focused (first) proposal.
      expect(frame).toContain("Seen 3× across 2 session(s) (2026-07-19 to 2026-07-21)");
      expect(frame).toContain("e.g. git filter-repo");
      expect(frame).toContain("nothing applied yet");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("without a harness the list is read-only: banner up front, review gated before planning", async () => {
    const planned: PrimitiveProposal[] = [];
    const view = await renderLearn({
      onMine: async () => ({ ...miningResult([guardProposal(), ruleProposal()]), harnessPresent: false }),
      onPlan: async (proposal) => {
        planned.push(proposal);
        return plannedFiles(proposal);
      }
    });
    try {
      const frame = await view.waitForFrame((value) => value.includes("read-only until a harness exists"));
      expect(frame.replace(/\s+/g, " ")).toContain(
        "No harness in this project yet, so proposals are read-only. Choose Create harness from the main menu first."
      );
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() =>
        view.captureCharFrame().replace(/\s+/g, " ").includes("then come back to apply it.")
      );
      const after = view.captureCharFrame().replace(/\s+/g, " ");
      expect(after).toContain("Choose Create harness from the main menu first, then come back to apply it.");
      expect(after).not.toContain("Preparing the exact files");
      expect(planned.length).toBe(0);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("a hand-harnessed repo (skills, no manifest) is never told it has no harness", async () => {
    const planned: PrimitiveProposal[] = [];
    const view = await renderLearn({
      onMine: async () => ({
        ...miningResult([guardProposal()]),
        harnessPresent: false,
        existingAgentFiles: ["AGENTS.md", "71 installed skill(s)"]
      }),
      onPlan: async (proposal) => {
        planned.push(proposal);
        return plannedFiles(proposal);
      }
    });
    try {
      const frame = await view.waitForFrame((value) => value.includes("read-only until farrier is set up"));
      const normalized = frame.replace(/\s+/g, " ");
      expect(normalized).toContain(
        "Found AGENTS.md and 71 installed skill(s), but farrier isn't set up in this project yet, so proposals are read-only."
      );
      expect(normalized).toContain("existing files are reviewed first and can be kept as-is");
      expect(normalized).not.toContain("No harness in this project yet");
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() =>
        view.captureCharFrame().replace(/\s+/g, " ").includes("farrier's manifest (.farrier.json)")
      );
      const after = view.captureCharFrame().replace(/\s+/g, " ");
      expect(after).toContain("your existing files are reviewed and can be kept");
      expect(planned.length).toBe(0);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("confirming a reviewed proposal invokes the engine apply exactly once", async () => {
    const applies: Array<{ plan: AdviceCreationPlan; force: boolean }> = [];
    let finishPlan: (() => void) | undefined;
    let finishApply: (() => void) | undefined;
    const props = learnAppProps({
      onPlan: (proposal) => new Promise((resolve) => {
        finishPlan = () => resolve(plannedFiles(proposal));
      }),
      onApply: (plan, force) => new Promise((resolve) => {
        applies.push({ plan, force });
        finishApply = () => resolve({ written: ["AGENTS.md"], unchanged: [], writtenFiles: ["AGENTS.md"], unchangedFiles: [], backupDir: null });
      })
    });
    const view = await renderLearn(props);
    try {
      await view.waitForFrame((value) => value.includes("3 proposal(s)"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => finishPlan !== undefined);
      await interact(view, () => finishPlan?.());
      const review = await view.waitForFrame((value) => value.includes("Review recommendation creation"));
      expect(review).toContain("Nothing is saved to your project yet.");
      expect(applies).toHaveLength(0);
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => applies.length === 1);
      expect(applies[0]!.plan.recommendationId).toBe("guard-large-file-commit");
      await interact(view, () => finishApply?.());
      expect(await view.waitForFrame((value) => value.includes("Recommendation created"))).toContain("Saved 1 file");

      // Back to the list: the applied proposal is marked.
      await interact(view, () => view.mockInput.pressEscape());
      expect(await view.waitForFrame((value) => value.includes("Applied in this session."))).toContain("✓ hook");
      expect(applies).toHaveLength(1);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("leaving the review applies nothing", async () => {
    let applies = 0;
    let finishPlan: (() => void) | undefined;
    const props = learnAppProps({
      onPlan: (proposal) => new Promise((resolve) => {
        finishPlan = () => resolve(plannedFiles(proposal));
      }),
      onApply: async () => {
        applies += 1;
        return { written: [], unchanged: [], writtenFiles: [], unchangedFiles: [], backupDir: null };
      }
    });
    const view = await renderLearn(props);
    try {
      await view.waitForFrame((value) => value.includes("3 proposal(s)"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => finishPlan !== undefined);
      await interact(view, () => finishPlan?.());
      await view.waitForFrame((value) => value.includes("Review recommendation creation"));
      await interact(view, () => view.mockInput.pressEscape());
      await view.waitForFrame((value) => value.includes("3 proposal(s)"));
      expect(applies).toBe(0);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("a skill suggestion returns its query instead of opening a file review", async () => {
    let plans = 0;
    const props = learnAppProps({
      onMine: async () => miningResult([skillProposal()]),
      onPlan: async (proposal) => {
        plans += 1;
        return plannedFiles(proposal);
      }
    });
    const view = await renderLearn(props);
    try {
      await view.waitForFrame((value) => value.includes("1 proposal(s)"));
      await interact(view, () => view.mockInput.pressEnter());
      const frame = await view.waitForFrame((value) => value.includes("Open Find skills from the main menu and search: npm deploy"));
      expect(frame).not.toContain("Review recommendation creation");
      expect(plans).toBe(0);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("a skill suggestion jumps to the Skills surface with its query when wired", async () => {
    const queries: string[] = [];
    const view = await renderLearn({
      onMine: async () => miningResult([skillProposal()]),
      onFindSkills: (query) => queries.push(query)
    });
    try {
      await view.waitForFrame((value) => value.includes("1 proposal(s)"));
      await interact(view, () => view.mockInput.pressEnter());
      expect(queries).toEqual(["npm deploy"]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("the deeper LLM analysis is offered and fires on a", async () => {
    let deeper = 0;
    const view = await renderLearn({
      onDeeper: () => {
        deeper += 1;
      },
      llmBackendLabel: "Claude Code"
    });
    try {
      const frame = await view.waitForFrame((value) => value.includes("3 proposal(s)"));
      expect(frame).toContain("Deeper pass: a runs the LLM analysis");
      expect(frame).toContain("Claude Code");
      await interact(view, () => view.mockInput.typeText("a"));
      expect(deeper).toBe(1);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("mining failure names the reason and applies nothing", async () => {
    const props = learnAppProps({
      onMine: async () => {
        throw new Error("not a farrier project; run farrier create first");
      }
    });
    const view = await renderLearn(props);
    try {
      const frame = await view.waitForFrame((value) => value.includes("Failure mining failed:"));
      expect(frame).toContain("not a farrier project; run farrier create first");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("keeps proposal text intact in a short terminal", async () => {
    // opentui overlaps overflowing stacked text unless the body is a bounded
    // scroll region; a short frame with several proposals is the regression.
    const proposals = [guardProposal(), ruleProposal(), skillProposal()];
    const view = await testRender(
      <LearnApp {...learnAppProps({ onMine: async () => miningResult(proposals) })} />,
      { width: 110, height: 22 }
    );
    try {
      await view.waitForFrame((value) => value.includes("3 proposal(s)"));
      await view.waitForVisualIdle();
      const frame = view.captureCharFrame();
      expect(frame).toContain("▸ hook");
      expect(frame).toContain("Deny committing oversized files (large-file-commit-guard)");
      expect(frame).toContain("Seen 3× across 2 session(s) (2026-07-19 to 2026-07-21)");
      // The consent-adjacent footer line must stay legible, not interleaved.
      expect(frame).toContain("Nothing is applied without confirmation");
      expect(frame).not.toMatch(/Nothing is applied\S/);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });
});
