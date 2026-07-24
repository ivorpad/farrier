import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";
import { act } from "react";
import type { AdviceCreationPlan } from "../src/engine/advice-apply";
import type { DistillReport } from "../src/engine/distill";
import type { DistillLesson } from "../src/engine/distill-playbook";
import { DistillApp, lessonRowLabel } from "../src/tui/distill-app";

const renderOptions = { width: 120, height: 44, kittyKeyboard: true };

function lesson(overrides: Partial<DistillLesson> = {}): DistillLesson {
  return {
    gateId: "visual-review-multi",
    classification: "portable",
    steerIndexes: [0],
    clusterIndexes: [],
    rationale: "The user demanded screenshot review twice.",
    source: "hints",
    ...overrides
  };
}

function report(lessons: DistillLesson[]): DistillReport {
  return {
    projectDir: "/tmp/walkledger",
    playbookName: "walkledger-playbook",
    evidence: {
      projectDir: "/tmp/walkledger",
      steers: [{ text: "take screenshots of every single page", sessionRef: "codex:a", date: "2026-07-22", truncated: false }],
      failureClusters: [],
      codexSessionsMatched: 2,
      codexSessionsScanned: 3,
      notes: []
    },
    annotated: {
      steers: [{ text: "take screenshots of every single page", sessionRef: "codex:a", date: "2026-07-22", truncated: false, hints: [] }],
      failureClusters: []
    },
    lessons,
    droppedLessons: [],
    llmClassified: false,
    notes: [],
    errors: []
  };
}

function planned() {
  const files = [{ path: ".agents/skills/walkledger-playbook/SKILL.md", content: "playbook\n", purpose: "orchestrator" }];
  return {
    plan: { recommendationId: "walkledger-playbook", summary: "Installs the playbook.", files } as AdviceCreationPlan,
    inspection: {
      targetDir: "/tmp/walkledger",
      existingHarness: true,
      files: [{ path: ".agents/skills/walkledger-playbook/SKILL.md", action: "create" as const, purpose: "orchestrator", reason: "new file", requiresForce: false, exists: false }],
      counts: { create: 1, unchanged: 0, merge: 0, update: 0, replace: 0, blocked: 0 },
      replacementPaths: [],
      replacements: [],
      blockers: []
    }
  };
}

function distillProps(overrides: Partial<Parameters<typeof DistillApp>[0]> = {}): Parameters<typeof DistillApp>[0] {
  return {
    onMine: async () => report([lesson(), lesson({ gateId: "name-preflight", classification: "app-specific" })]),
    onClassify: async () => ({ lessons: [lesson({ source: "llm" })], dropped: [] }),
    onPlan: async () => planned(),
    onApply: async () => ({ written: [], unchanged: [], writtenFiles: [".agents/skills/walkledger-playbook/SKILL.md"], unchangedFiles: [], backupDir: null }),
    backendLabel: "claude (sonnet)",
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

async function renderDistill(
  overrides: Partial<Parameters<typeof DistillApp>[0]> = {}
): Promise<TestRendererSetup> {
  const props = distillProps(overrides);
  const mine = props.onMine;
  let release: (() => void) | undefined;
  props.onMine = () => new Promise((resolve, reject) => {
    release = () => mine().then(resolve, reject);
  });
  const view = await testRender(<DistillApp {...props} />, renderOptions);
  await view.waitFor(() => release !== undefined);
  await interact(view, () => release?.());
  return view;
}

describe("distill consent screen", () => {
  test("shows scannable consent with sent/never-sent/limit lines before anything leaves", async () => {
    const view = await renderDistill();
    try {
      const frame = await view.waitForFrame((value) => value.includes("Classify lessons with claude (sonnet)?"));
      expect(frame).toContain("Mined locally: 1 steer(s) and 0 failure cluster(s) from 2 session(s).");
      expect(frame).toContain("Sends: redacted quotes of your own steering messages");
      expect(frame).toContain("Never sent: file contents");
      expect(frame).toContain("NOT caught");
      expect(frame).toContain("[y] classify with the backend");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("declining stays local and labels the lesson source", async () => {
    let classifyCalls = 0;
    const view = await renderDistill({
      onClassify: async () => {
        classifyCalls += 1;
        return { lessons: [], dropped: [] };
      }
    });
    try {
      await view.waitForFrame((value) => value.includes("Classify lessons with"));
      await interact(view, () => view.mockInput.typeText("n"));
      const frame = await view.waitForFrame((value) => value.includes("Lesson source:"));
      expect(frame).toContain("catalog signature hints (local only)");
      expect(frame).toContain(lessonRowLabel(lesson()));
      expect(classifyCalls).toBe(0);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("consenting classifies with the backend and marks the source", async () => {
    let classifyCalls = 0;
    const view = await renderDistill({
      onClassify: async () => {
        classifyCalls += 1;
        return { lessons: [lesson({ source: "llm" })], dropped: [] };
      }
    });
    try {
      await view.waitForFrame((value) => value.includes("Classify lessons with"));
      await interact(view, () => view.mockInput.typeText("y"));
      const frame = await view.waitForFrame((value) => value.includes("Lesson source:"));
      expect(frame).toContain("LLM classification (review-gated)");
      expect(classifyCalls).toBe(1);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });
});

describe("distill lesson review", () => {
  test("app-specific lessons are evidence-only and portable ones apply exactly once after file review", async () => {
    const applies: Array<{ plan: AdviceCreationPlan; force: boolean }> = [];
    const view = await renderDistill({
      onApply: async (plan, force) => {
        applies.push({ plan, force });
        return { written: [], unchanged: [], writtenFiles: [plan.files[0]!.path], unchangedFiles: [], backupDir: null };
      }
    });
    try {
      await view.waitForFrame((value) => value.includes("Classify lessons with"));
      await interact(view, () => view.mockInput.typeText("n"));
      const listFrame = await view.waitForFrame((value) => value.includes("2 lesson(s)"));
      expect(listFrame).toContain("1 included");
      expect(listFrame).toContain("evi");

      await interact(view, () => view.mockInput.pressEnter());
      const review = await view.waitForFrame((value) => value.includes("Review recommendation creation"));
      expect(review).toContain("walkledger-playbook");
      expect(applies).toHaveLength(0);

      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => applies.length === 1);
      expect(applies[0]!.plan.recommendationId).toBe("walkledger-playbook");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("space excludes a portable lesson from the proposal", async () => {
    const planCalls: DistillLesson[][] = [];
    const view = await renderDistill({
      onMine: async () => report([lesson(), lesson({ gateId: "device-verification" })]),
      onPlan: async (_report, lessons) => {
        planCalls.push(lessons);
        return planned();
      }
    });
    try {
      await view.waitForFrame((value) => value.includes("Classify lessons with"));
      await interact(view, () => view.mockInput.typeText("n"));
      await view.waitForFrame((value) => value.includes("2 included"));
      await interact(view, () => view.mockInput.typeText(" "));
      await view.waitForFrame((value) => value.includes("1 included"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitFor(() => planCalls.length === 1);
      expect(planCalls[0]!.map((item) => item.gateId)).toEqual(["device-verification"]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });
});
