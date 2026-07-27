import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * The review-decisions ledger: an append-only local record of what the user
 * accepted or rejected in the Improve review surface, fed back into the next
 * analysis so the model does not re-propose a rejected idea unchanged.
 *
 * Greenfield discipline: one JSON object per line in
 * .farrier/review-decisions.jsonl, no version header, no migration paths, and
 * a malformed line fails loud rather than being tolerated or skipped. A
 * missing file is the normal empty case, not an error.
 */

export type ReviewDecisionOutcome = "accepted" | "rejected";

export type ReviewDecision = {
  /** Stable id of the reviewed proposal. */
  proposalId: string;
  /** The proposal kind (e.g. "kb-rule", "guard-instance"); kept agnostic. */
  kind: string;
  /** Human-readable proposal title, as shown in the review list. */
  title: string;
  decision: ReviewDecisionOutcome;
  /** ISO-8601 timestamp supplied by the caller. */
  at: string;
};

const ledgerRelativePath = join(".farrier", "review-decisions.jsonl");

function ledgerPath(targetDir: string): string {
  return join(resolve(targetDir), ledgerRelativePath);
}

function fieldError(where: string, field: string): Error {
  return new Error(`review decision ${where} has a missing or invalid "${field}"`);
}

/** Validates an arbitrary value as a ReviewDecision, throwing loud on any defect. */
function assertReviewDecision(value: unknown, where: string): ReviewDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`review decision ${where} must be a JSON object`);
  }
  const record = value as Record<string, unknown>;
  const { proposalId, kind, title, decision, at } = record;
  if (typeof proposalId !== "string" || proposalId.length === 0) throw fieldError(where, "proposalId");
  if (typeof kind !== "string" || kind.length === 0) throw fieldError(where, "kind");
  if (typeof title !== "string" || title.length === 0) throw fieldError(where, "title");
  if (decision !== "accepted" && decision !== "rejected") throw fieldError(where, "decision");
  if (typeof at !== "string" || at.length === 0) throw fieldError(where, "at");
  return { proposalId, kind, title, decision, at };
}

/**
 * Appends one decision to the ledger, creating .farrier/ if needed. Validates
 * the entry first (fail loud); the caller is responsible for not letting a
 * write failure block the action it is recording.
 */
export async function appendReviewDecision(targetDir: string, decision: ReviewDecision): Promise<void> {
  const entry = assertReviewDecision(decision, "to append");
  const path = ledgerPath(targetDir);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * Reads every recorded decision in file order. A missing ledger yields an
 * empty list; a malformed line throws with its line number (no tolerance).
 */
export async function readReviewDecisions(targetDir: string): Promise<ReviewDecision[]> {
  const path = ledgerPath(targetDir);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }

  const decisions: ReviewDecision[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `review-decisions.jsonl line ${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    decisions.push(assertReviewDecision(parsed, `on line ${index + 1}`));
  }
  return decisions;
}
