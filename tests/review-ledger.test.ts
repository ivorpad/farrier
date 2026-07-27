import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendReviewDecision, readReviewDecisions, type ReviewDecision } from "../src/engine/review-ledger";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-review-ledger-"));
}

function decision(overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    proposalId: "kb-buttons",
    kind: "kb-rule",
    title: "Buttons come from DesignSystem",
    decision: "accepted",
    at: "2026-07-27T10:00:00.000Z",
    ...overrides
  };
}

describe("review ledger", () => {
  test("reads an empty list when no ledger exists", async () => {
    const project = await tempDir();
    expect(await readReviewDecisions(project)).toEqual([]);
  });

  test("appends decisions and reads them back in file order", async () => {
    const project = await tempDir();
    await appendReviewDecision(project, decision({ proposalId: "one", decision: "accepted" }));
    await appendReviewDecision(project, decision({ proposalId: "two", decision: "rejected", title: "Prune the dead skill", kind: "prune-skill" }));

    const decisions = await readReviewDecisions(project);
    expect(decisions.map((entry) => [entry.proposalId, entry.decision])).toEqual([
      ["one", "accepted"],
      ["two", "rejected"]
    ]);
    expect(decisions[1]!.kind).toBe("prune-skill");

    // One object per line, .farrier/ created on demand.
    const raw = await readFile(join(project, ".farrier", "review-decisions.jsonl"), "utf8");
    expect(raw.trimEnd().split("\n")).toHaveLength(2);
  });

  test("appending refuses a malformed decision (fail loud, no coercion)", async () => {
    const project = await tempDir();
    await expect(appendReviewDecision(project, decision({ decision: "maybe" as ReviewDecision["decision"] }))).rejects.toThrow('"decision"');
    await expect(appendReviewDecision(project, decision({ proposalId: "" }))).rejects.toThrow('"proposalId"');
  });

  test("reading a malformed line fails loud with its line number", async () => {
    const project = await tempDir();
    await mkdir(join(project, ".farrier"), { recursive: true });
    const path = join(project, ".farrier", "review-decisions.jsonl");
    await writeFile(path, `${JSON.stringify(decision())}\nnot json at all\n`, "utf8");
    await expect(readReviewDecisions(project)).rejects.toThrow("line 2");

    await writeFile(path, `${JSON.stringify({ proposalId: "x", kind: "kb-rule", title: "t", decision: "accepted" })}\n`, "utf8");
    await expect(readReviewDecisions(project)).rejects.toThrow('"at"');
  });
});
