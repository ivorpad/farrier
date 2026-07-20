import { expect, test } from "bun:test";
import { harnessAuditAliasCopyProblems } from "../src/engine/harness-audit-review-aliases";

test("blinded repository copies are distinct across reviewers", () => {
  expect(harnessAuditAliasCopyProblems({
    reviewer1: { linen: { targetDir: "/opaque/shared" } },
    reviewer2: { quartz: { targetDir: "/opaque/shared" } },
  })).toEqual([
    "Blinded repository target /opaque/shared is shared by reviewer1:linen and reviewer2:quartz.",
  ]);
  expect(harnessAuditAliasCopyProblems({
    reviewer1: { linen: { targetDir: "/opaque/reviewer1-linen" } },
    reviewer2: { quartz: { targetDir: "/opaque/reviewer2-quartz" } },
  })).toEqual([]);
});
