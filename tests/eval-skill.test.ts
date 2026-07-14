import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BackendCommandRunner, BackendCommandRunnerInput } from "../src/engine/backend";
import { validateLabeledEvalVerdict } from "../src/engine/eval-judge";
import { evaluatePerAgentSkill, resolvePerAgentSkillWinner } from "../src/engine/eval-skill";
import type { SkillCreationOutcome, SkillCreationRequest } from "../src/engine/create-skill";
import type { CommandRunner, CommandRunnerInput } from "../src/engine/skills";
import { createQueuedCollisionHandler, type CollisionPrompt } from "../src/tui/collision";
import { eligiblePerAgentEvals } from "../src/tui/create-eval";
import { runHarnessWrite } from "../src/tui/harness-write";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-eval-skill-"));
}

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

async function writeSkill(dir: string, root: string, name: string): Promise<void> {
  await mkdir(join(dir, root, name), { recursive: true });
  await writeFile(join(dir, root, name, "SKILL.md"), `---\nname: ${name}\ndescription: Test skill.\n---\n\nBody.\n`, "utf8");
}

async function writePinnedCreator(dir: string): Promise<void> {
  const files = [
    ".claude/skills/skill-creator/SKILL.md",
    ".claude/skills/skill-creator/agents/comparator.md",
    ".claude/skills/skill-creator/agents/analyzer.md",
    ".claude/skills/skill-creator/references/schemas.md"
  ];

  for (const file of files) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), file, "utf8");
  }
}

function candidatePaths(prompt: string): { aPath: string; bPath: string } {
  const aPath = /Candidate A: (\S+)/.exec(prompt)?.[1];
  const bPath = /Candidate B: (\S+)/.exec(prompt)?.[1];

  if (!aPath || !bPath) {
    throw new Error(`prompt does not name both candidates: ${prompt.slice(0, 200)}`);
  }

  return { aPath, bPath };
}

/**
 * Fake judge: parses the staged candidate paths out of the prompt and votes.
 * The engine always stages claude at candidate-one, codex at candidate-two.
 * `winner: "claude"` votes consistently for claude in both passes;
 * `winner: "always-A"` simulates a position-biased judge.
 */
function labeledVerdictJson(
  prompt: string,
  skillName: string,
  winner: "claude" | "codex" | "tie" | "always-A"
): string {
  const { aPath, bPath } = candidatePaths(prompt);
  const claudeLabel = aPath.endsWith("candidate-one") ? "A" : "B";
  const recommended =
    winner === "tie" ? "tie" : winner === "always-A" ? "A" : winner === "claude" ? claudeLabel : claudeLabel === "A" ? "B" : "A";

  // Score by identity (claude's staged copy always 8, codex's 6), so the
  // engine's cross-pass average stays stable regardless of label order.
  const copy = (path: string) => ({
    path,
    score: path.endsWith("candidate-one") ? 8 : 6,
    rationale: "Judged blind.",
    strengths: ["specific strength"],
    weaknesses: ["specific weakness"]
  });

  return JSON.stringify({
    skill_name: skillName,
    recommended_winner: recommended,
    rationale: "One concise paragraph.",
    copies: { A: copy(aPath), B: copy(bPath) },
    notes: ["Recommendation is advisory."]
  });
}

function promptOf(input: BackendCommandRunnerInput): string {
  return `${input.cmd.join(" ")} ${input.stdin ?? ""}`;
}

describe("per-agent skill eval engine", () => {
  test("evaluatePerAgentSkill runs two blind read-only passes over staged neutral copies", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const calls: BackendCommandRunnerInput[] = [];
    const runner: BackendCommandRunner = async (input) => {
      calls.push(input);
      return { exitCode: 0, stdout: labeledVerdictJson(promptOf(input), "pii-masker", "claude"), stderr: "" };
    };

    const verdict = await evaluatePerAgentSkill({
      targetDir: dir,
      skillName: "pii-masker",
      description: "Mask PII in prompts",
      backend: "codex",
      runner
    });

    expect(verdict.recommendedWinner).toBe("claude");
    expect(verdict.copies.claude.path).toBe(".claude/skills/pii-masker");
    expect(verdict.copies.codex.path).toBe(".agents/skills/pii-masker");
    expect(verdict.copies.claude.score).toBe(8);

    // Two swapped passes, both read-only, both blind: the prompt names only
    // staged neutral paths, never the vendor-revealing native paths.
    expect(calls).toHaveLength(2);
    const prompts = calls.map(promptOf);
    expect(new Set(prompts.map((prompt) => candidatePaths(prompt).aPath)).size).toBe(2);
    for (const call of calls) {
      expect(call.cmd[0]).toBe("codex");
      expect(call.cmd).toContain("read-only");
      const prompt = promptOf(call);
      expect(prompt).toContain(".farrier-staging/eval-");
      expect(prompt).not.toContain(".claude/skills/pii-masker");
      expect(prompt).not.toContain(".agents/skills/pii-masker");
      expect(prompt).not.toContain("Claude copy");
    }

    // Reports are written for both copies plus the raw verdict.
    expect(verdict.reportPaths).toBeDefined();
    const claudeReport = await readFile(join(dir, verdict.reportPaths!.claude), "utf8");
    expect(claudeReport).toContain("(recommended)");
    expect(claudeReport).toContain("8/10");
    expect(existsSync(join(dir, verdict.reportPaths!.codex))).toBe(true);
    expect(existsSync(join(dir, verdict.reportPaths!.verdict))).toBe(true);

    // The neutral staging copies are cleaned up.
    const staging = await readdir(join(dir, ".farrier-staging")).catch(() => [] as string[]);
    expect(staging.filter((entry) => entry.startsWith("eval-"))).toEqual([]);
  });

  test("evaluatePerAgentSkill passes reasoningEffort through to the codex judge command", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const calls: BackendCommandRunnerInput[] = [];
    const runner: BackendCommandRunner = async (input) => {
      calls.push(input);
      return { exitCode: 0, stdout: labeledVerdictJson(promptOf(input), "pii-masker", "claude"), stderr: "" };
    };

    await evaluatePerAgentSkill({
      targetDir: dir,
      skillName: "pii-masker",
      backend: "codex",
      reasoningEffort: "xhigh",
      runner
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.cmd.join(" ")).toContain("-c model_reasoning_effort=xhigh");
    }
  });

  test("a judge that flips with candidate order degrades the recommendation to a tie", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const runner: BackendCommandRunner = async (input) => ({
      exitCode: 0,
      stdout: labeledVerdictJson(promptOf(input), "pii-masker", "always-A"),
      stderr: ""
    });

    const verdict = await evaluatePerAgentSkill({ targetDir: dir, skillName: "pii-masker", backend: "claude", runner });

    expect(verdict.recommendedWinner).toBe("tie");
    expect(verdict.notes.join(" ")).toContain("disagreed with itself");
  });

  test("validateLabeledEvalVerdict accepts the documented shape and rejects malformed output with backend-named errors", () => {
    const expected = { skillName: "router", aPath: "x/candidate-one", bPath: "x/candidate-two" };
    const prompt = "Candidate A: x/candidate-one\nCandidate B: x/candidate-two";
    const valid = validateLabeledEvalVerdict(JSON.parse(labeledVerdictJson(prompt, "router", "claude")), "claude", expected);
    expect(valid.recommendedWinner).toBe("A");
    expect(valid.copies.A.score).toBe(8);

    expect(() => validateLabeledEvalVerdict({ skill_name: "router" }, "claude", expected)).toThrow(
      "claude backend JSON must have shape"
    );

    const wrongScore = JSON.parse(labeledVerdictJson(prompt, "router", "claude")) as { copies: { A: { score: number } } };
    wrongScore.copies.A.score = 11;
    expect(() => validateLabeledEvalVerdict(wrongScore, "codex", expected)).toThrow("codex backend JSON field copies.A.score");

    const wrongSkill = JSON.parse(labeledVerdictJson(prompt, "other", "claude"));
    expect(() => validateLabeledEvalVerdict(wrongSkill, "claude", expected)).toThrow("skill_name must be router");

    const wrongPath = JSON.parse(labeledVerdictJson(prompt, "router", "claude")) as { copies: { B: { path: string } } };
    wrongPath.copies.B.path = "elsewhere";
    expect(() => validateLabeledEvalVerdict(wrongPath, "claude", expected)).toThrow("copies.B.path must be x/candidate-two");
  });

  test("a verdict for the wrong skill fails the eval loudly", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const runner: BackendCommandRunner = async (input) => ({
      exitCode: 0,
      stdout: labeledVerdictJson(promptOf(input), "other-skill", "claude"),
      stderr: ""
    });

    await expect(evaluatePerAgentSkill({ targetDir: dir, skillName: "pii-masker", backend: "claude", runner })).rejects.toThrow(
      "skill_name must be pii-masker"
    );
  });

  test("evaluatePerAgentSkill falls back to a global pinned creator when the project has none", async () => {
    const dir = await tempDir();
    const fakeHome = await tempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      await writePinnedCreator(fakeHome);
      await writeSkill(dir, ".claude/skills", "pii-masker");
      await writeSkill(dir, ".agents/skills", "pii-masker");

      const globalRoot = join(fakeHome, ".claude/skills/skill-creator");
      const runner: BackendCommandRunner = async (input) => {
        expect(promptOf(input)).toContain(`Read ${globalRoot}/agents/comparator.md`);
        return { exitCode: 0, stdout: labeledVerdictJson(promptOf(input), "pii-masker", "claude"), stderr: "" };
      };

      const verdict = await evaluatePerAgentSkill({ targetDir: dir, skillName: "pii-masker", backend: "claude", runner });
      expect(verdict.recommendedWinner).toBe("claude");
    } finally {
      restoreEnv("HOME", previousHome);
    }
  });

  test("evaluatePerAgentSkill self-heals a missing pinned creator by installing it globally", async () => {
    const dir = await tempDir();
    const fakeHome = await tempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      await writeSkill(dir, ".claude/skills", "pii-masker");
      await writeSkill(dir, ".agents/skills", "pii-masker");

      const skillsCalls: CommandRunnerInput[] = [];
      const skillsRunner: CommandRunner = async (input) => {
        skillsCalls.push(input);
        await writePinnedCreator(fakeHome);
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const runner: BackendCommandRunner = async (input) => ({
        exitCode: 0,
        stdout: labeledVerdictJson(promptOf(input), "pii-masker", "claude"),
        stderr: ""
      });

      const verdict = await evaluatePerAgentSkill({
        targetDir: dir,
        skillName: "pii-masker",
        backend: "claude",
        runner,
        skillsRunner,
        resolveDeps: { which: () => "skills", exists: () => false }
      });

      expect(verdict.recommendedWinner).toBe("claude");
      expect(skillsCalls).toHaveLength(1);
      expect(skillsCalls[0]?.cmd).toContain("-g");
    } finally {
      restoreEnv("HOME", previousHome);
    }
  });

  test("evaluatePerAgentSkill fails loudly when the pinned creator is missing everywhere and install fails", async () => {
    const dir = await tempDir();
    const fakeHome = await tempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      await writeSkill(dir, ".claude/skills", "pii-masker");
      await writeSkill(dir, ".agents/skills", "pii-masker");

      const skillsRunner: CommandRunner = async () => ({ exitCode: 1, stdout: "", stderr: "network unreachable" });
      const runner: BackendCommandRunner = async () => ({ exitCode: 0, stdout: "{}", stderr: "" });

      await expect(
        evaluatePerAgentSkill({
          targetDir: dir,
          skillName: "pii-masker",
          backend: "claude",
          runner,
          skillsRunner,
          resolveDeps: { which: () => "skills", exists: () => false }
        })
      ).rejects.toThrow("Pinned Anthropic skill-creator eval tooling is missing from both");
    } finally {
      restoreEnv("HOME", previousHome);
    }
  });

  test("eval and winner resolution reject non-kebab-case skill names before touching any path", async () => {
    const dir = await tempDir();
    let runnerCalls = 0;
    const runner: BackendCommandRunner = async () => {
      runnerCalls += 1;
      return { exitCode: 0, stdout: "{}", stderr: "" };
    };

    await expect(
      evaluatePerAgentSkill({ targetDir: dir, skillName: "../pii-masker", backend: "codex", runner })
    ).rejects.toThrow("must be kebab-case");
    expect(runnerCalls).toBe(0);

    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");
    await expect(
      resolvePerAgentSkillWinner({ targetDir: dir, skillName: "../../etc", winner: "claude", confirmDeleteAndLink: true })
    ).rejects.toThrow("must be kebab-case");
    expect((await lstat(join(dir, ".agents/skills/pii-masker"))).isDirectory()).toBe(true);
  });

  test("diverged per-agent names are evaluated blind and resolved under the winner's name", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pdf-tables");
    await writeSkill(dir, ".agents/skills", "convert-tables");

    const names = { claude: "pdf-tables", codex: "convert-tables" };
    const runner: BackendCommandRunner = async (input) => ({
      exitCode: 0,
      stdout: labeledVerdictJson(promptOf(input), "pdf-tables", "claude"),
      stderr: ""
    });

    const verdict = await evaluatePerAgentSkill({ targetDir: dir, skillName: "pdf-tables", names, backend: "codex", runner });
    expect(verdict.recommendedWinner).toBe("claude");
    expect(verdict.copies.codex.path).toBe(".agents/skills/convert-tables");

    const resolution = await resolvePerAgentSkillWinner({
      targetDir: dir,
      skillName: "pdf-tables",
      names,
      winner: "claude",
      confirmDeleteAndLink: true
    });

    expect(resolution.deleted).toEqual([".agents/skills/convert-tables"]);
    expect(resolution.canonicalPath).toBe(".agents/skills/pdf-tables");
    expect(resolution.links[0]?.path).toBe(".claude/skills/pdf-tables");
    expect(resolution.links[0]?.target).toBe("../../.agents/skills/pdf-tables");
    expect(existsSync(join(dir, ".agents/skills/convert-tables"))).toBe(false);
    expect(await realpath(join(dir, ".agents/skills/pdf-tables/SKILL.md"))).toBe(
      await realpath(join(dir, ".claude/skills/pdf-tables/SKILL.md"))
    );
  });

  test("diverged-name resolution refuses when the winner's name already exists in the loser's root", async () => {
    const dir = await tempDir();
    await writeSkill(dir, ".claude/skills", "pdf-tables");
    await writeSkill(dir, ".agents/skills", "convert-tables");
    await writeSkill(dir, ".agents/skills", "pdf-tables");

    await expect(
      resolvePerAgentSkillWinner({
        targetDir: dir,
        skillName: "pdf-tables",
        names: { claude: "pdf-tables", codex: "convert-tables" },
        winner: "claude",
        confirmDeleteAndLink: true
      })
    ).rejects.toThrow(".agents/skills/pdf-tables already exists");
    expect((await lstat(join(dir, ".agents/skills/convert-tables"))).isDirectory()).toBe(true);
  });

  test("resolvePerAgentSkillWinner deletes exactly the loser and creates a resolving relative symlink", async () => {
    const dir = await tempDir();
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const resolution = await resolvePerAgentSkillWinner({
      targetDir: dir,
      skillName: "pii-masker",
      winner: "claude",
      confirmDeleteAndLink: true
    });

    expect(resolution.deleted).toEqual([".agents/skills/pii-masker"]);
    expect(resolution.canonicalPath).toBe(".agents/skills/pii-masker");
    expect(resolution.links[0]?.path).toBe(".claude/skills/pii-masker");
    expect(resolution.backupPath).toBeUndefined();
    expect(await readlink(join(dir, ".claude/skills/pii-masker"))).toBe("../../.agents/skills/pii-masker");
    expect((await lstat(join(dir, ".claude/skills/pii-masker"))).isSymbolicLink()).toBe(true);
    expect(await realpath(join(dir, ".agents/skills/pii-masker/SKILL.md"))).toBe(
      await realpath(join(dir, ".claude/skills/pii-masker/SKILL.md"))
    );
    expect(existsSync(join(dir, ".agents/skills/pii-masker.farrier-delete"))).toBe(false);
  });

  test("retainBackupInTrash keeps the deleted copy under .farrier-staging/trash/", async () => {
    const dir = await tempDir();
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const resolution = await resolvePerAgentSkillWinner({
      targetDir: dir,
      skillName: "pii-masker",
      winner: "codex",
      confirmDeleteAndLink: true,
      retainBackupInTrash: true
    });

    expect(resolution.deleted).toEqual([".claude/skills/pii-masker"]);
    expect(resolution.backupPath).toMatch(/^\.farrier-staging\/trash\/pii-masker-/);
    expect(await readFile(join(dir, resolution.backupPath!, "SKILL.md"), "utf8")).toContain("name: pii-masker");
    expect((await lstat(join(dir, ".claude/skills/pii-masker"))).isSymbolicLink()).toBe(true);
    expect(resolution.notes.join(" ")).toContain("change your mind");
  });

  test("resolvePerAgentSkillWinner refuses unsafe paths and missing confirmation", async () => {
    const dir = await tempDir();
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    await expect(
      resolvePerAgentSkillWinner({ targetDir: dir, skillName: "pii-masker", winner: "claude", confirmDeleteAndLink: false })
    ).rejects.toThrow("explicit confirmation");
    expect((await lstat(join(dir, ".agents/skills/pii-masker"))).isDirectory()).toBe(true);

    await rm(join(dir, ".agents/skills/pii-masker"), { recursive: true, force: true });
    await expect(
      resolvePerAgentSkillWinner({ targetDir: dir, skillName: "pii-masker", winner: "claude", confirmDeleteAndLink: true })
    ).rejects.toThrow("missing .agents/skills/pii-masker");

    await mkdir(join(dir, ".agents/skills"), { recursive: true });
    await symlink("../elsewhere", join(dir, ".agents/skills/pii-masker"));
    await expect(
      resolvePerAgentSkillWinner({ targetDir: dir, skillName: "pii-masker", winner: "claude", confirmDeleteAndLink: true })
    ).rejects.toThrow("already a symlink");
  });

  test("eligiblePerAgentEvals offers only per-agent outcomes with both copies in place", () => {
    const perAgent: SkillCreationRequest = { description: "Mask PII", agents: ["claude", "codex"], mode: "per-agent" };
    const bothCopies: SkillCreationOutcome = {
      request: perAgent,
      name: "pii-masker",
      files: [".claude/skills/pii-masker/SKILL.md", ".agents/skills/pii-masker/SKILL.md"],
      installed: false,
      notes: []
    };

    expect(eligiblePerAgentEvals([bothCopies])).toEqual([
      { skillName: "pii-masker", author: "claude", names: { claude: "pii-masker", codex: "pii-masker" }, description: "Mask PII" }
    ]);
    expect(eligiblePerAgentEvals([{ ...bothCopies, error: "codex: leg failed" }])).toEqual([]);
    expect(eligiblePerAgentEvals([{ ...bothCopies, files: [".claude/skills/pii-masker/SKILL.md"] }])).toEqual([]);
    expect(
      eligiblePerAgentEvals([{ ...bothCopies, request: { ...perAgent, mode: "author-claude" } }])
    ).toEqual([]);
  });

  test("eligiblePerAgentEvals recovers diverged per-agent names from the outcome files", () => {
    const perAgent: SkillCreationRequest = { description: "Tables to markdown", agents: ["claude", "codex"], mode: "per-agent" };
    const diverged: SkillCreationOutcome = {
      request: perAgent,
      name: "pdf-tables",
      files: [
        ".claude/skills/pdf-tables/SKILL.md",
        ".claude/skills/pdf-tables/scripts/tablesToMarkdown.ts",
        ".agents/skills/convert-tables/SKILL.md"
      ],
      installed: false,
      notes: ["The copies chose different names: pdf-tables, convert-tables."]
    };

    expect(eligiblePerAgentEvals([diverged])).toEqual([
      { skillName: "pdf-tables", author: "claude", names: { claude: "pdf-tables", codex: "convert-tables" }, description: "Tables to markdown" }
    ]);
  });

  test("harness write forwards an onCollision handler into createSkills", async () => {
    const dir = await tempDir();
    const request: SkillCreationRequest = { description: "x", agents: ["claude"], mode: "author-claude" };
    const decisions: string[] = [];
    const outcome: SkillCreationOutcome = { request, name: "x", files: [], installed: false, notes: [] };

    await runHarnessWrite(
      {
        reviewPlan: { targetDir: dir, files: [] },
        selectedSkills: [],
        createRequests: [request],
        targetDir: dir,
        signal: new AbortController().signal,
        onCollision: async (info) => {
          decisions.push(`${info.path}:${info.stagingPath}`);
          return "replace";
        }
      },
      {
        writeRenderPlan: async () => undefined,
        installSkills: async () => [],
        createSkills: async (_requests, _targetDir, deps) => {
          expect(deps).toBeDefined();
          expect(await deps!.onCollision?.({ path: "skills/x", stagingPath: ".farrier-staging/1/x" })).toBe("replace");
          return [outcome];
        }
      }
    );

    expect(decisions).toEqual(["skills/x:.farrier-staging/1/x"]);
  });

  test("queued collision handler resolves replace and keep decisions", async () => {
    let collision: CollisionPrompt | null = null;
    const currentCollision = (): CollisionPrompt => {
      if (!collision) {
        throw new Error("collision prompt was not shown");
      }
      return collision;
    };
    const chainRef = { current: Promise.resolve() };
    const handler = createQueuedCollisionHandler({
      signal: new AbortController().signal,
      chainRef,
      setCollision: (value) => {
        collision = typeof value === "function" ? value(collision) : value;
      }
    });

    const replace = handler({ path: "skills/replace-me", stagingPath: ".farrier-staging/1/replace-me" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    currentCollision().resolve("replace");
    expect(await replace).toBe("replace");

    const keep = handler({ path: "skills/keep-me", stagingPath: ".farrier-staging/1/keep-me" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    currentCollision().resolve("keep");
    expect(await keep).toBe("keep");
  });
});
