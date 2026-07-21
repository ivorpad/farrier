import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateRepoMapSection,
  repoMapBeginMarker,
  repoMapEndMarker,
  spliceRepoMapSection,
  stripRepoMapSection
} from "../src/engine/repo-map";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { applyUpdate, createUpdateReport } from "../src/engine/update";
import { resolvePack } from "../src/packs/index";
import { main } from "../src/cli";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-repo-map-"));
}

async function git(dir: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd: dir,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com"
    }
  });
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

async function seedFile(dir: string, path: string, content = `// ${path}\n`): Promise<void> {
  await mkdir(join(dir, path, ".."), { recursive: true });
  await writeFile(join(dir, path), content, "utf8");
}

/**
 * A repository with enough structure for every map section: a src tree, a
 * mirrored test tree, and a commit history where src/engine/render.ts and
 * tests/render.test.ts repeatedly change together.
 */
async function seedRepository(dir: string): Promise<void> {
  await git(dir, "init", "-q");

  for (const path of [
    "src/engine/render.ts",
    "src/engine/update.ts",
    "src/engine/detect.ts",
    "src/engine/doctor.ts",
    "src/engine/learn.ts",
    "src/cli.ts",
    "tests/render.test.ts",
    "tests/update.test.ts",
    "tests/detect.test.ts",
    "README.md"
  ]) {
    await seedFile(dir, path);
  }
  await git(dir, "add", "-A");
  await git(dir, "commit", "-qm", "init");

  for (let i = 0; i < 12; i += 1) {
    const coupled = i % 3 !== 2;
    const files = coupled
      ? ["src/engine/render.ts", "tests/render.test.ts"]
      : ["src/engine/update.ts"];
    for (const path of files) {
      await seedFile(dir, path, `// ${path} rev ${i}\n`);
    }
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", `change ${i}`);
  }
}

describe("generateRepoMapSection", () => {
  test("renders layout, tests, frequency, and coupling for a real repository", async () => {
    const dir = await tempDir();
    await seedRepository(dir);

    const section = await generateRepoMapSection(dir);
    expect(section).not.toBeNull();
    expect(section).toStartWith(repoMapBeginMarker);
    expect(section).toEndWith(repoMapEndMarker);
    expect(section).toContain("### Layout");
    expect(section).toContain("- `src/` — 6 files (.ts)");
    expect(section).toContain("### Tests");
    expect(section).toContain("`<name>.test.ts`");
    expect(section).toContain("### Frequently changed files");
    expect(section).toContain("### Change coupling");
    expect(section).toContain("- `src/engine/render.ts` and `tests/render.test.ts` (9/9)");
    expect(section).toContain("not a reading list");
  });

  test("is deterministic for the same repository state", async () => {
    const dir = await tempDir();
    await seedRepository(dir);

    expect(await generateRepoMapSection(dir)).toBe((await generateRepoMapSection(dir))!);
  });

  test("returns null outside a git repository", async () => {
    const dir = await tempDir();
    expect(await generateRepoMapSection(dir)).toBeNull();
  });

  test("returns null for a subdirectory of a repository", async () => {
    const dir = await tempDir();
    await seedRepository(dir);
    expect(await generateRepoMapSection(join(dir, "src"))).toBeNull();
  });

  test("returns null when too few files are tracked", async () => {
    const dir = await tempDir();
    await git(dir, "init", "-q");
    await seedFile(dir, "a.ts");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "init");
    expect(await generateRepoMapSection(dir)).toBeNull();
  });
});

describe("spliceRepoMapSection / stripRepoMapSection", () => {
  const section = `${repoMapBeginMarker}\n## Repository Map\n\n- \`src/\` — 2 files\n${repoMapEndMarker}`;

  test("appends when no markers exist and strip restores the original", async () => {
    const base = "# Instructions\n\n- rule one\n";
    const spliced = spliceRepoMapSection(base, section);
    expect(spliced).toBe(`# Instructions\n\n- rule one\n\n${section}\n`);
    expect(stripRepoMapSection(spliced)).toBe(base);
  });

  test("replaces an existing marked region and preserves content around it", async () => {
    const before = "# Instructions\n";
    const after = "## User notes\n\nkeep me\n";
    const original = `${before}\n${section}\n\n${after}`;
    const newSection = section.replace("2 files", "3 files");

    const spliced = spliceRepoMapSection(original, newSection);
    expect(spliced).toContain("3 files");
    expect(spliced).not.toContain("2 files");
    expect(spliced).toContain("keep me");
    expect(stripRepoMapSection(spliced)).toBe(stripRepoMapSection(original));
  });

  test("null section leaves content untouched", async () => {
    const content = `# Instructions\n\n${section}\n`;
    expect(spliceRepoMapSection(content, null)).toBe(content);
  });

  test("strip is a no-op without markers", async () => {
    expect(stripRepoMapSection("# plain\n")).toBe("# plain\n");
  });
});

describe("render plan integration", () => {
  test("AGENTS.md includes the map inside a git repository and omits it outside", async () => {
    const withGit = await tempDir();
    await seedRepository(withGit);
    const gitPlan = await createRenderPlan({ targetDir: withGit, pack: resolvePack("ts-base") });
    const gitAgents = gitPlan.files.find((file) => file.path === "AGENTS.md")!;
    expect(gitAgents.content).toContain(repoMapBeginMarker);
    expect(gitAgents.content).toContain("## Repository Map");

    const withoutGit = await tempDir();
    const barePlan = await createRenderPlan({ targetDir: withoutGit, pack: resolvePack("ts-base") });
    const bareAgents = barePlan.files.find((file) => file.path === "AGENTS.md")!;
    expect(bareAgents.content).not.toContain(repoMapBeginMarker);
    expect(stripRepoMapSection(gitAgents.content)).toBe(bareAgents.content);
  });
});

describe("update integration", () => {
  async function renderProject(dir: string): Promise<void> {
    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("ts-base") });
    await writeRenderPlan(plan);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "harness");
  }

  test("map-only drift is repairable and --yes refreshes the map", async () => {
    const dir = await tempDir();
    await seedRepository(dir);
    await renderProject(dir);

    // Evolve the repository so the generated map changes.
    for (let i = 0; i < 3; i += 1) {
      await seedFile(dir, "src/engine/doctor.ts", `// rev ${i}\n`);
      await seedFile(dir, "src/engine/detect.ts", `// rev ${i}\n`);
      await git(dir, "add", "-A");
      await git(dir, "commit", "-qm", `drift ${i}`);
    }

    const report = await createUpdateReport(dir);
    expect(report.outdatedOwnedFiles).toContain("AGENTS.md");
    expect(report.outdatedUserFiles).not.toContain("AGENTS.md");

    const result = await applyUpdate(dir);
    expect(result.repairedFiles).toContain("AGENTS.md");

    const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("- `src/engine/detect.ts` and `src/engine/doctor.ts` (");

    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "refreshed");
    const clean = await createUpdateReport(dir);
    expect(clean.outdatedOwnedFiles).not.toContain("AGENTS.md");
  });

  test("user edits stay manual-review, but --yes still refreshes the map region", async () => {
    const dir = await tempDir();
    await seedRepository(dir);
    await renderProject(dir);

    const agentsPath = join(dir, "AGENTS.md");
    const edited = `${await readFile(agentsPath, "utf8")}\n## Team notes\n\ncustom\n`;
    await writeFile(agentsPath, edited, "utf8");
    await seedFile(dir, "src/engine/doctor.ts", "// user drift\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "user edit");

    const report = await createUpdateReport(dir);
    expect(report.outdatedUserFiles).toContain("AGENTS.md");
    expect(report.outdatedOwnedFiles).not.toContain("AGENTS.md");
    expect(report.notes.join("\n")).toContain("refreshes only its generated repository-map region");

    const result = await applyUpdate(dir);
    expect(result.repairedFiles).toContain("AGENTS.md");

    const agents = await readFile(agentsPath, "utf8");
    expect(agents).toContain("## Team notes");
    expect(agents).toContain("- `src/engine/doctor.ts` (2 commits)");
  });
});

describe("farrier map CLI", () => {
  test("refreshes the map in place and preserves user edits", async () => {
    const dir = await tempDir();
    await seedRepository(dir);
    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("ts-base") });
    await writeRenderPlan(plan);

    const agentsPath = join(dir, "AGENTS.md");
    await writeFile(agentsPath, `${await readFile(agentsPath, "utf8")}\n## Team notes\n\ncustom\n`, "utf8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "harness");
    await seedFile(dir, "docs/one.md");
    await seedFile(dir, "docs/two.md");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "docs");

    expect(await main(["map", "--dir", dir, "--json"])).toBe(0);

    const agents = await readFile(agentsPath, "utf8");
    expect(agents).toContain("## Team notes");
    expect(agents).toContain("- `docs/` — 2 files (.md)");
    expect(agents.indexOf(repoMapBeginMarker)).toBe(agents.lastIndexOf(repoMapBeginMarker));
  });

  test("fails clearly outside a git repository", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "AGENTS.md"), "# x\n", "utf8");
    expect(await main(["map", "--dir", dir])).toBe(1);
  });

  test("fails clearly without AGENTS.md", async () => {
    const dir = await tempDir();
    expect(await main(["map", "--dir", dir])).toBe(1);
  });
});
