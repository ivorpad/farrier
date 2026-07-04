import { describe, expect, test } from "bun:test";
import type { BackendCommandRunner, BackendCommandRunnerInput } from "../src/engine/backend";
import { applyRefinements, generateNextGrillQuestion, type RefineAnswer } from "../src/engine/refine-skill";

function stubRunner(stdout: string, exitCode = 0): { runner: BackendCommandRunner; calls: BackendCommandRunnerInput[] } {
  const calls: BackendCommandRunnerInput[] = [];
  const runner: BackendCommandRunner = async (input) => {
    calls.push(input);
    return { exitCode, stdout, stderr: "" };
  };
  return { runner, calls };
}

describe("grill engine", () => {
  test("first question: one read-only call, budget in the prompt, no transcript, options capped at 5", async () => {
    const { runner, calls } = stubRunner(
      JSON.stringify({
        question: "Which PDF library?",
        options: ["pdfplumber", "camelot", "tabula", "pymupdf", "borb", "pdfminer", "textract"]
      })
    );

    const question = await generateNextGrillQuestion({
      description: "Convert financial tables to markdown",
      backend: "claude",
      targetDir: "/tmp/x",
      packId: "python-uv",
      priorAnswers: [],
      questionNumber: 1,
      runner
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd.slice(0, 2)).toEqual(["claude", "-p"]);
    expect(calls[0]?.cmd).not.toContain("--permission-mode");
    expect(calls[0]?.stdin).toContain("Convert financial tables to markdown");
    expect(calls[0]?.stdin).toContain("Project stack: python-uv");
    expect(calls[0]?.stdin).toContain("question 1 of at most 6");
    expect(calls[0]?.stdin).not.toContain("Decisions so far");

    expect(question?.question).toBe("Which PDF library?");
    expect(question?.options).toHaveLength(5);
    expect(question?.options[0]).toBe("pdfplumber");
  });

  test("adaptive question: prior answers become a transcript, blanks render as skipped", async () => {
    const { runner, calls } = stubRunner(JSON.stringify({ question: "Output format?", options: ["GFM pipe tables"] }));

    const priorAnswers: RefineAnswer[] = [
      { question: "Which PDF library?", answer: "pdfplumber" },
      { question: "Handle scanned PDFs?", answer: "  " }
    ];

    await generateNextGrillQuestion({
      description: "Convert financial tables to markdown",
      backend: "claude",
      targetDir: "/tmp/x",
      priorAnswers,
      questionNumber: 3,
      runner
    });

    const prompt = calls[0]?.stdin ?? "";
    expect(prompt).toContain("Decisions so far");
    expect(prompt).toContain("Which PDF library?");
    expect(prompt).toContain("pdfplumber");
    expect(prompt).toContain("Handle scanned PDFs?");
    expect(prompt).toContain("(skipped — you decide; do not re-ask)");
  });

  test('{"done": true} ends the grill with null', async () => {
    const { runner, calls } = stubRunner(JSON.stringify({ done: true }));

    const question = await generateNextGrillQuestion({
      description: "x",
      backend: "claude",
      targetDir: "/tmp/x",
      priorAnswers: [],
      questionNumber: 2,
      runner
    });

    expect(question).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("a question number past the budget returns null without calling the backend", async () => {
    const { runner, calls } = stubRunner(JSON.stringify({ question: "unreachable", options: ["a"] }));

    const question = await generateNextGrillQuestion({
      description: "x",
      backend: "claude",
      targetDir: "/tmp/x",
      priorAnswers: [],
      questionNumber: 7,
      runner
    });

    expect(question).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("malformed steps reject with the backend-named shape error", async () => {
    const shapeError = 'codex backend JSON must be {"question":"...","options":[...]} or {"done":true}';

    const missing = stubRunner(JSON.stringify({ nope: true }));
    await expect(
      generateNextGrillQuestion({
        description: "x",
        backend: "codex",
        targetDir: "/tmp/x",
        priorAnswers: [],
        questionNumber: 1,
        runner: missing.runner
      })
    ).rejects.toThrow(shapeError);

    const empty = stubRunner(JSON.stringify({ question: "" }));
    await expect(
      generateNextGrillQuestion({
        description: "x",
        backend: "codex",
        targetDir: "/tmp/x",
        priorAnswers: [],
        questionNumber: 1,
        runner: empty.runner
      })
    ).rejects.toThrow(shapeError);
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
