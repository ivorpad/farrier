import { createHash } from "node:crypto";

export type EvidenceWorkflow = "learn" | "advice" | "skill";
export type EvidenceCaseOutcome = "pass" | "fail" | "inconclusive";
export type EvidenceComparisonResult = "improved" | "regressed" | "inconclusive";

export type BoundedEvidenceSet<T> = {
  workflow: EvidenceWorkflow;
  digest: string;
  items: T[];
  itemCount: number;
  byteCount: number;
  inputItemCount: number;
  inputByteCount: number;
  truncatedItemCount: number;
  omittedItemCount: number;
  truncated: boolean;
};

export type EvidenceCaseResult = {
  id: string;
  outcome: EvidenceCaseOutcome;
};

export type EvidenceComparison = {
  inputDigest: string;
  result: EvidenceComparisonResult;
  before: { passed: number; failed: number; inconclusive: number };
  after: { passed: number; failed: number; inconclusive: number };
  regressionVeto: boolean;
  input: {
    inputItems: number;
    retainedItems: number;
    inputBytes: number;
    retainedBytes: number;
    truncatedItems: number;
    omittedItems: number;
    truncated: boolean;
  };
};

const defaultMaxItems = 40;
const defaultMaxItemBytes = 2_000;
const defaultMaxTotalBytes = 32_000;
const encoder = new TextEncoder();
const sensitiveKeys = new Set([
  "apikey", "accesstoken", "refreshtoken", "token", "secret", "password", "passwd",
  "credential", "credentials", "authorization", "privatekey", "awssecretaccesskey",
  "awssessiontoken", "openaiapikey", "githubtoken", "gitlabtoken", "slacktoken"
]);

function isSensitiveKey(key: string): boolean {
  return sensitiveKeys.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase());
}

function redactString(value: string): string {
  return value
    .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|gl(?:pat|rt)-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{8,})\b/g, "[REDACTED_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}={0,2}/gi, "$1[REDACTED_TOKEN]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED_CREDENTIALS]@")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|credential|authorization|private[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

export function redactEvidence<T>(value: T): T {
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactEvidence(item)) as T;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => {
      const redactedKey = redactString(key);
      return [redactedKey, isSensitiveKey(key) ? "[REDACTED]" : redactEvidence(item)];
    });
    return Object.fromEntries(entries) as T;
  }
  return value;
}

export function canonicalEvidence(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEvidence).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalEvidence(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function bytes(value: unknown): number {
  return encoder.encode(canonicalEvidence(value)).byteLength;
}

function validateLimit(name: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer >= ${minimum}.`);
  }
}

function boundedItem<T>(value: T, maxBytes: number): { value?: T; truncated: boolean } {
  if (bytes(value) <= maxBytes) return { value, truncated: false };

  const marker = { truncated: true };
  if (bytes(marker) > maxBytes) return { truncated: true };

  const source = canonicalEvidence(value);
  const codePoints = Array.from(source);
  let low = 0;
  let high = codePoints.length;
  let best: unknown = marker;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = { truncated: true, preview: codePoints.slice(0, middle).join("") };
    if (bytes(candidate) <= maxBytes) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return { value: best as T, truncated: true };
}

export function createEvidenceSet<T>(input: {
  workflow: EvidenceWorkflow;
  items: readonly T[];
  maxItems?: number;
  maxItemBytes?: number;
  maxTotalBytes?: number;
}): BoundedEvidenceSet<T> {
  const maxItems = input.maxItems ?? defaultMaxItems;
  const maxItemBytes = input.maxItemBytes ?? defaultMaxItemBytes;
  const maxTotalBytes = input.maxTotalBytes ?? defaultMaxTotalBytes;
  validateLimit("maxItems", maxItems, 1);
  validateLimit("maxItemBytes", maxItemBytes, bytes({ truncated: true }));
  validateLimit("maxTotalBytes", maxTotalBytes, bytes([]));

  const redactedInput = input.items.map((item) => redactEvidence(item));
  const inputByteCount = bytes(redactedInput);
  const items: T[] = [];
  let truncatedItemCount = 0;
  let omittedItemCount = Math.max(0, input.items.length - maxItems);

  for (const source of redactedInput.slice(0, maxItems)) {
    const bounded = boundedItem(source, maxItemBytes);
    if (bounded.truncated) truncatedItemCount += 1;
    if (bounded.value === undefined) {
      omittedItemCount += 1;
      continue;
    }
    if (bytes([...items, bounded.value]) > maxTotalBytes) {
      omittedItemCount += redactedInput.slice(0, maxItems).length - items.length;
      break;
    }
    items.push(bounded.value);
  }

  const byteCount = bytes(items);
  const truncated = truncatedItemCount > 0 || omittedItemCount > 0;
  const digest = createHash("sha256")
    .update(canonicalEvidence({ workflow: input.workflow, items }))
    .digest("hex");
  return {
    workflow: input.workflow,
    digest,
    items,
    itemCount: items.length,
    byteCount,
    inputItemCount: input.items.length,
    inputByteCount,
    truncatedItemCount,
    omittedItemCount,
    truncated
  };
}

function counts(results: readonly EvidenceCaseResult[]) {
  return {
    passed: results.filter((item) => item.outcome === "pass").length,
    failed: results.filter((item) => item.outcome === "fail").length,
    inconclusive: results.filter((item) => item.outcome === "inconclusive").length
  };
}

function resultMap(results: readonly EvidenceCaseResult[], side: string): Map<string, EvidenceCaseOutcome> {
  const mapped = new Map<string, EvidenceCaseOutcome>();
  for (const item of results) {
    if (mapped.has(item.id)) throw new Error(`Behavior evidence comparison rejects duplicate case id '${item.id}' in ${side} results.`);
    mapped.set(item.id, item.outcome);
  }
  return mapped;
}

export function compareEvidence(input: {
  beforeSet: BoundedEvidenceSet<unknown>;
  afterSet: BoundedEvidenceSet<unknown>;
  before: readonly EvidenceCaseResult[];
  after: readonly EvidenceCaseResult[];
  regressionVeto?: boolean;
}): EvidenceComparison {
  if (input.beforeSet.workflow !== input.afterSet.workflow || input.beforeSet.digest !== input.afterSet.digest) {
    throw new Error("Behavior evidence comparison requires the identical bounded input set before and after.");
  }
  const beforeById = resultMap(input.before, "before");
  const afterById = resultMap(input.after, "after");
  if (beforeById.size !== afterById.size || [...beforeById.keys()].some((id) => !afterById.has(id))) {
    throw new Error("Behavior evidence comparison requires identical case ids before and after.");
  }
  const regressionVeto = input.regressionVeto === true || [...beforeById].some(([id, outcome]) => outcome === "pass" && afterById.get(id) === "fail");
  const before = counts(input.before);
  const after = counts(input.after);
  const result: EvidenceComparisonResult = regressionVeto || after.failed > before.failed
    ? "regressed"
    : after.passed > before.passed && after.failed <= before.failed
      ? "improved"
      : "inconclusive";
  return {
    inputDigest: input.beforeSet.digest,
    result,
    before,
    after,
    regressionVeto,
    input: {
      inputItems: input.beforeSet.inputItemCount,
      retainedItems: input.beforeSet.itemCount,
      inputBytes: input.beforeSet.inputByteCount,
      retainedBytes: input.beforeSet.byteCount,
      truncatedItems: input.beforeSet.truncatedItemCount,
      omittedItems: input.beforeSet.omittedItemCount,
      truncated: input.beforeSet.truncated
    }
  };
}
