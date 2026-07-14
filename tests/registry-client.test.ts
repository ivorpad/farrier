import { describe, expect, test } from "bun:test";
import { lstat, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RegistryClient, RegistryError, resolveRegistrySource } from "../src/registry/client";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-registry-client-"));
}

const registryIndex = {
  schemaVersion: 1,
  name: "@acme",
  items: [
    {
      name: "demo",
      type: "pack",
      version: "1.0.0"
    }
  ]
};

describe("resolveRegistrySource", () => {
  test("expands provider shorthands", () => {
    expect(resolveRegistrySource("@acme", "github:owner/repo/registry@main").itemUrl("demo")).toBe(
      "https://raw.githubusercontent.com/owner/repo/main/registry/demo.json"
    );

    expect(resolveRegistrySource("@acme", "github:owner/repo").itemUrl("registry")).toBe(
      "https://raw.githubusercontent.com/owner/repo/HEAD/registry.json"
    );

    expect(resolveRegistrySource("@acme", "gitlab:group/project//dir/sub@release").itemUrl("demo")).toBe(
      "https://gitlab.com/api/v4/projects/group%2Fproject/repository/files/dir%2Fsub%2Fdemo.json/raw?ref=release"
    );

    expect(resolveRegistrySource("@acme", "bitbucket:workspace/repo/registry@release").itemUrl("demo")).toBe(
      "https://api.bitbucket.org/2.0/repositories/workspace/repo/src/release/registry/demo.json"
    );
  });

  test("rejects full URL templates without {name} and http outside loopback", () => {
    expect(() => resolveRegistrySource("@acme", "https://example.test/registry.json").itemUrl("registry")).toThrow(
      "must contain {name}"
    );

    expect(() => resolveRegistrySource("@acme", "http://example.test/{name}.json").itemUrl("registry")).toThrow(
      "must use https outside localhost"
    );

    expect(resolveRegistrySource("@acme", "http://127.0.0.1:1234/{name}.json").itemUrl("registry")).toBe(
      "http://127.0.0.1:1234/registry.json"
    );
  });

  test("binds source identity to non-secret scope and authentication policy", () => {
    const userProvider = resolveRegistrySource(
      "@acme",
      "github:acme/registry",
      { scope: "user", sourcePath: "/home/user/.config/farrier/config.json" }
    );
    const projectProvider = resolveRegistrySource(
      "@acme",
      "github:acme/registry",
      { scope: "project", sourcePath: "/project/farrier.config.json" }
    );
    expect(userProvider.sourceIdentity).not.toBe(projectProvider.sourceIdentity);

    const url = "https://registry.example/{name}.json";
    const explicitTemplate = resolveRegistrySource(
      "@acme",
      { url, headers: { Authorization: "Bearer ${ACME_TOKEN}", "X-Literal": "fixed" } },
      { scope: "user", sourcePath: "/home/user/.config/farrier/config.json" }
    );
    const noHeaders = resolveRegistrySource(
      "@acme",
      url,
      { scope: "user", sourcePath: "/home/user/.config/farrier/config.json" }
    );
    expect(explicitTemplate.sourceIdentity).not.toBe(noHeaders.sourceIdentity);

    const reordered = resolveRegistrySource(
      "@acme",
      { url, headers: { "X-Literal": "different-value", Authorization: "Token ${ACME_TOKEN}" } },
      { scope: "user", sourcePath: "/elsewhere/config.json" }
    );
    expect(reordered.sourceIdentity).toBe(explicitTemplate.sourceIdentity);
  });
});

describe("RegistryClient", () => {
  test("expands explicit auth headers at fetch time and sends them to the server", async () => {
    const cacheDir = await tempDir();
    let receivedAuth: string | undefined;
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        receivedAuth = request.headers.get("authorization") ?? undefined;
        return Response.json(registryIndex);
      }
    });

    try {
      const client = new RegistryClient({
        cacheDir,
        env: {
          ACME_TOKEN: "server-secret"
        }
      });

      const result = await client.fetchRegistryIndex("@acme", {
        url: `http://127.0.0.1:${server.port}/{name}.json`,
        headers: {
          Authorization: "Bearer ${ACME_TOKEN}"
        }
      });

      expect(result.value.name).toBe("@acme");
      expect(result.fromCache).toBe(false);
      expect(result.sha256).toHaveLength(64);
      expect(receivedAuth as string | undefined).toBe("Bearer server-secret");
    } finally {
      await server.stop(true);
    }
  });

  test("missing explicit header env var is an env error that names only the variable", async () => {
    const client = new RegistryClient({
      cacheDir: await tempDir(),
      env: {}
    });

    let error: unknown;
    try {
      await client.fetchRegistryIndex("@acme", {
        url: "http://127.0.0.1:1/{name}.json",
        headers: {
          Authorization: "Bearer ${ACME_TOKEN}"
        }
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RegistryError);
    expect((error as RegistryError).kind).toBe("env");
    expect((error as Error).message).toContain("ACME_TOKEN");
    expect((error as Error).message).not.toContain("Bearer");
  });

  test("401 responses become auth errors and do not leak token values", async () => {
    const token = "super-secret-token";
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("no", { status: 401 });
      }
    });

    try {
      const client = new RegistryClient({
        cacheDir: await tempDir(),
        env: {
          ACME_TOKEN: token
        }
      });

      let error: unknown;
      try {
        await client.fetchRegistryIndex("@acme", {
          url: `http://127.0.0.1:${server.port}/{name}.json`,
          headers: {
            Authorization: "Bearer ${ACME_TOKEN}"
          }
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(RegistryError);
      expect((error as RegistryError).kind).toBe("auth");
      expect((error as Error).message).toContain("@acme");
      expect((error as Error).message).toContain("127.0.0.1");
      expect((error as Error).message).toContain("ACME_TOKEN");
      expect((error as Error).message).not.toContain(token);
    } finally {
      await server.stop(true);
    }
  });

  test("404 from a provider shorthand with no token set hints at the private-repo case", async () => {
    // GitHub (and GitLab/Bitbucket) return 404, not 401/403, for unauthenticated
    // access to a private repo -- so this is the error an enterprise actually sees
    // if they forget to export GITHUB_TOKEN, not an auth-classified error.
    const client = new RegistryClient({
      cacheDir: await tempDir(),
      env: {},
      fetchImpl: (async () => new Response("no", { status: 404 })) as unknown as typeof fetch
    });

    let error: unknown;
    try {
      await client.fetchRegistryIndex("@acme", "github:acme-corp/private-registry");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RegistryError);
    expect((error as RegistryError).kind).toBe("not-found");
    expect((error as Error).message).toContain("If this is a private repository, set GITHUB_TOKEN");
  });

  test("404 from an explicit URL with no optional token stays a plain not-found", async () => {
    const client = new RegistryClient({
      cacheDir: await tempDir(),
      env: {},
      fetchImpl: (async () => new Response("no", { status: 404 })) as unknown as typeof fetch
    });

    let error: unknown;
    try {
      await client.fetchRegistryIndex("@acme", "https://harness.acme.dev/registry/{name}.json");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RegistryError);
    expect((error as RegistryError).kind).toBe("not-found");
    expect((error as Error).message).not.toContain("private repository");
  });

  test("404 from a provider shorthand with the token already set stays a plain not-found", async () => {
    const client = new RegistryClient({
      cacheDir: await tempDir(),
      env: { GITHUB_TOKEN: "configured" },
      fetchImpl: (async () => new Response("no", { status: 404 })) as unknown as typeof fetch
    });

    let error: unknown;
    try {
      await client.fetchRegistryIndex("@acme", "github:acme-corp/private-registry");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RegistryError);
    expect((error as Error).message).not.toContain("private repository");
  });

  test("repeat cache writes do not accumulate transaction backups", async () => {
    const cacheDir = await tempDir();
    let version = "1.0.0";
    const fetchImpl = (async () => Response.json({
      ...registryIndex,
      items: [{ ...registryIndex.items[0], version }]
    })) as unknown as typeof fetch;
    const entry = "https://registry.example/{name}.json";

    await new RegistryClient({ cacheDir, env: {}, fetchImpl }).fetchRegistryIndex("@acme", entry);
    version = "2.0.0";
    await new RegistryClient({ cacheDir, env: {}, fetchImpl }).fetchRegistryIndex("@acme", entry);

    expect(await lstat(join(cacheDir, "registries", "@acme", ".farrier-staging")).catch(() => undefined)).toBeUndefined();
  });

  test("uses disk cache fallback after the registry becomes unreachable", async () => {
    const cacheDir = await tempDir();
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json(registryIndex);
      }
    });
    const entry = `http://127.0.0.1:${server.port}/{name}.json`;

    const firstClient = new RegistryClient({ cacheDir, env: {} });
    const first = await firstClient.fetchRegistryIndex("@acme", entry);
    expect(first.fromCache).toBe(false);

    await server.stop(true);

    const secondClient = new RegistryClient({
      cacheDir,
      env: {},
      timeoutMs: 100
    });
    const second = await secondClient.fetchRegistryIndex("@acme", entry);

    expect(second.fromCache).toBe(true);
    expect(second.value).toEqual(first.value);
    expect(second.sha256).toBe(first.sha256);
  });


  test("rejects project credential expansion before network I/O while user-config private registries continue", async () => {
    let calls = 0;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer user-secret");
      return Response.json(registryIndex);
    }) as unknown as typeof fetch;
    const client = new RegistryClient({ cacheDir: await tempDir(), env: { ACME_TOKEN: "user-secret" }, fetchImpl });
    const entry = {
      url: "https://registry.example/{name}.json",
      headers: { Authorization: "Bearer ${ACME_TOKEN}" }
    };

    await expect(
      client.fetchRegistryIndex("@acme", entry, { scope: "project", sourcePath: "/project/farrier.config.json" })
    ).rejects.toThrow("move this private registry entry to the user config");
    expect(calls).toBe(0);

    const result = await client.fetchRegistryIndex("@acme", entry, {
      scope: "user",
      sourcePath: "/home/user/.config/farrier/config.json"
    });
    expect(result.value.name).toBe("@acme");
    expect(calls).toBe(1);
  });

  test("project provider shorthand does not attach an ambient provider token", async () => {
    let authorization: string | null = "not-called";
    const client = new RegistryClient({
      cacheDir: await tempDir(),
      env: { GITHUB_TOKEN: "ambient-secret" },
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        authorization = new Headers(init?.headers).get("authorization");
        return Response.json(registryIndex);
      }) as unknown as typeof fetch
    });

    await client.fetchRegistryIndex("@acme", "github:acme/public-registry", {
      scope: "project",
      sourcePath: "/project/farrier.config.json"
    });
    expect(authorization).toBeNull();
  });


  test("project-public provider source cannot consume a user-auth cache", async () => {
    const cacheDir = await tempDir();
    const entry = "github:acme/registry";
    const userSource = { scope: "user" as const, sourcePath: "/home/user/.config/farrier/config.json" };
    const projectSource = { scope: "project" as const, sourcePath: "/project/farrier.config.json" };
    await new RegistryClient({
      cacheDir,
      env: { GITHUB_TOKEN: "user-secret" },
      fetchImpl: (async () => Response.json(registryIndex)) as unknown as typeof fetch
    }).fetchRegistryIndex("@acme", entry, userSource);

    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(
      new RegistryClient({ cacheDir, env: { GITHUB_TOKEN: "user-secret" }, fetchImpl: offline })
        .fetchRegistryIndex("@acme", entry, projectSource)
    ).rejects.toThrow("cache belongs to a different source");
  });

  test("rejects credentialed cross-origin redirects before requesting the redirected origin", async () => {
    let calls = 0;
    const client = new RegistryClient({
      cacheDir: await tempDir(),
      env: { ACME_TOKEN: "secret" },
      fetchImpl: (async () => {
        calls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: "https://other.example/registry.json" }
        });
      }) as unknown as typeof fetch
    });

    await expect(
      client.fetchRegistryIndex("@acme", {
        url: "https://registry.example/{name}.json",
        headers: { Authorization: "Bearer ${ACME_TOKEN}" }
      })
    ).rejects.toThrow("credentialed cross-origin redirect");
    expect(calls).toBe(1);
  });

  test("rejects corrupt and cross-source cache fallback", async () => {
    const cacheDir = await tempDir();
    const entry = "https://one.example/{name}.json";
    const first = new RegistryClient({
      cacheDir,
      env: {},
      fetchImpl: (async () => Response.json(registryIndex)) as unknown as typeof fetch
    });
    await first.fetchRegistryIndex("@acme", entry);

    await writeFile(join(cacheDir, "registries", "@acme", "registry.json"), "{\"tampered\":true}\n", "utf8");
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(new RegistryClient({ cacheDir, env: {}, fetchImpl: offline }).fetchRegistryIndex("@acme", entry)).rejects.toThrow(
      "cache digest is corrupt"
    );

    await expect(
      new RegistryClient({ cacheDir, env: {}, fetchImpl: offline }).fetchRegistryIndex(
        "@acme",
        "https://two.example/{name}.json"
      )
    ).rejects.toThrow("cache belongs to a different source");
  });



  test("resolves cached historical bytes against the pinned version after latest advances", async () => {
    const cacheDir = await tempDir();
    const entry = "https://registry.example/{name}.json";
    const configSource = { scope: "user" as const, sourcePath: "/home/user/.config/farrier/config.json" };
    const descriptorV1 = { name: "demo", type: "pack" as const, version: "1.0.0" };
    const descriptorV2 = { name: "demo", type: "pack" as const, version: "2.0.0" };
    const item = (version: string) => ({
      schemaVersion: 1,
      type: "pack",
      name: "demo",
      version,
      pack: {
        detect: {},
        skills: [],
        hooks: [],
        verbs: { check: "true", test: "true", fmt: "true" }
      }
    });

    const v1 = await new RegistryClient({
      cacheDir,
      env: {},
      fetchImpl: (async () => Response.json(item("1.0.0"))) as unknown as typeof fetch
    }).fetchRegistryItem("@acme", entry, descriptorV1, configSource);

    const latestClient = new RegistryClient({
      cacheDir,
      env: {},
      fetchImpl: (async () => Response.json(item("2.0.0"))) as unknown as typeof fetch
    });
    const v2 = await latestClient.fetchRegistryItem("@acme", entry, descriptorV2, configSource);
    expect(v2.value.version).toBe("2.0.0");

    const pinned = await latestClient.fetchRegistryItemPinned(
      "@acme",
      entry,
      descriptorV2,
      {
        type: "pack",
        version: "1.0.0",
        sha256: v1.sha256,
        sourceIdentity: v1.sourceIdentity!
      },
      configSource
    );
    expect(pinned?.value.version).toBe("1.0.0");
    expect(pinned?.sha256).toBe(v1.sha256);
    expect(pinned?.sourceIdentity).toBe(v1.sourceIdentity);
  });

  test("bounds registry response bodies", async () => {
    const client = new RegistryClient({
      cacheDir: await tempDir(),
      env: {},
      maxResponseBytes: 32,
      fetchImpl: (async () => new Response(JSON.stringify(registryIndex))) as unknown as typeof fetch
    });

    await expect(
      client.fetchRegistryIndex("@acme", "https://registry.example/{name}.json")
    ).rejects.toThrow("exceeds 32 bytes");
  });

  test("schema-invalid registry responses raise schema errors", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          schemaVersion: 1,
          name: "@other",
          items: []
        });
      }
    });

    try {
      const client = new RegistryClient({
        cacheDir: await tempDir(),
        env: {}
      });

      let error: unknown;
      try {
        await client.fetchRegistryIndex("@acme", `http://127.0.0.1:${server.port}/{name}.json`);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(RegistryError);
      expect((error as RegistryError).kind).toBe("schema");
      expect((error as Error).message).toContain("registry.name");
    } finally {
      await server.stop(true);
    }
  });
});
