import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildExportProposal,
  createExportReport,
  defaultPlaybookName,
  hintLessons,
  validateExportLesson,
  type LessonValidationContext
} from "../src/engine/export-harness";
import { annotateSessionEvidence, seedGateCatalog } from "../src/engine/gate-catalog";
import { buildPlaybookProposal, type ExportLesson } from "../src/engine/export-playbook";
import type { SessionEvidence } from "../src/engine/session-evidence";
import type { BackendCommandRunner } from "../src/engine/backend";

async function tempDir(prefix = "farrier-export-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function evidence(overrides: Partial<SessionEvidence> = {}): SessionEvidence {
  return {
    projectDir: "/tmp/walkledger",
    steers: [
      { text: "the UI is stupidly shitty as you haven't used any of the skills", sessionRef: "codex:a", date: "2026-07-22", truncated: false },
      { text: "take screenshots of every single page and have reviewers critique them", sessionRef: "codex:b", date: "2026-07-23", truncated: false },
      { text: "when i invoke the skill is coz im ready. no questpns asked", sessionRef: "codex:b", date: "2026-07-23", truncated: false }
    ],
    failureClusters: [
      {
        class: "work-loop-failure",
        key: "xcodebuild -scheme",
        count: 239,
        sessionCount: 1,
        dates: ["2026-07-22"],
        sessionRefs: ["codex:a"],
        samples: ["xcodebuild -scheme App build — error opening '~/.cache/clang/ModuleCache/x' for output: Operation not permitted"]
      }
    ],
    skillUsage: [],
    codexSessionsMatched: 2,
    codexSessionsScanned: 2,
    notes: [],
    ...overrides
  };
}

function context(overrides: Partial<LessonValidationContext> = {}): LessonValidationContext {
  return {
    catalogIds: new Set(seedGateCatalog.map((entry) => entry.id)),
    steerCount: 3,
    clusterCount: 1,
    seenGateIds: new Set(),
    ...overrides
  };
}

describe("validateExportLesson", () => {
  test("accepts a catalog match and rejects unknown gates, bad indexes, and evidence-free lessons", () => {
    const good = validateExportLesson(
      { gateId: "visual-review-multi", classification: "portable", steerIndexes: [1], clusterIndexes: [], rationale: "user demanded screenshot review" },
      context()
    );
    expect(good.ok).toBe(true);

    expect(validateExportLesson({ gateId: "invented-gate", classification: "portable", steerIndexes: [0] }, context()).ok).toBe(false);
    expect(validateExportLesson({ gateId: "visual-review-multi", classification: "portable", steerIndexes: [99] }, context()).ok).toBe(false);
    expect(validateExportLesson({ gateId: "visual-review-multi", classification: "portable", steerIndexes: [], clusterIndexes: [] }, context()).ok).toBe(false);
    expect(validateExportLesson({ gateId: "visual-review-multi", classification: "sometimes", steerIndexes: [0] }, context()).ok).toBe(false);
  });

  test("proposedGate entries must be kebab-case, complete, and non-colliding", () => {
    const proposed = validateExportLesson(
      {
        proposedGate: { id: "migrations-reviewed", portable: "p", binding: "b", symptom: "s" },
        classification: "portable",
        steerIndexes: [0],
        rationale: "no catalog entry covers this"
      },
      context()
    );
    expect(proposed.ok).toBe(true);
    if (proposed.ok) expect(proposed.lesson.proposedGate?.id).toBe("migrations-reviewed");

    const colliding = validateExportLesson(
      { proposedGate: { id: "name-preflight", portable: "p", binding: "b", symptom: "s" }, classification: "portable", steerIndexes: [0] },
      context()
    );
    expect(colliding.ok).toBe(false);

    const incomplete = validateExportLesson(
      { proposedGate: { id: "new-gate", portable: "p", binding: "b" }, classification: "portable", steerIndexes: [0] },
      context()
    );
    expect(incomplete.ok).toBe(false);
  });

  test("duplicate lessons for the same gate are dropped", () => {
    const shared = context();
    const first = validateExportLesson({ gateId: "device-verification", classification: "portable", steerIndexes: [0] }, shared);
    expect(first.ok).toBe(true);
    shared.seenGateIds.add("device-verification");
    const second = validateExportLesson({ gateId: "device-verification", classification: "portable", steerIndexes: [1] }, shared);
    expect(second.ok).toBe(false);
  });
});

describe("hintLessons", () => {
  test("builds catalog-ordered lessons from signature hints, labeled as hints", () => {
    const annotated = annotateSessionEvidence(evidence());
    const lessons = hintLessons(annotated);
    const ids = lessons.map((lesson) => lesson.gateId);

    expect(ids).toContain("skeleton-before-features");
    expect(ids).toContain("visual-review-multi");
    expect(ids).toContain("execute-dont-interrogate");
    expect(ids).toContain("one-capability-per-change");
    for (const lesson of lessons) {
      expect(lesson.source).toBe("hints");
      expect(lesson.steerIndexes.length + lesson.clusterIndexes.length).toBeGreaterThan(0);
    }
    // Catalog order is preserved.
    const orders = ids.map((id) => seedGateCatalog.find((entry) => entry.id === id)!.order);
    expect([...orders].sort((left, right) => left - right)).toEqual(orders);
  });
});

describe("buildPlaybookProposal", () => {
  test("assembles orchestrator, gates.md with evidence, and the visual-review subagent", async () => {
    const annotated = annotateSessionEvidence(evidence());
    const lessons = hintLessons(annotated);
    const proposal = await buildPlaybookProposal({
      projectDir: "/tmp/walkledger",
      playbookName: "walkledger-playbook",
      lessons,
      annotated,
      catalog: seedGateCatalog,
      agents: ["claude", "codex"]
    });

    const paths = proposal.files.map((file) => file.path);
    expect(paths).toContain(".agents/skills/walkledger-playbook/SKILL.md");
    expect(paths).toContain(".agents/skills/walkledger-playbook/references/gates.md");
    expect(paths).toContain(".agents/skills/walkledger-playbook/agents/ux_hig_reviewer.toml");
    expect(paths).toContain(".claude/skills/walkledger-playbook/SKILL.md");
    expect(paths).toContain(".claude/agents/ux-hig-reviewer.md");

    const skillMd = proposal.files.find((file) => file.path === ".agents/skills/walkledger-playbook/SKILL.md")!.content;
    expect(skillMd).toContain("## Operating style (earned, do not regress)");
    expect(skillMd).toContain("no questpns asked");
    expect(skillMd).toContain("## Phases and gates");
    expect(skillMd).toContain("skeleton-before-features");
    // Evidence dates come from the mined evidence, never a wall clock.
    expect(skillMd).toContain("2026-07-22 to 2026-07-23");

    const gatesMd = proposal.files.find((file) => file.path === ".agents/skills/walkledger-playbook/references/gates.md")!.content;
    expect(gatesMd).toContain("## visual-review-multi");
    expect(gatesMd).toContain("Evidence from this project:");
    expect(gatesMd).toContain("`xcodebuild -scheme` 239× across 1 session(s)");
  });

  test("with an authored goal the proposal leads with GOAL.md as the driver; without one it doesn't", async () => {
    const annotated = annotateSessionEvidence(evidence());
    const base = {
      projectDir: "/tmp/walkledger",
      playbookName: "walkledger-playbook",
      evidence: evidence(),
      annotated,
      lessons: hintLessons(annotated),
      droppedLessons: [],
      llmClassified: true,
      notes: [],
      errors: []
    };

    const withGoal = await buildExportProposal(
      { ...base, goal: { goalMd: "# contract\n## 1.\n## 2.\n## 3.\n## 4.\n## 5.\n## 6.\n", condition: "Work per GOAL.md until every check prints." } },
      { agents: ["claude", "codex"] }
    );
    expect(withGoal.files[0]!.path).toBe("GOAL.md");
    expect(withGoal.files[1]!.path).toBe("README.md");
    expect(withGoal.summary).toContain("runnable as a /goal");
    const readme = withGoal.files[1]!.content;
    expect(readme).toContain("Work per GOAL.md until every check prints.");
    expect(readme).toContain("Codex 0.128.0+");
    expect(readme).toContain("v2.1.139+");

    const withoutGoal = await buildExportProposal(base, { agents: ["claude", "codex"] });
    expect(withoutGoal.files.some((file) => file.path === "GOAL.md")).toBe(false);
    expect(withoutGoal.summary).not.toContain("/goal");
  });

  test("includeInvokedSkills copies invoked skills per agent root; zero-invoked and symlinked skills stay out", async () => {
    const project = await tempDir("farrier-export-project-");
    await mkdir(join(project, ".agents/skills/swiftui-pro/references"), { recursive: true });
    await writeFile(join(project, ".agents/skills/swiftui-pro/SKILL.md"), "---\nname: swiftui-pro\ndescription: x\n---\n\nBody\n", "utf8");
    await writeFile(join(project, ".agents/skills/swiftui-pro/references/notes.md"), "notes\n", "utf8");
    await mkdir(join(project, ".agents/skills/liquid-glass"), { recursive: true });
    await writeFile(join(project, ".agents/skills/liquid-glass/SKILL.md"), "---\nname: liquid-glass\n---\n", "utf8");

    const annotated = annotateSessionEvidence(evidence());
    const report = {
      projectDir: project,
      playbookName: "walkledger-playbook",
      evidence: evidence({
        projectDir: project,
        skillUsage: [
          { name: "swiftui-pro", invocations: 2, sessions: 1, installed: true, missingSkillMd: false },
          { name: "liquid-glass", invocations: 0, sessions: 0, installed: true, missingSkillMd: false }
        ]
      }),
      annotated,
      lessons: hintLessons(annotated),
      droppedLessons: [],
      llmClassified: false,
      notes: [],
      errors: []
    };

    const proposal = await buildExportProposal(report, { agents: ["claude", "codex"], includeInvokedSkills: true });
    const paths = proposal.files.map((file) => file.path);
    expect(paths).toContain(".agents/skills/swiftui-pro/SKILL.md");
    expect(paths).toContain(".claude/skills/swiftui-pro/SKILL.md");
    expect(paths).toContain(".agents/skills/swiftui-pro/references/notes.md");
    expect(paths.some((path) => path.includes("liquid-glass"))).toBe(false);
    expect(proposal.summary).toContain("Copies 1 invoked skill(s): swiftui-pro.");

    const withoutToggle = await buildExportProposal(report, { agents: ["claude", "codex"] });
    expect(withoutToggle.files.some((file) => file.path.includes("swiftui-pro"))).toBe(false);
  });

  test("app-specific lessons and excluded gates stay out; proposed gates ship marked", async () => {
    const annotated = annotateSessionEvidence(evidence());
    const lessons: ExportLesson[] = [
      { gateId: "visual-review-multi", classification: "portable", steerIndexes: [1], clusterIndexes: [], rationale: "r", source: "llm" },
      { gateId: "name-preflight", classification: "app-specific", steerIndexes: [0], clusterIndexes: [], rationale: "tied to this app", source: "llm" },
      {
        gateId: "migrations-reviewed",
        classification: "portable",
        steerIndexes: [2],
        clusterIndexes: [],
        rationale: "new",
        proposedGate: { id: "migrations-reviewed", portable: "p", binding: "b", symptom: "s" },
        source: "llm"
      }
    ];
    const proposal = await buildPlaybookProposal({
      projectDir: "/tmp/walkledger",
      playbookName: "walkledger-playbook",
      lessons,
      annotated,
      catalog: seedGateCatalog,
      agents: ["codex"]
    });

    const gatesMd = proposal.files.find((file) => file.path.endsWith("references/gates.md"))!.content;
    expect(gatesMd).toContain("## visual-review-multi");
    expect(gatesMd).not.toContain("## name-preflight");
    expect(gatesMd).toContain("## migrations-reviewed (PROPOSED");
    expect(proposal.proposedGateIds).toEqual(["migrations-reviewed"]);
  });
});

describe("model-authored exit checks", () => {
  test("valid rules ride the lesson into gates.json and the SKILL.md exit-check line", async () => {
    const annotated = annotateSessionEvidence(evidence());
    const lessons: ExportLesson[] = [
      {
        gateId: "evidence-before-complete",
        classification: "portable",
        steerIndexes: [0],
        clusterIndexes: [],
        rationale: "ledger discipline",
        exitChecks: [{ kind: "file-exists", path: "EVIDENCE_LEDGER.csv" }],
        source: "llm"
      },
      { gateId: "device-verification", classification: "portable", steerIndexes: [1], clusterIndexes: [], rationale: "r", source: "llm" }
    ];
    const proposal = await buildPlaybookProposal({
      projectDir: "/tmp/walkledger",
      playbookName: "walkledger-playbook",
      lessons,
      annotated,
      catalog: seedGateCatalog,
      agents: ["codex"]
    });

    const gatesJson = JSON.parse(proposal.files.find((file) => file.path.endsWith("gates/gates.json"))!.content);
    // Every selected gate is listed; the rule-less one reports SKIP at runtime.
    expect(gatesJson.gates.map((gate: { gateId: string }) => gate.gateId)).toEqual([
      "device-verification",
      "evidence-before-complete"
    ]);
    expect(gatesJson.gates[1].rules).toEqual([{ kind: "file-exists", path: "EVIDENCE_LEDGER.csv" }]);
    expect(gatesJson.gates[0].rules).toEqual([]);

    const skillMd = proposal.files.find((file) => file.path.endsWith("walkledger-playbook/SKILL.md"))!.content;
    expect(skillMd).toContain("`python3 gates/check.py evidence-before-complete`");
    expect(skillMd).not.toContain("`python3 gates/check.py device-verification`");
    expect(proposal.summary).toContain("1 with deterministic exit checks");
    expect(proposal.files.some((file) => file.path.endsWith("gates/check.py"))).toBe(true);
  });

  test("unsafe or malformed rules are dropped individually and the lesson survives", () => {
    const shared = context();
    const result = validateExportLesson(
      {
        gateId: "evidence-before-complete",
        classification: "portable",
        steerIndexes: [0],
        exitChecks: [
          { kind: "file-exists", path: "../outside.md" },
          { kind: "file-exists", path: "/etc/passwd" },
          { kind: "glob-min", pattern: "artifacts/**/*.png", min: 0 },
          { kind: "file-contains", path: "LEDGER.csv", pattern: "(" },
          { kind: "run-script", path: "x.sh" },
          { kind: "file-exists", path: "LEDGER.csv" }
        ]
      },
      shared
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.lesson.exitChecks).toEqual([{ kind: "file-exists", path: "LEDGER.csv" }]);
    expect(result.checkDrops).toHaveLength(5);
  });

  test("the rendered checker script passes and fails against real files", async () => {
    const repo = await tempDir("farrier-gates-repo-");
    const annotated = annotateSessionEvidence(evidence());
    const proposal = await buildPlaybookProposal({
      projectDir: repo,
      playbookName: "walkledger-playbook",
      lessons: [{
        gateId: "evidence-before-complete",
        classification: "portable",
        steerIndexes: [0],
        clusterIndexes: [],
        rationale: "r",
        exitChecks: [
          { kind: "file-exists", path: "EVIDENCE_LEDGER.csv" },
          { kind: "glob-min", pattern: "shots/**/*.png", min: 2 },
          { kind: "file-contains", path: "EVIDENCE_LEDGER.csv", pattern: "feature," }
        ],
        source: "llm"
      }],
      annotated,
      catalog: seedGateCatalog,
      agents: ["codex"]
    });

    // Install the gates directory into a temp repo (no git; checker falls back to cwd).
    for (const file of proposal.files) {
      if (!file.path.includes("/gates/")) continue;
      const target = join(repo, file.path);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
    const checker = join(repo, ".agents/skills/walkledger-playbook/gates/check.py");

    const failing = Bun.spawnSync(["python3", checker], { cwd: repo });
    expect(failing.exitCode).toBe(1);
    expect(failing.stdout.toString()).toContain("FAIL evidence-before-complete: file-exists EVIDENCE_LEDGER.csv");

    await writeFile(join(repo, "EVIDENCE_LEDGER.csv"), "feature,evidence,timestamp\n", "utf8");
    await mkdir(join(repo, "shots", "a"), { recursive: true });
    await writeFile(join(repo, "shots", "a", "one.png"), "x", "utf8");
    await writeFile(join(repo, "shots", "a", "two.png"), "x", "utf8");

    const passing = Bun.spawnSync(["python3", checker], { cwd: repo });
    expect(passing.stdout.toString()).toContain("PASS evidence-before-complete: glob-min shots/**/*.png >= 2 (found 2)");
    expect(passing.exitCode).toBe(0);

    const unknown = Bun.spawnSync(["python3", checker, "not-a-gate"], { cwd: repo });
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stdout.toString()).toContain("UNKNOWN gate id(s): not-a-gate");
  });
});

describe("createExportReport", () => {
  test("without consent it stays local with hint lessons and says why", async () => {
    const project = await tempDir("farrier-export-project-");
    const report = await createExportReport({
      targetDir: project,
      codexSessionsDir: join(project, "no-sessions"),
      transcriptsDir: join(project, "no-transcripts")
    });

    expect(report.llmClassified).toBe(false);
    expect(report.playbookName).toBe(defaultPlaybookName(project));
    expect(report.notes.some((note) => note.includes("explicit consent"))).toBe(true);
  });

  test("with consent a stub backend classifies lessons and invalid ones are dropped with reasons", async () => {
    const project = await tempDir("farrier-export-project-");
    const sessions = await tempDir("farrier-export-sessions-");
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

    const runner: BackendCommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        lessons: [
          { gateId: "visual-review-multi", classification: "portable", steerIndexes: [0], clusterIndexes: [], rationale: "verbatim demand" },
          { gateId: "not-a-gate", classification: "portable", steerIndexes: [0] }
        ]
      }),
      stderr: ""
    });

    const report = await createExportReport({
      targetDir: project,
      codexSessionsDir: sessions,
      transcriptsDir: join(project, "no-transcripts"),
      sendSessionEvidence: true,
      backend: "claude",
      runner
    });

    expect(report.llmClassified).toBe(true);
    expect(report.lessons.map((lesson) => lesson.gateId)).toEqual(["visual-review-multi"]);
    expect(report.lessons[0]!.source).toBe("llm");
    expect(report.droppedLessons).toEqual([
      { gateId: "not-a-gate", reason: "gateId is not in the catalog; use proposedGate for new entries" }
    ]);
    expect(report.notes.some((note) => note.includes("with your consent"))).toBe(true);
  });

  test("a failing backend falls back to hints and records the error", async () => {
    const project = await tempDir("farrier-export-project-");
    const runner: BackendCommandRunner = async () => ({ exitCode: 1, stdout: "", stderr: "boom" });

    const report = await createExportReport({
      targetDir: project,
      codexSessionsDir: join(project, "no-sessions"),
      transcriptsDir: join(project, "no-transcripts"),
      sendSessionEvidence: true,
      backend: "claude",
      runner
    });

    expect(report.llmClassified).toBe(false);
    expect(report.errors.some((error) => error.includes("fell back to signature hints"))).toBe(true);
  });

  test("buildExportProposal renders only for the requested agents", async () => {
    const project = await tempDir("farrier-export-project-");
    const report = await createExportReport({
      targetDir: project,
      codexSessionsDir: join(project, "no-sessions"),
      transcriptsDir: join(project, "no-transcripts")
    });
    const withLessons = {
      ...report,
      lessons: [
        { gateId: "visual-review-multi", classification: "portable" as const, steerIndexes: [], clusterIndexes: [], rationale: "r", source: "hints" as const }
      ]
    };
    // A lesson with no evidence indexes cannot come from validation, but the
    // builder still renders it; evidence lines are simply absent.
    const proposal = await buildExportProposal(withLessons, { agents: ["codex"] });
    // No authored goal on this report, so no root-level goal artifacts either.
    expect(proposal.files.every((file) => file.path.startsWith(".agents/"))).toBe(true);
  });
});
