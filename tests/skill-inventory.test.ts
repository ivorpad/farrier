import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  inventoryProjectSkills,
  skillInventoryLimits,
  type SkillInventory,
} from "../src/engine/skill-inventory";

async function tempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-skill-inventory-" + label + "-"));
}

async function writeSkill(
  root: string,
  path: string,
  content = "---\nname: example\n---\nInstructions.\n",
): Promise<void> {
  const directory = join(root, path);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), content, "utf8");
}

function topologies(inventory: SkillInventory, name: string): string[] {
  const entry = inventory.entries.find((candidate) => candidate.name === name);
  if (!entry) throw new Error("missing inventory entry " + name);
  return entry.topologies.map((topology) => topology.kind);
}

function malformedReason(inventory: SkillInventory, suffix: string): string {
  return inventory.malformedLocations.find((location) => location.path.endsWith(suffix))?.reason ?? "";
}

async function snapshotTree(root: string): Promise<unknown[]> {
  const output: unknown[] = [];
  async function walk(path: string): Promise<void> {
    const stats = await lstat(path);
    const name = relative(root, path) || ".";
    if (stats.isSymbolicLink()) {
      output.push({ name, kind: "link", mode: stats.mode & 0o777, target: await readlink(path) });
      return;
    }
    if (stats.isFile()) {
      const bytes = await readFile(path);
      output.push({
        name,
        kind: "file",
        mode: stats.mode & 0o777,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        digest: createHash("sha256").update(bytes).digest("hex"),
      });
      return;
    }
    output.push({ name, kind: stats.isDirectory() ? "directory" : "special", mode: stats.mode & 0o777 });
    if (stats.isDirectory()) {
      for (const child of (await readdir(path)).sort()) await walk(join(path, child));
    }
  }
  await walk(root);
  return output;
}

describe("read-only skill topology inventory", () => {
  test("classifies legacy, provider-only, linked, copied, and divergent layouts", async () => {
    const root = await tempDir("topologies");
    await writeSkill(root, "skills/legacy");
    await writeSkill(root, ".agents/skills/codex-only");
    await writeSkill(root, ".claude/skills/claude-only");
    await writeSkill(root, ".agents/skills/shared");
    await mkdir(join(root, ".claude/skills"), { recursive: true });
    await symlink("../../.agents/skills/shared", join(root, ".claude/skills/shared"));
    await writeSkill(root, ".agents/skills/identical", "same bytes\n");
    await writeSkill(root, ".claude/skills/identical", "same bytes\n");
    await writeSkill(root, ".agents/skills/divergent", "codex bytes\n");
    await writeSkill(root, ".claude/skills/divergent", "claude bytes\n");

    const inventory = await inventoryProjectSkills({ targetDir: root });

    expect(topologies(inventory, "legacy")).toEqual(["legacy-canonical"]);
    expect(topologies(inventory, "codex-only")).toEqual(["codex-native"]);
    expect(topologies(inventory, "claude-only")).toEqual(["claude-native"]);
    expect(topologies(inventory, "shared")).toEqual(["linked-shared"]);
    expect(topologies(inventory, "identical")).toEqual(["copied-identical"]);
    expect(topologies(inventory, "divergent")).toEqual(["divergent"]);
    expect(inventory.entries.map((entry) => entry.name)).toEqual([
      "claude-only",
      "codex-only",
      "divergent",
      "identical",
      "legacy",
      "shared",
    ]);
  });

  test("rejects missing skill files and absolute, escaped, broken, chained, or unexpected links", async () => {
    const root = await tempDir("links");
    const outside = join(await tempDir("outside"), "outside.txt");
    await writeFile(outside, "outside", "utf8");
    await mkdir(join(root, ".claude/skills"), { recursive: true });
    await symlink(outside, join(root, ".claude/skills/absolute"));

    await writeSkill(root, ".agents/skills/escaped");
    await symlink("../../../../outside", join(root, ".agents/skills/escaped/reference"));
    await writeSkill(root, ".agents/skills/broken");
    await symlink("missing.txt", join(root, ".agents/skills/broken/reference"));
    await writeSkill(root, ".agents/skills/chained");
    await writeFile(join(root, ".agents/skills/chained/source.txt"), "source", "utf8");
    await symlink("source.txt", join(root, ".agents/skills/chained/second"));
    await symlink("second", join(root, ".agents/skills/chained/first"));
    await writeSkill(root, ".agents/skills/link-source");
    await symlink("link-source", join(root, ".agents/skills/unexpected"));
    await mkdir(join(root, ".agents/skills/missing-skill"), { recursive: true });
    await writeFile(join(root, ".agents/skills/not-a-tree"), "plain file", "utf8");

    const inventory = await inventoryProjectSkills({ targetDir: root });

    for (const name of [
      "absolute",
      "escaped",
      "broken",
      "chained",
      "unexpected",
      "missing-skill",
      "not-a-tree",
    ]) {
      expect(topologies(inventory, name)).toEqual(["invalid"]);
    }
    expect(malformedReason(inventory, "/absolute")).toContain("absolute-link");
    expect(malformedReason(inventory, "/escaped")).toContain("escaped-link");
    expect(malformedReason(inventory, "/broken")).toContain("broken-link");
    expect(malformedReason(inventory, "/chained")).toContain("chained-link");
    expect(malformedReason(inventory, "/unexpected")).toContain("unexpected-top-level-link");
    expect(malformedReason(inventory, "/missing-skill")).toContain("missing-regular-SKILL.md");
    expect(malformedReason(inventory, "/not-a-tree")).toContain("special-or-regular-file-location");
  });

  test("rejects oversized files, oversized trees, entry floods, unreadable files, and special files", async () => {
    const root = await tempDir("bounds");
    await writeSkill(root, ".agents/skills/oversized-file");
    await writeFile(
      join(root, ".agents/skills/oversized-file/large.bin"),
      Buffer.alloc(skillInventoryLimits.maxFileBytes + 1),
    );

    await writeSkill(root, ".agents/skills/oversized-tree", "x");
    for (let index = 0; index < 10; index += 1) {
      await writeFile(
        join(root, ".agents/skills/oversized-tree/blob-" + String(index).padStart(2, "0")),
        Buffer.alloc(skillInventoryLimits.maxFileBytes),
      );
    }

    await writeSkill(root, ".agents/skills/entry-flood");
    for (let index = 0; index < skillInventoryLimits.maxEntriesPerTree; index += 1) {
      await writeFile(join(root, ".agents/skills/entry-flood/file-" + index), "x", "utf8");
    }

    await writeSkill(root, ".agents/skills/unreadable");
    const unreadable = join(root, ".agents/skills/unreadable/private.txt");
    await writeFile(unreadable, "private", "utf8");
    await chmod(unreadable, 0);

    await writeSkill(root, ".agents/skills/special");
    await mkdir(join(root, ".claude/skills"), { recursive: true });
    for (let index = 0; index <= skillInventoryLimits.maxSkillsPerRoot; index += 1) {
      await mkdir(join(root, ".claude/skills/location-" + index));
    }
    const fifo = join(root, ".agents/skills/special/pipe");
    const madeFifo = Bun.spawnSync(["mkfifo", fifo]);
    expect(madeFifo.exitCode).toBe(0);

    try {
      const inventory = await inventoryProjectSkills({ targetDir: root });
      for (const name of ["oversized-file", "oversized-tree", "entry-flood", "unreadable", "special"]) {
        expect(topologies(inventory, name)).toEqual(["invalid"]);
      }
      expect(malformedReason(inventory, "/oversized-file")).toContain("oversized-file");
      expect(malformedReason(inventory, "/oversized-tree")).toContain("oversized-tree");
      expect(malformedReason(inventory, "/entry-flood")).toContain("entry-limit");
      expect(malformedReason(inventory, "/unreadable")).toContain("unreadable-file");
      expect(malformedReason(inventory, "/special")).toContain("special-file");
      expect(inventory.coverage.roots.find((item) => item.path === ".claude/skills"))
        .toEqual(expect.objectContaining({ status: "oversized", skillLocations: 0 }));
    } finally {
      await chmod(unreadable, 0o600);
    }
  }, 30_000);

  test("uses stable byte digests, permits contained leaf links, and never writes, fetches, or executes", async () => {
    const root = await tempDir("deterministic");
    const sentinel = join(root, "executed");
    const skillPath = ".agents/skills/passive";
    await writeSkill(root, skillPath, "#!/bin/sh\ntouch " + sentinel + "\n");
    await chmod(join(root, skillPath, "SKILL.md"), 0o755);
    await writeFile(join(root, skillPath, "reference.md"), Buffer.from([0, 255, 1, 2]));
    await symlink("reference.md", join(root, skillPath, "alias.md"));
    await writeSkill(root, ".agents/skills/zeta");
    await writeSkill(root, ".agents/skills/éclair");

    const before = await snapshotTree(root);
    const previousFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error("network forbidden");
    }) as unknown as typeof fetch;

    try {
      const first = await inventoryProjectSkills({ targetDir: root });
      const second = await inventoryProjectSkills({ targetDir: root });
      const firstEntry = first.entries.find((entry) => entry.name === "passive");
      const secondEntry = second.entries.find((entry) => entry.name === "passive");

      expect(first.entries.map((entry) => entry.name)).toEqual(["passive", "zeta", "éclair"]);
      expect(firstEntry?.locations[0]?.tree?.treeDigest).toBe(secondEntry?.locations[0]?.tree?.treeDigest);
      expect(firstEntry?.locations[0]?.tree?.files.find((file) => file.path === "reference.md")?.digest)
        .toBe(createHash("sha256").update(Buffer.from([0, 255, 1, 2])).digest("hex"));
      expect(firstEntry?.locations[0]?.tree?.files.find((file) => file.path === "alias.md")?.linkTarget)
        .toBe("reference.md");
      expect(await snapshotTree(root)).toEqual(before);
      expect(await Bun.file(sentinel).exists()).toBe(false);
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
