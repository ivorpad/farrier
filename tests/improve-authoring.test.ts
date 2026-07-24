import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BackendCommandRunner } from "../src/engine/backend";
import {
  authorImproveProposals,
  buildImprovePrompt,
  improveEvidenceSummary,
  snapshotHarness,
  validateImproveProposals,
  type HarnessSnapshot
} from "../src/engine/improve-authoring";
import { mergePreferenceRule, parsePreferenceKb } from "../src/engine/preference-kb";
import type { SessionEvidence } from "../src/engine/session-evidence";

async function tempDir(prefix = "farrier-improve-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function evidence(overrides: Partial<SessionEvidence> = {}): SessionEvidence {
  return {
    projectDir: "/tmp/project",
    steers: [
      { text: "los botones deben usar el design system", sessionRef: "claude:aaaa", date: "2026-07-20", truncated: false },
      { text: "why didnt you use the glass skills", sessionRef: "codex:rollout-bbbb", date: "2026-07-21", truncated: false }
    ],
    failureClusters: [
      {
        class: "work-loop-failure",
        key: "xcodebuild -scheme",
        count: 5,
        sessionCount: 2,
        sessionRefs: ["codex:rollout-bbbb", "codex:rollout-cccc"],
        dates: ["2026-07-21"],
        samples: ["xcodebuild -scheme App build -> error"]
      }
    ],
    skillUsage: [
      { name: "swiftui-pro", invocations: 3, sessions: 2, installed: true, missingSkillMd: false },
      { name: "liquid-glass", invocations: 0, sessions: 0, installed: true, missingSkillMd: false },
      { name: "cua", invocations: 1, sessions: 1, installed: false, missingSkillMd: false }
    ],
    codexSessionsMatched: 2,
    codexSessionsScanned: 3,
    notes: [],
    ...overrides
  };
}

function snapshot(overrides: Partial<HarnessSnapshot> = {}): HarnessSnapshot {
  return {
    agentsMd: "# Project\n\n## Hard Rules\n\n- Never style buttons inline.\n- Use bun for scripts.\n",
    skillDescriptions: { "swiftui-pro": "SwiftUI patterns", "liquid-glass": "Glass effects" },
    subagents: [{ name: "ux-reviewer", description: "Reviews UI consistency" }],
    hookIds: ["large-file-commit-guard"],
    ...overrides
  };
}

describe("snapshotHarness", () => {
  test("reads AGENTS.md, skill descriptions, subagents, and flags the missing manifest", async () => {
    const project = await tempDir();
    await writeFile(join(project, "AGENTS.md"), "# Rules\n\n- keep it small\n", "utf8");
    await writeFile(join(project, "CLAUDE.md"), "See AGENTS.md\n", "utf8");
    await mkdir(join(project, ".agents/skills/swiftui-pro"), { recursive: true });
    await writeFile(
      join(project, ".agents/skills/swiftui-pro/SKILL.md"),
      '---\nname: swiftui-pro\ndescription: "SwiftUI layout patterns"\n---\n\nBody\n',
      "utf8"
    );
    await mkdir(join(project, ".claude/agents"), { recursive: true });
    await writeFile(
      join(project, ".claude/agents/ux-reviewer.md"),
      '---\nname: ux-reviewer\ndescription: "Reviews UI consistency"\n---\n\nCheck the tokens.\n',
      "utf8"
    );
    await mkdir(join(project, ".codex/agents"), { recursive: true });
    await writeFile(
      join(project, ".codex/agents/builder.toml"),
      'name = "builder"\ndescription = "Builds features"\nsandbox_mode = "workspace-write"\n',
      "utf8"
    );

    const snapshotResult = await snapshotHarness(project);
    expect(snapshotResult.agentsMd).toContain("keep it small");
    expect(snapshotResult.claudeMd).toContain("See AGENTS.md");
    expect(snapshotResult.skillDescriptions["swiftui-pro"]).toBe("SwiftUI layout patterns");
    expect(snapshotResult.subagents).toEqual([
      { name: "builder", description: "Builds features" },
      { name: "ux-reviewer", description: "Reviews UI consistency" }
    ]);
    // No manifest: still improvable, just no engine-installed hooks to diff against.
    expect(snapshotResult.hookIds).toEqual([]);
  });
});

describe("buildImprovePrompt", () => {
  test("carries the harness snapshot, evidence indexes, and the optional focus", () => {
    const prompt = buildImprovePrompt({ evidence: evidence(), snapshot: snapshot(), focus: "design consistency" });
    expect(prompt).toContain("Never style buttons inline.");
    expect(prompt).toContain('"design consistency"');
    expect(prompt).toContain("los botones deben usar el design system");
    expect(prompt).toContain("xcodebuild -scheme");
    expect(prompt).toContain('"liquid-glass"');
    expect(prompt).toContain("ux-reviewer");
    expect(prompt).toContain('"proposals": [');
  });

  test("omits the focus line when none is given", () => {
    expect(buildImprovePrompt({ evidence: evidence(), snapshot: snapshot() })).not.toContain("current focus");
  });
});

describe("validateImproveProposals", () => {
  const base = { title: "A title", rationale: "because the steers demand it" };

  test("accepts one proposal of every kind and computes deterministic evidence lines", () => {
    const { proposals, dropped } = validateImproveProposals(
      [
        { ...base, kind: "new-skill", id: "skill-design", steerIndexes: [0], name: "design-system-builder", description: "Build DesignSystem components and tokens from DESIGN_DIRECTION.md before feature work." },
        { ...base, kind: "kb-rule", id: "kb-buttons", steerIndexes: [0], ruleId: "pref-buttons", rule: "All buttons come from DesignSystem components.", tier: "declarative", owner: "ux-reviewer" },
        { ...base, kind: "agents-md-edit", id: "edit-tighten", steerIndexes: [0], edit: { op: "replace", anchor: "- Never style buttons inline.", text: "- Never style buttons or inputs inline; use DesignSystem components." } },
        { ...base, kind: "guard-instance", id: "guard-teardown", clusterIndexes: [0], hookId: "process-teardown-audit", guardsPatch: { processTeardown: { patterns: ["CoreSimulator"], message: "clean up" } } },
        { ...base, kind: "subagent", id: "agent-designer", steerIndexes: [0, 1], skillNames: ["liquid-glass"], name: "design-lead", description: "Owns design direction and DesignSystem components.", instructions: "Read DESIGN_DIRECTION.md, then build tokens and components before any feature work starts.", skills: ["liquid-glass", "swiftui-pro"] },
        { ...base, kind: "skill-rescope", id: "rescope-glass", skillNames: ["liquid-glass"], skill: "liquid-glass", description: "Use whenever styling any iOS 26 surface: glass effects, materials, translucency." },
        { ...base, kind: "prune-skill", id: "prune-glass", skillNames: ["liquid-glass"], skill: "liquid-glass" }
      ],
      evidence(),
      snapshot()
    );
    expect(dropped).toEqual([]);
    expect(proposals).toHaveLength(7);
    expect(proposals[0]!.evidence).toBe("Cites 1 steer(s); across 1 session(s)");
    expect(proposals[3]!.evidence).toBe("Cites 1 failure cluster(s), 5 occurrence(s); across 2 session(s)");
    expect(proposals[6]!.evidence).toBe("Cites skill liquid-glass: 0 invocation(s) in 0 session(s)");
  });

  test("rejects uncited proposals, unknown skills, non-verbatim anchors, and invented hooks", () => {
    const { proposals, dropped } = validateImproveProposals(
      [
        { ...base, kind: "prune-skill", id: "prune-uncited", skill: "liquid-glass" },
        { ...base, kind: "skill-rescope", id: "rescope-missing", skillNames: ["cua"], skill: "cua", description: "cua is invoked but not installed here, so it cannot be re-scoped." },
        { ...base, kind: "agents-md-edit", id: "edit-bad-anchor", steerIndexes: [0], edit: { op: "delete", anchor: "- A rule that never existed." } },
        { ...base, kind: "guard-instance", id: "guard-invented", clusterIndexes: [0], hookId: "my-new-hook", guardsPatch: { myNewHook: {} } },
        { ...base, kind: "subagent", id: "agent-collision", steerIndexes: [0], name: "ux-reviewer", description: "Collides with the existing subagent name.", instructions: "This subagent duplicates an existing name and must be rejected by validation." },
        { ...base, kind: "new-skill", id: "skill-collision", steerIndexes: [0], name: "swiftui-pro", description: "Collides with an installed skill and must be rejected." },
        { ...base, kind: "kb-rule", id: "kb-multiline", steerIndexes: [0], ruleId: "pref-x", rule: "line one\nline two", tier: "declarative" }
      ],
      evidence(),
      snapshot()
    );
    expect(proposals).toEqual([]);
    expect(dropped.map((drop) => drop.id)).toEqual([
      "prune-uncited",
      "rescope-missing",
      "edit-bad-anchor",
      "guard-invented",
      "agent-collision",
      "skill-collision",
      "kb-multiline"
    ]);
    expect(dropped[0]!.reason).toBe("proposal cites no evidence");
    expect(dropped[1]!.reason).toContain("not installed");
    expect(dropped[2]!.reason).toContain("verbatim");
    expect(dropped[3]!.reason).toContain("hookId must be one of");
  });

  test("rejects duplicate ids, ambiguous anchors, and out-of-range indexes", () => {
    const ambiguous = snapshot({ agentsMd: "- same line\n- same line\n" });
    const { proposals, dropped } = validateImproveProposals(
      [
        { ...base, kind: "prune-skill", id: "prune-glass", skillNames: ["liquid-glass"], skill: "liquid-glass" },
        { ...base, kind: "prune-skill", id: "prune-glass", skillNames: ["liquid-glass"], skill: "liquid-glass" },
        { ...base, kind: "agents-md-edit", id: "edit-ambiguous", steerIndexes: [0], edit: { op: "delete", anchor: "- same line" } },
        { ...base, kind: "prune-skill", id: "prune-out-of-range", steerIndexes: [99], skill: "liquid-glass" }
      ],
      evidence(),
      ambiguous
    );
    expect(proposals).toHaveLength(1);
    expect(dropped.map((drop) => drop.reason)).toEqual([
      "duplicate proposal id",
      "edit.anchor occurs 2 times in AGENTS.md; it must be unique",
      "evidence indexes must be integers within the evidence range"
    ]);
  });
});

describe("authorImproveProposals", () => {
  test("sends the diff prompt and validates the returned proposals", async () => {
    const project = await tempDir();
    const prompts: string[] = [];
    const runner: BackendCommandRunner = async (input) => {
      prompts.push(input.stdin ?? "");
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          proposals: [
            {
              kind: "skill-rescope",
              id: "rescope-glass",
              title: "Front-load the liquid-glass triggers",
              rationale: "installed but never invoked",
              skillNames: ["liquid-glass"],
              skill: "liquid-glass",
              description: "Use whenever styling any iOS 26 surface: glass, materials, translucency."
            },
            { kind: "prune-skill", id: "prune-uncited", title: "t", rationale: "r", skill: "liquid-glass" }
          ]
        }),
        stderr: ""
      };
    };

    const result = await authorImproveProposals({
      targetDir: project,
      evidence: evidence(),
      snapshot: snapshot(),
      focus: "skills that never fire",
      backend: "claude",
      runner
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("harness-improvement analyst");
    expect(prompts[0]).toContain("skills that never fire");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.kind).toBe("skill-rescope");
    expect(result.dropped).toEqual([{ id: "prune-uncited", reason: "proposal cites no evidence" }]);
  });
});

describe("preference KB", () => {
  const rule = {
    id: "pref-buttons",
    rule: "All buttons come from DesignSystem components.",
    tier: "declarative" as const,
    owner: "ux-reviewer",
    evidence: ["steer 0"],
    addedAt: "2026-07-24"
  };

  test("starts empty, appends, and replaces by id", () => {
    const first = mergePreferenceRule(undefined, rule);
    expect(parsePreferenceKb(first).rules).toHaveLength(1);
    const updated = mergePreferenceRule(first, { ...rule, rule: "All buttons and inputs come from DesignSystem." });
    const kb = parsePreferenceKb(updated);
    expect(kb.rules).toHaveLength(1);
    expect(kb.rules[0]!.rule).toContain("and inputs");
    const second = mergePreferenceRule(updated, { ...rule, id: "pref-spacing" });
    expect(parsePreferenceKb(second).rules.map((entry) => entry.id)).toEqual(["pref-buttons", "pref-spacing"]);
  });

  test("refuses to overwrite a malformed KB file", () => {
    expect(() => mergePreferenceRule("not json", rule)).toThrow("not valid JSON");
    expect(() => mergePreferenceRule('{"version":2,"rules":[]}', rule)).toThrow("preference KB format");
    const duplicated = JSON.stringify({ version: 1, rules: [rule, rule] });
    expect(() => mergePreferenceRule(duplicated, { ...rule, rule: "updated" })).toThrow("duplicate rule ids");
  });
});
