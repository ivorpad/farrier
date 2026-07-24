import type { AdviceCreationFile } from "./advice-apply";
import type { GoalArtifacts } from "./goal-authoring";

/**
 * Deterministic wrapper around the LLM-authored goal artifacts. GOAL.md is
 * what the agent reads (authored and validated in goal-authoring.ts);
 * README.md is what the human reads — setup, the paste-ready /goal condition,
 * and per-CLI mechanics, which are fixed facts farrier owns, not judgment.
 */

export function renderGoalReadme(condition: string): string {
  return [
    "# Run this export as a goal",
    "",
    "This directory carries a harness exported from a finished project: a playbook skill with gates distilled from real session evidence, review subagents, and `GOAL.md`, the contract an agent works against. `GOAL.md` is what the agent reads; this file is what you read.",
    "",
    "## Setup",
    "",
    "1. Copy these files into the new project's root (the skill trees, `.claude/agents/`, and `GOAL.md`).",
    "2. Write `PRD.md` at the repository root: what you are building, with acceptance criteria.",
    "",
    "## Goal condition (paste after /goal)",
    "",
    "```text",
    condition,
    "```",
    "",
    "## Run",
    "",
    "- Codex: `/goal <condition>` (requires Codex 0.128.0+; thread-scoped, budget-accounted).",
    "- Claude Code: `/goal <condition>` (requires v2.1.139+, an accepted workspace trust dialog, and hooks not disabled via `disableAllHooks`).",
    "- Headless: `claude -p \"/goal <condition>\"` runs the loop to completion; add `--output-format stream-json --verbose` to watch progress.",
    "",
    "`/goal` with no argument shows status; `/goal clear` stops it.",
    ""
  ].join("\n");
}

/** The two goal artifacts, first in the install plan so review starts with them. */
export function goalFiles(artifacts: GoalArtifacts): AdviceCreationFile[] {
  return [
    {
      path: "GOAL.md",
      content: artifacts.goalMd.endsWith("\n") ? artifacts.goalMd : `${artifacts.goalMd}\n`,
      purpose: "The goal contract an agent works against in the next project; LLM-authored from the classified lessons, mechanics validated."
    },
    {
      path: "README.md",
      content: renderGoalReadme(artifacts.condition),
      purpose: "Human instructions: setup, the paste-ready /goal condition, and per-CLI version requirements."
    }
  ];
}
