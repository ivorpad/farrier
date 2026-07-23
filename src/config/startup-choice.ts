import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defaultUserConfigPath, type FarrierConfigEnv } from "./farrier-config";

/**
 * The remembered startup pick lives under the `startup` key of the USER-level
 * farrier config file (defaultUserConfigPath: $FARRIER_CONFIG, else
 * $XDG_CONFIG_HOME/farrier/config.json, else ~/.config/farrier/config.json).
 * User-level on purpose: which agent you work with is a property of the
 * person and machine, not of any one repository. Reading is lenient (an
 * invalid value means "no remembered choice"); writing rewrites only this key
 * and preserves every other key in the file. The remembered choice is a
 * preselection only: the startup screen always renders and always waits for
 * an explicit confirmation.
 */

export type StartupAgentChoice = "claude" | "codex" | "both" | "none";

export type StartupModelChoices = { claude?: string; codex?: string };

/** Session-level effort picks; CLI-sourced or typed, so plain strings. */
export type StartupEffortChoices = { claude?: string; codex?: string };

export type StartupChoice = {
  agent: StartupAgentChoice;
  /** Session-level model overrides; an absent entry means "config default". */
  models: StartupModelChoices;
  /** Session-level reasoning-effort overrides; absent means "config default". */
  efforts: StartupEffortChoices;
};

const startupAgentChoices = new Set<string>(["claude", "codex", "both", "none"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/** Shared by models and efforts: both are per-backend non-empty strings. */
function normalizedBackendStrings(value: unknown): { claude?: string; codex?: string } {
  const entries: { claude?: string; codex?: string } = {};
  if (!isRecord(value)) return entries;
  for (const backend of ["claude", "codex"] as const) {
    const entry = value[backend];
    if (typeof entry === "string" && entry.trim().length > 0) {
      entries[backend] = entry.trim();
    }
  }
  return entries;
}

export async function loadStartupChoice(env: FarrierConfigEnv = process.env): Promise<StartupChoice | undefined> {
  const path = defaultUserConfigPath(env);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }

  if (!isRecord(raw) || !isRecord(raw.startup)) return undefined;
  const agent = raw.startup.agent;
  if (typeof agent !== "string" || !startupAgentChoices.has(agent)) return undefined;
  return {
    agent: agent as StartupAgentChoice,
    models: normalizedBackendStrings(raw.startup.models),
    efforts: normalizedBackendStrings(raw.startup.efforts)
  };
}

export async function saveStartupChoice(choice: StartupChoice, env: FarrierConfigEnv = process.env): Promise<void> {
  const path = defaultUserConfigPath(env);

  let existing: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed)) {
      throw new Error(`refusing to rewrite ${path}: existing config root is not an object`);
    }
    existing = parsed;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      // A file we cannot parse is never clobbered; the pick still applies to
      // this session, it just is not remembered.
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  const models = normalizedBackendStrings(choice.models);
  const efforts = normalizedBackendStrings(choice.efforts);
  existing.startup = {
    agent: choice.agent,
    ...(Object.keys(models).length > 0 ? { models } : {}),
    ...(Object.keys(efforts).length > 0 ? { efforts } : {})
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(existing, null, 2)}\n`);
}
