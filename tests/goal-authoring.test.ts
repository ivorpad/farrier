import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BackendCommandRunner } from "../src/engine/backend";
import { createExportReport } from "../src/engine/export-harness";
import {
  buildGoalPrompt,
  goalApprovalPath,
  goalLedgerPath,
  reviewerNamesForLessons,
  validateGoalArtifacts
} from "../src/engine/goal-authoring";
import type { ExportLesson } from "../src/engine/export-playbook";
import { annotateSessionEvidence } from "../src/engine/gate-catalog";
import type { SessionEvidence } from "../src/engine/session-evidence";

async function tempDir(prefix = "farrier-goal-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function lesson(overrides: Partial<ExportLesson> = {}): ExportLesson {
  return {
    gateId: "visual-review-multi",
    classification: "portable",
    steerIndexes: [0],
    clusterIndexes: [],
    rationale: "verbatim demand for screenshots",
    source: "llm",
    ...overrides
  };
}

/** A goalMd that satisfies every mechanical validation rule. */
function validGoalMd(): string {
  const filler =
    "Print the exact command, its exit code, and the decisive output line before claiming any row closed. " +
    "Re-read PRD.md and the open plan file before continuing after a fresh context.";
  return [
    "# Goal contract",
    "",
    "## 1. Outcome",
    `Every requirement in PRD.md is implemented and its row in ${goalLedgerPath} is closed with a pointer to the printed check.`,
    "",
    "## 2. Verification surface",
    "- .agents/skills/x-playbook/gates/check.py exits 0 with every gate printed as PASS.",
    "- The project's check command from AGENTS.md exits 0, final line printed.",
    "- Checks the PRD does not justify print <name>=not_applicable with the PRD reason.",
    "",
    "## 3. Constraints",
    "- Screenshots of every screen before any approval [evidence: steer 0].",
    "",
    "## 4. Boundaries",
    `- PRD.md is the only per-project input. The design approval is quoted verbatim at ${goalApprovalPath}.`,
    "",
    "## 5. Iteration policy",
    filler,
    "",
    "## 6. Blocked stop",
    `Stop when PRD.md is contradictory or the review awaits the user; report the open rows in ${goalLedgerPath} and the single blocker.`,
    filler,
    filler,
    ""
  ].join("\n");
}

describe("validateGoalArtifacts", () => {
  const context = { hasLessons: true, requiresApproval: true };

  test("accepts a complete contract", () => {
    const result = validateGoalArtifacts({ goalMd: validGoalMd(), condition: "Work per GOAL.md until all checks print." }, context);
    expect(result.ok).toBe(true);
  });

  test("rejects missing sections, ledger, escapes, citations, and approval path", () => {
    const goalMd = validGoalMd();
    const cases: Array<{ mutate: (value: string) => string; reason: string }> = [
      { mutate: (value) => value.replace("## 4.", "## IV."), reason: '"## 4."' },
      { mutate: (value) => value.replaceAll(goalLedgerPath, "LEDGER"), reason: goalLedgerPath },
      { mutate: (value) => value.replace("not_applicable", "skipped"), reason: "not_applicable" },
      { mutate: (value) => value.replace("[evidence: steer 0]", "(seen in sessions)"), reason: "[evidence:" },
      { mutate: (value) => value.replaceAll(goalApprovalPath, "the transcript"), reason: goalApprovalPath }
    ];
    for (const { mutate, reason } of cases) {
      const result = validateGoalArtifacts({ goalMd: mutate(goalMd), condition: "Work per GOAL.md." }, context);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain(reason);
    }
  });

  test("rejects an oversized or GOAL.md-less condition", () => {
    const long = validateGoalArtifacts({ goalMd: validGoalMd(), condition: `Work per GOAL.md ${"x".repeat(3_600)}` }, context);
    expect(long.ok).toBe(false);
    const unanchored = validateGoalArtifacts({ goalMd: validGoalMd(), condition: "keep working until done" }, context);
    expect(unanchored.ok).toBe(false);
  });

  test("approval and citation rules relax when nothing requires them", () => {
    const goalMd = validGoalMd()
      .replace("[evidence: steer 0]", "(universal)")
      .replaceAll(goalApprovalPath, "no approval file");
    const result = validateGoalArtifacts(
      { goalMd, condition: "Work per GOAL.md." },
      { hasLessons: false, requiresApproval: false }
    );
    expect(result.ok).toBe(true);
  });
});

describe("buildGoalPrompt", () => {
  test("carries lessons, evidence indexes, skills, and the checkpoint instruction", () => {
    const evidence: SessionEvidence = {
      projectDir: "/tmp/p",
      steers: [{ text: "take screenshots of every page", sessionRef: "codex:a", date: "2026-07-22", truncated: false }],
      failureClusters: [],
      skillUsage: [{ name: "swiftui-pro", invocations: 9, sessions: 3, installed: true, missingSkillMd: false }],
      codexSessionsMatched: 1,
      codexSessionsScanned: 1,
      notes: []
    };
    const prompt = buildGoalPrompt({
      playbookName: "walkledger-playbook",
      annotated: annotateSessionEvidence(evidence),
      lessons: [lesson()],
      skillUsage: evidence.skillUsage
    });
    expect(prompt).toContain('"goalMd"');
    expect(prompt).toContain("ux_hig_reviewer");
    expect(prompt).toContain("approved the design review in this thread");
    expect(prompt).toContain("not_applicable");
    expect(prompt).toContain(goalLedgerPath);
    expect(prompt).toContain("swiftui-pro");
    expect(prompt).toContain(".agents/skills/walkledger-playbook/gates/check.py");
  });

  test("reviewerNamesForLessons mirrors the playbook's subagent selection", () => {
    expect(reviewerNamesForLessons([lesson()])).toEqual(["ux_hig_reviewer"]);
    expect(reviewerNamesForLessons([lesson({ classification: "app-specific" })])).toEqual([]);
    expect(reviewerNamesForLessons([lesson({ gateId: "skeleton-before-features" })])).toEqual([]);
  });
});

describe("createExportReport goal authoring", () => {
  async function projectWithOneSteer(): Promise<{ project: string; sessions: string }> {
    const project = await tempDir("farrier-goal-project-");
    const sessions = await tempDir("farrier-goal-sessions-");
    const day = join(sessions, "2026", "07", "22");
    await mkdir(day, { recursive: true });
    await writeFile(
      join(day, "rollout-2026-07-22T08-00-00-aaaa.jsonl"),
      `${[
        JSON.stringify({ timestamp: "2026-07-22T08:00:00.000Z", type: "session_meta", payload: { id: "x", cwd: project, originator: "Codex Desktop", source: "vscode" } }),
        JSON.stringify({ timestamp: "2026-07-22T08:01:00.000Z", type: "event_msg", payload: { type: "user_message", message: "take screenshots of every page", kind: null } })
      ].join("\n")}\n`,
      "utf8"
    );
    return { project, sessions };
  }

  const lessonsJson = JSON.stringify({
    lessons: [{ gateId: "visual-review-multi", classification: "portable", steerIndexes: [0], clusterIndexes: [], rationale: "verbatim demand" }]
  });

  test("a second consented call authors the goal; the report carries it", async () => {
    const { project, sessions } = await projectWithOneSteer();
    const prompts: string[] = [];
    const runner: BackendCommandRunner = async (input) => {
      const prompt = input.stdin ?? "";
      prompts.push(prompt);
      if (prompt.includes("Farrier's goal author")) {
        return { exitCode: 0, stdout: JSON.stringify({ goal: { goalMd: validGoalMd(), condition: "Work per GOAL.md until every check prints fresh." } }), stderr: "" };
      }
      return { exitCode: 0, stdout: lessonsJson, stderr: "" };
    };

    const report = await createExportReport({
      targetDir: project,
      codexSessionsDir: sessions,
      transcriptsDir: join(project, "no-transcripts"),
      sendSessionEvidence: true,
      backend: "claude",
      runner
    });

    expect(prompts).toHaveLength(2);
    // The goal prompt receives the ALREADY-CLASSIFIED lessons, not raw hints.
    expect(prompts[1]).toContain("verbatim demand");
    expect(report.goal?.condition).toContain("Work per GOAL.md");
    expect(report.errors).toEqual([]);
    expect(report.notes.join("\n")).toContain("GOAL.md and its /goal condition were authored");
  });

  test("an invalid authored goal is dropped with the validation reason; export proceeds", async () => {
    const { project, sessions } = await projectWithOneSteer();
    const runner: BackendCommandRunner = async (input) => {
      const prompt = input.stdin ?? "";
      if (prompt.includes("Farrier's goal author")) {
        return { exitCode: 0, stdout: JSON.stringify({ goal: { goalMd: validGoalMd().replace("not_applicable", "skipped"), condition: "Work per GOAL.md." } }), stderr: "" };
      }
      return { exitCode: 0, stdout: lessonsJson, stderr: "" };
    };

    const report = await createExportReport({
      targetDir: project,
      codexSessionsDir: sessions,
      transcriptsDir: join(project, "no-transcripts"),
      sendSessionEvidence: true,
      backend: "claude",
      runner
    });

    expect(report.goal).toBeUndefined();
    expect(report.errors.join("\n")).toContain("not_applicable");
    expect(report.lessons).toHaveLength(1);
  });

  test("without consent no goal call happens and the note says so", async () => {
    const { project, sessions } = await projectWithOneSteer();
    let calls = 0;
    const runner: BackendCommandRunner = async () => {
      calls += 1;
      return { exitCode: 0, stdout: lessonsJson, stderr: "" };
    };

    const report = await createExportReport({
      targetDir: project,
      codexSessionsDir: sessions,
      transcriptsDir: join(project, "no-transcripts"),
      runner
    });

    expect(calls).toBe(0);
    expect(report.goal).toBeUndefined();
    expect(report.notes.join("\n")).toContain("GOAL.md is not emitted without the consented LLM pass");
  });
});
