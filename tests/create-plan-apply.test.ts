import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyHarnessChangePlan, HarnessApplyError } from "../src/engine/create-plan";
import { renderPlanDigest } from "../src/engine/render";

test("a failed fresh-target transaction removes its files and newly created root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "farrier-create-plan-apply-"));
  const targetDir = join(parent, "new-target");
  let caught: unknown;

  try {
    await applyHarnessChangePlan(
      {
        targetDir,
        files: [
          { path: "first.txt", content: "first\n" },
          { path: "nested/second.txt", content: "second\n" },
        ],
      },
      { force: false },
      {
        beforeWrite: ({ index }) => {
          if (index === 1) throw new Error("injected fresh-target failure");
        },
      },
    );
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(HarnessApplyError);
  expect((caught as HarnessApplyError).mutationState).toBe("rolled-back");
  expect(existsSync(targetDir)).toBe(false);
});


test("refuses bytes changed after review before writing", async () => {
  const targetDir = join(await mkdtemp(join(tmpdir(), "farrier-reviewed-bytes-")), "target");
  const files = [{ path: ".claude/hooks/@acme/guard/guard.sh", content: "echo reviewed\n" }];
  const plan = {
    targetDir,
    files,
    reviewedDigest: renderPlanDigest(files)
  };
  files[0]!.content = "echo changed\n";

  await expect(applyHarnessChangePlan(plan, { force: false })).rejects.toThrow("bytes changed after review");
  expect(existsSync(targetDir)).toBe(false);
});
