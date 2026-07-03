import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFarrierConfig, resolveModelSettings } from "../src/config/farrier-config";

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
      registries: {},
      models: {}
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
      },
      models: {}
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

describe("loadFarrierConfig models", () => {
  test("parses string and object model entries", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "farrier.config.json"), {
      models: {
        claude: { default: "sonnet", skillCreation: "opus" },
        codex: {
          default: { model: "gpt-5.5", reasoningEffort: "medium" },
          skillCreation: { reasoningEffort: "xhigh" }
        }
      }
    });

    const loaded = await loadFarrierConfig({ projectDir: dir, env: { HOME: await tempDir() } });

    expect(loaded.config.models).toEqual({
      claude: { default: "sonnet", skillCreation: "opus" },
      codex: {
        default: { model: "gpt-5.5", reasoningEffort: "medium" },
        skillCreation: { reasoningEffort: "xhigh" }
      }
    });
  });

  test("project role entry replaces user's while user default survives", async () => {
    const dir = await tempDir();
    const xdg = await tempDir();
    await writeJson(join(xdg, "farrier", "config.json"), {
      models: {
        claude: { default: "sonnet", skillCreation: "opus" }
      }
    });
    await writeJson(join(dir, "farrier.config.json"), {
      models: {
        claude: { skillCreation: "haiku" }
      }
    });

    const loaded = await loadFarrierConfig({ projectDir: dir, env: { XDG_CONFIG_HOME: xdg, HOME: "/unused" } });

    expect(loaded.config.models).toEqual({
      claude: { default: "sonnet", skillCreation: "haiku" }
    });
  });

  test("rejects an unknown role key", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "farrier.config.json"), {
      models: { claude: { bogus: "sonnet" } }
    });

    await expect(loadFarrierConfig({ projectDir: dir, env: { HOME: await tempDir() } })).rejects.toThrow(
      "models.claude.bogus is not a known role"
    );
  });

  test("rejects an unknown backend key", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "farrier.config.json"), {
      models: { gemini: { default: "flash" } }
    });

    await expect(loadFarrierConfig({ projectDir: dir, env: { HOME: await tempDir() } })).rejects.toThrow(
      "models.gemini is not a known backend"
    );
  });

  test("rejects reasoningEffort under claude", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "farrier.config.json"), {
      models: { claude: { default: { model: "sonnet", reasoningEffort: "high" } } }
    });

    await expect(loadFarrierConfig({ projectDir: dir, env: { HOME: await tempDir() } })).rejects.toThrow(
      "reasoningEffort is only supported for codex"
    );
  });

  test("rejects a bad reasoning effort value", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "farrier.config.json"), {
      models: { codex: { default: { reasoningEffort: "turbo" } } }
    });

    await expect(loadFarrierConfig({ projectDir: dir, env: { HOME: await tempDir() } })).rejects.toThrow(
      "reasoningEffort must be one of"
    );
  });

  test("rejects a non-string model", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "farrier.config.json"), {
      models: { claude: { default: { model: 42 } } }
    });

    await expect(loadFarrierConfig({ projectDir: dir, env: { HOME: await tempDir() } })).rejects.toThrow(
      "models.claude.default.model must be a non-empty string"
    );
  });
});

describe("resolveModelSettings", () => {
  test("explicit model beats config", () => {
    const resolved = resolveModelSettings({
      models: { claude: { default: "sonnet", skillCreation: "opus" } },
      backend: "claude",
      role: "skillCreation",
      explicitModel: "haiku"
    });
    expect(resolved).toEqual({ model: "haiku" });
  });

  test("role model beats default", () => {
    const resolved = resolveModelSettings({
      models: { claude: { default: "sonnet", skillCreation: "opus" } },
      backend: "claude",
      role: "skillCreation"
    });
    expect(resolved).toEqual({ model: "opus" });
  });

  test("field merge: role sets effort, default supplies model", () => {
    const resolved = resolveModelSettings({
      models: {
        codex: {
          default: { model: "gpt-5.5", reasoningEffort: "medium" },
          skillCreation: { reasoningEffort: "xhigh" }
        }
      },
      backend: "codex",
      role: "skillCreation"
    });
    expect(resolved).toEqual({ model: "gpt-5.5", reasoningEffort: "xhigh" });
  });

  test("empty config resolves to all undefined", () => {
    const resolved = resolveModelSettings({ models: {}, backend: "codex", role: "eval" });
    expect(resolved.model).toBeUndefined();
    expect(resolved.reasoningEffort).toBeUndefined();
    expect(resolved).toEqual({});
  });
});
