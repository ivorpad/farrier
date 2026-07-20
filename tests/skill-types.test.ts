import { describe, expect, test } from "bun:test";
import { unknownSkillPermissions } from "../src/engine/skill-permissions";

describe("shared skill contracts", () => {
  test("returns fresh permission summaries with every category unknown", () => {
    const first = unknownSkillPermissions();
    const second = unknownSkillPermissions();

    expect(first).toEqual({
      shell: { status: "unknown", values: [] },
      filesystemReads: { status: "unknown", values: [] },
      filesystemWrites: { status: "unknown", values: [] },
      networkDomains: { status: "unknown", values: [] },
      browser: { status: "unknown", values: [] },
      mcpServers: { status: "unknown", values: [] },
      secretNames: { status: "unknown", values: [] },
      requiredTools: { status: "unknown", values: [] },
      unclassified: [],
    });
    first.shell.values.push("bash");
    expect(second.shell.values).toEqual([]);
  });
});
