import { describe, expect, test } from "bun:test";
import {
  canonicalEvidence,
  compareEvidence,
  createEvidenceSet,
  redactEvidence
} from "../src/engine/behavior-evidence";

const byteLength = (value: unknown) => new TextEncoder().encode(canonicalEvidence(value)).byteLength;

describe("behavior evidence contract", () => {
  test("redacts nested object keys, sensitive values, common credentials, and private material", () => {
    const providerTokens = [
      ["github", "pat", "fixture", "a".repeat(24)].join("_"),
      ["ghp", "1".repeat(36)].join("_"),
      `${["gl", "pat"].join("")}-${"b".repeat(20)}`,
      ["xoxb", "1".repeat(10), "c".repeat(12)].join("-"),
      ["AK", "IA", "2".repeat(16)].join(""),
      ["sk", "d".repeat(16)].join("-")
    ];
    const source = {
      token: "seeded-secret",
      nested: {
        password: "long secret with spaces",
        list: [
          "Bearer abcdefghijklmnop",
          "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
          ...providerTokens,
          "https://user:pass@example.com/path",
          "dev@example.com",
          "-----BEGIN RSA PRIVATE KEY-----\nseeded\n-----END RSA PRIVATE KEY-----"
        ]
      },
      "token=key-secret": "value",
      prose: "The secret garden uses ordinary prose."
    };
    const redacted = redactEvidence(source);
    const serialized = JSON.stringify(redacted);
    for (const secret of [
      "seeded-secret", "long secret with spaces", "abcdefghijklmnop",
      "123456789012345678901234567890", "user:pass", "dev@example.com",
      "key-secret", "\nseeded\n", ...providerTokens
    ]) expect(serialized).not.toContain(secret);
    expect(redacted.prose).toBe("The secret garden uses ordinary prose.");
  });

  test("redacts provider key shapes and prefixed secret assignments while leaving ordinary code alone", () => {
    // Token fixtures are assembled from parts so no credential-shaped literal
    // lands in the repo. Prose PII stays out of scope for these patterns.
    const secretValue = "j".repeat(30);
    const positives = [
      ["AIza", "SyA", "d".repeat(32)].join(""),
      ["npm", "e".repeat(36)].join("_"),
      ["AS", "IA", "8".repeat(16)].join(""),
      ["sk", "ant", "api03", "g".repeat(24)].join("-"),
      `aws_secret_access_key = ${secretValue}`,
      `GITHUB_TOKEN=${secretValue}`,
      `"password": "${secretValue}"`,
      `signing_key: '${secretValue}'`
    ];
    for (const sample of positives) {
      const redacted = redactEvidence({ text: sample }).text;
      expect(redacted).toContain("REDACTED");
      expect(redacted).not.toContain(secretValue);
    }

    const negatives = [
      `commit ${"3f78".repeat(10)} tagged for release`,
      `deploy_commit = ${"ab12".repeat(10)}`,
      "the task-scheduler and risk-assessment jobs run nightly",
      "https://github.com/owner/repo/pull/42",
      '"integrity": "sha512-C7x8CXm9E6vXjMLC0Ap5nqWaEzFJ9lKAJgtcQPP=="',
      "max_tokens: 4096",
      "sort_key=lambda item: item.name",
      "short id ab12cd"
    ];
    for (const sample of negatives) {
      expect(redactEvidence({ text: sample }).text).toBe(sample);
    }
  });

  test("removes supplied exact values longest-first before pattern redaction", () => {
    const redacted = redactEvidence(
      { message: "prefix violet horse battery suffix violet horse" },
      ["", "violet horse", "violet horse battery"]
    );
    expect(redacted.message).toBe("prefix [REDACTED_EXACT] suffix [REDACTED_EXACT]");
  });

  test("enforces exact per-item and retained-set byte limits with escaping and multibyte input", () => {
    const set = createEvidenceSet({
      workflow: "learn",
      items: Array.from({ length: 10 }, (_, index) => ({
        index,
        body: `"\\\\😀${"é".repeat(300)}`
      })),
      maxItems: 10,
      maxItemBytes: 128,
      maxTotalBytes: 300
    });
    expect(set.items.every((item) => byteLength(item) <= 128)).toBeTrue();
    expect(byteLength(set.items)).toBe(set.byteCount);
    expect(set.byteCount).toBeLessThanOrEqual(300);
    expect(set.truncated).toBeTrue();
    expect(set.inputItemCount).toBe(10);
    expect(set.truncatedItemCount).toBeGreaterThan(0);
    expect(set.omittedItemCount).toBeGreaterThan(0);
    expect(() => createEvidenceSet({ workflow: "learn", items: [], maxItems: 0 })).toThrow("maxItems");
    expect(() => createEvidenceSet({ workflow: "learn", items: [], maxItemBytes: 1 })).toThrow("maxItemBytes");
    expect(() => createEvidenceSet({ workflow: "learn", items: [], maxTotalBytes: 1 })).toThrow("maxTotalBytes");
  });

  test("requires identical inputs, rejects duplicate ids, and applies deterministic regression veto", () => {
    const set = createEvidenceSet({ workflow: "skill", items: [{ id: "positive" }, { id: "negative" }] });
    expect(compareEvidence({ beforeSet: set, afterSet: set, before: [{ id: "positive", outcome: "pass" }, { id: "negative", outcome: "fail" }], after: [{ id: "positive", outcome: "pass" }, { id: "negative", outcome: "pass" }] }).result).toBe("improved");
    expect(compareEvidence({ beforeSet: set, afterSet: set, before: [{ id: "positive", outcome: "pass" }, { id: "negative", outcome: "pass" }], after: [{ id: "positive", outcome: "fail" }, { id: "negative", outcome: "pass" }] })).toMatchObject({ result: "regressed", regressionVeto: true });
    expect(() => compareEvidence({ beforeSet: set, afterSet: set, before: [{ id: "same", outcome: "pass" }, { id: "same", outcome: "fail" }], after: [] })).toThrow("duplicate case id");
    expect(() => compareEvidence({ beforeSet: set, afterSet: set, before: [], after: [{ id: "same", outcome: "pass" }, { id: "same", outcome: "fail" }] })).toThrow("duplicate case id");
    const changed = createEvidenceSet({ workflow: "skill", items: [{ id: "different" }] });
    expect(() => compareEvidence({ beforeSet: set, afterSet: changed, before: [], after: [] })).toThrow("identical bounded input set");
  });
});
