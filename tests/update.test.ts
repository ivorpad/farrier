import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyUpdate, createUpdateReport, notFarrierProjectMessage } from "../src/engine/update";
import { advisorSkillFiles, createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { rename, rm } from "node:fs/promises";
import { resolvePack } from "../src/packs/index";
import { loadPackCatalog, type RegistryCatalogClient } from "../src/registry/catalog";
import type { RegistryFetchResult } from "../src/registry/client";
import type { RegistryIndex, RegistryIndexItem, RegistryItem } from "../src/registry/schema";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-update-"));
}

async function renderPack(dir: string, packId: string): Promise<void> {
  const pack = resolvePack(packId);
  const plan = await createRenderPlan({ targetDir: dir, pack });
  await writeRenderPlan(plan);
}

/**
 * Build a realistic pre-v3 install: hooks under .claude/hooks, path-only
 * legacy variants of the bindings and justfile, materialized advisor trees,
 * and a v2 manifest listing disabled judge hooks.
 */
async function renderLegacyV2Pack(dir: string, packId: string): Promise<void> {
  await renderPack(dir, packId);

  const hooksDir = join(dir, ".farrier", "hooks");
  const legacyHooksDir = join(dir, ".claude", "hooks");
  await mkdir(join(dir, ".claude"), { recursive: true });
  await rename(hooksDir, legacyHooksDir);
  await rm(join(dir, ".farrier"), { recursive: true, force: true });

  for (const file of [".claude/settings.json", ".codex/hooks.json"]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const content = await readFile(path, "utf8");
    await writeFile(path, content.replaceAll(".farrier/hooks", ".claude/hooks"), "utf8");
  }

  // Byte-exact v2 justfile: one full check aggregate including the hook
  // self-test suite, and no fast gate.
  await writeFile(
    join(dir, "justfile"),
    `check:
  uv run ruff check . && uv run pytest && uv run --with pytest pytest .claude/hooks

test:
  uv run pytest

fmt:
  uv run ruff format .

konpy:
  # Temporary local path dependency; upgrade path: git dependency, then PyPI.
  ${resolvePack(packId).verbs.konsistent}
`,
    "utf8"
  );

  for (const agent of ["claude", "codex"] as const) {
    for (const file of await advisorSkillFiles(agent)) {
      const absolute = join(dir, file.path);
      await mkdir(join(absolute, ".."), { recursive: true });
      await writeFile(absolute, file.content, "utf8");
    }
  }

  const manifestPath = join(dir, ".farrier.json");
  const manifest = await readJson(manifestPath);
  delete manifest.advisors;
  manifest.hookIds = [...(manifest.hookIds as string[]), "quality-judge", "stop-judge"];
  manifest.judge = {
    perEdit: { enabled: false, backend: "claude", model: "haiku", timeoutMs: 15000, prompt: ".claude/hooks/prompts/quality-judge-v1.txt" },
    stop: { enabled: false, backend: "claude", model: "sonnet", timeoutMs: 30000, prompt: ".claude/hooks/prompts/stop-judge-v1.txt", maxDiffBytes: 120000, maxUntrackedFiles: 50 }
  };
  (manifest.versions as Record<string, unknown>).farrierManifest = 2;
  (manifest.versions as { hooks: Record<string, number> }).hooks["quality-judge"] = 4;
  (manifest.versions as { hooks: Record<string, number> }).hooks["stop-judge"] = 3;
  await writeJson(manifestPath, manifest);
}


async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function registryResult<T>(value: T, sha256: string): RegistryFetchResult<T> {
  return {
    value,
    raw: JSON.stringify(value),
    sha256,
    fromCache: false
  };
}

function remoteRegistryClient(input: {
  hookVersion: number;
  hookContent: string;
  hookSha: string;
  packSha: string;
}): RegistryCatalogClient {
  const index: RegistryIndex = {
    schemaVersion: 1,
    name: "@acme",
    items: [
      { name: "guard", type: "hook", version: `${input.hookVersion}.0.0` },
      { name: "demo", type: "pack", version: "1.0.0" }
    ]
  };
  const hook: RegistryItem = {
    schemaVersion: 1,
    type: "hook",
    name: "guard",
    version: `${input.hookVersion}.0.0`,
    hook: {
      hookVersion: input.hookVersion,
      events: [{ event: "PreToolUse", matcher: "Bash" }],
      entry: "guard.sh",
      runner: "bash",
      files: [{ path: "guard.sh", content: input.hookContent }]
    }
  };
  const pack: RegistryItem = {
    schemaVersion: 1,
    type: "pack",
    name: "demo",
    version: "1.0.0",
    pack: {
      extends: "generic",
      detect: {
        files: ["acme.toml"]
      },
      skills: [],
      hooks: ["@acme/guard"]
    }
  };

  return {
    async fetchRegistryIndex() {
      return registryResult(index, "index".padEnd(64, "0"));
    },
    async fetchRegistryItem(_namespace: string, _entry: string, item: RegistryIndexItem) {
      if (item.name === "guard") {
        return registryResult(hook, input.hookSha);
      }
      if (item.name === "demo") {
        return registryResult(pack, input.packSha);
      }
      throw new Error(`missing item ${item.name}`);
    }
  };
}

async function remoteCatalog(input: { hookVersion: number; hookContent: string; hookSha: string; packSha: string }) {
  return loadPackCatalog({
    config: {
      useDefaultPacks: true,
      registries: {
        "@acme": "https://registry.example/{name}.json"
      },
      models: {}
    },
    client: remoteRegistryClient(input)
  });
}

describe("update engine", () => {
  test("missing manifest errors as non-farrier project", async () => {
    const dir = await tempDir();

    await expect(createUpdateReport({ targetDir: dir })).rejects.toThrow(notFarrierProjectMessage);
  });

  test("reports stack drift but apply does not switch packs", async () => {
    const dir = await tempDir();
    await renderPack(dir, "python-uv");

    await writeFile(
      join(dir, "pyproject.toml"),
      `[project]
name = "example"
dependencies = ["fastapi>=0.110"]
`,
      "utf8"
    );

    const report = await createUpdateReport({ targetDir: dir });

    expect(report.currentPackId).toBe("python-uv");
    expect(report.currentPackIds).toEqual(["python-uv"]);
    expect(report.stackDrift.detectedPackIds).toEqual(["python-fastapi", "python-uv"]);
    expect(report.stackDrift.hasDrift).toBe(true);
    expect(report.stackDrift.suggestedPackId).toBe("python-fastapi");
    expect(report.stackDrift.message).toContain("will not switch packs automatically");

    const result = await applyUpdate({ targetDir: dir });
    expect(result.report.stackDrift.hasDrift).toBe(true);

    const manifest = await readJson(join(dir, ".farrier.json"));
    expect(manifest.packIds).toEqual(["python-uv"]);
  });

  test("reports and repairs missing files, owned drift, hook drift, and preserves user-mutable drift", async () => {
    const dir = await tempDir();
    await renderPack(dir, "python-fastapi");

    await unlink(join(dir, "CLAUDE.md"));
    await writeFile(join(dir, ".farrier", "hooks", "test_secret_shield.py"), "# changed owned hook test\n", "utf8");
    await writeFile(join(dir, "AGENTS.md"), "# custom user instructions\n", "utf8");

    const manifestPath = join(dir, ".farrier.json");
    const manifest = await readJson(manifestPath);
    const versions = manifest.versions as { hooks: Record<string, number> };
    versions.hooks["secret-shield"] = 0;
    await writeJson(manifestPath, manifest);

    const report = await createUpdateReport({ targetDir: dir });

    expect(report.missingInventoryFiles).toContain("CLAUDE.md");
    expect(report.outdatedOwnedFiles).toContain(".farrier/hooks/test_secret_shield.py");
    expect(report.outdatedUserFiles).toContain("AGENTS.md");
    expect(report.hookDrift).toContainEqual({
      hookId: "secret-shield",
      manifestVersion: 0,
      currentVersion: 5
    });
    expect(report.notes).toContain("Manual review required for outdated user-mutable files; update mode will not overwrite them.");

    const result = await applyUpdate({ targetDir: dir });

    expect(result.repairedFiles).toContain("CLAUDE.md");
    expect(result.repairedFiles).toContain(".farrier/hooks/test_secret_shield.py");
    expect(result.repairedFiles).toContain(".farrier.json");
    expect(result.repairedFiles).not.toContain("AGENTS.md");

    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# custom user instructions\n");
    expect(await readFile(join(dir, ".farrier", "hooks", "test_secret_shield.py"), "utf8")).toContain("HOOK = Path(__file__).with_name");

    const repairedManifest = await readJson(manifestPath);
    const repairedVersions = repairedManifest.versions as { hooks: Record<string, number> };
    expect(repairedVersions.hooks["secret-shield"]).toBe(5);
    expect(repairedManifest.farrierVersion).toBe("0.3.0");

    const after = await createUpdateReport({ targetDir: dir });

    expect(after.missingInventoryFiles).toEqual([]);
    expect(after.outdatedOwnedFiles).toEqual([]);
    expect(after.hookDrift).toEqual([]);
    expect(after.outdatedUserFiles).toContain("AGENTS.md");
  });

  test("repairs missing executable hook files with executable mode", async () => {
    const dir = await tempDir();
    await renderPack(dir, "python-fastapi");

    const hookPath = join(dir, ".farrier", "hooks", "secret-shield.py");
    await unlink(hookPath);

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.missingInventoryFiles).toContain(".farrier/hooks/secret-shield.py");

    const result = await applyUpdate({ targetDir: dir });
    expect(result.repairedFiles).toContain(".farrier/hooks/secret-shield.py");

    const mode = (await stat(hookPath)).mode;
    expect(mode & 0o111).not.toBe(0);
  });

  test("defaults old manifests to Claude and preserves an unselected Codex binding", async () => {
    const dir = await tempDir();
    await renderPack(dir, "generic");
    const manifestPath = join(dir, ".farrier.json");
    const manifest = await readJson(manifestPath);
    delete manifest.agents;
    await writeJson(manifestPath, manifest);

    await mkdir(join(dir, ".codex"), { recursive: true });
    const customCodex = '{"hooks":{"PreToolUse":[]},"owner":"user"}\n';
    await writeFile(join(dir, ".codex", "hooks.json"), customCodex, "utf8");

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.agents).toEqual(["claude"]);
    expect(report.missingInventoryFiles).not.toContain(".codex/hooks.json");
    expect(report.outdatedUserFiles).not.toContain(".codex/hooks.json");

    await applyUpdate({ targetDir: dir });
    expect((await readJson(manifestPath)).agents).toEqual(["claude"]);
    expect(await readFile(join(dir, ".codex", "hooks.json"), "utf8")).toBe(customCodex);
  });

  test("repairs a missing selected Codex binding and leaves Claude settings unmanaged", async () => {
    const dir = await tempDir();
    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("generic"), agents: ["codex"] });
    await writeRenderPlan(plan);
    const customClaude = '{"hooks":{},"owner":"user"}\n';
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".claude", "settings.json"), customClaude, "utf8");
    await unlink(join(dir, ".codex", "hooks.json"));

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.agents).toEqual(["codex"]);
    expect(report.missingInventoryFiles).toContain(".codex/hooks.json");
    expect(report.outdatedUserFiles).not.toContain(".claude/settings.json");

    const result = await applyUpdate({ targetDir: dir });
    expect(result.repairedFiles).toContain(".codex/hooks.json");
    expect(existsSync(join(dir, ".codex", "hooks.json"))).toBe(true);
    expect(await readFile(join(dir, ".claude", "settings.json"), "utf8")).toBe(customClaude);
  });

  test("reports but does not overwrite a modified selected Codex binding", async () => {
    const dir = await tempDir();
    const plan = await createRenderPlan({
      targetDir: dir,
      pack: resolvePack("generic"),
      agents: ["claude", "codex"]
    });
    await writeRenderPlan(plan);
    const customCodex = '{"hooks":{},"owner":"reviewed-user-change"}\n';
    await writeFile(join(dir, ".codex", "hooks.json"), customCodex, "utf8");

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.outdatedUserFiles).toContain(".codex/hooks.json");

    const result = await applyUpdate({ targetDir: dir });
    expect(result.repairedFiles).not.toContain(".codex/hooks.json");
    expect(await readFile(join(dir, ".codex", "hooks.json"), "utf8")).toBe(customCodex);
  });

  test("reports and acknowledges Rails Hotwire secondary findings", async () => {
    const dir = await tempDir();
    await renderPack(dir, "rails");

    await writeFile(
      join(dir, "Gemfile"),
      `source "https://rubygems.org"

gem "rails"
gem "turbo-rails"
`,
      "utf8"
    );

    const report = await createUpdateReport({ targetDir: dir });

    expect(report.currentPackId).toBe("rails");
    expect(report.stackDrift.hasDrift).toBe(false);
    expect(report.unacknowledgedSecondaryFindings.map((finding) => finding.id)).toEqual(["rails-hotwire"]);

    const result = await applyUpdate({ targetDir: dir });

    expect(result.acknowledgedSecondaryIds).toEqual(["rails-hotwire"]);
    expect(result.suggestedSkillsNotInstalled).toEqual([]);
    expect(result.repairedFiles).toContain(".farrier.json");

    const manifest = await readJson(join(dir, ".farrier.json"));
    expect(manifest.secondaryAcknowledged).toEqual(["rails-hotwire"]);

    const after = await createUpdateReport({ targetDir: dir });
    expect(after.unacknowledgedSecondaryFindings).toEqual([]);
  });

  test("detects Rails Hotwire secondary findings from app/javascript and acknowledges once", async () => {
    const dir = await tempDir();
    await renderPack(dir, "rails");

    await writeFile(
      join(dir, "Gemfile"),
      `source "https://rubygems.org"

gem "rails"
`,
      "utf8"
    );
    await mkdir(join(dir, "app", "javascript"), { recursive: true });
    await writeFile(join(dir, "app", "javascript", "application.js"), "import '@hotwired/turbo-rails'\n", "utf8");

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.unacknowledgedSecondaryFindings.map((finding) => finding.id)).toEqual(["rails-hotwire"]);

    await applyUpdate({ targetDir: dir });
    const secondApply = await applyUpdate({ targetDir: dir });

    expect(secondApply.acknowledgedSecondaryIds).toEqual([]);

    const manifest = await readJson(join(dir, ".farrier.json"));
    expect(manifest.secondaryAcknowledged).toEqual(["rails-hotwire"]);
  });

  test("reports and repairs remote hook drift, registry pin drift, and remote owned files", async () => {
    const dir = await tempDir();
    const initialCatalog = await remoteCatalog({
      hookVersion: 1,
      hookContent: "echo v1\n",
      hookSha: "hook-v1".padEnd(64, "0"),
      packSha: "pack-v1".padEnd(64, "0")
    });
    const initialPlan = await createRenderPlan({
      targetDir: dir,
      pack: initialCatalog.resolvePack("@acme/demo"),
      registryPins: initialCatalog.registryPins()
    });
    await writeRenderPlan(initialPlan);

    const updatedCatalog = await remoteCatalog({
      hookVersion: 2,
      hookContent: "echo v2\n",
      hookSha: "hook-v2".padEnd(64, "0"),
      packSha: "pack-v1".padEnd(64, "0")
    });
    const report = await createUpdateReport({ targetDir: dir, catalog: updatedCatalog });

    expect(report.hookDrift).toContainEqual({
      hookId: "@acme/guard",
      manifestVersion: 1,
      currentVersion: 2
    });
    expect(report.registryPinDrift).toContainEqual({
      id: "@acme/guard",
      type: "hook",
      manifestVersion: "1.0.0",
      currentVersion: "2.0.0",
      manifestSha256: "hook-v1".padEnd(64, "0"),
      currentSha256: "hook-v2".padEnd(64, "0")
    });
    expect(report.outdatedOwnedFiles).toContain(".farrier/hooks/@acme/guard/guard.sh");

    const result = await applyUpdate({ targetDir: dir, catalog: updatedCatalog });
    expect(result.repairedFiles).toContain(".farrier/hooks/@acme/guard/guard.sh");
    expect(result.repairedFiles).toContain(".farrier.json");

    expect(await readFile(join(dir, ".farrier", "hooks", "@acme", "guard", "guard.sh"), "utf8")).toBe("echo v2\n");

    const manifest = await readJson(join(dir, ".farrier.json"));
    expect((manifest.versions as { hooks: Record<string, number> }).hooks["@acme/guard"]).toBe(2);
    expect((manifest.registry as { items: Record<string, { sha256: string }> }).items["@acme/guard"].sha256).toBe(
      "hook-v2".padEnd(64, "0")
    );
  });

  test("rejects a concurrent edit after review without overwriting it", async () => {
    const dir = await tempDir();
    await renderPack(dir, "python-fastapi");
    const path = join(dir, ".farrier", "hooks", "write-guard.py");
    await writeFile(path, "reviewed drift\n", "utf8");

    await expect(applyUpdate({ targetDir: dir }, {
      beforeTransaction: () => writeFile(path, "concurrent user edit\n", "utf8")
    })).rejects.toThrow("changed after review");
    expect(await readFile(path, "utf8")).toBe("concurrent user edit\n");
  });
  test("migrates a v2 layout: prunes legacy hooks and advisor trees, drops disabled judges", async () => {
    const dir = await tempDir();
    await renderLegacyV2Pack(dir, "python-fastapi");

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.stalePaths).toContain(".claude/hooks/secret-shield.py");
    expect(report.stalePaths).toContain(".claude/skills/harness-advisor/SKILL.md");
    expect(report.migratableUserFiles).toEqual(expect.arrayContaining([".claude/settings.json", "justfile"]));

    const result = await applyUpdate({ targetDir: dir });

    expect(result.prunedPaths).toContain(".claude/hooks/secret-shield.py");
    expect(existsSync(join(dir, ".claude", "hooks"))).toBe(false);
    expect(existsSync(join(dir, ".claude", "skills"))).toBe(false);
    expect(existsSync(join(dir, ".agents"))).toBe(false);
    expect(existsSync(join(dir, ".farrier", "hooks", "secret-shield.py"))).toBe(true);
    expect(existsSync(join(dir, ".farrier", "hooks", "quality-judge.py"))).toBe(false);

    const settings = await readFile(join(dir, ".claude", "settings.json"), "utf8");
    expect(settings).toContain(".farrier/hooks/secret-shield.py");
    expect(settings).not.toContain(".claude/hooks");
    expect(settings).not.toContain("quality-judge.py");

    const manifest = await readJson(join(dir, ".farrier.json"));
    expect((manifest.versions as { farrierManifest: number }).farrierManifest).toBe(3);
    expect(manifest.hookIds).toEqual(["secret-shield", "tool-policy", "write-guard", "verb-runner"]);
    expect(manifest.judge).toBeUndefined();
    expect(manifest.advisors).toBe(false);
  });

  test("migration carries learned tool-policy rules into the new rules file", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "uv.lock"), "", "utf8");
    await renderLegacyV2Pack(dir, "python-fastapi");

    const legacyRulesPath = join(dir, ".claude", "hooks", "tool-policy-rules.json");
    const legacyRules = await readJson(legacyRulesPath);
    (legacyRules.rules as unknown[]).push({
      id: "learned-no-curl-pipe-sh",
      description: "Learned rule",
      tool: "Bash",
      commandPattern: "curl[^|]*\\|\\s*sh",
      message: "Do not pipe curl to sh.",
      redirect: "Download and inspect scripts first."
    });
    await writeJson(legacyRulesPath, legacyRules);

    const result = await applyUpdate({ targetDir: dir });
    expect(result.prunedPaths).toContain(".claude/hooks/tool-policy-rules.json");

    const migrated = await readJson(join(dir, ".farrier", "hooks", "tool-policy-rules.json"));
    const ids = (migrated.rules as Array<{ id: string }>).map((rule) => rule.id);
    expect(ids).toContain("python-use-uv-not-pip-install");
    expect(ids).toContain("learned-no-curl-pipe-sh");
  });

  test("migration never removes diverged legacy files", async () => {
    const dir = await tempDir();
    await renderLegacyV2Pack(dir, "python-fastapi");

    await writeFile(join(dir, ".claude", "hooks", "tool-policy-rules.json"), "{not json", "utf8");
    const advisorPath = join(dir, ".claude", "skills", "harness-advisor", "SKILL.md");
    await writeFile(advisorPath, "# my customized advisor\n", "utf8");

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.staleBlockedPaths).toContain(".claude/hooks/tool-policy-rules.json");
    expect(report.staleBlockedPaths).toContain(".claude/skills/harness-advisor/SKILL.md");

    await applyUpdate({ targetDir: dir });

    expect(existsSync(join(dir, ".claude", "hooks", "tool-policy-rules.json"))).toBe(true);
    expect(await readFile(advisorPath, "utf8")).toBe("# my customized advisor\n");
  });
});
