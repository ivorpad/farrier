import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHarnessWrite } from "../src/tui/harness-write";
import { skillRetryCommands } from "../src/tui/skill-install-failures";

test("harness write requires explicit replacement confirmation", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-harness-write-"));
  const agentsPath = join(targetDir, "AGENTS.md");
  const reviewPlan = {
    targetDir,
    files: [{ path: "AGENTS.md", content: "new instructions\n" }],
  };
  const deps = {
    installSkills: async () => [],
    createSkills: async () => [],
  };

  try {
    await writeFile(agentsPath, "existing instructions\n", "utf8");

    await expect(
      runHarnessWrite(
        {
          reviewPlan,
          selectedSkills: [],
          createRequests: [],
          targetDir,
          signal: new AbortController().signal,
        },
        deps,
      ),
    ).rejects.toThrow("Refusing to replace existing files without --force");
    expect(await readFile(agentsPath, "utf8")).toBe("existing instructions\n");

    const result = await runHarnessWrite(
      {
        reviewPlan,
        selectedSkills: [],
        createRequests: [],
        targetDir,
        signal: new AbortController().signal,
        forceReplace: true,
      },
      deps,
    );

    expect(await readFile(agentsPath, "utf8")).toBe("new instructions\n");
    expect(result.partial).toBe(false);
    expect(result.applyResult.writtenFiles).toEqual(["AGENTS.md"]);
    expect(result.applyResult.unchangedFiles).toEqual([]);
    expect(result.applyResult.backupDir).toStartWith(join(".farrier-staging", "backups"));
    expect(await readFile(join(targetDir, result.applyResult.backupDir!, "AGENTS.md"), "utf8")).toBe("existing instructions\n");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("harness write reports exact written and unchanged counts", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-harness-write-"));
  try {
    await writeFile(join(targetDir, "same.txt"), "same\n", "utf8");
    const result = await runHarnessWrite(
      {
        reviewPlan: {
          targetDir,
          files: [
            { path: "same.txt", content: "same\n" },
            { path: "new.txt", content: "new\n" },
          ],
        },
        selectedSkills: [],
        createRequests: [],
        targetDir,
        signal: new AbortController().signal,
      },
      { installSkills: async () => [], createSkills: async () => [] },
    );

    expect(result.applyResult.writtenFiles).toEqual(["new.txt"]);
    expect(result.applyResult.unchangedFiles).toEqual(["same.txt"]);
    expect(result.message).toContain("Applied 1 file change(s); 1 unchanged.");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("skill install failures are explicit partial results with bounded retry commands", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-harness-write-"));
  const failed = {
    ref: "owner/repo@project-patterns",
    ok: false,
    stdout: "",
    stderr: "network unavailable",
    exitCode: 1,
  } as const;

  try {
    const result = await runHarnessWrite(
      {
        reviewPlan: { targetDir, files: [{ path: "AGENTS.md", content: "instructions\n" }] },
        selectedSkills: [failed.ref],
        createRequests: [],
        targetDir,
        signal: new AbortController().signal,
      },
      { installSkills: async () => [failed], createSkills: async () => [] },
    );

    expect(result.partial).toBe(true);
    expect(result.applyResult.writtenFiles).toEqual(["AGENTS.md"]);
    expect(result.message).toContain("Partial result: installed 0 of 1 selected skill(s); 1 failed.");
    expect(skillRetryCommands(result.installResults)).toEqual({
      commands: ["skills add owner/repo -s project-patterns -a claude-code codex -y"],
      omitted: 0,
    });
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("skill authoring failures make the wizard result partial", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "farrier-harness-write-"));
  const request = { description: "Review migrations", agents: ["codex" as const], mode: "author-codex" as const };

  try {
    const result = await runHarnessWrite(
      {
        reviewPlan: { targetDir, files: [{ path: "AGENTS.md", content: "instructions\n" }] },
        selectedSkills: [],
        createRequests: [request],
        targetDir,
        signal: new AbortController().signal,
      },
      {
        installSkills: async () => [],
        createSkills: async () => [{ request, files: [], installed: false, notes: [], error: "author unavailable" }],
      },
    );

    expect(result.partial).toBe(true);
    expect(result.message).toContain("Created 0 skill(s); 1 failed.");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});
