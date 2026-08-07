import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  composeNativeInstructionOverlay,
  createNativeHarnessManifest,
  verifyNativeInstructionComposition,
  verifyNativeHarnessOverlay,
} from "../src/engine/evaluations/native-harness-manifest";

const temporaryDirectories: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], {
    cwd,
    env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(stderr.trim());
  return stdout.trim();
}

async function repository(): Promise<{ root: string; commit: string; tree: string }> {
  const root = await mkdtemp(join(tmpdir(), "farrier-native-harness-"));
  temporaryDirectories.push(root);
  await git(root, "init", "--quiet");
  for (const directory of [
    ".claude/hooks", ".codex", ".agents/skills/example", ".github/workflows", "src",
  ]) {
    await mkdir(join(root, directory), { recursive: true });
  }
  const canary = "PRIVATE-CANARY-DO-NOT-EXPORT";
  await Promise.all([
    writeFile(join(root, "AGENTS.md"), `# Rules\n${canary}\n`),
    writeFile(join(root, ".claude/hooks/check.mjs"), "export default true;\n"),
    writeFile(join(root, ".codex/config.toml"), "model = 'fixed'\n"),
    writeFile(join(root, ".agents/skills/example/SKILL.md"), "# Example\n"),
    writeFile(join(root, ".github/workflows/ci.yml"), "name: ci\n"),
    writeFile(join(root, "package.json"), "{\"scripts\":{\"test\":\"bun test\"}}\n"),
    writeFile(join(root, "src/app.ts"), `export const canary = "${canary}";\n`),
  ]);
  await git(root, "add", "--all");
  await git(
    root,
    "-c", "user.name=Test",
    "-c", "user.email=test@example.invalid",
    "commit", "--quiet", "--no-gpg-sign", "-m", "fixture",
  );
  return {
    root,
    commit: await git(root, "rev-parse", "HEAD"),
    tree: await git(root, "rev-parse", "HEAD^{tree}"),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("native harness evidence", () => {
  test("manifests only native harness consumers at the frozen commit without exporting content", async () => {
    const source = await repository();
    const manifest = await createNativeHarnessManifest({
      repository: source.root,
      commit: source.commit,
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      sourceCommit: source.commit,
      sourceTree: source.tree,
    });
    expect(manifest.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.artifacts.map(({ path, consumer }) => [path, consumer])).toEqual([
      [".agents/skills/example/SKILL.md", "agent-tooling"],
      [".claude/hooks/check.mjs", "claude-code"],
      [".codex/config.toml", "codex"],
      [".github/workflows/ci.yml", "ci"],
      ["AGENTS.md", "coding-agent"],
      ["package.json", "repository-verifier"],
    ]);
    expect(JSON.stringify(manifest)).not.toContain("PRIVATE-CANARY-DO-NOT-EXPORT");
    expect(manifest.artifacts.every((artifact) => /^[0-9a-f]{64}$/.test(artifact.contentDigest))).toBe(true);
  });

  test("accepts no overlay or one allowed brief and rejects any second changed path", async () => {
    const source = await repository();

    expect(await verifyNativeHarnessOverlay({
      workspace: source.root,
      expectedSourceTree: source.tree,
      kind: "none",
    })).toMatchObject({ valid: true, changedPaths: [] });

    await writeFile(join(source.root, "AGENTS.md"), "# Oracle brief\n");
    expect(await verifyNativeHarnessOverlay({
      workspace: source.root,
      expectedSourceTree: source.tree,
      kind: "brief",
      allowedBriefPath: "AGENTS.md",
    })).toMatchObject({ valid: true, changedPaths: ["AGENTS.md"] });

    await writeFile(join(source.root, ".codex/extra.md"), "extra\n");
    const rejected = await verifyNativeHarnessOverlay({
      workspace: source.root,
      expectedSourceTree: source.tree,
      kind: "brief",
      allowedBriefPath: "AGENTS.md",
    });
    expect(rejected.valid).toBe(false);
    expect(rejected.changedPaths).toEqual([".codex/extra.md", "AGENTS.md"]);
  });

  test("requires a brief to append to the exact native instruction bytes", () => {
    const encoder = new TextEncoder();
    const baseline = encoder.encode("# Native rules\nKeep tests green.\n");
    const brief = encoder.encode("Use the repository parser for config files.\n");
    const composed = composeNativeInstructionOverlay({ baseline, brief });

    expect(verifyNativeInstructionComposition({
      baseline,
      brief,
      final: composed.bytes,
      expectedBriefDigest: composed.evidence.briefContentSha256,
    })).toEqual(composed.evidence);
    expect(() => verifyNativeInstructionComposition({
      baseline,
      brief,
      final: encoder.encode("# Oracle-only replacement\n"),
      expectedBriefDigest: composed.evidence.briefContentSha256,
    })).toThrow("did not preserve the baseline");
  });
});
