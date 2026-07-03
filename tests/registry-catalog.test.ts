import { describe, expect, test } from "bun:test";
import type { FarrierConfig, RegistryEntryConfig } from "../src/config/farrier-config";
import { detectPacks } from "../src/engine/detect";
import { loadPackCatalog, type RegistryCatalogClient } from "../src/registry/catalog";
import type { RegistryFetchResult } from "../src/registry/client";
import type { RegistryIndex, RegistryIndexItem, RegistryItem } from "../src/registry/schema";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function result<T>(value: T, fromCache = false): RegistryFetchResult<T> {
  return {
    value,
    raw: JSON.stringify(value),
    sha256: `${value && typeof value === "object" && "name" in value ? String(value.name) : "registry"}-${fromCache ? "cached" : "fresh"}`.padEnd(64, "0"),
    fromCache
  };
}

function packItem(name: string, pack: RegistryItem & { type: "pack" }): RegistryItem {
  return {
    ...pack,
    name
  };
}

function fixtureClient(registries: Record<string, { index: RegistryIndex; items: RegistryItem[] }>): RegistryCatalogClient {
  return {
    async fetchRegistryIndex(namespace: string, _entry: RegistryEntryConfig) {
      const registry = registries[namespace];
      if (!registry) {
        throw new Error(`missing registry ${namespace}`);
      }
      return result(registry.index);
    },
    async fetchRegistryItem(namespace: string, _entry: RegistryEntryConfig, item: RegistryIndexItem) {
      const registry = registries[namespace];
      const found = registry?.items.find((candidate) => candidate.name === item.name && candidate.type === item.type);
      if (!found) {
        throw new Error(`missing item ${namespace}/${item.name}`);
      }
      return result(found);
    }
  };
}

function failingClient(message: string): RegistryCatalogClient {
  return {
    async fetchRegistryIndex() {
      throw new Error(message);
    },
    async fetchRegistryItem() {
      throw new Error(message);
    }
  };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-catalog-"));
}

const baseConfig: FarrierConfig = {
  useDefaultPacks: true,
  registries: {
    "@acme": "https://registry.example/{name}.json",
    "@platform": "https://platform.example/{name}.json"
  },
  models: {}
};

const guardHook: RegistryItem = {
  schemaVersion: 1,
  type: "hook",
  name: "guard",
  version: "1.2.0",
  hook: {
    hookVersion: 3,
    events: [{ event: "PreToolUse", matcher: "Bash" }],
    entry: "guard.py",
    runner: "python3",
    files: [{ path: "guard.py", content: "print('guard')\n", executable: true }]
  }
};

const skillBundle: RegistryItem = {
  schemaVersion: 1,
  type: "skill",
  name: "bundle",
  version: "2.0.0",
  skill: {
    refs: ["github.com/acme/skills@python-style", "github.com/acme/skills@testing"]
  }
};

const demoPack: RegistryItem = {
  schemaVersion: 1,
  type: "pack",
  name: "demo",
  version: "1.0.0",
  description: "Acme demo pack",
  pack: {
    extends: "python-uv",
    detect: {
      files: ["acme.toml"]
    },
    skills: ["@acme/bundle"],
    hooks: ["@acme/guard"],
    agentsRules: ["Use the Acme platform CLI."]
  }
};

const platformPack: RegistryItem = {
  schemaVersion: 1,
  type: "pack",
  name: "service",
  version: "1.0.0",
  description: "Platform service",
  pack: {
    extends: "@acme/demo",
    detect: {
      files: ["platform.toml"]
    },
    skills: [],
    hooks: [],
    verbs: {
      check: "platform check",
      test: "platform test",
      fmt: "platform fmt"
    }
  }
};

const registries = {
  "@acme": {
    index: {
      schemaVersion: 1 as const,
      name: "@acme",
      items: [
        { name: "guard", type: "hook" as const, version: "1.2.0" },
        { name: "bundle", type: "skill" as const, version: "2.0.0" },
        { name: "demo", type: "pack" as const, version: "1.0.0", description: "Acme demo pack" }
      ]
    },
    items: [guardHook, skillBundle, demoPack]
  },
  "@platform": {
    index: {
      schemaVersion: 1 as const,
      name: "@platform",
      items: [{ name: "service", type: "pack" as const, version: "1.0.0", description: "Platform service" }]
    },
    items: [platformPack]
  }
};

describe("PackCatalog", () => {
  test("loads remote registries, resolves cross-registry extends, hooks, skills, and pins", async () => {
    const catalog = await loadPackCatalog({
      config: baseConfig,
      client: fixtureClient(registries)
    });

    expect(catalog.packIds().slice(0, 2)).toEqual(["generic", "python-fastapi"]);
    expect(catalog.packIds()).toContain("@acme/demo");
    expect(catalog.packIds()).toContain("@platform/service");

    const resolved = catalog.resolvePack("@platform/service");

    expect(resolved.packIds).toEqual(["python-uv", "@acme/demo", "@platform/service"]);
    expect(resolved.verbs.check).toBe("platform check");
    expect(resolved.skills).toContain("github.com/acme/skills@python-style");
    expect(resolved.skills).toContain("github.com/acme/skills@testing");
    expect(resolved.hooks).toContain("@acme/guard");
    expect(resolved.remoteHooks).toHaveLength(1);
    expect(resolved.remoteHooks[0]).toMatchObject({
      id: "@acme/guard",
      hookVersion: 3,
      entry: "guard.py",
      runner: "python3"
    });

    expect(catalog.remoteHook("@acme/guard")?.files[0]?.content).toContain("guard");
    expect(catalog.registryPins()).toMatchObject({
      "@acme/guard": { type: "hook", version: "1.2.0" },
      "@acme/bundle": { type: "skill", version: "2.0.0" },
      "@acme/demo": { type: "pack", version: "1.0.0" },
      "@platform/service": { type: "pack", version: "1.0.0" }
    });
  });

  test("useDefaultPacks false hides builtins from listing and detection, but not resolution", async () => {
    const catalog = await loadPackCatalog({
      config: {
        ...baseConfig,
        useDefaultPacks: false
      },
      client: fixtureClient(registries)
    });

    expect(catalog.packIds()).toEqual(["@acme/demo", "@platform/service"]);
    expect(catalog.listings().map((listing) => listing.id)).toEqual(["@acme/demo", "@platform/service"]);
    expect(catalog.detectablePackIds()).toEqual(["@acme/demo", "@platform/service"]);
    expect(catalog.resolvePack("generic").id).toBe("generic");
    expect(catalog.resolvePack("@acme/demo").packIds).toEqual(["python-uv", "@acme/demo"]);
  });

  test("remote packs participate in detection after builtins", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "acme.toml"), "stack = true\n", "utf8");

    const catalog = await loadPackCatalog({
      config: baseConfig,
      client: fixtureClient(registries)
    });

    await expect(detectPacks(dir, catalog)).resolves.toEqual(["@acme/demo"]);
  });

  test("detects extends cycles", async () => {
    const config: FarrierConfig = {
      useDefaultPacks: true,
      registries: {
        "@acme": "https://registry.example/{name}.json"
      },
      models: {}
    };
    const client = fixtureClient({
      "@acme": {
        index: {
          schemaVersion: 1,
          name: "@acme",
          items: [
            { name: "a", type: "pack", version: "1.0.0" },
            { name: "b", type: "pack", version: "1.0.0" }
          ]
        },
        items: [
          packItem("a", {
            schemaVersion: 1,
            type: "pack",
            name: "a",
            version: "1.0.0",
            pack: { extends: "@acme/b", detect: {}, skills: [], hooks: [] }
          }),
          packItem("b", {
            schemaVersion: 1,
            type: "pack",
            name: "b",
            version: "1.0.0",
            pack: { extends: "@acme/a", detect: {}, skills: [], hooks: [] }
          })
        ]
      }
    });

    const catalog = await loadPackCatalog({ config, client });

    expect(() => catalog.resolvePack("@acme/a")).toThrow("Pack extends cycle detected: @acme/a -> @acme/b -> @acme/a");
  });

  test("registry failures degrade to warnings unless namespace is required", async () => {
    const config: FarrierConfig = {
      useDefaultPacks: true,
      registries: {
        "@acme": "https://registry.example/{name}.json"
      },
      models: {}
    };

    const catalog = await loadPackCatalog({
      config,
      client: failingClient("network unavailable")
    });

    expect(catalog.warnings).toEqual([
      {
        namespace: "@acme",
        message: "network unavailable"
      }
    ]);
    expect(catalog.packIds()).toContain("generic");

    await expect(
      loadPackCatalog({
        config,
        client: failingClient("network unavailable"),
        requireNamespaces: ["@acme"]
      })
    ).rejects.toThrow("registry @acme unreachable and no local cache");
  });
});
