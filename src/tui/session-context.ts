import type { StartupAgentChoice, StartupModelChoices } from "../config/startup-choice";
import type { AgentDetectionInventory } from "../engine/agent-detection";
import type { EnforcementAgent } from "../engine/agent-selection";
import type { AgentBackend } from "../engine/backend";
import type { LauncherContext, LauncherRowNotes } from "./launcher";

/**
 * The confirmed startup pick, threaded explicitly from the startup screen
 * through the launcher loop into each workflow (no globals). Two distinct
 * concepts ride here and must not be conflated:
 *
 * - `agents`: which agents the generated harness binds hooks and skills for.
 *   The pick seeds the create wizard's Agent step and the skill-creation
 *   agent default; the user can still change both there.
 * - `backend` + `models`: which installed CLI (and model) farrier itself runs
 *   for its own LLM work this session (advise, refinement, skill authoring).
 *
 * Session mining is deliberately NOT narrowed by this pick: learn and advise
 * evidence readers keep reading BOTH Claude transcripts and Codex rollouts.
 * Mining is local counting, more evidence is strictly better, and the mined
 * source notes state both counts. The pick governs which CLI farrier runs
 * and which defaults it seeds, not which local evidence it may read.
 */
export type SessionAgentContext = {
  choice: StartupAgentChoice;
  agents: EnforcementAgent[];
  backend?: AgentBackend;
  models: StartupModelChoices;
  detection: AgentDetectionInventory;
};

const agentsByChoice: Record<StartupAgentChoice, EnforcementAgent[]> = {
  claude: ["claude"],
  codex: ["codex"],
  both: ["claude", "codex"],
  none: []
};

/**
 * farrier's own backend must actually be runnable here: the chosen agent when
 * installed; for "Both", Claude Code first (the order advise already uses).
 * A chosen-but-not-installed agent yields no backend rather than silently
 * substituting the other one: the user said which agent they work with.
 */
export function sessionAgentContext(input: {
  choice: StartupAgentChoice;
  models: StartupModelChoices;
  detection: AgentDetectionInventory;
}): SessionAgentContext {
  const candidates: AgentBackend[] =
    input.choice === "claude" ? ["claude"] : input.choice === "codex" ? ["codex"] : input.choice === "both" ? ["claude", "codex"] : [];
  const backend = candidates.find((agent) => input.detection[agent].installed);

  return {
    choice: input.choice,
    agents: [...agentsByChoice[input.choice]],
    ...(backend !== undefined ? { backend } : {}),
    models: { ...input.models },
    detection: input.detection
  };
}

function agentProductName(backend: AgentBackend): string {
  return backend === "claude" ? "Claude Code" : "Codex";
}

export function launcherSessionView(context: SessionAgentContext): LauncherContext {
  const neitherInstalled = !context.detection.claude.installed && !context.detection.codex.installed;

  const rowNotes: LauncherRowNotes = neitherInstalled
    ? {
        advise: "needs Claude Code or Codex installed",
        create: "authoring needs Claude Code or Codex installed"
      }
    : {};

  if (context.choice === "none") {
    return {
      statusLine: "No working agent selected. Create harness, Learn, and Doctor run without one.",
      rowNotes
    };
  }

  const label =
    context.choice === "both"
      ? "Claude Code + Codex"
      : agentProductName(context.choice === "claude" ? "claude" : "codex");
  const modelParts = (["claude", "codex"] as const)
    .filter((backend) => context.models[backend] && agentsByChoice[context.choice].includes(backend))
    .map((backend) => `${backend} model ${context.models[backend]}`);
  const missing = agentsByChoice[context.choice].filter((agent) => !context.detection[agent].installed);
  const missingPart = missing.length > 0 ? ` (${missing.map(agentProductName).join(" and ")} not installed here)` : "";

  return {
    statusLine: `Working with ${label}${modelParts.length > 0 ? ` · ${modelParts.join(" · ")}` : ""}${missingPart}`,
    rowNotes
  };
}
