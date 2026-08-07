import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePack } from "../src/packs/index";
import type { Pack, ResolvedRemoteHook } from "../src/packs/types";
import { builtinCatalog, type PackCatalog, type RegistryPin } from "../src/registry/catalog";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { applyStackMigrationPlan, createStackMigrationPlan } from "../src/engine/stack-migration";

function remoteMigrationCatalog(): PackCatalog {
  const builtins = builtinCatalog();
  const pin = (type: RegistryPin["type"], value: string): RegistryPin => ({
    type,
    version: "1.0.0",
    sha256: value.padEnd(64, "0"),
    sourceIdentity: "test-registry",
  });
  const hook = (id: `@${string}`, entry: string): ResolvedRemoteHook => ({
    id,
    version: "1.0.0",
    sha256: id.slice(1).replaceAll("/", "-").padEnd(64, "0"),
    sourceIdentity: "test-registry",
    registryRef: id,
    fromCache: false,
    hookVersion: 1,
    events: [{ event: "PreToolUse", matcher: "Bash" }],
    entry,
    runner: "bash",
    files: [{ path: entry, content: `#!/bin/sh\necho ${id}\n`, executable: true }],
  });
  const guard = hook("@acme/guard", "guard.sh");
  const custom = hook("@acme/custom", "custom.sh");
  const parent = builtins.resolvePack("generic");
  const remotePack: Pack = {
    id: "@acme/demo",
    extends: "generic",
    detect: { files: ["acme.toml"] },
    skills: ["@acme/bundle"],
    hooks: ["@acme/guard"],
    verbs: parent.verbs,
    agentsRules: ["Use the Acme project command."],
  };
  const resolved = {
    ...parent,
    ...remotePack,
    skills: [...parent.skills, "github.com/acme/skills@remote-style"],
    hooks: [...parent.hooks, guard.id],
    toolPolicyRules: [...parent.toolPolicyRules],
    agentsRules: [...parent.agentsRules, ...(remotePack.agentsRules ?? [])],
    ruleBlocks: [...parent.ruleBlocks],
    secondaryDetectors: [...parent.secondaryDetectors],
    subagents: [...parent.subagents],
    packIds: [...parent.packIds, remotePack.id],
    remoteHooks: [guard],
  };
  const pins: Record<string, RegistryPin> = {
    "@acme/demo": pin("pack", "demo"),
    "@acme/guard": pin("hook", "guard"),
    "@acme/custom": pin("hook", "custom"),
    "@acme/bundle": pin("skill", "bundle"),
  };

  return {
    packIds: () => [...builtins.packIds(), remotePack.id],
    listings: () => [...builtins.listings(), { id: remotePack.id, source: "registry", cached: false }],
    getPack: (id) => id === remotePack.id ? remotePack : builtins.getPack(id),
    resolvePack: (id) => id === remotePack.id ? resolved : builtins.resolvePack(id),
    remoteHook: (id) => id === guard.id ? guard : id === custom.id ? custom : undefined,
    detectablePackIds: () => [remotePack.id],
    registryPins: () => pins,
    warnings: [],
  };
}

async function mismatchedHarness(): Promise<string> {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-stack-migration-"));
  await writeFile(join(targetDir, "pyproject.toml"), `[project]\nname = "old"\ndependencies = ["fastapi"]\n`);
  await writeFile(join(targetDir, "uv.lock"), "");
  const python = resolvePack("python-fastapi");
  const plan = await createRenderPlan({
    targetDir,
    pack: python,
    skills: [...python.skills, "owner/project@review-procedure"],
    learnEnabled: true,
    agents: ["claude"],
    existingManifest: {
      quality: { maxFileLines: 321, rules: ["Reuse the parser fixture."] },
    },
  });
  await writeRenderPlan(plan);

  await rm(join(targetDir, "pyproject.toml"));
  await rm(join(targetDir, "uv.lock"));
  await writeFile(join(targetDir, "package.json"), `${JSON.stringify({
    name: "typescript-project",
    packageManager: "bun@1.3.0",
    devDependencies: { typescript: "latest" },
  }, null, 2)}\n`);
  await writeFile(join(targetDir, "tsconfig.json"), "{\n  \"compilerOptions\": {\"strict\": true}\n}\n");
  await writeFile(join(targetDir, "bun.lock"), "");
  await writeFile(join(targetDir, "skills-lock.json"), `${JSON.stringify({
    version: 1,
    skills: Object.fromEntries(python.skills.map((ref) => [ref.split("@").at(-1), {}])),
  }, null, 2)}\n`);
  return targetDir;
}

describe("reviewed stack migration", () => {
  test("switches the pack, removes only old defaults, and preserves project configuration", async () => {
    const targetDir = await mismatchedHarness();
    const beforeAgents = await readFile(join(targetDir, "AGENTS.md"), "utf8");
    const plan = await createStackMigrationPlan({ targetDir });

    expect(plan.currentPackId).toBe("python-fastapi");
    expect(plan.targetPackId).toBe("ts-base");
    expect(plan.blockers).toEqual([]);
    expect(plan.removedDefaultSkills).toEqual(resolvePack("python-fastapi").skills);
    expect(plan.preservedSkills).toEqual(["owner/project@review-procedure"]);
    expect(plan.notes[0]).toContain("old-pack metadata");

    const agentsChange = plan.changes.find((change) => change.path === "AGENTS.md");
    expect(agentsChange).toMatchObject({ action: "replace", previousContent: beforeAgents, requiresForce: true });
    expect(agentsChange?.content).toContain("Use Bun for TypeScript package and script execution.");
    expect(plan.changes.find((change) => change.path === ".farrier.json")?.action).toBe("replace");

    const result = await applyStackMigrationPlan(plan);
    expect(result.report.stackDrift.hasDrift).toBe(false);
    expect(result.report.currentPackId).toBe("ts-base");
    expect(result.transaction.backupDir).toContain(".farrier-staging/transactions/");

    const manifest = JSON.parse(await readFile(join(targetDir, ".farrier.json"), "utf8")) as {
      packIds: string[];
      skills: string[];
      learn: { enabled: boolean };
      quality: { maxFileLines: number; rules: string[] };
    };
    expect(manifest.packIds).toEqual(["ts-base"]);
    expect(manifest.skills).toEqual(["owner/project@review-procedure"]);
    expect(manifest.learn.enabled).toBe(true);
    expect(manifest.quality).toEqual({ maxFileLines: 321, rules: ["Reuse the parser fixture."] });
    expect(await readFile(join(targetDir, "AGENTS.md"), "utf8")).toContain("Use Bun for TypeScript package and script execution.");
    expect(await readFile(join(targetDir, "justfile"), "utf8")).toContain("bun test");
  });

  test("refuses bytes changed after review and leaves the concurrent edit intact", async () => {
    const targetDir = await mismatchedHarness();
    const plan = await createStackMigrationPlan({ targetDir });
    await writeFile(join(targetDir, "AGENTS.md"), "# concurrent user edit\n");

    await expect(applyStackMigrationPlan(plan)).rejects.toThrow("changed after review");
    expect(await readFile(join(targetDir, "AGENTS.md"), "utf8")).toBe("# concurrent user edit\n");
    const manifest = JSON.parse(await readFile(join(targetDir, ".farrier.json"), "utf8")) as { packIds: string[] };
    expect(manifest.packIds).toEqual(["python-uv", "python-fastapi"]);
  });

  test("rolls back when detection evidence changes inside the reviewed transaction", async () => {
    const targetDir = await mismatchedHarness();
    const plan = await createStackMigrationPlan({ targetDir });
    expect(plan.detectionEvidencePaths).toEqual(["package.json", "tsconfig.json"]);
    let changed = false;

    await expect(applyStackMigrationPlan(plan, {
      transaction: {
        beforeCommit: async () => {
          if (changed) return;
          changed = true;
          const packageJson = JSON.parse(await readFile(join(targetDir, "package.json"), "utf8")) as Record<string, unknown>;
          packageJson.description = "concurrent edit that keeps stack detection unchanged";
          await writeFile(join(targetDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
        },
      },
    })).rejects.toThrow("package.json changed after review");

    const manifest = JSON.parse(await readFile(join(targetDir, ".farrier.json"), "utf8")) as { packIds: string[] };
    expect(manifest.packIds).toEqual(["python-uv", "python-fastapi"]);
    expect(await readFile(join(targetDir, "package.json"), "utf8")).toContain("concurrent edit that keeps stack detection unchanged");
  });

  test("rebuilds reviewed bytes for an explicit enforcement-agent change", async () => {
    const targetDir = await mismatchedHarness();
    const plan = await createStackMigrationPlan({ targetDir, agents: ["codex"] });

    expect(plan.agents).toEqual(["codex"]);
    expect(plan.changes.find((change) => change.path === ".codex/hooks.json")?.content).toContain("hooks");
    expect(plan.changes.find((change) => change.path === ".claude/settings.json")?.content ?? "").not.toContain("PreToolUse");

    await applyStackMigrationPlan(plan);
    const manifest = JSON.parse(await readFile(join(targetDir, ".farrier.json"), "utf8")) as { agents: string[] };
    expect(manifest.agents).toEqual(["codex"]);
  });

  test("pins a remote target pack and preserves a custom remote hook", async () => {
    const targetDir = await mismatchedHarness();
    await rm(join(targetDir, "package.json"));
    await rm(join(targetDir, "tsconfig.json"));
    await rm(join(targetDir, "bun.lock"));
    await writeFile(join(targetDir, "acme.toml"), "stack = true\n");
    const manifestPath = join(targetDir, ".farrier.json");
    const sourceManifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      hookIds: string[];
      registry: { items: Record<string, RegistryPin> };
    };
    sourceManifest.hookIds.push("@acme/custom");
    sourceManifest.registry = {
      items: {
        "@acme/custom": {
          type: "hook",
          version: "1.0.0",
          sha256: "custom".padEnd(64, "0"),
          sourceIdentity: "test-registry",
        },
        "@old/python": { type: "pack", version: "1.0.0", sha256: "old".padEnd(64, "0") },
      },
    };
    await writeFile(manifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);
    const catalog = remoteMigrationCatalog();

    const plan = await createStackMigrationPlan({ targetDir, catalog });

    expect(plan.targetPackId).toBe("@acme/demo");
    expect(plan.detectionEvidencePaths).toEqual(["acme.toml"]);
    expect(plan.changes.map((change) => change.path)).toContain(".farrier/hooks/@acme/guard/guard.sh");
    expect(plan.changes.map((change) => change.path)).toContain(".farrier/hooks/@acme/custom/custom.sh");

    await applyStackMigrationPlan(plan, { catalog });
    const migrated = JSON.parse(await readFile(manifestPath, "utf8")) as {
      packIds: string[];
      hookIds: string[];
      skills: string[];
      registry: { items: Record<string, RegistryPin> };
    };
    expect(migrated.packIds).toEqual(["generic", "@acme/demo"]);
    expect(migrated.hookIds).toContain("@acme/guard");
    expect(migrated.hookIds).toContain("@acme/custom");
    expect(migrated.skills).toContain("github.com/acme/skills@remote-style");
    expect(Object.keys(migrated.registry.items).sort()).toEqual([
      "@acme/bundle",
      "@acme/custom",
      "@acme/demo",
      "@acme/guard",
    ]);
    const settings = await readFile(join(targetDir, ".claude", "settings.json"), "utf8");
    expect(settings).toContain(".farrier/hooks/@acme/guard/guard.sh");
    expect(settings).toContain(".farrier/hooks/@acme/custom/custom.sh");
  });

  test("carries learned policy rules while replacing old stack defaults", async () => {
    const targetDir = await mismatchedHarness();
    const rulesPath = join(targetDir, ".farrier", "hooks", "tool-policy-rules.json");
    const document = JSON.parse(await readFile(rulesPath, "utf8")) as { version: number; rules: Array<{ id: string }> };
    document.rules.push({
      id: "project-no-force-push",
      probe: "git push --force origin main",
      description: "Protect the shared branch.",
      tool: "Bash",
      commandPattern: "git\\s+push\\s+--force",
      flags: "i",
      message: "Do not force-push the shared branch.",
      redirect: "Push a new branch instead.",
    } as never);
    await writeFile(rulesPath, `${JSON.stringify(document, null, 2)}\n`);

    const plan = await createStackMigrationPlan({ targetDir });
    expect(plan.notes).toContain("Carried 1 learned tool-policy rule(s): project-no-force-push.");
    const rulesChange = plan.changes.find((change) => change.path === ".farrier/hooks/tool-policy-rules.json");
    expect(rulesChange?.content).toContain("project-no-force-push");

    await applyStackMigrationPlan(plan);
    const migrated = JSON.parse(await readFile(rulesPath, "utf8")) as { rules: Array<{ id: string }> };
    const ids = migrated.rules.map((rule) => rule.id);
    expect(ids).toContain("project-no-force-push");
    expect(ids).toContain("typescript-use-bunx-not-npx");
    expect(ids).not.toContain("python-use-uv-not-pip-install");
  });

  test("blocks while an old-pack default skill is still discoverable by an agent", async () => {
    const targetDir = await mismatchedHarness();
    const skillDir = join(targetDir, ".agents", "skills", "python-code-style");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: python-code-style\ndescription: Python only.\n---\n");

    const plan = await createStackMigrationPlan({ targetDir });
    expect(plan.blockers).toContainEqual({
      path: ".agents/skills/python-code-style",
      reason: "Installed old-pack skill 'python-code-style' must be removed with the skills workflow before migration.",
    });
    await expect(applyStackMigrationPlan(plan)).rejects.toThrow("migration is blocked");
  });
});
