import { describe, expect, test } from "bun:test";
import type { BackendCommandRunner, BackendCommandRunnerInput } from "../src/engine/backend";
import { applyRefinements, generateRefineQuestions } from "../src/engine/refine-skill";

function stubRunner(stdout: string, exitCode = 0): { runner: BackendCommandRunner; calls: BackendCommandRunnerInput[] } {
  const calls: BackendCommandRunnerInput[] = [];
  const runner: BackendCommandRunner = async (input) => {
    calls.push(input);
    return { exitCode, stdout, stderr: "" };
  };
  return { runner, calls };
}

describe("refine-skill engine", () => {
  test("asks the backend read-only with the request and stack, and validates questions", async () => {
    const { runner, calls } = stubRunner(
      JSON.stringify({
        questions: [
          { question: "Which PDF library?", options: ["pdfplumber", "camelot"] },
          { question: "Output format?", options: ["GFM pipe tables"] },
          { question: "", options: ["dropped"] },
          { question: "No options is fine" },
          { question: "Too many", options: ["a"] },
          { question: "Beyond the cap", options: ["b"] }
        ]
      })
    );

    const questions = await generateRefineQuestions({
      description: "Convert financial tables to markdown",
      backend: "claude",
      targetDir: "/tmp/x",
      packId: "python-uv",
      runner
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd.slice(0, 2)).toEqual(["claude", "-p"]);
    expect(calls[0]?.cmd).not.toContain("--permission-mode");
    expect(calls[0]?.stdin).toContain("Convert financial tables to markdown");
    expect(calls[0]?.stdin).toContain("Project stack: python-uv");

    expect(questions).toHaveLength(4);
    expect(questions[0]).toEqual({ question: "Which PDF library?", options: ["pdfplumber", "camelot"] });
    expect(questions[2]).toEqual({ question: "No options is fine", options: [] });
  });

  test("accepts an empty question list and rejects malformed JSON with a backend-named error", async () => {
    const empty = stubRunner(JSON.stringify({ questions: [] }));
    expect(
      await generateRefineQuestions({ description: "x", backend: "codex", targetDir: "/tmp/x", runner: empty.runner })
    ).toEqual([]);

    const bad = stubRunner(JSON.stringify({ nope: true }));
    await expect(
      generateRefineQuestions({ description: "x", backend: "codex", targetDir: "/tmp/x", runner: bad.runner })
    ).rejects.toThrow('codex backend JSON must have shape {"questions":[...]}');
  });

  test("applyRefinements appends decisions and is a no-op without answers", () => {
    const enriched = applyRefinements("Convert tables", [
      { question: "Which PDF library?", answer: "pdfplumber" },
      { question: "Blank answers vanish", answer: "  " }
    ]);

    expect(enriched).toContain("Convert tables");
    expect(enriched).toContain("Implementation decisions (follow these exactly):");
    expect(enriched).toContain("- Which PDF library? pdfplumber");
    expect(enriched).not.toContain("Blank answers vanish");

    expect(applyRefinements("Convert tables", [])).toBe("Convert tables");
  });
});
