import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  installSkills,
  resolveSkillsCommand,
  searchSkills,
  type CommandRunner,
  type CommandRunnerInput,
  type ResolveSkillsCommandDeps
} from "../src/engine/skills";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-skills-"));
}

function restoreSkillsApiUrl(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.SKILLS_API_URL;
  } else {
    process.env.SKILLS_API_URL = previous;
  }
}

function restoreSkillsBinEnv(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.FARRIER_SKILLS_BIN;
  } else {
    process.env.FARRIER_SKILLS_BIN = previous;
  }
}

function neverWhich(): string | null {
  return null;
}

function neverExists(): boolean {
  return false;
}

describe("skills engine", () => {
  test("searchSkills queries SKILLS_API_URL and normalizes results", async () => {
    const previous = process.env.SKILLS_API_URL;
    let seenUrl: URL | undefined;

    const server = Bun.serve({
      port: 0,
      fetch(request) {
        seenUrl = new URL(request.url);

        return Response.json({
          skills: [
            {
              skillId: "python-code-style",
              name: "Python Code Style",
              installs: 123,
              source: "wshobson/agents"
            }
          ]
        });
      }
    });

    process.env.SKILLS_API_URL = server.url.origin;

    try {
      const results = await searchSkills("python style");

      expect(seenUrl?.pathname).toBe("/api/search");
      expect(seenUrl?.searchParams.get("q")).toBe("python style");
      expect(seenUrl?.searchParams.get("limit")).toBe("10");
      expect(results).toEqual([
        {
          skillId: "python-code-style",
          name: "Python Code Style",
          installs: 123,
          source: "wshobson/agents"
        }
      ]);
    } finally {
      restoreSkillsApiUrl(previous);
      server.stop(true);
    }
  });

  test("searchSkills orders results by installs descending with stable ties", async () => {
    const previous = process.env.SKILLS_API_URL;

    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          skills: [
            { skillId: "low", name: "Low", installs: 5, source: "owner/low" },
            { skillId: "high", name: "High", installs: 5000, source: "owner/high" },
            { skillId: "mid", name: "Mid", installs: 120, source: "owner/mid" },
            { skillId: "tie-first", name: "Tie First", installs: 5, source: "owner/tie-first" }
          ]
        });
      }
    });

    process.env.SKILLS_API_URL = server.url.origin;

    try {
      const results = await searchSkills("ordering");

      expect(results.map((result) => result.skillId)).toEqual(["high", "mid", "low", "tie-first"]);
    } finally {
      restoreSkillsApiUrl(previous);
      server.stop(true);
    }
  });

  test("searchSkills drops malformed records and supports id fallback", async () => {
    const previous = process.env.SKILLS_API_URL;

    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          skills: [
            {
              id: "fallback-id",
              source: "owner/repo"
            },
            {
              skillId: "missing-source"
            },
            {
              source: "missing/skill"
            },
            null
          ]
        });
      }
    });

    process.env.SKILLS_API_URL = server.url.origin;

    try {
      const results = await searchSkills("fallback");

      expect(results).toEqual([
        {
          skillId: "fallback-id",
          name: "fallback-id",
          installs: 0,
          source: "owner/repo"
        }
      ]);
    } finally {
      restoreSkillsApiUrl(previous);
      server.stop(true);
    }
  });

  test("searchSkills aborts the in-flight request when the signal fires", async () => {
    const previous = process.env.SKILLS_API_URL;

    const server = Bun.serve({
      port: 0,
      async fetch() {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return Response.json({ skills: [] });
      }
    });

    process.env.SKILLS_API_URL = server.url.origin;

    try {
      const controller = new AbortController();
      const pending = searchSkills("python", { signal: controller.signal });

      setTimeout(() => controller.abort(), 10);

      await expect(pending).rejects.toThrow();
      expect(controller.signal.aborted).toBe(true);
    } finally {
      restoreSkillsApiUrl(previous);
      server.stop(true);
    }
  });

  test("searchSkills returns empty results for blank queries", async () => {
    await expect(searchSkills("   ")).resolves.toEqual([]);
  });

  test("searchSkills throws on non-2xx responses", async () => {
    const previous = process.env.SKILLS_API_URL;

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("nope", { status: 503 });
      }
    });

    process.env.SKILLS_API_URL = server.url.origin;

    try {
      await expect(searchSkills("python")).rejects.toThrow("skills search failed with HTTP 503");
    } finally {
      restoreSkillsApiUrl(previous);
      server.stop(true);
    }
  });

  test("installSkills shells out once for a single ref", async () => {
    const dir = await tempDir();
    const calls: CommandRunnerInput[] = [];
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    process.env.FARRIER_SKILLS_BIN = "skills";

    const runner: CommandRunner = async (input) => {
      calls.push(input);
      return {
        exitCode: 0,
        stdout: "installed",
        stderr: ""
      };
    };

    try {
      const results = await installSkills(["wshobson/agents@python-code-style"], dir, runner);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.cmd).toEqual(["skills", "add", "wshobson/agents", "-s", "python-code-style", "-a", "claude-code", "codex", "-y"]);
      expect(calls[0]?.cwd).not.toBe(dir);
      expect(calls[0]?.env?.HOME).toStartWith(calls[0]!.cwd);
      expect(results[0]).toMatchObject({
        ref: "wshobson/agents@python-code-style", ok: true, stdout: "installed", stderr: "", exitCode: 0,
        isolation: { mode: "staged-best-effort" }
      });
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("installSkills threads a custom agents list into the -a args", async () => {
    const dir = await tempDir();
    const calls: CommandRunnerInput[] = [];
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    process.env.FARRIER_SKILLS_BIN = "skills";

    const runner: CommandRunner = async (input) => {
      calls.push(input);
      return {
        exitCode: 0,
        stdout: "installed",
        stderr: ""
      };
    };

    try {
      const results = await installSkills(["owner/repo@one"], dir, runner, undefined, ["codex"]);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.cmd).toEqual(["skills", "add", "owner/repo", "-s", "one", "-a", "codex", "-y"]);
      expect(calls[0]?.cwd).not.toBe(dir);
      expect(results[0]?.ok).toBe(true);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("installSkills dedupes refs while preserving order", async () => {
    const dir = await tempDir();
    const calls: CommandRunnerInput[] = [];
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    process.env.FARRIER_SKILLS_BIN = "skills";

    const runner: CommandRunner = async (input) => {
      calls.push(input);
      return {
        exitCode: 0,
        stdout: "",
        stderr: ""
      };
    };

    try {
      const results = await installSkills(["owner/repo@one", "owner/repo@one", "owner/repo@two"], dir, runner);

      expect(calls.map((call) => call.cmd)).toEqual([
        ["skills", "add", "owner/repo", "-s", "one", "two", "-a", "claude-code", "codex", "-y"]
      ]);

      expect(results.map((result) => result.ref)).toEqual(["owner/repo@one", "owner/repo@two"]);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("installSkills batches per source and reports each ref", async () => {
    const dir = await tempDir();
    const calls: CommandRunnerInput[] = [];
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    process.env.FARRIER_SKILLS_BIN = "skills";

    const runner: CommandRunner = async (input) => {
      calls.push(input);
      const failing = input.cmd.includes("bad/repo");
      return {
        exitCode: failing ? 3 : 0,
        stdout: failing ? "" : "installed",
        stderr: failing ? "clone failed" : ""
      };
    };

    try {
      const results = await installSkills(
        ["owner/repo@one", "bad/repo@three", "owner/repo@two", "not-a-valid-ref"],
        dir,
        runner
      );

      expect(calls.map((call) => call.cmd)).toEqual([
        ["skills", "add", "owner/repo", "-s", "one", "two", "-a", "claude-code", "codex", "-y"],
        ["skills", "add", "bad/repo", "-s", "three", "-a", "claude-code", "codex", "-y"]
      ]);

      expect(results.map((result) => [result.ref, result.ok])).toEqual([
        ["owner/repo@one", true],
        ["bad/repo@three", false],
        ["owner/repo@two", true],
        ["not-a-valid-ref", false]
      ]);

      const failed = results.find((result) => result.ref === "bad/repo@three");
      expect(failed?.exitCode).toBe(3);
      expect(failed?.stderr).toBe("clone failed");
      expect(failed?.error).toMatch(/exited with code 3/);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("installSkills serializes sources that share lock and manifest outputs", async () => {
    const dir = await tempDir();
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    process.env.FARRIER_SKILLS_BIN = "skills";

    let inFlight = 0;
    let maxInFlight = 0;

    const runner: CommandRunner = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return {
        exitCode: 0,
        stdout: "",
        stderr: ""
      };
    };

    try {
      const results = await installSkills(["alpha/repo@one", "beta/repo@two", "gamma/repo@three"], dir, runner);

      expect(maxInFlight).toBe(1);
      expect(results.every((result) => result.ok)).toBe(true);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("installSkills re-runs skills the lockfile race dropped", async () => {
    const dir = await tempDir();
    const calls: CommandRunnerInput[] = [];
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    process.env.FARRIER_SKILLS_BIN = "skills";

    const runner: CommandRunner = async (input) => {
      calls.push(input);
      const lockPath = join(input.cwd, "skills-lock.json");

      // Simulate each CLI invocation writing only its own lock entry. Farrier
      // merges staged lock output transactionally instead of accepting drops.
      if (input.cmd.includes("alpha/repo")) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        await Bun.write(lockPath, JSON.stringify({ version: 1, skills: { one: {} } }));
      } else if (calls.filter((call) => call.cmd.includes("beta/repo")).length === 1) {
        await Bun.write(lockPath, JSON.stringify({ version: 1, skills: { two: {} } }));
      } else {
        // The repair re-run has no concurrent writer, so the merge survives.
        await Bun.write(lockPath, JSON.stringify({ version: 1, skills: { one: {}, two: {} } }));
      }

      return {
        exitCode: 0,
        stdout: "",
        stderr: ""
      };
    };

    try {
      const results = await installSkills(["alpha/repo@one", "beta/repo@two"], dir, runner);

      expect(calls.map((call) => call.cmd)).toEqual([
        ["skills", "add", "alpha/repo", "-s", "one", "-a", "claude-code", "codex", "-y"],
        ["skills", "add", "beta/repo", "-s", "two", "-a", "claude-code", "codex", "-y"]
      ]);

      expect(results.map((result) => [result.ref, result.ok])).toEqual([
        ["alpha/repo@one", true],
        ["beta/repo@two", true]
      ]);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("installSkills reports non-zero exits without throwing", async () => {
    const dir = await tempDir();
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    process.env.FARRIER_SKILLS_BIN = "skills";

    const runner: CommandRunner = async () => ({
      exitCode: 7,
      stdout: "",
      stderr: "boom"
    });

    try {
      const results = await installSkills(["wshobson/agents@python-code-style"], dir, runner);

      expect(results[0]).toMatchObject({
        ref: "wshobson/agents@python-code-style", ok: false, stdout: "", stderr: "boom", exitCode: 7,
        error: "skills add exited with code 7. Try installing the skills CLI or set FARRIER_SKILLS_BIN.",
        isolation: { mode: "staged-best-effort" }
      });
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("installSkills rejects unexpected staged output and exposes no ambient secret", async () => {
    const dir = await tempDir();
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    const previousSecret = process.env.FARRIER_TEST_SECRET;
    const previousToken = process.env.GITHUB_TOKEN;
    const previousGitConfig = process.env.GIT_CONFIG_GLOBAL;
    delete process.env.GIT_CONFIG_GLOBAL;
    process.env.FARRIER_SKILLS_BIN = "skills";
    process.env.FARRIER_TEST_SECRET = "do-not-forward";
    process.env.GITHUB_TOKEN = "required-provider-auth";
    const runner: CommandRunner = async (input) => {
      expect(input.cwd).not.toBe(dir);
      expect(input.env?.FARRIER_TEST_SECRET).toBeUndefined();
      expect(input.env?.GITHUB_TOKEN).toBe("required-provider-auth");
      expect(input.env?.GIT_CONFIG_GLOBAL).toBe(join(homedir(), ".gitconfig"));
      expect(input.env?.HOME).not.toBe(process.env.HOME);
      await Bun.write(join(input.cwd, "unexpected.txt"), "not allowed");
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    try {
      const result = await installSkills(["owner/repo@one"], dir, runner);
      expect(result[0]?.ok).toBe(false);
      expect(result[0]?.error).toContain("unexpected output");
      expect(await Bun.file(join(dir, "unexpected.txt")).exists()).toBe(false);
    } finally {
      restoreSkillsBinEnv(previousBin);
      if (previousSecret === undefined) delete process.env.FARRIER_TEST_SECRET;
      else process.env.FARRIER_TEST_SECRET = previousSecret;
      if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previousToken;
      if (previousGitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousGitConfig;
    }
  });

  test("installSkills reports invalid refs without calling runner", async () => {
    const dir = await tempDir();
    const calls: CommandRunnerInput[] = [];
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    process.env.FARRIER_SKILLS_BIN = "skills";

    const runner: CommandRunner = async (input) => {
      calls.push(input);
      return {
        exitCode: 0,
        stdout: "",
        stderr: ""
      };
    };

    try {
      const results = await installSkills(["not-a-valid-ref"], dir, runner);

      expect(calls).toEqual([]);
      expect(results).toEqual([
        {
          ref: "not-a-valid-ref",
          ok: false,
          stdout: "",
          stderr: "",
          exitCode: 1,
          error: "Invalid skill ref 'not-a-valid-ref'. Expected <source>@<skillId>."
        }
      ]);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("installSkills catches runner exceptions", async () => {
    const dir = await tempDir();
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    process.env.FARRIER_SKILLS_BIN = "skills";

    const runner: CommandRunner = async () => {
      throw new Error("missing skills binary");
    };

    try {
      const results = await installSkills(["owner/repo@skill"], dir, runner);

      expect(results).toEqual([
        {
          ref: "owner/repo@skill",
          ok: false,
          stdout: "",
          stderr: "",
          exitCode: 1,
          error: "missing skills binary (ran 'skills'). Try installing the skills CLI or set FARRIER_SKILLS_BIN."
        }
      ]);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("installSkills reports resolution failure for every ref when no skills CLI is found", async () => {
    const dir = await tempDir();
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    delete process.env.FARRIER_SKILLS_BIN;
    const calls: CommandRunnerInput[] = [];

    const runner: CommandRunner = async (input) => {
      calls.push(input);
      return {
        exitCode: 0,
        stdout: "",
        stderr: ""
      };
    };

    const resolveDeps: ResolveSkillsCommandDeps = {
      which: neverWhich,
      exists: neverExists
    };

    try {
      const results = await installSkills(["owner/repo@one", "owner/repo@one", "owner/repo@two"], dir, runner, resolveDeps);

      expect(calls).toEqual([]);
      expect(results).toHaveLength(2);

      for (const result of results) {
        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(1);
        expect(result.error).toMatch(/FARRIER_SKILLS_BIN/);
      }
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("resolveSkillsCommand honors FARRIER_SKILLS_BIN and splits on spaces", () => {
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    process.env.FARRIER_SKILLS_BIN = "/custom/path/skills --flag";

    const deps: ResolveSkillsCommandDeps = {
      which: neverWhich,
      exists: neverExists
    };

    try {
      expect(resolveSkillsCommand(deps)).toEqual(["/custom/path/skills", "--flag"]);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("resolveSkillsCommand prefers the bundled node_modules/.bin/skills", () => {
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    delete process.env.FARRIER_SKILLS_BIN;

    const deps: ResolveSkillsCommandDeps = {
      which: () => {
        throw new Error("which should not be consulted when the bundled bin exists");
      },
      exists: (path) => path.endsWith(join("node_modules", ".bin", "skills"))
    };

    try {
      const result = resolveSkillsCommand(deps);
      expect(result).toHaveLength(1);
      expect(result[0]?.endsWith(join("node_modules", ".bin", "skills"))).toBe(true);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("resolveSkillsCommand falls back to PATH when bundled bin is missing", () => {
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    delete process.env.FARRIER_SKILLS_BIN;

    const deps: ResolveSkillsCommandDeps = {
      which: (bin) => (bin === "skills" ? "/usr/local/bin/skills" : null),
      exists: neverExists
    };

    try {
      expect(resolveSkillsCommand(deps)).toEqual(["skills"]);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("resolveSkillsCommand falls back to bunx when nothing else is found", () => {
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    delete process.env.FARRIER_SKILLS_BIN;

    const deps: ResolveSkillsCommandDeps = {
      which: (bin) => (bin === "bunx" ? "/usr/local/bin/bunx" : null),
      exists: neverExists
    };

    try {
      expect(resolveSkillsCommand(deps)).toEqual(["bunx", "skills"]);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("resolveSkillsCommand falls back to pnpm dlx as a last resort", () => {
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    delete process.env.FARRIER_SKILLS_BIN;

    const deps: ResolveSkillsCommandDeps = {
      which: (bin) => (bin === "pnpm" ? "/usr/local/bin/pnpm" : null),
      exists: neverExists
    };

    try {
      expect(resolveSkillsCommand(deps)).toEqual(["pnpm", "dlx", "skills"]);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });

  test("resolveSkillsCommand throws a remediation error when nothing resolves", () => {
    const previousBin = process.env.FARRIER_SKILLS_BIN;
    delete process.env.FARRIER_SKILLS_BIN;

    const deps: ResolveSkillsCommandDeps = {
      which: neverWhich,
      exists: neverExists
    };

    try {
      expect(() => resolveSkillsCommand(deps)).toThrow(/FARRIER_SKILLS_BIN/);
    } finally {
      restoreSkillsBinEnv(previousBin);
    }
  });
});
