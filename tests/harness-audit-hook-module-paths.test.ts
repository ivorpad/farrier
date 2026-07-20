import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHarnessAuditCorpus } from "../src/engine/harness-audit-evidence";

describe("harness audit hook module paths", () => {
  test("resolves hook imports without changing hook command roots", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-audit-hook-modules-"));
    await Promise.all([
      mkdir(join(targetDir, ".claude/hooks/lib/runtime"), { recursive: true }),
      mkdir(join(targetDir, "scripts"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(targetDir, ".claude/hooks/lib/types.ts"), "export type Violation = string;\n"),
      writeFile(join(targetDir, ".claude/hooks/lib/dynamic.mts"), "export const dynamic = true;\n"),
      writeFile(join(targetDir, ".claude/hooks/lib/common.cjs"), "exports.common = true;\n"),
      writeFile(join(targetDir, ".claude/hooks/lib/runtime/index.js"), "export const ready = true;\n"),
      writeFile(join(targetDir, "scripts/hook.sh"), "#!/bin/sh\n"),
      writeFile(join(targetDir, ".claude/hooks/main.ts"), [
        'import type { Violation } from "./lib/types";',
        'import "./lib/runtime";',
        'const dynamic = import("./lib/dynamic");',
        'const common = require("./lib/common");',
        'import { packageValue } from "package/lib/value";',
        'import { missing } from "./lib/missing";',
        "export const violation: Violation = missing;",
        "",
      ].join("\n")),
      writeFile(join(targetDir, ".claude/settings.local.json"), [
        "{",
        '  "hooks": {',
        '    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "./scripts/hook.sh" }] }]',
        "  }",
        "}",
        "",
      ].join("\n")),
    ]);

    const corpus = await collectHarnessAuditCorpus(targetDir);

    expect(corpus.checks).toContainEqual(expect.objectContaining({
      description: "Checked referenced path .claude/hooks/lib/types.",
      result: ".claude/hooks/lib/types.ts: regular file exists",
    }));
    expect(corpus.checks).toContainEqual(expect.objectContaining({
      description: "Checked referenced path .claude/hooks/lib/runtime.",
      result: ".claude/hooks/lib/runtime/index.js: regular file exists",
    }));
    expect(corpus.checks).toContainEqual(expect.objectContaining({
      description: "Checked referenced path .claude/hooks/lib/dynamic.",
      result: ".claude/hooks/lib/dynamic.mts: regular file exists",
    }));
    expect(corpus.checks).toContainEqual(expect.objectContaining({
      description: "Checked referenced path .claude/hooks/lib/common.",
      result: ".claude/hooks/lib/common.cjs: regular file exists",
    }));
    expect(corpus.checks).toContainEqual(expect.objectContaining({
      description: "Checked referenced path .claude/hooks/lib/missing.",
      result: "missing",
    }));
    expect(corpus.checks).toContainEqual(expect.objectContaining({
      description: "Checked referenced path scripts/hook.sh.",
      result: "regular file exists",
    }));
    expect(corpus.checks.some((item) =>
      item.description.includes("package/lib/value"))).toBeFalse();
    expect(corpus.checks.some((item) =>
      item.description.includes(".claude/scripts/hook.sh"))).toBeFalse();
  });
});
