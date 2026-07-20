import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  manifestToInput,
  notFarrierProjectMessage,
  readManifest,
} from "../src/engine/manifest";
import { resolvePack } from "../src/packs/index";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "manifests");

async function manifestProject(name: string): Promise<{ root: string; text: string }> {
  const root = await mkdtemp(join(tmpdir(), "farrier-manifest-"));
  const text = await readFile(join(fixtureDir, name), "utf8");
  await writeFile(join(root, ".farrier.json"), text, "utf8");
  return { root, text };
}

describe("manifest service", () => {
  test("reads missing, v1, and finite v2 versions under existing permissive semantics", async () => {
    const missing = await manifestProject("missing-version.json");
    const v1 = await manifestProject("current-v1.json");
    const v2 = await manifestProject("version-2.json");

    expect((await readManifest(missing.root)).versions.farrierManifest).toBeNull();
    expect((await readManifest(v1.root)).versions.farrierManifest).toBe(1);
    expect((await readManifest(v2.root)).versions.farrierManifest).toBe(2);
  });

  test("keeps legacy skill string arrays and falls back to pack skills only when omitted", async () => {
    const legacy = await manifestProject("legacy-skills.json");
    const omitted = await manifestProject("missing-version.json");

    expect((await readManifest(legacy.root)).skills).toEqual([
      "owner/repository@first-skill",
      "another/source@second-skill",
    ]);
    expect((await readManifest(omitted.root)).skills).toEqual(resolvePack("generic").skills);
  });

  test("normalizes registry pins and converts without changing manifest shapes", async () => {
    const project = await manifestProject("registry-pins.json");
    const manifest = await readManifest(project.root);
    const input = manifestToInput(manifest);

    expect(manifest.registry.items["@acme/platform-skill"]).toEqual({
      type: "skill",
      version: "1.2.3",
      sha256: "a".repeat(64),
      sourceIdentity: "https://registry.example",
      ref: "@acme/platform-skill",
    });
    expect(input.skills).toEqual(["@acme/platform-skill"]);
    expect(input.registry?.items).toEqual(manifest.registry.items);
  });

  test("preserves unsupported-hook, malformed-JSON, and missing-manifest errors", async () => {
    const unsupported = await manifestProject("unsupported-hook.json");
    const malformed = await manifestProject("malformed.json");
    const missing = await mkdtemp(join(tmpdir(), "farrier-manifest-missing-"));

    await expect(readManifest(unsupported.root)).rejects.toThrow(
      "invalid .farrier.json: unsupported hook id 'not-a-hook'",
    );
    await expect(readManifest(malformed.root)).rejects.toThrow("invalid .farrier.json:");
    await expect(readManifest(missing)).rejects.toThrow(notFarrierProjectMessage);
  });

  test("rejects linked and oversized manifests through the contained reader", async () => {
    const linkedRoot = await mkdtemp(join(tmpdir(), "farrier-manifest-linked-"));
    const outside = join(await mkdtemp(join(tmpdir(), "farrier-manifest-outside-")), "manifest.json");
    await writeFile(outside, JSON.stringify({ packIds: ["generic"] }), "utf8");
    await symlink(outside, join(linkedRoot, ".farrier.json"));
    await expect(readManifest(linkedRoot)).rejects.toThrow(
      "invalid .farrier.json: manifest was not read (symlink)",
    );

    const oversizedRoot = await mkdtemp(join(tmpdir(), "farrier-manifest-oversized-"));
    await writeFile(join(oversizedRoot, ".farrier.json"), " ".repeat(1024 * 1024 + 1), "utf8");
    await expect(readManifest(oversizedRoot)).rejects.toThrow(
      "invalid .farrier.json: manifest was not read (oversized)",
    );
  });

  test("reading and conversion do not rewrite or mutate old manifests", async () => {
    const project = await manifestProject("legacy-skills.json");
    const manifest = await readManifest(project.root);
    const input = manifestToInput(manifest);
    input.skills?.push("new/skill@not-persisted");

    expect(await readFile(join(project.root, ".farrier.json"), "utf8")).toBe(project.text);
    expect(manifest.skills).toEqual([
      "owner/repository@first-skill",
      "another/source@second-skill",
    ]);
  });
});
