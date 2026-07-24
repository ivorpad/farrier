import { homedir } from "node:os";
import { join } from "node:path";
import { enforcementAgentOrder, normalizeAgents, type EnforcementAgent } from "./agent-selection";
import type { AgentBackend } from "./backend";

export type SkillAgent = AgentBackend;

const defaultCreatorRefs: Record<SkillAgent, string | undefined> = {
  claude: "anthropics/skills@skill-creator",
  codex: undefined,
};

const creatorRefEnvVars: Record<SkillAgent, string> = {
  claude: "FARRIER_CREATOR_CLAUDE",
  codex: "FARRIER_CREATOR_CODEX",
};

export function creatorRef(agent: SkillAgent): string | undefined {
  const override = process.env[creatorRefEnvVars[agent]];
  return override !== undefined && override.trim() !== "" ? override : defaultCreatorRefs[agent];
}

export const skillsCliAgentIds: Record<SkillAgent, string> = {
  claude: "claude-code",
  codex: "codex",
};

/**
 * The `skills` CLI `-a` agent list for a harness. Normally skills install only
 * for the enforcement agents the harness targets; when a single agent is
 * targeted and the user opts to share, both agents are included.
 */
export function skillInstallAgentIds(agents: readonly EnforcementAgent[], shareSkillsWithOtherAgent: boolean): string[] {
  const effective = agents.length === 1 && shareSkillsWithOtherAgent ? enforcementAgentOrder : agents;
  return normalizeAgents(effective).map((agent) => skillsCliAgentIds[agent]);
}

export const nativeSkillRoots: Record<SkillAgent, string> = {
  claude: ".claude/skills",
  codex: ".agents/skills",
};

export const canonicalSkillRoot = "skills";

/** Every root a project skill may live under; order matters (first root wins). */
export const projectSkillRoots = [canonicalSkillRoot, nativeSkillRoots.codex, nativeSkillRoots.claude] as const;

export function resolvedHomedir(): string {
  return process.env.HOME || homedir();
}

export function globalSkillRoot(agent: SkillAgent): string {
  const dir = agent === "claude" ? ".claude" : ".codex";
  return join(resolvedHomedir(), dir, "skills");
}
