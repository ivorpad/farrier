import { resolveModelSettings, type ModelRole, type ModelsConfig, type ResolvedModelSettings } from "../config/farrier-config";
import type { StartupAgentChoice, StartupEffortChoices, StartupModelChoices } from "../config/startup-choice";
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
  efforts: StartupEffortChoices;
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
  efforts?: StartupEffortChoices;
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
    efforts: { ...(input.efforts ?? {}) },
    detection: input.detection
  };
}

/**
 * The one resolution rule for farrier's own LLM calls: the startup pick is
 * explicit and wins; the config's role entry, then backend default, fill the
 * rest. TUI call sites resolve through here so the session pick cannot be
 * silently dropped or overridden by a config default. (Exception: the advise
 * wizard still receives the same picks as exploded model/effort overrides
 * through cli.ts and resolves them itself.)
 */
export function sessionModelSettings(input: {
  session: SessionAgentContext | undefined;
  models: ModelsConfig;
  backend: AgentBackend;
  role: ModelRole;
}): ResolvedModelSettings {
  return resolveModelSettings({
    models: input.models,
    backend: input.backend,
    role: input.role,
    explicitModel: input.session?.models[input.backend],
    explicitReasoningEffort: input.session?.efforts[input.backend]
  });
}

/**
 * The full backend+model resolution one surface needs to run farrier's own
 * LLM work: the startup-picked backend (claude fallback), the role-resolved
 * model settings, and the label consent screens show — so "the consent
 * screen names exactly what would run" is enforced in one place instead of
 * per-surface copies.
 */
export async function loadSessionBackendSettings(input: {
  projectDir: string;
  session: SessionAgentContext | undefined;
  role: ModelRole;
}): Promise<{ backend: AgentBackend; settings: ResolvedModelSettings; backendLabel: string }> {
  const backend = input.session?.backend ?? "claude";
  const { loadFarrierConfig } = await import("../config/farrier-config");
  const models = await loadFarrierConfig({ projectDir: input.projectDir })
    .then((loaded) => loaded.config.models)
    .catch(() => ({}));
  const settings = sessionModelSettings({ session: input.session, models, backend, role: input.role });
  return { backend, settings, backendLabel: `${backend} (${settings.model ?? "default model"})` };
}

/**
 * Which backend a surface may run against a live availability probe: with a
 * startup pick, the chosen backend or nothing — never the other one (the user
 * said which agent they work with). The claude-first fallback only serves
 * session-less callers (the headless `farrier skill new` entry).
 */
export function sessionBackendFor(
  session: SessionAgentContext | undefined,
  availability: Partial<Record<AgentBackend, boolean>> | undefined
): AgentBackend | undefined {
  if (session) return session.backend && availability?.[session.backend] ? session.backend : undefined;
  if (availability?.claude) return "claude";
  if (availability?.codex) return "codex";
  return undefined;
}

export function agentProductName(backend: AgentBackend): string {
  return backend === "claude" ? "Claude Code" : "Codex";
}

export function launcherSessionView(context: SessionAgentContext): LauncherContext {
  const neitherInstalled = !context.detection.claude.installed && !context.detection.codex.installed;

  const rowNotes: LauncherRowNotes = neitherInstalled
    ? {
        improve: "local counting works; LLM analysis needs Claude Code or Codex",
        skills: "search works; suggestions and authoring need Claude Code or Codex"
      }
    : {};

  if (context.choice === "none") {
    return {
      statusLine: "No working agent selected. Create harness, skill search, Improve's local pass, and Doctor run without one.",
      rowNotes
    };
  }

  const label =
    context.choice === "both"
      ? "Claude Code + Codex"
      : agentProductName(context.choice === "claude" ? "claude" : "codex");
  const modelParts = (["claude", "codex"] as const)
    .filter((backend) => agentsByChoice[context.choice].includes(backend))
    .flatMap((backend) => [
      ...(context.models[backend] ? [`${backend} model ${context.models[backend]}`] : []),
      ...(context.efforts[backend] ? [`${backend} effort ${context.efforts[backend]}`] : [])
    ]);
  const missing = agentsByChoice[context.choice].filter((agent) => !context.detection[agent].installed);
  const missingPart = missing.length > 0 ? ` (${missing.map(agentProductName).join(" and ")} not installed here)` : "";

  return {
    statusLine: `Working with ${label}${modelParts.length > 0 ? ` · ${modelParts.join(" · ")}` : ""}${missingPart}`,
    rowNotes
  };
}
