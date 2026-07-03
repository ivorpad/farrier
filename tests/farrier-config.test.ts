import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFarrierConfig } from "../src/config/farrier-config";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-config-"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("loadFarrierConfig", () => {
  test("missing user and project files returns defaults", async () => {
    const dir = await tempDir();
    const home = await tempDir();

    const loaded = await loadFarrierConfig({
      projectDir: dir,
      env: { HOME: home }
    });

    expect(loaded.config).toEqual({
      useDefaultPacks: true,
      registries: {}
    });
    expect(loaded.loadedPaths).toEqual([]);
    expect(loaded.userConfigPath).toBe(join(home, ".config", "farrier", "config.json"));
    expect(loaded.projectConfigPath).toBe(join(dir, "farrier.config.json"));
  });

  test("loads XDG user config and lets project config replace namespaces wholesale", async () => {
    const dir = await tempDir();
    const xdg = await tempDir();
    const userPath = join(xdg, "farrier", "config.json");
    const projectPath = join(dir, "farrier.config.json");

    await writeJson(userPath, {
      useDefaultPacks: false,
      registries: {
        "@acme": {
          url: "https://user.example/{name}.json",
          headers: {
            Authorization: "Bearer ${USER_TOKEN}"
          }
        },
        "@shared": "github:shared/farrier-registry@main"
      }
    });
    await writeJson(projectPath, {
      registries: {
        "@acme": "https://project.example/{name}.json"
      }
    });

    const loaded = await loadFarrierConfig({
      projectDir: dir,
      env: { XDG_CONFIG_HOME: xdg, HOME: "/unused" }
    });

    expect(loaded.config).toEqual({
      useDefaultPacks: false,
      registries: {
        "@acme": "https://project.example/{name}.json",
        "@shared": "github:shared/farrier-registry@main"
      }
    });
    expect(loaded.loadedPaths).toEqual([userPath, projectPath]);
  });

  test("FARRIER_CONFIG overrides the user config path and project wins useDefaultPacks", async () => {
    const dir = await tempDir();
    const overridePath = join(await tempDir(), "enterprise.json");
    const projectPath = join(dir, "farrier.config.json");

    await writeJson(overridePath, {
      useDefaultPacks: false,
      registries: {
        "@acme": "github:acme/registry"
      }
    });
    await writeJson(projectPath, {
      useDefaultPacks: true,
      registries: {
        "@platform": {
          url: "https://platform.example/{name}.json"
        }
      }
    });

    const loaded = await loadFarrierConfig({
      projectDir: dir,
      env: {
        FARRIER_CONFIG: overridePath,
        HOME: "/unused"
      }
    });

    expect(loaded.userConfigPath).toBe(overridePath);
    expect(loaded.config.useDefaultPacks).toBe(true);
    expect(loaded.config.registries).toEqual({
      "@acme": "github:acme/registry",
      "@platform": {
        url: "https://platform.example/{name}.json"
      }
    });
  });

  test("rejects invalid namespace keys", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "farrier.config.json"), {
      registries: {
        acme: "https://example.test/{name}.json"
      }
    });

    await expect(loadFarrierConfig({ projectDir: dir, env: { HOME: await tempDir() } })).rejects.toThrow(
      "registry namespace 'acme' must match"
    );
  });

  test("malformed JSON is a hard error naming the path", async () => {
    const dir = await tempDir();
    const path = join(dir, "farrier.config.json");
    await writeFile(path, "{not json", "utf8");

    await expect(loadFarrierConfig({ projectDir: dir, env: { HOME: await tempDir() } })).rejects.toThrow(
      `invalid farrier config ${path}:`
    );
  });
});
