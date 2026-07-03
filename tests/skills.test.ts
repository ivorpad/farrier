import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
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

  test("installSkills shells out once per source@skill ref", async () => {
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

      expect(calls).toEqual([
        {
          cmd: ["skills", "add", "wshobson/agents", "-s", "python-code-style", "-a", "claude-code", "codex", "-y"],
          cwd: dir
        }
      ]);

      expect(results).toEqual([
        {
          ref: "wshobson/agents@python-code-style",
          ok: true,
          stdout: "installed",
          stderr: "",
          exitCode: 0,
          error: undefined
        }
      ]);
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
      await installSkills(["owner/repo@one", "owner/repo@one", "owner/repo@two"], dir, runner);

      expect(calls.map((call) => call.cmd)).toEqual([
        ["skills", "add", "owner/repo", "-s", "one", "-a", "claude-code", "codex", "-y"],
        ["skills", "add", "owner/repo", "-s", "two", "-a", "claude-code", "codex", "-y"]
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

      expect(results).toEqual([
        {
          ref: "wshobson/agents@python-code-style",
          ok: false,
          stdout: "",
          stderr: "boom",
          exitCode: 7,
          error: "skills add exited with code 7. Try installing the skills CLI or set FARRIER_SKILLS_BIN."
        }
      ]);
    } finally {
      restoreSkillsBinEnv(previousBin);
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
