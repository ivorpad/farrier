import { describe, expect, test } from "bun:test";
import {
  adviseSkills,
  detectAgentBackend,
  resolveContext,
  type AdviseCommandRunner,
  type AdviseCommandRunnerInput
} from "../src/engine/advise";
import type { SkillSearchResult } from "../src/engine/skills";

const contextCharLimit = 16_000;

function fakeFiles(files: Record<string, string>) {
  return {
    exists: (path: string) => path in files,
    readFile: async (path: string) => {
      const content = files[path];
      if (content === undefined) {
        throw new Error(`unexpected read of ${path}`);
      }
      return content;
    }
  };
}

function queuedRunner(outputs: Array<{ exitCode?: number; stdout?: string; stderr?: string }>): {
  runner: AdviseCommandRunner;
  calls: AdviseCommandRunnerInput[];
} {
  const calls: AdviseCommandRunnerInput[] = [];
  const runner: AdviseCommandRunner = async (input) => {
    calls.push(input);
    const output = outputs[Math.min(calls.length - 1, outputs.length - 1)] ?? {};
    return { exitCode: output.exitCode ?? 0, stdout: output.stdout ?? "", stderr: output.stderr ?? "" };
  };
  return { runner, calls };
}

function candidate(source: string, skillId: string, installs = 10): SkillSearchResult {
  return { skillId, name: skillId, installs, source };
}

const queriesJson = JSON.stringify({ queries: ["fastapi testing"] });

function recommendationsJson(recommendations: unknown[]): string {
  return JSON.stringify({ recommendations });
}

describe("resolveContext", () => {
  test("reads a context file as given, then relative to the target dir, else treats the value as text", async () => {
    const deps = fakeFiles({ "/abs/brief.md": "absolute brief", "/target/docs/notes.md": "relative brief" });

    const cases = [
      { context: "/abs/brief.md", text: "absolute brief", source: "file:/abs/brief.md" },
      { context: "docs/notes.md", text: "relative brief", source: "file:/target/docs/notes.md" },
      { context: "a FastAPI billing service", text: "a FastAPI billing service", source: "text" }
    ];

    for (const expected of cases) {
      const resolved = await resolveContext({ targetDir: "/target", context: expected.context, deps });
      expect(resolved).toEqual({ text: expected.text, source: expected.source });
    }
  });

  test("detects PRP.md before PRP.txt and docs/PRP.md when no context is passed", async () => {
    const deps = fakeFiles({
      "/target/PRP.md": "top prp",
      "/target/PRP.txt": "txt prp",
      "/target/docs/PRP.md": "docs prp"
    });

    const resolved = await resolveContext({ targetDir: "/target", deps });
    expect(resolved).toEqual({ text: "top prp", source: "detected:PRP.md" });

    const fallback = await resolveContext({ targetDir: "/target", deps: fakeFiles({ "/target/docs/PRP.md": "docs prp" }) });
    expect(fallback).toEqual({ text: "docs prp", source: "detected:docs/PRP.md" });
  });

  test("returns undefined when nothing is found and truncates oversized context", async () => {
    expect(await resolveContext({ targetDir: "/target", deps: fakeFiles({}) })).toBeUndefined();

    const oversized = await resolveContext({ targetDir: "/target", context: "x".repeat(contextCharLimit + 5), deps: fakeFiles({}) });
    expect(oversized?.text.startsWith("x".repeat(contextCharLimit))).toBe(true);
    expect(oversized?.text).toContain(`[context truncated to ${contextCharLimit} characters]`);
    expect(oversized?.text).not.toContain("x".repeat(contextCharLimit + 1));
  });
});

describe("detectAgentBackend", () => {
  test("prefers claude, falls back to codex, else undefined", () => {
    const cases: Array<{ bins: string[]; expected: "claude" | "codex" | undefined }> = [
      { bins: ["claude", "codex"], expected: "claude" },
      { bins: ["codex"], expected: "codex" },
      { bins: [], expected: undefined }
    ];

    for (const { bins, expected } of cases) {
      expect(detectAgentBackend({ which: (bin) => (bins.includes(bin) ? `/bin/${bin}` : null) })).toBe(expected);
    }
  });
});

describe("adviseSkills", () => {
  const baseInput = {
    targetDir: "/target",
    packId: "python-fastapi",
    contextText: "a FastAPI billing service"
  };

  test("runs claude via -p with the prompt on stdin, searches, and validates recommendations", async () => {
    const { runner, calls } = queuedRunner([
      { stdout: queriesJson },
      { stdout: recommendationsJson([{ ref: "owner/repo@pytest-skill", reason: "covers pytest patterns" }]) }
    ]);
    const searched: string[] = [];

    const result = await adviseSkills({
      ...baseInput,
      backend: "claude",
      runner,
      search: async (query) => {
        searched.push(query);
        return [candidate("owner/repo", "pytest-skill", 42)];
      }
    });

    expect(calls.map((call) => call.cmd)).toEqual([
      ["claude", "-p", "--model", "sonnet"],
      ["claude", "-p", "--model", "sonnet"]
    ]);
    expect(calls[0]?.stdin).toContain("a FastAPI billing service");
    expect(calls[1]?.stdin).toContain("owner/repo@pytest-skill");
    expect(searched).toEqual(["fastapi testing"]);
    expect(result.queries).toEqual(["fastapi testing"]);
    expect(result.recommendations).toEqual([
      { ref: "owner/repo@pytest-skill", name: "pytest-skill", installs: 42, reason: "covers pytest patterns" }
    ]);
    expect(result.notes).toEqual([]);
  });

  test("runs codex via exec with read-only sandbox flags and the prompt as trailing argument", async () => {
    const { runner, calls } = queuedRunner([{ stdout: queriesJson }, { stdout: recommendationsJson([]) }]);

    await adviseSkills({ ...baseInput, backend: "codex", model: "gpt-x", runner, search: async () => [candidate("o/r", "s")] });

    for (const call of calls) {
      expect(call.cmd.slice(0, 8)).toEqual([
        "codex",
        "exec",
        "--model",
        "gpt-x",
        "-s",
        "read-only",
        "-c",
        "skills.include_instructions=false"
      ]);
      expect(call.cmd[8]).toContain("Return JSON only");
      expect(call.stdin).toBeUndefined();
    }
  });

  test("omits --model for codex when none is given so the account default applies", async () => {
    const { runner, calls } = queuedRunner([{ stdout: queriesJson }, { stdout: recommendationsJson([]) }]);

    await adviseSkills({ ...baseInput, backend: "codex", runner, search: async () => [candidate("o/r", "s")] });

    expect(calls[0]?.cmd.slice(0, 4)).toEqual(["codex", "exec", "-s", "read-only"]);
    expect(calls[0]?.cmd).not.toContain("--model");
  });

  test("drops hallucinated, malformed, and reason-less recommendations with notes", async () => {
    const { runner } = queuedRunner([
      { stdout: queriesJson },
      {
        stdout: recommendationsJson([
          { ref: "owner/repo@real", reason: "fits the stack" },
          { ref: "made/up@skill", reason: "hallucinated" },
          { ref: "not-a-ref", reason: "malformed" },
          { ref: "owner/repo@real2" }
        ])
      }
    ]);

    const result = await adviseSkills({
      ...baseInput,
      backend: "claude",
      runner,
      search: async () => [candidate("owner/repo", "real"), candidate("owner/repo", "real2")]
    });

    expect(result.recommendations.map((recommendation) => recommendation.ref)).toEqual(["owner/repo@real"]);
    expect(result.notes).toEqual([
      "recommendation ref 'made/up@skill' is not in the candidate set",
      "recommendation ref 'not-a-ref' is not shaped <source>@<skillId>",
      "recommendation 'owner/repo@real2' is missing required string field reason"
    ]);
  });

  test("recovers JSON embedded in prose and runs query searches in parallel, deduping results", async () => {
    const { runner } = queuedRunner([
      { stdout: `Sure! Here you go:\n${JSON.stringify({ queries: ["one", "two"] })}\nHope that helps.` },
      { stdout: recommendationsJson([{ ref: "o/r@dup", reason: "useful" }]) }
    ]);

    // The first search only resolves once the second has started: deterministic proof of parallelism.
    let releaseFirst: (results: SkillSearchResult[]) => void = () => {};
    const firstSearch = new Promise<SkillSearchResult[]>((resolve) => {
      releaseFirst = resolve;
    });
    const started: string[] = [];

    const result = await adviseSkills({
      ...baseInput,
      backend: "claude",
      runner,
      search: (query) => {
        started.push(query);
        if (started.length === 1) {
          return firstSearch;
        }
        releaseFirst([candidate("o/r", "dup")]);
        return Promise.resolve([candidate("o/r", "dup")]);
      }
    });

    expect(started).toEqual(["one", "two"]);
    expect(result.recommendations).toHaveLength(1);
  });

  test("continues with a note when one query search fails", async () => {
    const { runner } = queuedRunner([
      { stdout: JSON.stringify({ queries: ["good", "bad"] }) },
      { stdout: recommendationsJson([{ ref: "o/r@kept", reason: "still useful" }]) }
    ]);

    const result = await adviseSkills({
      ...baseInput,
      backend: "claude",
      runner,
      search: async (query) => {
        if (query === "bad") {
          throw new Error("registry down");
        }
        return [candidate("o/r", "kept")];
      }
    });

    expect(result.recommendations.map((recommendation) => recommendation.ref)).toEqual(["o/r@kept"]);
    expect(result.notes).toEqual(["Search for 'bad' failed: registry down"]);
  });

  test("caps recommendations and notes the dropped extras", async () => {
    const candidates = Array.from({ length: 4 }, (_, index) => candidate("o/r", `skill-${index}`));
    const { runner } = queuedRunner([
      { stdout: queriesJson },
      { stdout: recommendationsJson(candidates.map((entry) => ({ ref: `o/r@${entry.skillId}`, reason: "fits" }))) }
    ]);

    const result = await adviseSkills({
      ...baseInput,
      backend: "claude",
      maxRecommendations: 2,
      runner,
      search: async () => candidates
    });

    expect(result.recommendations).toHaveLength(2);
    expect(result.notes).toEqual([
      "Dropped extra recommendation beyond the 2 cap.",
      "Dropped extra recommendation beyond the 2 cap."
    ]);
  });

  test("returns early with a note when no candidates are found", async () => {
    const { runner, calls } = queuedRunner([{ stdout: queriesJson }]);

    const result = await adviseSkills({ ...baseInput, backend: "claude", runner, search: async () => [] });

    expect(calls).toHaveLength(1);
    expect(result.recommendations).toEqual([]);
    expect(result.notes).toEqual(["No candidate skills found for the generated queries."]);
  });

  test("rejects with a backend-named error on nonzero exit, empty stdout, and non-JSON stdout", async () => {
    const failures = [
      { output: { exitCode: 1, stderr: "boom" }, message: "claude backend exited with code 1: boom" },
      { output: { stdout: "   " }, message: "claude backend returned empty stdout" },
      { output: { stdout: "no json here" }, message: "claude backend did not return JSON" }
    ];

    for (const failure of failures) {
      const { runner } = queuedRunner([failure.output]);
      expect(
        adviseSkills({ ...baseInput, backend: "claude", runner, search: async () => [] })
      ).rejects.toThrow(failure.message);
    }
  });

  test("rejects when backend JSON has the wrong shape", async () => {
    const { runner } = queuedRunner([{ stdout: JSON.stringify({ nope: [] }) }]);

    expect(adviseSkills({ ...baseInput, backend: "claude", runner, search: async () => [] })).rejects.toThrow(
      'claude backend JSON must have shape {"queries":[...]}'
    );
  });
});
