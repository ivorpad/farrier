import { createHash } from "node:crypto";
import type { HarnessAuditCorpus } from "./harness-audit-evidence";

export function harnessAuditCorpusDigest(corpus: HarnessAuditCorpus): string {
  const snapshot = {
    documents: corpus.documents.map(({ path, kind, text }) => ({ path, kind, text })),
    lines: corpus.lines,
    checks: corpus.checks,
    skipped: corpus.skipped,
  };
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}
