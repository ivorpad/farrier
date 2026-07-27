import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";
import { act } from "react";
import type { AdviceCreationPlan } from "../src/engine/advice-apply";
import type { SessionIndexEntry } from "../src/engine/advice-sessions";
import type { HarnessSnapshot, ImproveProposal } from "../src/engine/improve-authoring";
import type { ImproveSessionList } from "../src/engine/improve-sessions";
import type { ReviewDecision } from "../src/engine/review-ledger";
import type { SessionEvidence, SessionSelection } from "../src/engine/session-evidence";
import { presetSelectionIds, sessionPickerPresets } from "../src/tui/AdviceSessionPicker";
import { ImproveAnalysisFlow, improveKindNoun } from "../src/tui/ImproveAnalysisFlow";

const renderOptions = { width: 120, height: 44, kittyKeyboard: true };

function entry(opaqueId: string, provider: "claude" | "codex"): SessionIndexEntry {
  return {
    opaqueId,
    provider,
    updatedAt: "2026-07-24T10:00:00.000Z",
    projectMatch: "directory",
    sourceFingerprint: `fp-${opaqueId}`,
    label: `session ${opaqueId}`
  };
}

function sessionList(): ImproveSessionList {
  return {
    entries: [entry("c1", "claude"), entry("x1", "codex")],
    sources: new Map([
      ["c1", { provider: "claude", stem: "aaaa-session" }],
      ["x1", { provider: "codex", threadId: "019f-thread" }]
    ]),
    notes: []
  };
}

function evidence(): SessionEvidence {
  return {
    projectDir: "/tmp/project",
    steers: [{ text: "los botones deben usar el design system", sessionRef: "claude:aaaa", date: "2026-07-20", truncated: false }],
    failureClusters: [],
    skillUsage: [{ name: "liquid-glass", invocations: 0, sessions: 0, installed: true, missingSkillMd: false }],
    codexSessionsMatched: 1,
    codexSessionsScanned: 1,
    notes: ["Mining was restricted to the 2 selected session(s)."]
  };
}

function snapshot(): HarnessSnapshot {
  return { agentsMd: "## Hard Rules\n\n- x\n", skillDescriptions: {}, subagents: [], hookIds: [] };
}

function proposal(): ImproveProposal {
  return {
    kind: "kb-rule",
    id: "kb-buttons",
    title: "Buttons come from DesignSystem",
    rationale: "The steers repeat the same button correction.",
    citations: { steerIndexes: [0], clusterIndexes: [], skillNames: [] },
    evidence: "Cites 1 steer(s); across 1 session(s)",
    ruleId: "pref-buttons",
    rule: "All buttons come from DesignSystem components.",
    tier: "declarative",
    owner: "ux-reviewer"
  };
}

function plannedFiles() {
  const files = [{ path: ".farrier/preferences.json", content: "{}\n", purpose: "preference KB" }];
  return {
    kind: "files" as const,
    plan: { recommendationId: "kb-buttons", summary: "Adds one preference rule.", files } as AdviceCreationPlan,
    inspection: {
      targetDir: "/tmp/project",
      existingHarness: true,
      files: [{ path: ".farrier/preferences.json", action: "create" as const, purpose: "preference KB", reason: "new file", requiresForce: false, exists: false }],
      counts: { create: 1, unchanged: 0, merge: 0, update: 0, replace: 0, blocked: 0 },
      replacementPaths: [],
      replacements: [],
      blockers: []
    }
  };
}

type FlowProps = Parameters<typeof ImproveAnalysisFlow>[0];

function flowProps(overrides: Partial<FlowProps> = {}): FlowProps {
  return {
    backendLabel: "claude (sonnet)",
    onListSessions: async () => sessionList(),
    onMine: async () => ({ evidence: evidence(), snapshot: snapshot() }),
    onAuthor: async () => ({ proposals: [proposal()], dropped: [{ id: "prune-x", reason: "proposal cites no evidence" }] }),
    onPlan: async () => plannedFiles(),
    onApply: async () => ({ written: [".farrier/preferences.json"], unchanged: [], writtenFiles: [".farrier/preferences.json"], unchangedFiles: [], backupDir: null }),
    onFindSkills: () => undefined,
    onBack: () => undefined,
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

/**
 * Strips the box-drawing frame (borders, scrollbar) and collapses whitespace,
 * so a phrase the renderer wrapped across lines reads as one contiguous string.
 * Lets consent assertions check semantic content, not layout width.
 */
function flattenFrame(frame: string): string {
  return frame.replace(/[│┌┐└┘─█]/g, " ").replace(/\s+/g, " ").trim();
}

describe("presetSelectionIds", () => {
  test("selects the newest N (or all up to the cap)", () => {
    const entries = Array.from({ length: 40 }, (_, index) => entry(`s${index}`, "claude"));
    expect(presetSelectionIds(entries, 7, 500)).toHaveLength(7);
    expect(presetSelectionIds(entries, 30, 500)[29]).toBe("s29");
    expect(presetSelectionIds(entries, "all", 500)).toHaveLength(40);
    expect(presetSelectionIds(entries, 15, 10)).toHaveLength(10);
    expect(sessionPickerPresets).toEqual([7, 15, 30, "all"]);
  });
});

describe("improve analysis flow", () => {
  test("picker → focus → consent → typed proposals → review applies once", async () => {
    const mines: Array<SessionSelection | undefined> = [];
    const authored: Array<{ focus?: string }> = [];
    const applies: AdviceCreationPlan[] = [];
    const view = await testRender(
      <ImproveAnalysisFlow
        {...flowProps({
          onMine: async (selection) => {
            mines.push(selection);
            return { evidence: evidence(), snapshot: snapshot() };
          },
          onAuthor: async (input) => {
            authored.push({ ...(input.focus ? { focus: input.focus } : {}) });
            return { proposals: [proposal()], dropped: [] };
          },
          onApply: async (plan) => {
            applies.push(plan);
            return { written: [], unchanged: [], writtenFiles: [], unchangedFiles: [], backupDir: null };
          }
        })}
      />,
      renderOptions
    );
    try {
      const picker = await view.waitForFrame((value) => value.includes("Choose the sessions Improve learns from"));
      expect(picker).toContain("2 of 2 selected");
      expect(picker).toContain("presets 7/15/30/all");
      expect(picker).toContain("claude · ");

      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("What matters to you now?"));
      await interact(view, () => view.mockInput.typeText("design consistency"));
      await interact(view, () => view.mockInput.pressEnter());

      const consent = await view.waitForFrame((value) => value.includes("Analyze with claude (sonnet)?"));
      // Flatten first: the disclosure is several lines and may wrap at any
      // width, so each category is asserted as a semantic piece, not one
      // contiguous substring tied to the 120-col layout.
      const consentText = flattenFrame(consent);
      expect(consentText).toContain("Mined locally from 2 selected session(s): 1 steer(s), 0 failure cluster(s), 1 installed skill(s) tracked.");
      // Both new evidence categories are named honestly.
      expect(consentText).toContain("the assistant action each steering message followed");
      expect(consentText).toContain("per-session counts of your steers, edits, and commands, plus the top folders you worked in");
      // The pre-existing categories still stand.
      expect(consentText).toContain("redacted quotes of your steering messages");
      expect(consentText).toContain("AGENTS.md, CLAUDE.md, and skill and subagent descriptions");
      expect(consentText).toContain("Never sent: session ids");
      expect(consentText).toContain("NOT caught");
      expect(consentText).toContain("Focus: design consistency");
      expect(mines).toEqual([{ claudeStems: new Set(["aaaa-session"]), codexThreadIds: new Set(["019f-thread"]) }]);
      expect(authored).toEqual([]);

      await interact(view, () => view.mockInput.typeText("y"));
      const list = await view.waitForFrame((value) => value.includes("1 proposal(s)"));
      expect(authored).toEqual([{ focus: "design consistency" }]);
      expect(list).toContain(improveKindNoun("kb-rule"));
      expect(list).toContain("Buttons come from DesignSystem");
      expect(list).toContain("Cites 1 steer(s)");
      expect(list).toContain("Tier: declarative · owner: ux-reviewer");

      await interact(view, () => view.mockInput.pressEnter());
      const review = await view.waitForFrame((value) => value.includes("Review recommendation creation"));
      expect(review).toContain(".farrier/preferences.json");
      expect(applies).toHaveLength(0);

      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => applies.length === 1);
      expect(applies[0]!.recommendationId).toBe("kb-buttons");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("declining consent sends nothing and returns", async () => {
    let authorCalls = 0;
    let backCalls = 0;
    const view = await testRender(
      <ImproveAnalysisFlow
        {...flowProps({
          onAuthor: async () => {
            authorCalls += 1;
            return { proposals: [], dropped: [] };
          },
          onBack: () => {
            backCalls += 1;
          }
        })}
      />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("Choose the sessions"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("What matters to you now?"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("Analyze with"));
      await interact(view, () => view.mockInput.typeText("n"));
      await view.waitFor(() => backCalls === 1);
      expect(authorCalls).toBe(0);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("records a rejection from the list and an acceptance after apply", async () => {
    const decisions: ReviewDecision[] = [];
    const view = await testRender(
      <ImproveAnalysisFlow
        {...flowProps({
          onAuthor: async () => ({
            proposals: [proposal(), { ...proposal(), id: "kb-spacing", title: "Spacing scale" }],
            dropped: []
          }),
          onRecordDecision: async (decision) => {
            decisions.push(decision);
          }
        })}
      />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("Choose the sessions"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("What matters to you now?"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("Analyze with"));
      await interact(view, () => view.mockInput.typeText("y"));
      await view.waitForFrame((value) => value.includes("2 proposal(s)"));

      // n rejects the focused proposal from the list and records it.
      await interact(view, () => view.mockInput.typeText("n"));
      await view.waitFor(() => decisions.length === 1);
      expect(decisions[0]).toMatchObject({ proposalId: "kb-buttons", decision: "rejected", kind: "kb-rule" });

      // The second proposal reviews and applies; the apply records an acceptance.
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("Review recommendation creation"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => decisions.length === 2);
      expect(decisions[1]).toMatchObject({ proposalId: "kb-spacing", decision: "accepted" });
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("a new-skill proposal hands its query to the skills flow", async () => {
    const queries: string[] = [];
    const view = await testRender(
      <ImproveAnalysisFlow
        {...flowProps({
          onAuthor: async () => ({
            proposals: [{
              kind: "new-skill",
              id: "skill-design",
              title: "Capture the design-system build procedure",
              rationale: "Repeated deep procedure in the steers.",
              citations: { steerIndexes: [0], clusterIndexes: [], skillNames: [] },
              evidence: "Cites 1 steer(s); across 1 session(s)",
              name: "design-system-builder",
              description: "Build DesignSystem components from DESIGN_DIRECTION.md."
            }],
            dropped: []
          }),
          onPlan: async () => ({ kind: "skill", query: "design-system-builder: Build DesignSystem components from DESIGN_DIRECTION.md.", message: "" }),
          onFindSkills: (query) => {
            queries.push(query);
          }
        })}
      />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("Choose the sessions"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("What matters to you now?"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("Analyze with"));
      await interact(view, () => view.mockInput.typeText("y"));
      await view.waitForFrame((value) => value.includes("new skill"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => queries.length === 1);
      expect(queries[0]).toContain("design-system-builder");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });
});
