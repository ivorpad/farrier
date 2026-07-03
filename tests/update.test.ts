import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyUpdate, createUpdateReport, notFarrierProjectMessage } from "../src/engine/update";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
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
      }
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
    await writeFile(join(dir, ".claude", "hooks", "test_secret_shield.py"), "# changed owned hook test\n", "utf8");
    await writeFile(join(dir, "AGENTS.md"), "# custom user instructions\n", "utf8");

    const manifestPath = join(dir, ".farrier.json");
    const manifest = await readJson(manifestPath);
    const versions = manifest.versions as { hooks: Record<string, number> };
    versions.hooks["secret-shield"] = 0;
    await writeJson(manifestPath, manifest);

    const report = await createUpdateReport({ targetDir: dir });

    expect(report.missingInventoryFiles).toContain("CLAUDE.md");
    expect(report.outdatedOwnedFiles).toContain(".claude/hooks/test_secret_shield.py");
    expect(report.outdatedUserFiles).toContain("AGENTS.md");
    expect(report.hookDrift).toContainEqual({
      hookId: "secret-shield",
      manifestVersion: 0,
      currentVersion: 1
    });
    expect(report.notes).toContain("Manual review required for outdated user-mutable files; update mode will not overwrite them.");

    const result = await applyUpdate({ targetDir: dir });

    expect(result.repairedFiles).toContain("CLAUDE.md");
    expect(result.repairedFiles).toContain(".claude/hooks/test_secret_shield.py");
    expect(result.repairedFiles).toContain(".farrier.json");
    expect(result.repairedFiles).not.toContain("AGENTS.md");

    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# custom user instructions\n");
    expect(await readFile(join(dir, ".claude", "hooks", "test_secret_shield.py"), "utf8")).toContain("HOOK = Path(__file__).with_name");

    const repairedManifest = await readJson(manifestPath);
    const repairedVersions = repairedManifest.versions as { hooks: Record<string, number> };
    expect(repairedVersions.hooks["secret-shield"]).toBe(1);
    expect(repairedManifest.farrierVersion).toBe("0.1.0");

    const after = await createUpdateReport({ targetDir: dir });

    expect(after.missingInventoryFiles).toEqual([]);
    expect(after.outdatedOwnedFiles).toEqual([]);
    expect(after.hookDrift).toEqual([]);
    expect(after.outdatedUserFiles).toContain("AGENTS.md");
  });

  test("repairs missing executable hook files with executable mode", async () => {
    const dir = await tempDir();
    await renderPack(dir, "python-fastapi");

    const hookPath = join(dir, ".claude", "hooks", "secret-shield.py");
    await unlink(hookPath);

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.missingInventoryFiles).toContain(".claude/hooks/secret-shield.py");

    const result = await applyUpdate({ targetDir: dir });
    expect(result.repairedFiles).toContain(".claude/hooks/secret-shield.py");

    const mode = (await stat(hookPath)).mode;
    expect(mode & 0o111).not.toBe(0);
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
    expect(report.outdatedOwnedFiles).toContain(".claude/hooks/@acme/guard/guard.sh");

    const result = await applyUpdate({ targetDir: dir, catalog: updatedCatalog });
    expect(result.repairedFiles).toContain(".claude/hooks/@acme/guard/guard.sh");
    expect(result.repairedFiles).toContain(".farrier.json");

    expect(await readFile(join(dir, ".claude", "hooks", "@acme", "guard", "guard.sh"), "utf8")).toBe("echo v2\n");

    const manifest = await readJson(join(dir, ".farrier.json"));
    expect((manifest.versions as { hooks: Record<string, number> }).hooks["@acme/guard"]).toBe(2);
    expect((manifest.registry as { items: Record<string, { sha256: string }> }).items["@acme/guard"].sha256).toBe(
      "hook-v2".padEnd(64, "0")
    );
  });
});
