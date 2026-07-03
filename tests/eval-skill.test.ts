import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BackendCommandRunner, BackendCommandRunnerInput } from "../src/engine/backend";
import {
  evaluatePerAgentSkill,
  resolvePerAgentSkillWinner,
  validateSkillEvalVerdict
} from "../src/engine/eval-skill";
import type { SkillCreationOutcome, SkillCreationRequest } from "../src/engine/create-skill";
import { createQueuedCollisionHandler, type CollisionPrompt } from "../src/tui/collision";
import { runForgeWrite } from "../src/tui/forge";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-eval-skill-"));
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

function verdictJson(skillName = "pii-masker"): string {
  return JSON.stringify({
    skill_name: skillName,
    recommended_winner: "claude",
    rationale: "The Claude copy is more specific.",
    copies: {
      claude: {
        path: `.claude/skills/${skillName}`,
        score: 8,
        rationale: "Clear instructions.",
        strengths: ["specific workflow"],
        weaknesses: ["minor verbosity"]
      },
      codex: {
        path: `.agents/skills/${skillName}`,
        score: 6,
        rationale: "Useful but less precise.",
        strengths: ["short"],
        weaknesses: ["missing edge cases"]
      }
    },
    notes: ["Recommendation is advisory."]
  });
}

describe("per-agent skill eval engine", () => {
  test("evaluatePerAgentSkill invokes a read-only backend with the pinned skill-creator eval prompt", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const calls: BackendCommandRunnerInput[] = [];
    const runner: BackendCommandRunner = async (input) => {
      calls.push(input);
      return { exitCode: 0, stdout: verdictJson(), stderr: "" };
    };

    const verdict = await evaluatePerAgentSkill({
      targetDir: dir,
      skillName: "pii-masker",
      description: "Mask PII in prompts",
      backend: "codex",
      runner
    });

    expect(verdict.recommendedWinner).toBe("claude");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd[0]).toBe("codex");
    expect(calls[0]?.cmd).toContain("read-only");
    expect(calls[0]?.cwd).toBe(dir);
    const prompt = calls[0]!.cmd.join(" ");
    expect(prompt).toContain(".claude/skills/skill-creator/agents/comparator.md");
    expect(prompt).toContain(".claude/skills/pii-masker");
    expect(prompt).toContain(".agents/skills/pii-masker");
    expect(prompt).toContain("Return exactly this JSON shape");
  });

  test("validateSkillEvalVerdict accepts the documented shape and rejects malformed output with backend-named errors", () => {
    const valid = validateSkillEvalVerdict(JSON.parse(verdictJson("router")), "claude");
    expect(valid.skillName).toBe("router");
    expect(valid.copies.claude.score).toBe(8);

    expect(() => validateSkillEvalVerdict({ skill_name: "router" }, "claude")).toThrow("claude backend JSON must have shape");
    const malformed = JSON.parse(verdictJson("router")) as { copies: { claude: { score: number } } };
    malformed.copies.claude.score = 11;
    expect(() => validateSkillEvalVerdict(malformed, "codex")).toThrow("codex backend JSON field copies.claude.score");
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
    expect(resolution.links[0]?.path).toBe(".agents/skills/pii-masker");
    expect(await readlink(join(dir, ".agents/skills/pii-masker"))).toBe("../../.claude/skills/pii-masker");
    expect((await lstat(join(dir, ".agents/skills/pii-masker"))).isSymbolicLink()).toBe(true);
    expect(await realpath(join(dir, ".agents/skills/pii-masker/SKILL.md"))).toBe(
      await realpath(join(dir, ".claude/skills/pii-masker/SKILL.md"))
    );
    expect(existsSync(join(dir, ".agents/skills/pii-masker.farrier-delete"))).toBe(false);
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

  test("forge write forwards an onCollision handler into createSkills", async () => {
    const dir = await tempDir();
    const request: SkillCreationRequest = { description: "x", agents: ["claude"], mode: "author-claude" };
    const decisions: string[] = [];
    const outcome: SkillCreationOutcome = { request, name: "x", files: [], installed: false, notes: [] };

    await runForgeWrite(
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
