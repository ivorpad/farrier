import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFarrierConfig } from "../src/config/farrier-config";
import { loadStartupChoice, saveStartupChoice } from "../src/config/startup-choice";

async function scratchConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "farrier-startup-choice-"));
  return join(dir, "config.json");
}

describe("remembered startup choice in the user-level farrier config", () => {
  test("no config file means no remembered choice", async () => {
    const path = await scratchConfigPath();
    expect(await loadStartupChoice({ FARRIER_CONFIG: path })).toBeUndefined();
  });

  test("save then load round-trips the agent and model picks", async () => {
    const path = await scratchConfigPath();
    const env = { FARRIER_CONFIG: path };

    await saveStartupChoice({ agent: "both", models: { claude: "sonnet", codex: "gpt-5.5" } }, env);

    expect(await loadStartupChoice(env)).toEqual({
      agent: "both",
      models: { claude: "sonnet", codex: "gpt-5.5" }
    });
  });

  test("saving rewrites only the startup key and preserves the rest of the file", async () => {
    const path = await scratchConfigPath();
    const env = { FARRIER_CONFIG: path };
    await writeFile(
      path,
      JSON.stringify({ registries: { "@acme": "https://registry.example" }, models: { claude: { advise: "opus" } } }, null, 2)
    );

    await saveStartupChoice({ agent: "claude", models: {} }, env);

    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(raw.registries).toEqual({ "@acme": "https://registry.example" });
    expect(raw.models).toEqual({ claude: { advise: "opus" } });
    expect(raw.startup).toEqual({ agent: "claude" });
  });

  test("an unrecognized remembered value reads as no remembered choice", async () => {
    const path = await scratchConfigPath();
    await writeFile(path, JSON.stringify({ startup: { agent: "copilot" } }));
    expect(await loadStartupChoice({ FARRIER_CONFIG: path })).toBeUndefined();

    await writeFile(path, "{ not json");
    expect(await loadStartupChoice({ FARRIER_CONFIG: path })).toBeUndefined();
  });

  test("saving refuses to clobber a config file it cannot parse", async () => {
    const path = await scratchConfigPath();
    await writeFile(path, "{ broken json");

    await expect(saveStartupChoice({ agent: "codex", models: {} }, { FARRIER_CONFIG: path })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("{ broken json");
  });

  test("loadFarrierConfig tolerates the startup key alongside its own keys", async () => {
    const path = await scratchConfigPath();
    const env = { FARRIER_CONFIG: path };
    await saveStartupChoice({ agent: "codex", models: { codex: "gpt-5.5" } }, env);

    const loaded = await loadFarrierConfig({ projectDir: await mkdtemp(join(tmpdir(), "farrier-project-")), env });
    expect(loaded.config.useDefaultPacks).toBe(true);
  });
});
