import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { applyMutationPlan, inspectMutationPlan } from "../engine/mutation-transaction";
import type { RegistryConfigSource, RegistryEntryConfig } from "../config/farrier-config";
import { RegistryError } from "./error";
import {
  assertAllowedUrl,
  expandedHeaders,
  hostFor,
  resolveRegistrySource,
  type RegistrySource
} from "./source";
import {
  validateRegistryIndex,
  validateRegistryItem,
  type RegistryIndex,
  type RegistryIndexItem,
  type RegistryItem
} from "./schema";

export { RegistryError } from "./error";
export type { RegistryErrorKind } from "./error";
export { resolveRegistrySource } from "./source";
export type { RegistrySource } from "./source";

export type RegistryFetchResult<T> = {
  value: T;
  raw: string;
  sha256: string;
  sourceIdentity?: string;
  fromCache: boolean;
};

export type RegistryClientOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  cacheDir?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
};

const cacheMetadataVersion = 1;

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

async function boundedResponseText(
  response: Response,
  maxBytes: number,
  namespace: string,
  url: string
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RegistryError("schema", namespace, `registry ${namespace} response from ${hostFor(url)} exceeds ${maxBytes} bytes`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RegistryError("schema", namespace, `registry ${namespace} response from ${hostFor(url)} exceeds ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
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
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly memory = new Map<string, Promise<RegistryFetchResult<unknown>>>();

  constructor(options: RegistryClientOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cacheDir = cacheBaseDir(options);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.maxResponseBytes = options.maxResponseBytes ?? 1_000_000;
  }

  async fetchRegistryIndex(
    namespace: string,
    entry: RegistryEntryConfig,
    configSource?: RegistryConfigSource
  ): Promise<RegistryFetchResult<RegistryIndex>> {
    return this.fetchJson(namespace, entry, "registry", (value) => validateRegistryIndex(value, namespace), configSource);
  }

  async fetchRegistryItem(
    namespace: string,
    entry: RegistryEntryConfig,
    item: RegistryIndexItem,
    configSource?: RegistryConfigSource
  ): Promise<RegistryFetchResult<RegistryItem>> {
    return this.fetchJson(namespace, entry, item.name, (value) => validateRegistryItem(value, item), configSource);
  }

  async fetchRegistryItemPinned(
    namespace: string,
    entry: RegistryEntryConfig,
    item: RegistryIndexItem,
    pin: {
      type: RegistryIndexItem["type"];
      version: string;
      sha256: string;
      sourceIdentity: string;
    },
    configSource?: RegistryConfigSource
  ): Promise<RegistryFetchResult<RegistryItem> | undefined> {
    const source = resolveRegistrySource(namespace, entry, configSource);
    if (source.sourceIdentity !== pin.sourceIdentity) {
      throw new RegistryError(
        "schema",
        namespace,
        `registry ${namespace}/${item.name} pin belongs to a different source; restore the original user registry config or explicitly migrate with farrier update --yes`
      );
    }
    const path = cachePath(this.cacheDir, namespace, `${item.name}.${pin.sha256}`);
    const pinnedDescriptor: RegistryIndexItem = {
      name: item.name,
      type: pin.type,
      version: pin.version
    };
    const result = await this.readCache(
      path,
      `${path}.meta.json`,
      source,
      item.name,
      (value) => validateRegistryItem(value, pinnedDescriptor)
    );
    if (result && result.sha256 !== pin.sha256) {
      throw new RegistryError(
        "schema",
        namespace,
        `registry ${namespace}/${item.name} pinned cache digest does not match the requested pin; remove the registry cache and retry`
      );
    }
    return result;
  }

  private async fetchJson<T>(
    namespace: string,
    entry: RegistryEntryConfig,
    name: string,
    validate: (value: unknown) => T,
    configSource?: RegistryConfigSource
  ): Promise<RegistryFetchResult<T>> {
    const source = resolveRegistrySource(namespace, entry, configSource);
    const key = `${source.sourceIdentity}/${name}`;
    const cached = this.memory.get(key);
    if (cached) {
      return cached as Promise<RegistryFetchResult<T>>;
    }

    const request = this.fetchJsonUncached(source, name, validate);
    this.memory.set(key, request as Promise<RegistryFetchResult<unknown>>);

    try {
      return await request;
    } catch (error) {
      this.memory.delete(key);
      throw error;
    }
  }

  private async fetchJsonUncached<T>(
    source: RegistrySource,
    name: string,
    validate: (value: unknown) => T
  ): Promise<RegistryFetchResult<T>> {
    const namespace = source.namespace;
    const url = source.itemUrl(name);
    const path = cachePath(this.cacheDir, namespace, name);
    const metadataPath = `${path}.meta.json`;

    try {
      const raw = await this.fetchRaw(source, url);
      const value = validateRaw(raw, namespace, name, validate);
      const digest = sha256(raw);
      const metadata = {
        schemaVersion: cacheMetadataVersion,
        sourceIdentity: source.sourceIdentity,
        payloadSha256: digest
      };
      await this.writeCache(path, metadataPath, raw, metadata);
      const pinnedPath = cachePath(this.cacheDir, namespace, `${name}.${digest}`);
      await this.writeCache(pinnedPath, `${pinnedPath}.meta.json`, raw, metadata);
      return {
        value,
        raw,
        sha256: digest,
        sourceIdentity: source.sourceIdentity,
        fromCache: false
      };
    } catch (error) {
      const fallback = await this.readCache(path, metadataPath, source, name, validate);
      if (fallback) {
        return fallback;
      }
      throw error;
    }
  }

  private async fetchRaw(source: RegistrySource, initialUrl: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = expandedHeaders(source, this.env);
    let url = initialUrl;

    try {
      for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
        assertAllowedUrl(url, source.namespace);
        const response = await this.fetchImpl(url, {
          headers,
          signal: controller.signal,
          redirect: "manual"
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) {
            throw new RegistryError("network", source.namespace, `registry ${source.namespace} redirect from ${hostFor(url)} omitted Location`);
          }
          if (hop === this.maxRedirects) {
            throw new RegistryError("network", source.namespace, `registry ${source.namespace} exceeded ${this.maxRedirects} redirects`);
          }
          const nextUrl = new URL(location, url).toString();
          assertAllowedUrl(nextUrl, source.namespace);
          if (Object.keys(headers).length > 0 && new URL(nextUrl).origin !== new URL(url).origin) {
            throw new RegistryError(
              "auth",
              source.namespace,
              `registry ${source.namespace} refused a credentialed cross-origin redirect from ${hostFor(url)} to ${hostFor(nextUrl)}; use a same-origin endpoint or remove credentials`
            );
          }
          url = nextUrl;
          continue;
        }

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

        return boundedResponseText(response, this.maxResponseBytes, source.namespace, url);
      }

      throw new RegistryError("network", source.namespace, `registry ${source.namespace} redirect handling failed`);
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      throw new RegistryError("network", source.namespace, `registry ${source.namespace} request to ${hostFor(url)} failed`, {
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async writeCache(
    path: string,
    metadataPath: string,
    raw: string,
    metadata: { schemaVersion: number; sourceIdentity: string; payloadSha256: string }
  ): Promise<void> {
    const cacheDir = dirname(path);
    await applyMutationPlan(await inspectMutationPlan(cacheDir, [
      { kind: "write-file", path: basename(path), content: raw, mode: 0o600 },
      { kind: "write-file", path: basename(metadataPath), content: `${JSON.stringify(metadata)}\n`, mode: 0o600 }
    ]), { retainBackupsOnSuccess: false });
  }

  private async readCache<T>(
    path: string,
    metadataPath: string,
    source: RegistrySource,
    name: string,
    validate: (value: unknown) => T
  ): Promise<RegistryFetchResult<T> | undefined> {
    let raw: string;
    let metadataRaw: string;
    try {
      [raw, metadataRaw] = await Promise.all([readFile(path, "utf8"), readFile(metadataPath, "utf8")]);
    } catch {
      return undefined;
    }

    let metadata: unknown;
    try {
      metadata = JSON.parse(metadataRaw);
    } catch (error) {
      throw new RegistryError("schema", source.namespace, `registry ${source.namespace}/${name} cache metadata is corrupt; remove the registry cache and retry`, { cause: error });
    }
    if (
      !metadata ||
      typeof metadata !== "object" ||
      (metadata as { schemaVersion?: unknown }).schemaVersion !== cacheMetadataVersion ||
      (metadata as { sourceIdentity?: unknown }).sourceIdentity !== source.sourceIdentity
    ) {
      throw new RegistryError("schema", source.namespace, `registry ${source.namespace}/${name} cache belongs to a different source; remove the registry cache and retry`);
    }
    const digest = sha256(raw);
    if ((metadata as { payloadSha256?: unknown }).payloadSha256 !== digest) {
      throw new RegistryError("schema", source.namespace, `registry ${source.namespace}/${name} cache digest is corrupt; remove the registry cache and retry`);
    }

    return {
      value: validateRaw(raw, source.namespace, name, validate),
      raw,
      sha256: digest,
      sourceIdentity: source.sourceIdentity,
      fromCache: true
    };
  }
}
