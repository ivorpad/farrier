import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export type RegistryEntryConfig =
  | string
  | {
      url: string;
      headers?: Record<string, string>;
    };

export type FarrierConfig = {
  useDefaultPacks: boolean;
  registries: Record<string, RegistryEntryConfig>;
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
};

const namespacePattern = /^@[a-z0-9][a-z0-9-]*$/;

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
    registries
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

function mergeConfig(userConfig: PartialFarrierConfig | undefined, projectConfig: PartialFarrierConfig | undefined): FarrierConfig {
  return {
    useDefaultPacks: projectConfig?.useDefaultPacks ?? userConfig?.useDefaultPacks ?? true,
    registries: {
      ...(userConfig?.registries ?? {}),
      ...(projectConfig?.registries ?? {})
    }
  };
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
