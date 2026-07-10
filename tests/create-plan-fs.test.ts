import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitStagedCreation, pathMatchesFingerprint, snapshotRegularFile, stageFile } from "../src/engine/create-plan-fs";

test("staged files commit with the reviewed content identity and exact mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "farrier-create-plan-fs-"));
  const target = join(dir, "hook.py");
  const staged = await stageFile(target, "#!/usr/bin/env python3\n", 0o755);

  await commitStagedCreation(staged, target);

  expect(await pathMatchesFingerprint(target, staged.fingerprint)).toBe(true);
  const snapshot = await snapshotRegularFile(target);
  expect(snapshot.content.toString("utf8")).toBe("#!/usr/bin/env python3\n");
  expect(snapshot.fingerprint.mode).toBe(0o755);
});
