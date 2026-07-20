import { describe, expect, test } from "bun:test";
import { verificationTargetAbsenceSupported } from "../src/engine/harness-audit-verification-target";
import type { HarnessAuditCheck } from "../src/engine/harness-audit-types";

function inventory(result: string): HarnessAuditCheck[] {
  return [{
    id: "check:package-scripts",
    layers: ["verification"],
    description: "Listed package.json scripts.",
    result,
  }];
}

describe("verification target absence claims", () => {
  test("binds missing-target wording to the performed target inventory", () => {
    expect(verificationTargetAbsenceSupported("The test target is missing.", inventory("check, test")))
      .toBeFalse();
    expect(verificationTargetAbsenceSupported("The test target is missing.", inventory("check")))
      .toBeTrue();
    expect(verificationTargetAbsenceSupported("No `test:unit` script exists.", inventory("test")))
      .toBeTrue();
  });

  test("does not reinterpret an omitted-stage claim as a missing target", () => {
    expect(verificationTargetAbsenceSupported("The check gate is missing tests.", inventory("check")))
      .toBeUndefined();
  });
});
