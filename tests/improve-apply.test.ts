import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyAgentsMdEdit,
  applyImprovePlan,
  deleteAnchoredText,
  planImproveProposal,
  withSkillDescription
} from "../src/engine/improve-apply";
import type { ImproveProposal } from "../src/engine/improve-authoring";
import { parsePreferenceKb, preferenceKbPath } from "../src/engine/preference-kb";

async function tempDir(prefix = "farrier-improve-apply-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

const citations = { steerIndexes: [0], clusterIndexes: [], skillNames: [] };
const base = { title: "A title", rationale: "why", citations, evidence: "Cites 1 steer(s)" };

describe("applyAgentsMdEdit", () => {
  const content = "# Project\n\n## Hard Rules\n\n- Never style buttons inline.\n- Use bun for scripts.\n";

  test("replaces and deletes anchored text", () => {
    expect(applyAgentsMdEdit(content, { op: "replace", anchor: "- Never style buttons inline.", text: "- Never style buttons or inputs inline." }))
      .toContain("- Never style buttons or inputs inline.");
    const deleted = applyAgentsMdEdit(content, { op: "delete", anchor: "- Use bun for scripts.\n" });
    expect(deleted).not.toContain("Use bun");
    expect(deleted).not.toContain("\n\n\n");
  });

  test("keeps $-patterns in model-authored replacement text literal", () => {
    const edited = applyAgentsMdEdit(content, {
      op: "replace",
      anchor: "- Use bun for scripts.",
      text: '- Always quote "$@" and $$PID and $& too.'
    });
    expect(edited).toContain('- Always quote "$@" and $$PID and $& too.');
  });

  test("matches anchors against the repo-map-stripped text the analysis saw", () => {
    const withMap = `${content}\n<!-- farrier:repo-map:begin -->\n- Use bun for scripts.\n<!-- farrier:repo-map:end -->\n`;
    // The duplicate inside the generated region must not make the anchor ambiguous.
    const edited = applyAgentsMdEdit(withMap, { op: "replace", anchor: "- Use bun for scripts.", text: "- Use bun everywhere." });
    expect(edited).toContain("- Use bun everywhere.");
    expect(edited).toContain("farrier:repo-map:begin");
  });

  test("refuses when the anchor drifted since the analysis", () => {
    expect(() => applyAgentsMdEdit(content, { op: "delete", anchor: "- Gone rule." })).toThrow("no longer present");
    expect(() => applyAgentsMdEdit("- dup\n- dup\n", { op: "delete", anchor: "- dup" })).toThrow("no longer unique");
  });

  test("deleteAnchoredText collapses the gap a whole-line deletion leaves", () => {
    expect(deleteAnchoredText("a\n\nremove me\n\nb\n", "remove me\n")).toBe("a\n\nb\n");
  });
});

describe("withSkillDescription", () => {
  test("replaces a single-line description", () => {
    const updated = withSkillDescription('---\nname: x\ndescription: "old"\n---\n\nBody\n', "Use whenever styling glass.");
    expect(updated).toContain('description: Use whenever styling glass.');
    expect(updated).toContain("Body");
  });

  test("removes block-scalar continuation lines and inserts when missing", () => {
    const folded = "---\nname: x\ndescription: >-\n  old line one\n  old line two\nallowed-tools: Bash\n---\n\nBody\n";
    const updated = withSkillDescription(folded, "New triggers first.");
    expect(updated).toContain('description: New triggers first.');
    expect(updated).not.toContain("old line two");
    expect(updated).toContain("allowed-tools: Bash");
    const missing = withSkillDescription("---\nname: x\n---\n\nBody\n", "Added.");
    expect(missing).toContain('description: Added.');
    expect(withSkillDescription("no frontmatter", "x")).toBeUndefined();
  });

  test("a SKILL.md without a trailing newline round-trips without duplicating itself", () => {
    const updated = withSkillDescription("---\nname: x\ndescription: old\n---", "New triggers.");
    expect(updated).toBe("---\nname: x\ndescription: New triggers.\n---\n");
  });
});

describe("planImproveProposal", () => {
  test("new-skill hands off to the skill flow; prune stays advisory with locations", async () => {
    const project = await tempDir();
    await mkdir(join(project, ".agents/skills/liquid-glass"), { recursive: true });

    const skill = await planImproveProposal({
      targetDir: project,
      proposal: { ...base, kind: "new-skill", id: "skill-x", name: "design-system-builder", description: "Build tokens." }
    });
    expect(skill).toMatchObject({ kind: "skill", query: "design-system-builder: Build tokens." });

    const prune = await planImproveProposal({
      targetDir: project,
      proposal: { ...base, kind: "prune-skill", id: "prune-x", skill: "liquid-glass" }
    });
    expect(prune.kind).toBe("advisory");
    if (prune.kind === "advisory") {
      expect(prune.message).toContain(".agents/skills/liquid-glass");
      expect(prune.message).toContain("never deletes");
    }
  });

  test("kb-rule plans the preference KB file and applies atomically", async () => {
    const project = await tempDir();
    const proposal: ImproveProposal = {
      ...base,
      kind: "kb-rule",
      id: "kb-buttons",
      ruleId: "pref-buttons",
      rule: "All buttons come from DesignSystem components.",
      tier: "declarative",
      owner: "ux-reviewer"
    };
    const planned = await planImproveProposal({ targetDir: project, proposal, now: new Date("2026-07-24T12:00:00Z") });
    expect(planned.kind).toBe("files");
    if (planned.kind !== "files") return;
    expect(planned.plan.files[0]!.path).toBe(preferenceKbPath);
    await applyImprovePlan(project, planned.plan, false);
    const kb = parsePreferenceKb(await readFile(join(project, preferenceKbPath), "utf8"));
    expect(kb.rules).toEqual([{
      id: "pref-buttons",
      rule: "All buttons come from DesignSystem components.",
      tier: "declarative",
      owner: "ux-reviewer",
      evidence: ["steer 0", "Cites 1 steer(s)"],
      addedAt: "2026-07-24"
    }]);
  });

  test("agents-md-edit plans the exact rewritten AGENTS.md", async () => {
    const project = await tempDir();
    await writeFile(join(project, "AGENTS.md"), "## Hard Rules\n\n- Old rule.\n", "utf8");
    const planned = await planImproveProposal({
      targetDir: project,
      proposal: { ...base, kind: "agents-md-edit", id: "edit-x", edit: { op: "replace", anchor: "- Old rule.", text: "- Tightened rule." } }
    });
    expect(planned.kind).toBe("files");
    if (planned.kind !== "files") return;
    expect(planned.plan.files[0]!.content).toContain("- Tightened rule.");
    expect(planned.inspection.files[0]!.action).toBe("replace");
  });

  test("agents-md add-rule routes through the shared rules-line planner", async () => {
    const project = await tempDir();
    await writeFile(join(project, "AGENTS.md"), "## Hard Rules\n\n- Old rule.\n", "utf8");
    const planned = await planImproveProposal({
      targetDir: project,
      proposal: { ...base, kind: "agents-md-edit", id: "edit-add", edit: { op: "add-rule", text: "Sizes and spacing come from tokens." } }
    });
    expect(planned.kind).toBe("files");
    if (planned.kind !== "files") return;
    expect(planned.plan.files[0]!.path).toBe("AGENTS.md");
    expect(planned.plan.files[0]!.content).toContain("- Old rule.");
    expect(planned.plan.files[0]!.content).toContain("- Sizes and spacing come from tokens.");
  });

  test("subagent plans both agent formats with scoped skills", async () => {
    const project = await tempDir();
    const planned = await planImproveProposal({
      targetDir: project,
      proposal: {
        ...base,
        kind: "subagent",
        id: "agent-x",
        name: "design-lead",
        description: "Owns the design direction.",
        instructions: "Read DESIGN_DIRECTION.md and build DesignSystem components before features.",
        skills: ["liquid-glass"]
      }
    });
    expect(planned.kind).toBe("files");
    if (planned.kind !== "files") return;
    const paths = planned.plan.files.map((file) => file.path);
    expect(paths).toEqual([".claude/agents/design-lead.md", ".codex/agents/design-lead.toml"]);
    expect(planned.plan.files[0]!.content).toContain("skills:\n  - liquid-glass");
    expect(planned.plan.files[1]!.content).toContain("[[skills.config]]");
    expect(planned.plan.files[1]!.content).toContain('path = ".agents/skills/liquid-glass"');
  });

  test("skill-rescope rewrites every installed SKILL.md and skips matching ones", async () => {
    const project = await tempDir();
    for (const root of [".agents/skills", ".claude/skills"]) {
      await mkdir(join(project, root, "liquid-glass"), { recursive: true });
      await writeFile(join(project, root, "liquid-glass", "SKILL.md"), '---\nname: liquid-glass\ndescription: "old"\n---\n\nBody\n', "utf8");
    }
    const planned = await planImproveProposal({
      targetDir: project,
      proposal: { ...base, kind: "skill-rescope", id: "rescope-x", skill: "liquid-glass", description: "Use whenever styling any iOS 26 surface" }
    });
    expect(planned.kind).toBe("files");
    if (planned.kind !== "files") return;
    expect(planned.plan.files.map((file) => file.path)).toEqual([
      ".agents/skills/liquid-glass/SKILL.md",
      ".claude/skills/liquid-glass/SKILL.md"
    ]);
    await applyImprovePlan(project, planned.plan, true);
    expect(await readFile(join(project, ".agents/skills/liquid-glass/SKILL.md"), "utf8"))
      .toContain("description: Use whenever styling any iOS 26 surface");

    await expect(planImproveProposal({
      targetDir: project,
      proposal: { ...base, kind: "skill-rescope", id: "rescope-again", skill: "liquid-glass", description: "Use whenever styling any iOS 26 surface" }
    })).rejects.toThrow("already matches");
  });

  test("guard-instance refuses without a manifest (farrier bookkeeping required)", async () => {
    const project = await tempDir();
    await expect(planImproveProposal({
      targetDir: project,
      proposal: {
        ...base,
        kind: "guard-instance",
        id: "guard-x",
        hookId: "process-teardown-audit",
        guardsPatch: { processTeardown: { patterns: ["CoreSimulator"], message: "clean up" } }
      }
    })).rejects.toThrow();
  });
});
