import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeManifest } from "../src/engine/manifest";
import {
  inventoryProjectSkills,
  type SkillInventory,
} from "../src/engine/skill-inventory";

const templateSkills = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "templates",
  "skills",
);

async function tempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-skill-provenance-" + label + "-"));
}

async function writeSkill(root: string, path: string): Promise<void> {
  await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, path, "SKILL.md"), "skill content\n", "utf8");
}

function provenance(inventory: SkillInventory, name: string) {
  const entry = inventory.entries.find((candidate) => candidate.name === name);
  if (!entry) throw new Error("missing inventory entry " + name);
  return entry.provenance;
}

function validLock(source: string, name: string) {
  return {
    source,
    sourceType: "github",
    skillPath: "skills/" + name + "/SKILL.md",
    computedHash: "b".repeat(64),
  };
}

describe("local skill provenance", () => {
  test("classifies only exact bundled, pinned registry, external, lock, and project evidence", async () => {
    const root = await tempDir("classes");
    await mkdir(join(root, ".claude/skills"), { recursive: true });
    await cp(
      join(templateSkills, "harness-advisor"),
      join(root, ".claude/skills/harness-advisor"),
      { recursive: true },
    );
    for (const name of [
      "platform-skill",
      "external-skill",
      "locked-skill",
      "local-skill",
      "unpinned",
      "malformed-lock",
      "conflict",
    ]) {
      await writeSkill(root, ".agents/skills/" + name);
    }

    const manifest = normalizeManifest({
      packIds: ["generic"],
      hookIds: [],
      skills: [
        "@acme/platform-skill",
        "owner/repository@external-skill",
        "@acme/unpinned",
        "owner/repository@conflict",
      ],
      registry: {
        items: {
          "@acme/platform-skill": {
            type: "skill",
            version: "1.2.3",
            sha256: "a".repeat(64),
            sourceIdentity: "registry:acme",
            ref: "@acme/platform-skill",
          },
        },
      },
    });
    await writeFile(join(root, "skills-lock.json"), JSON.stringify({
      version: 1,
      skills: {
        "locked-skill": validLock("lock/repository", "locked-skill"),
        "malformed-lock": {},
        conflict: validLock("different/repository", "conflict"),
      },
    }), "utf8");

    const inventory = await inventoryProjectSkills({ targetDir: root, manifest });

    expect(provenance(inventory, "harness-advisor").kind).toBe("bundled");
    expect(provenance(inventory, "platform-skill")).toEqual(expect.objectContaining({
      kind: "registry",
      registryPin: expect.objectContaining({
        ref: "@acme/platform-skill",
        sourceIdentity: "registry:acme",
      }),
    }));
    expect(provenance(inventory, "external-skill").kind).toBe("third-party");
    expect(provenance(inventory, "locked-skill").kind).toBe("third-party");
    expect(provenance(inventory, "local-skill").kind).toBe("project");
    expect(provenance(inventory, "unpinned")).toEqual(expect.objectContaining({
      kind: "unknown",
      evidence: expect.arrayContaining(["registry ref has no matching source-bound skill pin"]),
    }));
    expect(provenance(inventory, "malformed-lock")).toEqual(expect.objectContaining({
      kind: "unknown",
      evidence: expect.arrayContaining(["matching lock entry is malformed"]),
    }));
    expect(provenance(inventory, "conflict")).toEqual(expect.objectContaining({
      kind: "unknown",
      evidence: expect.arrayContaining(["manifest and lock sources conflict"]),
    }));
  });

  test("uses explicit local skill refs and source-bound pins when the pack is unresolved", async () => {
    const root = await tempDir("unresolved-pack");
    await writeSkill(root, ".agents/skills/platform-skill");
    await writeFile(join(root, ".farrier.json"), JSON.stringify({
      packIds: ["@remote/unavailable-pack"],
      skills: ["@acme/platform-skill"],
      registry: {
        items: {
          "@acme/platform-skill": {
            type: "skill",
            version: "1.2.3",
            sha256: "a".repeat(64),
            sourceIdentity: "registry:acme",
            ref: "@acme/platform-skill",
          },
        },
      },
    }), "utf8");

    const inventory = await inventoryProjectSkills({ targetDir: root });

    expect(inventory.notes).not.toContain(".farrier.json could not be normalized for provenance");
    expect(provenance(inventory, "platform-skill")).toEqual(expect.objectContaining({
      kind: "registry",
      registryPin: expect.objectContaining({ sourceIdentity: "registry:acme" }),
    }));
  });

  test("does not infer bundled provenance from a name at the wrong location or from altered bytes", async () => {
    const wrongPathRoot = await tempDir("bundled-path");
    await writeSkill(wrongPathRoot, ".agents/skills/harness-advisor");
    const wrongPath = await inventoryProjectSkills({ targetDir: wrongPathRoot });
    expect(provenance(wrongPath, "harness-advisor").kind).toBe("project");

    const alteredRoot = await tempDir("bundled-altered");
    await writeSkill(alteredRoot, ".claude/skills/harness-advisor");
    const manifest = normalizeManifest({ packIds: ["generic"], hookIds: [], skills: [] });
    const altered = await inventoryProjectSkills({ targetDir: alteredRoot, manifest });
    expect(provenance(altered, "harness-advisor")).toEqual(expect.objectContaining({
      kind: "unknown",
      evidence: expect.arrayContaining([
        "bundled location lacks matching manifest and packaged tree evidence",
      ]),
    }));
  });

  test("treats ambiguous manifests, malformed metadata, and invalid topologies as unknown", async () => {
    const ambiguousRoot = await tempDir("ambiguous");
    await writeSkill(ambiguousRoot, ".agents/skills/ambiguous");
    const ambiguousManifest = normalizeManifest({
      packIds: ["generic"],
      hookIds: [],
      skills: ["one/repo@ambiguous", "two/repo@ambiguous"],
    });
    const ambiguous = await inventoryProjectSkills({
      targetDir: ambiguousRoot,
      manifest: ambiguousManifest,
    });
    expect(provenance(ambiguous, "ambiguous")).toEqual(expect.objectContaining({
      kind: "unknown",
      evidence: expect.arrayContaining(["multiple manifest refs match this skill"]),
    }));

    const malformedRoot = await tempDir("malformed");
    await writeSkill(malformedRoot, ".agents/skills/local");
    await writeFile(join(malformedRoot, ".farrier.json"), "{bad", "utf8");
    await writeFile(join(malformedRoot, "skills-lock.json"), "[]", "utf8");
    const malformed = await inventoryProjectSkills({ targetDir: malformedRoot });
    expect(provenance(malformed, "local")).toEqual(expect.objectContaining({
      kind: "unknown",
      evidence: expect.arrayContaining([
        "manifest metadata is invalid",
        "lock metadata is invalid",
      ]),
    }));

    const invalidRoot = await tempDir("invalid-topology");
    await mkdir(join(invalidRoot, ".agents/skills/missing"), { recursive: true });
    const invalid = await inventoryProjectSkills({ targetDir: invalidRoot });
    expect(provenance(invalid, "missing")).toEqual(expect.objectContaining({
      kind: "unknown",
      evidence: expect.arrayContaining(["topology is invalid"]),
    }));
  });

  test("rejects linked manifest and lock metadata without following it", async () => {
    const root = await tempDir("linked-metadata");
    const outside = await tempDir("outside");
    await writeSkill(root, ".agents/skills/local");
    await writeFile(join(outside, "manifest.json"), JSON.stringify({
      packIds: ["generic"],
      skills: ["owner/repo@local"],
    }), "utf8");
    await writeFile(join(outside, "lock.json"), JSON.stringify({
      version: 1,
      skills: { local: validLock("owner/repo", "local") },
    }), "utf8");
    await symlink(join(outside, "manifest.json"), join(root, ".farrier.json"));
    await symlink(join(outside, "lock.json"), join(root, "skills-lock.json"));

    const inventory = await inventoryProjectSkills({ targetDir: root });
    expect(provenance(inventory, "local").kind).toBe("unknown");
    expect(inventory.notes).toEqual([
      ".farrier.json was not read: symlink",
      "skills-lock.json was not read: symlink",
    ]);
  });
});
