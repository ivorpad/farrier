import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RegistryEntryConfig } from "../config/farrier-config";
import {
  validateRegistryIndex,
  validateRegistryItem,
  type RegistryIndex,
  type RegistryIndexItem,
  type RegistryItem
} from "./schema";

export type RegistryErrorKind = "auth" | "not-found" | "network" | "schema" | "env";

export class RegistryError extends Error {
  readonly kind: RegistryErrorKind;
  readonly namespace: string;

  constructor(kind: RegistryErrorKind, namespace: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "RegistryError";
    this.kind = kind;
    this.namespace = namespace;
    this.cause = options?.cause;
  }
}

export type RegistryFetchResult<T> = {
  value: T;
  raw: string;
  sha256: string;
  fromCache: boolean;
};

export type RegistrySource = {
  namespace: string;
  itemUrl: (name: string) => string;
  headers: Record<string, string>;
  authEnvVars: string[];
  optionalAuthEnvVars: string[];
};

export type RegistryClientOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  cacheDir?: string;
  timeoutMs?: number;
};

const envPattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function splitRef(value: string, fallback: string): { path: string; ref: string } {
  const at = value.lastIndexOf("@");

  if (at <= 0 || at === value.length - 1) {
    return {
      path: value,
      ref: fallback
    };
  }

  return {
    path: value.slice(0, at),
    ref: value.slice(at + 1)
  };
}

function encodePathSegments(value: string): string {
  return value
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

function hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function assertAllowedUrl(url: string, namespace: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new RegistryError("schema", namespace, `registry ${namespace} has invalid URL ${url}`, { cause: error });
  }

  if (parsed.protocol === "https:") {
    return;
  }

  if (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)) {
    return;
  }

  throw new RegistryError("schema", namespace, `registry ${namespace} URL must use https outside localhost`);
}

function expandTemplateUrl(namespace: string, template: string, name: string): string {
  if (!template.includes("{name}")) {
    throw new RegistryError("schema", namespace, `registry ${namespace} URL template must contain {name}`);
  }

  const url = template.replaceAll("{name}", encodeURIComponent(name));
  assertAllowedUrl(url, namespace);
  return url;
}

function headerEnvVars(headers: Record<string, string>): string[] {
  const vars = new Set<string>();

  for (const value of Object.values(headers)) {
    for (const match of value.matchAll(envPattern)) {
      vars.add(match[1]!);
    }
  }

  return Array.from(vars);
}

function fullUrlSource(namespace: string, entry: string | { url: string; headers?: Record<string, string> }): RegistrySource {
  const url = typeof entry === "string" ? entry : entry.url;
  const headers = typeof entry === "string" ? {} : entry.headers ?? {};

  return {
    namespace,
    itemUrl: (name) => expandTemplateUrl(namespace, url, name),
    headers,
    authEnvVars: headerEnvVars(headers),
    optionalAuthEnvVars: []
  };
}

function providerHeaders(
  explicitHeaders: Record<string, string> | undefined,
  defaultHeaders: Record<string, string>,
  envVar: string
): Pick<RegistrySource, "headers" | "authEnvVars" | "optionalAuthEnvVars"> {
  if (explicitHeaders) {
    return {
      headers: explicitHeaders,
      authEnvVars: headerEnvVars(explicitHeaders),
      optionalAuthEnvVars: []
    };
  }

  return {
    headers: defaultHeaders,
    authEnvVars: [],
    optionalAuthEnvVars: [envVar]
  };
}

function githubSource(namespace: string, value: string, headers?: Record<string, string>): RegistrySource {
  const { path, ref } = splitRef(value.slice("github:".length), "HEAD");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new RegistryError("schema", namespace, "github registry shorthand must be github:owner/repo[/dir][@ref]");
  }
  const [owner, repo, ...dirSegments] = segments;
  const auth = providerHeaders(headers, { Authorization: "Bearer ${GITHUB_TOKEN}" }, "GITHUB_TOKEN");

  return {
    namespace,
    itemUrl: (name) =>
      `https://raw.githubusercontent.com/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/${encodeURIComponent(ref)}/${[
        ...dirSegments.map(encodeURIComponent),
        `${encodeURIComponent(name)}.json`
      ].join("/")}`,
    ...auth
  };
}

function gitlabSource(namespace: string, value: string, headers?: Record<string, string>): RegistrySource {
  const { path, ref } = splitRef(value.slice("gitlab:".length), "main");
  const separator = path.indexOf("//");
  const projectPath = separator === -1 ? path : path.slice(0, separator);
  const dir = separator === -1 ? "" : path.slice(separator + 2).replace(/^\/+|\/+$/g, "");
  if (projectPath.split("/").filter(Boolean).length < 2) {
    throw new RegistryError("schema", namespace, "gitlab registry shorthand must be gitlab:group/project[//dir][@ref]");
  }
  const auth = providerHeaders(headers, { "PRIVATE-TOKEN": "${GITLAB_TOKEN}" }, "GITLAB_TOKEN");

  return {
    namespace,
    itemUrl: (name) => {
      const itemPath = dir ? `${dir}/${name}.json` : `${name}.json`;
      return `https://gitlab.com/api/v4/projects/${encodeURIComponent(projectPath)}/repository/files/${encodeURIComponent(itemPath)}/raw?ref=${encodeURIComponent(ref)}`;
    },
    ...auth
  };
}

function bitbucketSource(namespace: string, value: string, headers?: Record<string, string>): RegistrySource {
  const { path, ref } = splitRef(value.slice("bitbucket:".length), "main");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new RegistryError("schema", namespace, "bitbucket registry shorthand must be bitbucket:workspace/repo[/dir][@ref]");
  }
  const [workspace, repo, ...dirSegments] = segments;
  const auth = providerHeaders(headers, { Authorization: "Bearer ${BITBUCKET_TOKEN}" }, "BITBUCKET_TOKEN");

  return {
    namespace,
    itemUrl: (name) =>
      `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace!)}/${encodeURIComponent(repo!)}/src/${encodeURIComponent(ref)}/${[
        ...dirSegments.map(encodeURIComponent),
        `${encodeURIComponent(name)}.json`
      ].join("/")}`,
    ...auth
  };
}

export function resolveRegistrySource(namespace: string, entry: RegistryEntryConfig): RegistrySource {
  const rawUrl = typeof entry === "string" ? entry : entry.url;
  const explicitHeaders = typeof entry === "string" ? undefined : entry.headers;

  if (rawUrl.startsWith("github:")) {
    return githubSource(namespace, rawUrl, explicitHeaders);
  }
  if (rawUrl.startsWith("gitlab:")) {
    return gitlabSource(namespace, rawUrl, explicitHeaders);
  }
  if (rawUrl.startsWith("bitbucket:")) {
    return bitbucketSource(namespace, rawUrl, explicitHeaders);
  }

  return fullUrlSource(namespace, entry);
}

function expandedHeaders(source: RegistrySource, env: Record<string, string | undefined>): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [key, template] of Object.entries(source.headers)) {
    let missingOptional = false;
    const value = template.replace(envPattern, (_, envVar: string) => {
      const envValue = env[envVar];

      if (envValue === undefined || envValue.length === 0) {
        if (source.optionalAuthEnvVars.includes(envVar)) {
          missingOptional = true;
          return "";
        }

        throw new RegistryError("env", source.namespace, `registry ${source.namespace} header references unset env var ${envVar}`);
      }

      return envValue;
    });

    if (!missingOptional) {
      headers[key] = value;
    }
  }

  return headers;
}

function cacheBaseDir(options: RegistryClientOptions): string {
  const env = options.env ?? process.env;
  const configured = options.cacheDir ?? env.FARRIER_CACHE_DIR;

  if (configured && configured.length > 0) {
    return configured;
  }

  return join(env.HOME ?? homedir(), ".cache", "farrier");
}

function cachePath(baseDir: string, namespace: string, name: string): string {
  return join(baseDir, "registries", namespace, `${name}.json`);
}

function sha256(raw: string): string {
  return new Bun.CryptoHasher("sha256").update(raw).digest("hex");
}

function parseJson(raw: string, namespace: string, name: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new RegistryError("schema", namespace, `registry ${namespace}/${name} returned invalid JSON`, { cause: error });
  }
}

function validateRaw<T>(raw: string, namespace: string, name: string, validate: (value: unknown) => T): T {
  try {
    return validate(parseJson(raw, namespace, name));
  } catch (error) {
    if (error instanceof RegistryError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new RegistryError("schema", namespace, `registry ${namespace}/${name} failed schema validation: ${message}`, {
      cause: error
    });
  }
}

function authMessage(namespace: string, url: string, envVars: string[]): string {
  const suffix = envVars.length > 0 ? ` using env ${envVars.join(", ")}` : "";
  return `authentication failed for registry ${namespace} at ${hostFor(url)}${suffix}`;
}

function notFoundMessage(source: RegistrySource, url: string, env: Record<string, string | undefined>): string {
  const base = `registry ${source.namespace} item not found at ${hostFor(url)}`;
  const unsetOptionalTokens = source.optionalAuthEnvVars.filter((name) => !env[name]);

  if (unsetOptionalTokens.length === 0) {
    return base;
  }

  // GitHub, GitLab, and Bitbucket all return 404 (not 401/403) for unauthenticated
  // access to a private repo, to avoid confirming it exists. A provider shorthand
  // sends its token only when the env var is set (see providerHeaders), so a missing
  // token for a private registry looks identical to a real 404 without this hint.
  return `${base}. If this is a private repository, set ${unsetOptionalTokens.join(" or ")} and retry.`;
}

export class RegistryClient {
  private readonly env: Record<string, string | undefined>;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheDir: string;
  private readonly timeoutMs: number;
  private readonly memory = new Map<string, Promise<RegistryFetchResult<unknown>>>();

  constructor(options: RegistryClientOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cacheDir = cacheBaseDir(options);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async fetchRegistryIndex(namespace: string, entry: RegistryEntryConfig): Promise<RegistryFetchResult<RegistryIndex>> {
    return this.fetchJson(namespace, entry, "registry", (value) => validateRegistryIndex(value, namespace));
  }

  async fetchRegistryItem(
    namespace: string,
    entry: RegistryEntryConfig,
    item: RegistryIndexItem
  ): Promise<RegistryFetchResult<RegistryItem>> {
    return this.fetchJson(namespace, entry, item.name, (value) => validateRegistryItem(value, item));
  }

  private async fetchJson<T>(
    namespace: string,
    entry: RegistryEntryConfig,
    name: string,
    validate: (value: unknown) => T
  ): Promise<RegistryFetchResult<T>> {
    const key = `${namespace}/${name}`;
    const cached = this.memory.get(key);
    if (cached) {
      return cached as Promise<RegistryFetchResult<T>>;
    }

    const request = this.fetchJsonUncached(namespace, entry, name, validate);
    this.memory.set(key, request as Promise<RegistryFetchResult<unknown>>);

    try {
      return await request;
    } catch (error) {
      this.memory.delete(key);
      throw error;
    }
  }

  private async fetchJsonUncached<T>(
    namespace: string,
    entry: RegistryEntryConfig,
    name: string,
    validate: (value: unknown) => T
  ): Promise<RegistryFetchResult<T>> {
    const source = resolveRegistrySource(namespace, entry);
    const url = source.itemUrl(name);
    const path = cachePath(this.cacheDir, namespace, name);

    try {
      const raw = await this.fetchRaw(source, url);
      const value = validateRaw(raw, namespace, name, validate);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, raw, "utf8");
      return {
        value,
        raw,
        sha256: sha256(raw),
        fromCache: false
      };
    } catch (error) {
      const fallback = await this.readCache(path, namespace, name, validate);
      if (fallback) {
        return fallback;
      }
      throw error;
    }
  }

  private async fetchRaw(source: RegistrySource, url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        headers: expandedHeaders(source, this.env),
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) {
        throw new RegistryError(
          "auth",
          source.namespace,
          authMessage(source.namespace, url, [...source.authEnvVars, ...source.optionalAuthEnvVars])
        );
      }

      if (response.status === 404) {
        throw new RegistryError("not-found", source.namespace, notFoundMessage(source, url, this.env));
      }

      if (!response.ok) {
        throw new RegistryError(
          "network",
          source.namespace,
          `registry ${source.namespace} request to ${hostFor(url)} failed with HTTP ${response.status}`
        );
      }

      return await response.text();
    } catch (error) {
      if (error instanceof RegistryError) {
        throw error;
      }

      throw new RegistryError("network", source.namespace, `registry ${source.namespace} request to ${hostFor(url)} failed`, {
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readCache<T>(
    path: string,
    namespace: string,
    name: string,
    validate: (value: unknown) => T
  ): Promise<RegistryFetchResult<T> | undefined> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return undefined;
    }

    return {
      value: validateRaw(raw, namespace, name, validate),
      raw,
      sha256: sha256(raw),
      fromCache: true
    };
  }
}
