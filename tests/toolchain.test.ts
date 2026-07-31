import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { resolveToolchain } from "../src/engine/toolchain";
import { createDoctorReport } from "../src/engine/doctor";
import { applyUpdate, createUpdateReport } from "../src/engine/update";
import type { PackVerbs } from "../src/packs/types";
import { resolvePack } from "../src/packs/index";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-toolchain-"));
}

/** The derived commands only; evidence strings are asserted where they matter. */
function commandsOf(verbs: PackVerbs): Record<string, string | undefined> {
  return { lint: verbs.lint?.command, test: verbs.test?.command, fmt: verbs.fmt?.command };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Verbs are evidence-gated: tsc needs a tsconfig and prettier needs to be a
 * declared dependency, so every fixture that expects those recipes declares
 * them. Tests covering the ungated path opt out with `omitPrettier`.
 */
async function tsProject(
  dir: string,
  packageJson: Record<string, unknown>,
  options: { omitPrettier?: boolean } = {}
): Promise<void> {
  const devDependencies = {
    ...(packageJson.devDependencies as Record<string, unknown> | undefined),
    ...(options.omitPrettier ? {} : { prettier: "^3.0.0" }),
  };
  await writeJson(join(dir, "package.json"), { ...packageJson, devDependencies });
  await writeJson(join(dir, "tsconfig.json"), { compilerOptions: { strict: true } });
}

async function pnpmVitestFixture(): Promise<string> {
  const dir = await tempDir();
  await tsProject(dir, {
    dependencies: { react: "^19.0.0", vite: "^7.0.0" },
    devDependencies: { vitest: "^3.0.0" },
  });
  await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  return dir;
}

// Exact bytes the ts packs render today for bun-managed (and lockfile-less)
// repos. The bun path must stay byte-for-byte identical.
const bunJustfile = `check-fast *tests:
  bunx tsc --noEmit
  [ -z "{{tests}}" ] || bun test {{tests}}

check-full:
  bunx tsc --noEmit && bun test

check: check-full

test:
  bun test

fmt:
  bunx prettier --write .
`;

const pnpmVitestJustfile = `check-fast *tests:
  pnpm exec tsc --noEmit
  [ -z "{{tests}}" ] || pnpm exec vitest run {{tests}}

check-full:
  pnpm exec tsc --noEmit && pnpm exec vitest run

check: check-full

test:
  pnpm exec vitest run

fmt:
  pnpm exec prettier --write .
`;

describe("toolchain resolution", () => {
  test("pnpm + vitest repo renders pnpm verbs in the justfile and AGENTS.md", async () => {
    const dir = await pnpmVitestFixture();
    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("ts-react-vite") });

    const justfile = plan.files.find((file) => file.path === "justfile")?.content ?? "";
    expect(justfile).toBe(pnpmVitestJustfile);

    const agents = plan.files.find((file) => file.path === "AGENTS.md")?.content ?? "";
    expect(agents).toContain("- Full check (before finishing): `just check-full` (pnpm exec tsc --noEmit && pnpm exec vitest run)");
    expect(agents).toContain("- Test: `pnpm exec vitest run`");
    expect(agents).toContain("- Format: `pnpm exec prettier --write .`");
    expect(agents).not.toContain("bun test");
    expect(agents).not.toContain("bunx");

    expect(plan.toolchain?.packageManager).toBe("pnpm");
    expect(plan.toolchain?.testRunner).toBe("vitest");
    expect(plan.toolchain?.evidence).toEqual(["pnpm-lock.yaml", "package.json devDependency: vitest"]);
    expect(plan.toolchain?.notes).toEqual([]);
  });

  test("bun lockfile keeps today's bun verbs byte for byte", async () => {
    const dir = await tempDir();
    await tsProject(dir, { dependencies: { typescript: "^5.0.0" } });
    await writeFile(join(dir, "bun.lock"), "", "utf8");

    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("ts-base") });

    expect(plan.files.find((file) => file.path === "justfile")?.content).toBe(bunJustfile);
    expect(plan.toolchain?.packageManager).toBe("bun");
    expect(plan.toolchain?.verbs).toEqual(resolvePack("ts-base").verbs);
  });

  test("no lockfile keeps the pack defaults without guessing", async () => {
    const dir = await tempDir();
    await tsProject(dir, { dependencies: { typescript: "^5.0.0" } });

    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("ts-base") });

    expect(plan.files.find((file) => file.path === "justfile")?.content).toBe(bunJustfile);
    expect(plan.toolchain?.packageManager).toBeUndefined();
    expect(plan.toolchain?.evidence).toEqual([]);
  });

  test("competing lockfiles prefer the pack-implied manager and surface a warning", async () => {
    const dir = await tempDir();
    await tsProject(dir, { dependencies: { typescript: "^5.0.0" } });
    await writeFile(join(dir, "bun.lock"), "", "utf8");
    await writeFile(join(dir, "package-lock.json"), "{}\n", "utf8");

    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("ts-base") });

    expect(plan.files.find((file) => file.path === "justfile")?.content).toBe(bunJustfile);
    expect(plan.toolchain?.packageManager).toBe("bun");
    expect(plan.toolchain?.notes).toEqual([
      "Competing JavaScript lockfiles: verbs follow bun.lock (bun); ignoring package-lock.json. Run farrier audit for the full finding.",
    ]);
  });

  test("pnpm lockfile beats a stray package-lock.json", async () => {
    const dir = await pnpmVitestFixture();
    await writeFile(join(dir, "package-lock.json"), "{}\n", "utf8");

    const resolution = await resolveToolchain(dir, resolvePack("ts-react-vite"));

    expect(resolution.packageManager).toBe("pnpm");
    expect(resolution.verbs.test?.command).toBe("pnpm exec vitest run");
    expect(resolution.notes).toHaveLength(1);
    expect(resolution.notes[0]).toContain("package-lock.json");
  });

  test("yarn + jest derives yarn verbs", async () => {
    const dir = await tempDir();
    await tsProject(dir, { devDependencies: { jest: "^29.0.0" } });
    await writeFile(join(dir, "yarn.lock"), "", "utf8");

    const resolution = await resolveToolchain(dir, resolvePack("ts-base"));

    expect(resolution.packageManager).toBe("yarn");
    expect(resolution.testRunner).toBe("jest");
    expect(commandsOf(resolution.verbs)).toEqual({
      lint: "yarn run tsc --noEmit",
      test: "yarn run jest",
      fmt: "yarn run prettier --write .",
    });
  });

  test("npm without a recognized runner falls back to the manager's test script", async () => {
    const dir = await tempDir();
    await tsProject(dir, { dependencies: { typescript: "^5.0.0" } });
    await writeFile(join(dir, "package-lock.json"), "{}\n", "utf8");

    const resolution = await resolveToolchain(dir, resolvePack("ts-base"));

    expect(resolution.packageManager).toBe("npm");
    expect(resolution.testRunner).toBeUndefined();
    expect(commandsOf(resolution.verbs)).toEqual({
      lint: "npx tsc --noEmit",
      test: "npm test",
      fmt: "npx prettier --write .",
    });
  });

  test("non-ts packs ignore JavaScript lockfiles", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const pack = resolvePack("python-uv");
    const resolution = await resolveToolchain(dir, pack);

    expect(resolution.packageManager).toBeUndefined();
    expect(resolution.verbs).toEqual(pack.verbs);
  });

  test("doctor is healthy on a pnpm fixture right after create", async () => {
    const dir = await pnpmVitestFixture();
    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("ts-react-vite") });
    await writeRenderPlan(plan);

    const report = await createDoctorReport({ targetDir: dir });

    expect(report.problems).toEqual([]);
    expect(report.healthy).toBe(true);
  });

  test("update converges an unmodified bun-verb justfile on a pnpm repo", async () => {
    const dir = await pnpmVitestFixture();
    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("ts-react-vite") });
    await writeRenderPlan(plan);
    // Simulate a harness generated before toolchain resolution existed.
    await writeFile(join(dir, "justfile"), bunJustfile, "utf8");

    const report = await createUpdateReport(dir);
    expect(report.migratableUserFiles).toContain("justfile");
    expect(report.outdatedUserFiles).not.toContain("justfile");

    const result = await applyUpdate(dir);
    expect(result.repairedFiles).toContain("justfile");
    expect(await readFile(join(dir, "justfile"), "utf8")).toBe(pnpmVitestJustfile);
  });

  test("update never rewrites a user-modified justfile", async () => {
    const dir = await pnpmVitestFixture();
    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("ts-react-vite") });
    await writeRenderPlan(plan);
    const modified = `${bunJustfile}\ndeploy:\n  ./scripts/deploy.sh\n`;
    await writeFile(join(dir, "justfile"), modified, "utf8");

    const report = await createUpdateReport(dir);
    expect(report.outdatedUserFiles).toContain("justfile");
    expect(report.migratableUserFiles).not.toContain("justfile");

    await applyUpdate(dir);
    expect(await readFile(join(dir, "justfile"), "utf8")).toBe(modified);
  });
});
