import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
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
