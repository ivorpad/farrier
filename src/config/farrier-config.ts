import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export type RegistryEntryConfig =
  | string
  | {
      url: string;
      headers?: Record<string, string>;
    };

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

/** Roles a distinct model/effort can be configured for, on top of "default". */
export type ModelRole = "skillCreation" | "eval" | "refine" | "advise" | "learn";

/** A model shorthand string, or a { model, reasoningEffort } object. */
export type ModelSettingEntry = string | { model?: string; reasoningEffort?: ReasoningEffort };

export type BackendModelsConfig = Partial<Record<ModelRole | "default", ModelSettingEntry>>;

export type ModelsConfig = {
  claude?: BackendModelsConfig;
  codex?: BackendModelsConfig;
};

/** The concrete model/effort a call site should use after config resolution. */
export type ResolvedModelSettings = { model?: string; reasoningEffort?: ReasoningEffort };

export type FarrierConfig = {
  useDefaultPacks: boolean;
  registries: Record<string, RegistryEntryConfig>;
  models: ModelsConfig;
};

export type LoadedFarrierConfig = {
  config: FarrierConfig;
  userConfigPath: string;
  projectConfigPath: string;
  loadedPaths: string[];
};

export type FarrierConfigEnv = Partial<Pick<NodeJS.ProcessEnv, "FARRIER_CONFIG" | "XDG_CONFIG_HOME" | "HOME">> &
  Record<string, string | undefined>;

type PartialFarrierConfig = {
  useDefaultPacks?: boolean;
  registries: Record<string, RegistryEntryConfig>;
  models?: ModelsConfig;
};

const namespacePattern = /^@[a-z0-9][a-z0-9-]*$/;

const modelBackends = ["claude", "codex"] as const;
const modelRoleKeys = new Set<string>(["default", "skillCreation", "eval", "refine", "advise", "learn"]);
const reasoningEfforts = new Set<string>(["minimal", "low", "medium", "high", "xhigh"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function defaultUserConfigPath(env: FarrierConfigEnv): string {
  if (env.FARRIER_CONFIG && env.FARRIER_CONFIG.length > 0) {
    return env.FARRIER_CONFIG;
  }

  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0 ? env.XDG_CONFIG_HOME : join(env.HOME ?? homedir(), ".config");
  return join(base, "farrier", "config.json");
}

function assertNamespace(namespace: string, path: string): void {
  if (!namespacePattern.test(namespace)) {
    throw new Error(`invalid farrier config ${path}: registry namespace '${namespace}' must match ^@[a-z0-9][a-z0-9-]*$`);
  }
}

function normalizeHeaders(value: unknown, path: string, namespace: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`invalid farrier config ${path}: registries.${namespace}.headers must be an object`);
  }

  const headers: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(`invalid farrier config ${path}: registries.${namespace}.headers.${key} must be a string`);
    }
    headers[key] = item;
  }

  return headers;
}

function normalizeRegistryEntry(value: unknown, path: string, namespace: string): RegistryEntryConfig {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (!isRecord(value)) {
    throw new Error(`invalid farrier config ${path}: registries.${namespace} must be a string or object`);
  }

  if (typeof value.url !== "string" || value.url.length === 0) {
    throw new Error(`invalid farrier config ${path}: registries.${namespace}.url must be a non-empty string`);
  }

  const headers = normalizeHeaders(value.headers, path, namespace);
  return headers ? { url: value.url, headers } : { url: value.url };
}

function normalizeModelEntry(
  value: unknown,
  path: string,
  backend: "claude" | "codex",
  role: string
): ModelSettingEntry {
  const at = `models.${backend}.${role}`;

  if (typeof value === "string") {
    if (value.length === 0) {
      throw new Error(`invalid farrier config ${path}: ${at} must be a non-empty string`);
    }
    return value;
  }

  if (!isRecord(value)) {
    throw new Error(`invalid farrier config ${path}: ${at} must be a string or object`);
  }

  const entry: { model?: string; reasoningEffort?: ReasoningEffort } = {};

  if (value.model !== undefined) {
    if (typeof value.model !== "string" || value.model.length === 0) {
      throw new Error(`invalid farrier config ${path}: ${at}.model must be a non-empty string`);
    }
    entry.model = value.model;
  }

  if (value.reasoningEffort !== undefined) {
    if (backend === "claude") {
      throw new Error(`invalid farrier config ${path}: ${at}.reasoningEffort is only supported for codex`);
    }
    if (typeof value.reasoningEffort !== "string" || !reasoningEfforts.has(value.reasoningEffort)) {
      throw new Error(
        `invalid farrier config ${path}: ${at}.reasoningEffort must be one of minimal, low, medium, high, xhigh`
      );
    }
    entry.reasoningEffort = value.reasoningEffort as ReasoningEffort;
  }

  return entry;
}

function normalizeBackendModels(value: unknown, path: string, backend: "claude" | "codex"): BackendModelsConfig {
  if (!isRecord(value)) {
    throw new Error(`invalid farrier config ${path}: models.${backend} must be an object`);
  }

  const backendConfig: BackendModelsConfig = {};
  for (const [role, entry] of Object.entries(value)) {
    if (!modelRoleKeys.has(role)) {
      throw new Error(
        `invalid farrier config ${path}: models.${backend}.${role} is not a known role (default, skillCreation, eval, refine, advise, learn)`
      );
    }
    backendConfig[role as ModelRole | "default"] = normalizeModelEntry(entry, path, backend, role);
  }

  return backendConfig;
}

function normalizeModels(value: unknown, path: string): ModelsConfig {
  if (!isRecord(value)) {
    throw new Error(`invalid farrier config ${path}: models must be an object`);
  }

  for (const key of Object.keys(value)) {
    if (key !== "claude" && key !== "codex") {
      throw new Error(`invalid farrier config ${path}: models.${key} is not a known backend (claude, codex)`);
    }
  }

  const models: ModelsConfig = {};
  for (const backend of modelBackends) {
    if (value[backend] !== undefined) {
      models[backend] = normalizeBackendModels(value[backend], path, backend);
    }
  }

  return models;
}

function normalizeConfig(raw: unknown, path: string): PartialFarrierConfig {
  if (!isRecord(raw)) {
    throw new Error(`invalid farrier config ${path}: root must be an object`);
  }

  if (raw.useDefaultPacks !== undefined && typeof raw.useDefaultPacks !== "boolean") {
    throw new Error(`invalid farrier config ${path}: useDefaultPacks must be a boolean`);
  }

  if (raw.registries !== undefined && !isRecord(raw.registries)) {
    throw new Error(`invalid farrier config ${path}: registries must be an object`);
  }

  const registries: Record<string, RegistryEntryConfig> = {};
  for (const [namespace, entry] of Object.entries(raw.registries ?? {})) {
    assertNamespace(namespace, path);
    registries[namespace] = normalizeRegistryEntry(entry, path, namespace);
  }

  return {
    ...(typeof raw.useDefaultPacks === "boolean" ? { useDefaultPacks: raw.useDefaultPacks } : {}),
    registries,
    ...(raw.models !== undefined ? { models: normalizeModels(raw.models, path) } : {})
  };
}

async function readConfig(path: string): Promise<PartialFarrierConfig | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid farrier config ${path}: ${message}`);
  }

  return normalizeConfig(raw, path);
}

function mergeBackendModels(
  user: BackendModelsConfig | undefined,
  project: BackendModelsConfig | undefined
): BackendModelsConfig | undefined {
  if (!user && !project) {
    return undefined;
  }

  // Whole-entry project-over-user per role key (mirrors the registries merge).
  return { ...(user ?? {}), ...(project ?? {}) };
}

function mergeModels(user: ModelsConfig | undefined, project: ModelsConfig | undefined): ModelsConfig {
  const models: ModelsConfig = {};

  for (const backend of modelBackends) {
    const merged = mergeBackendModels(user?.[backend], project?.[backend]);
    if (merged) {
      models[backend] = merged;
    }
  }

  return models;
}

function mergeConfig(userConfig: PartialFarrierConfig | undefined, projectConfig: PartialFarrierConfig | undefined): FarrierConfig {
  return {
    useDefaultPacks: projectConfig?.useDefaultPacks ?? userConfig?.useDefaultPacks ?? true,
    registries: {
      ...(userConfig?.registries ?? {}),
      ...(projectConfig?.registries ?? {})
    },
    models: mergeModels(userConfig?.models, projectConfig?.models)
  };
}

function normalizeEntry(entry: ModelSettingEntry | undefined): { model?: string; reasoningEffort?: ReasoningEffort } {
  if (entry === undefined) {
    return {};
  }

  return typeof entry === "string" ? { model: entry } : entry;
}

/**
 * Resolves the model + reasoning effort for one call site, field by field:
 * an explicit model beats the role entry beats the backend default; reasoning
 * effort falls from role to default. Returns undefined fields when unconfigured
 * so the engine's built-in defaults take over.
 */
export function resolveModelSettings(input: {
  models: ModelsConfig;
  backend: "claude" | "codex";
  role: ModelRole;
  explicitModel?: string;
}): ResolvedModelSettings {
  const backendConfig = input.models[input.backend] ?? {};
  const roleEntry = normalizeEntry(backendConfig[input.role]);
  const defaultEntry = normalizeEntry(backendConfig.default);

  const model = input.explicitModel ?? roleEntry.model ?? defaultEntry.model;
  const reasoningEffort = roleEntry.reasoningEffort ?? defaultEntry.reasoningEffort;

  const resolved: ResolvedModelSettings = {};
  if (model !== undefined) {
    resolved.model = model;
  }
  if (reasoningEffort !== undefined) {
    resolved.reasoningEffort = reasoningEffort;
  }

  return resolved;
}

export async function loadFarrierConfig(input: {
  projectDir: string;
  env?: FarrierConfigEnv;
}): Promise<LoadedFarrierConfig> {
  const env = input.env ?? process.env;
  const userConfigPath = defaultUserConfigPath(env);
  const projectConfigPath = join(input.projectDir, "farrier.config.json");
  const userConfig = await readConfig(userConfigPath);
  const projectConfig = await readConfig(projectConfigPath);

  return {
    config: mergeConfig(userConfig, projectConfig),
    userConfigPath,
    projectConfigPath,
    loadedPaths: [userConfig ? userConfigPath : undefined, projectConfig ? projectConfigPath : undefined].filter(
      (path): path is string => path !== undefined
    )
  };
}
