import { describe, expect, test } from "bun:test";
import { lstat, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegistryClient } from "../src/registry/client";

describe("registry client cache concurrency", () => {
  test("parallel live item fetches never fall back to their newly written cache", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "farrier-registry-parallel-"));
    const descriptors = Array.from({ length: 12 }, (_, index) => ({
      name: `guard-${index}`,
      type: "hook" as const,
      version: "1.0.0",
    }));
    let requests = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchImpl = (async (input: string | URL | Request) => {
      requests += 1;
      if (requests === descriptors.length) release();
      await gate;
      const name = new URL(String(input)).pathname.split("/").at(-1)!.replace(/\.json$/, "");
      return Response.json({
        schemaVersion: 1,
        type: "hook",
        name,
        version: "1.0.0",
        hook: {
          hookVersion: 4,
          events: [{ event: "PreToolUse", matcher: "Bash" }],
          entry: "guard.sh",
          runner: "bash",
          files: [{ path: "guard.sh", content: "echo guard\n" }],
        },
      });
    }) as unknown as typeof fetch;
    const client = new RegistryClient({ cacheDir, env: {}, fetchImpl });

    const results = await Promise.all(descriptors.map((descriptor) =>
      client.fetchRegistryItem("@acme", "https://registry.example/{name}.json", descriptor)));

    expect(requests).toBe(descriptors.length);
    expect(results.every((result) => result.fromCache === false)).toBeTrue();
    expect(await lstat(join(cacheDir, "registries", "@acme", ".farrier-staging"))
      .catch(() => undefined)).toBeUndefined();
  });
});
