import { homedir } from "node:os";
import { join } from "node:path";
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

export const nativeSkillRoots: Record<SkillAgent, string> = {
  claude: ".claude/skills",
  codex: ".agents/skills",
};

export const canonicalSkillRoot = "skills";

export function resolvedHomedir(): string {
  return process.env.HOME || homedir();
}

export function globalSkillRoot(agent: SkillAgent): string {
  const dir = agent === "claude" ? ".claude" : ".codex";
  return join(resolvedHomedir(), dir, "skills");
}
