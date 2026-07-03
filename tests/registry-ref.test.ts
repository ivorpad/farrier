import { describe, expect, test } from "bun:test";
import { isRegistryRef, parseItemRef } from "../src/registry/ref";

describe("registry item refs", () => {
  test("parses @namespace/name refs", () => {
    expect(parseItemRef("@acme/demo")).toEqual({
      namespace: "@acme",
      name: "demo",
      id: "@acme/demo"
    });
    expect(parseItemRef("@acme-platform/python-fastapi")).toEqual({
      namespace: "@acme-platform",
      name: "python-fastapi",
      id: "@acme-platform/python-fastapi"
    });
  });

  test("rejects builtin ids and malformed registry refs", () => {
    expect(isRegistryRef("python-fastapi")).toBe(false);
    expect(isRegistryRef("owner/repo@skill")).toBe(false);
    expect(isRegistryRef("@Acme/demo")).toBe(false);
    expect(isRegistryRef("@acme/demo/extra")).toBe(false);
    expect(isRegistryRef("@acme/_demo")).toBe(false);
  });
});
