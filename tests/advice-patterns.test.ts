import { describe, expect, test } from "bun:test";
import { boundSessionText } from "../src/engine/advice-patterns";

describe("advice session text bounds", () => {
  test("bounds large text without expanding the full input into code points", () => {
    const result = boundSessionText(`prefix ${"x".repeat(16 * 1024 * 1024)} €`, 4_000);

    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(4_000);
    expect(result.text).toEndWith("\n[truncated]");
    expect(result.truncated).toBeTrue();
  });

  test("does not split a multibyte character at the retained boundary", () => {
    const result = boundSessionText("é".repeat(20), 15);

    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(15);
    expect(result.text).not.toContain("�");
    expect(result.text).toEndWith("\n[truncated]");
  });
});
