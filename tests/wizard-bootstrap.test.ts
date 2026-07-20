import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWizardContext } from "../src/tui/wizard-bootstrap";

describe("resolveWizardContext", () => {
  test("uses package.json dependencies when no PRD or explicit context exists", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-wizard-context-"));
    try {
      await writeFile(join(targetDir, "package.json"), JSON.stringify({
        dependencies: { react: "^19.0.0", zod: "^4.0.0" },
        devDependencies: { vitest: "^3.0.0" },
      }));

      const context = await resolveWizardContext(targetDir);

      expect(context.source).toBe("deterministic-project-profile");
      expect(context.text).toContain("Dependencies: react, zod, vitest");
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  test("keeps explicit context ahead of the deterministic project profile", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "farrier-wizard-context-"));
    try {
      await writeFile(join(targetDir, "package.json"), JSON.stringify({ dependencies: { hono: "^4.0.0" } }));
      const context = await resolveWizardContext(targetDir, "Build a scheduling dashboard");

      expect(context.source).toBe("text");
      expect(context.text).toStartWith("Build a scheduling dashboard\n\nDetected project profile:");
      expect(context.text).toContain("Dependencies: hono");
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });
});
