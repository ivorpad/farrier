import type { RegistryConfigSource, RegistryEntryConfig } from "../config/farrier-config";
import { RegistryError } from "./error";

export type RegistrySource = {
  namespace: string;
  itemUrl: (name: string) => string;
  headers: Record<string, string>;
  authEnvVars: string[];
  optionalAuthEnvVars: string[];
  sourceIdentity: string;
  configSource?: RegistryConfigSource;
};

const envPattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function sha256(raw: string): string {
  return new Bun.CryptoHasher("sha256").update(raw).digest("hex");
}

function headerPolicy(headers: Record<string, string>): Array<{
  name: string;
  marker: "literal" | "template";
  envVars: string[];
}> {
  return Object.entries(headers)
    .map(([name, value]) => {
      const envVars = Array.from(
        new Set(Array.from(value.matchAll(envPattern), (match) => match[1]!))
      ).sort();
      return {
        name: name.toLowerCase(),
        marker: envVars.length > 0 ? ("template" as const) : ("literal" as const),
        envVars
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function sourceIdentity(
  namespace: string,
  descriptor: string,
  headers: Record<string, string>,
  configSource?: RegistryConfigSource
): string {
  const policy = {
    scope: configSource?.scope ?? "compatibility-user",
    authEnabled: Object.keys(headers).length > 0,
    headers: headerPolicy(headers)
  };
  return sha256(`${namespace}\0${descriptor}\0${JSON.stringify(policy)}`);
}

function headerEnvVars(headers: Record<string, string>): string[] {
  const vars = new Set<string>();
  for (const value of Object.values(headers)) {
    for (const match of value.matchAll(envPattern)) vars.add(match[1]!);
  }
  return Array.from(vars);
}

function assertProjectHeadersSafe(
  namespace: string,
  headers: Record<string, string> | undefined,
  configSource?: RegistryConfigSource
): void {
  if (configSource?.scope !== "project" || !headers || headerEnvVars(headers).length === 0) return;
  throw new RegistryError(
    "env",
    namespace,
    `registry ${namespace} in project config ${configSource.sourcePath} may not reference environment credentials; move this private registry entry to the user config`
  );
}

function splitRef(value: string, fallback: string): { path: string; ref: string } {
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return { path: value, ref: fallback };
  return { path: value.slice(0, at), ref: value.slice(at + 1) };
}

export function hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function assertAllowedUrl(url: string, namespace: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new RegistryError("schema", namespace, `registry ${namespace} has invalid URL ${url}`, { cause: error });
  }
  if (parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))) return;
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

function providerHeaders(
  explicitHeaders: Record<string, string> | undefined,
  defaultHeaders: Record<string, string>,
  envVar: string,
  namespace: string,
  configSource?: RegistryConfigSource
): Pick<RegistrySource, "headers" | "authEnvVars" | "optionalAuthEnvVars"> {
  assertProjectHeadersSafe(namespace, explicitHeaders, configSource);
  if (explicitHeaders) {
    return { headers: explicitHeaders, authEnvVars: headerEnvVars(explicitHeaders), optionalAuthEnvVars: [] };
  }
  if (configSource?.scope === "project") return { headers: {}, authEnvVars: [], optionalAuthEnvVars: [] };
  return { headers: defaultHeaders, authEnvVars: [], optionalAuthEnvVars: [envVar] };
}

function fullUrlSource(
  namespace: string,
  entry: string | { url: string; headers?: Record<string, string> },
  configSource?: RegistryConfigSource
): RegistrySource {
  const url = typeof entry === "string" ? entry : entry.url;
  const headers = typeof entry === "string" ? {} : entry.headers ?? {};
  assertProjectHeadersSafe(namespace, headers, configSource);
  return {
    namespace,
    itemUrl: (name) => expandTemplateUrl(namespace, url, name),
    headers,
    authEnvVars: headerEnvVars(headers),
    optionalAuthEnvVars: [],
    sourceIdentity: sourceIdentity(namespace, url, headers, configSource),
    configSource
  };
}

function githubSource(
  namespace: string,
  value: string,
  headers?: Record<string, string>,
  configSource?: RegistryConfigSource
): RegistrySource {
  const { path, ref } = splitRef(value.slice("github:".length), "HEAD");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new RegistryError("schema", namespace, "github registry shorthand must be github:owner/repo[/dir][@ref]");
  }
  const [owner, repo, ...dirSegments] = segments;
  const auth = providerHeaders(headers, { Authorization: "Bearer ${GITHUB_TOKEN}" }, "GITHUB_TOKEN", namespace, configSource);
  return {
    namespace,
    itemUrl: (name) =>
      `https://raw.githubusercontent.com/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/${encodeURIComponent(ref)}/${[
        ...dirSegments.map(encodeURIComponent),
        `${encodeURIComponent(name)}.json`
      ].join("/")}`,
    ...auth,
    sourceIdentity: sourceIdentity(namespace, `github:${path}@${ref}`, auth.headers, configSource),
    configSource
  };
}

function gitlabSource(
  namespace: string,
  value: string,
  headers?: Record<string, string>,
  configSource?: RegistryConfigSource
): RegistrySource {
  const { path, ref } = splitRef(value.slice("gitlab:".length), "main");
  const separator = path.indexOf("//");
  const projectPath = separator === -1 ? path : path.slice(0, separator);
  const dir = separator === -1 ? "" : path.slice(separator + 2).replace(/^\/+|\/+$/g, "");
  if (projectPath.split("/").filter(Boolean).length < 2) {
    throw new RegistryError("schema", namespace, "gitlab registry shorthand must be gitlab:group/project[//dir][@ref]");
  }
  const auth = providerHeaders(headers, { "PRIVATE-TOKEN": "${GITLAB_TOKEN}" }, "GITLAB_TOKEN", namespace, configSource);
  return {
    namespace,
    itemUrl: (name) => {
      const itemPath = dir ? `${dir}/${name}.json` : `${name}.json`;
      return `https://gitlab.com/api/v4/projects/${encodeURIComponent(projectPath)}/repository/files/${encodeURIComponent(itemPath)}/raw?ref=${encodeURIComponent(ref)}`;
    },
    ...auth,
    sourceIdentity: sourceIdentity(namespace, `gitlab:${projectPath}//${dir}@${ref}`, auth.headers, configSource),
    configSource
  };
}

function bitbucketSource(
  namespace: string,
  value: string,
  headers?: Record<string, string>,
  configSource?: RegistryConfigSource
): RegistrySource {
  const { path, ref } = splitRef(value.slice("bitbucket:".length), "main");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new RegistryError("schema", namespace, "bitbucket registry shorthand must be bitbucket:workspace/repo[/dir][@ref]");
  }
  const [workspace, repo, ...dirSegments] = segments;
  const auth = providerHeaders(headers, { Authorization: "Bearer ${BITBUCKET_TOKEN}" }, "BITBUCKET_TOKEN", namespace, configSource);
  return {
    namespace,
    itemUrl: (name) =>
      `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace!)}/${encodeURIComponent(repo!)}/src/${encodeURIComponent(ref)}/${[
        ...dirSegments.map(encodeURIComponent),
        `${encodeURIComponent(name)}.json`
      ].join("/")}`,
    ...auth,
    sourceIdentity: sourceIdentity(namespace, `bitbucket:${path}@${ref}`, auth.headers, configSource),
    configSource
  };
}

export function resolveRegistrySource(
  namespace: string,
  entry: RegistryEntryConfig,
  configSource?: RegistryConfigSource
): RegistrySource {
  const rawUrl = typeof entry === "string" ? entry : entry.url;
  const explicitHeaders = typeof entry === "string" ? undefined : entry.headers;
  if (rawUrl.startsWith("github:")) return githubSource(namespace, rawUrl, explicitHeaders, configSource);
  if (rawUrl.startsWith("gitlab:")) return gitlabSource(namespace, rawUrl, explicitHeaders, configSource);
  if (rawUrl.startsWith("bitbucket:")) return bitbucketSource(namespace, rawUrl, explicitHeaders, configSource);
  return fullUrlSource(namespace, entry, configSource);
}

export function expandedHeaders(
  source: RegistrySource,
  env: Record<string, string | undefined>
): Record<string, string> {
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
    if (!missingOptional) headers[key] = value;
  }
  return headers;
}
