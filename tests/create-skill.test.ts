import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBackendRunner, probeAgents, type BackendCommandRunner, type BackendCommandRunnerInput } from "../src/engine/backend";
import {
  buildAuthoringPrompt,
  createSkill,
  createSkills,
  creatorRef,
  ensureCreatorInstalled,
  installLocalSkill,
  recordSkillInManifest,
  scaffoldSkillDraft,
  slugifySkillName,
  type SkillCreationProgressEvent,
  type SkillCreationRequest
} from "../src/engine/create-skill";
import type { CommandRunner, CommandRunnerInput } from "../src/engine/skills";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-create-skill-"));
}

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

function recordingSkillsRunner(exitCode = 0): { runner: CommandRunner; calls: CommandRunnerInput[] } {
  const calls: CommandRunnerInput[] = [];
  const runner: CommandRunner = async (input) => {
    calls.push(input);
    return { exitCode, stdout: "", stderr: exitCode === 0 ? "" : "boom" };
  };
  return { runner, calls };
}

function writingBackendRunner(
  write: (input: BackendCommandRunnerInput) => Promise<void>,
  exitCode = 0
): { runner: BackendCommandRunner; calls: BackendCommandRunnerInput[] } {
  const calls: BackendCommandRunnerInput[] = [];
  const runner: BackendCommandRunner = async (input) => {
    calls.push(input);
    await write(input);
    return { exitCode, stdout: "", stderr: exitCode === 0 ? "" : "backend blew up" };
  };
  return { runner, calls };
}

async function writeSkill(dir: string, root: string, name: string, frontmatterName = name, description = "Does a thing. Use when testing."): Promise<void> {
  await mkdir(join(dir, root, name), { recursive: true });
  await writeFile(
    join(dir, root, name, "SKILL.md"),
    `---\nname: ${frontmatterName}\ndescription: ${description}\n---\n\nBody.\n`,
    "utf8"
  );
}

// Authoring runs write into a per-run staging root that farrier names in the
// prompt; the fake agent reads it back out, like the real one would.
function rootFromPrompt(input: BackendCommandRunnerInput): string {
  const text = `${input.stdin ?? ""} ${input.cmd.join(" ")}`;
  const match = text.match(/under (\S+)\/ only/);

  if (!match) {
    throw new Error("prompt does not name an output root");
  }

  return match[1]!;
}

const skillsBin = "FARRIER_SKILLS_BIN";

describe("create-skill engine", () => {
  test("slugifySkillName kebab-cases text, caps length, and rejects unusable input", () => {
    expect(slugifySkillName("Convert Financial Tables to Markdown!")).toBe("convert-financial-tables-to-markdown");
    expect(slugifySkillName("  PDF -> text  ")).toBe("pdf-text");
    expect(slugifySkillName("???")).toBeUndefined();
    const long = slugifySkillName(`${"a".repeat(70)} tail`);
    expect(long).toBe("a".repeat(64));
  });

  test("probeAgents reports availability from --version exit codes and spawn failures", async () => {
    const runner: BackendCommandRunner = async (input) => {
      if (input.cmd[0] === "claude") {
        return { exitCode: 0, stdout: "1.0.0", stderr: "" };
      }
      throw new Error("codex: command not found");
    };

    expect(await probeAgents(runner)).toEqual({ claude: true, codex: false });

    const failing: BackendCommandRunner = async () => ({ exitCode: 127, stdout: "", stderr: "" });
    expect(await probeAgents(failing)).toEqual({ claude: false, codex: false });
  });

  test("scaffoldSkillDraft derives the name, honors overrides, and emits one SKILL.md", () => {
    const draft = scaffoldSkillDraft({ description: "Summarize PR diffs before review" });
    expect(draft.name).toBe("summarize-pr-diffs-before-review");
    expect(draft.files).toHaveLength(1);
    expect(draft.files[0]?.path).toBe("skills/summarize-pr-diffs-before-review/SKILL.md");
    expect(draft.files[0]?.content).toStartWith("---\nname: summarize-pr-diffs-before-review\n");
    expect(draft.files[0]?.content).toContain("Summarize PR diffs before review");
    expect(draft.files[0]?.content).toContain("## Steps");

    expect(scaffoldSkillDraft({ description: "whatever", nameOverride: "my-skill" }).name).toBe("my-skill");
    expect(() => scaffoldSkillDraft({ description: "???" })).toThrow("Could not derive a skill name");
    expect(() => scaffoldSkillDraft({ description: "x", nameOverride: "Not Kebab" })).toThrow("kebab-case");
  });

  test("creatorRef pins anthropics for claude, built-in (none) for codex, env overrides both", () => {
    const previousClaude = process.env.FARRIER_CREATOR_CLAUDE;
    const previousCodex = process.env.FARRIER_CREATOR_CODEX;
    delete process.env.FARRIER_CREATOR_CLAUDE;
    delete process.env.FARRIER_CREATOR_CODEX;

    try {
      expect(creatorRef("claude")).toBe("anthropics/skills@skill-creator");
      expect(creatorRef("codex")).toBeUndefined();

      process.env.FARRIER_CREATOR_CODEX = "openai/skills@skill-creator";
      expect(creatorRef("codex")).toBe("openai/skills@skill-creator");
    } finally {
      restoreEnv("FARRIER_CREATOR_CLAUDE", previousClaude);
      restoreEnv("FARRIER_CREATOR_CODEX", previousCodex);
    }
  });

  test("ensureCreatorInstalled installs claude's creator for claude-code only and skips when pinned", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";

    try {
      const { runner, calls } = recordingSkillsRunner();
      const result = await ensureCreatorInstalled("claude", dir, runner);

      expect(calls).toEqual([
        {
          cmd: ["skills", "add", "anthropics/skills", "-s", "skill-creator", "-a", "claude-code", "-y"],
          cwd: dir
        }
      ]);
      expect(result?.ok).toBe(true);

      await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");
      const again = recordingSkillsRunner();
      const skipped = await ensureCreatorInstalled("claude", dir, again.runner);
      expect(again.calls).toEqual([]);
      expect(skipped?.ok).toBe(true);

      expect(await ensureCreatorInstalled("codex", dir, again.runner)).toBeUndefined();
      expect(again.calls).toEqual([]);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("buildAuthoringPrompt names each vendor's creator and confines output", () => {
    const claude = buildAuthoringPrompt({ agent: "claude", description: "Extract IBANs", outputRoot: "skills" });
    expect(claude).toContain("Use the skill-creator skill installed in this project");
    expect(claude).toContain("under skills/ only");
    expect(claude).toContain("Extract IBANs");

    const codex = buildAuthoringPrompt({ agent: "codex", description: "Extract IBANs", outputRoot: ".agents/skills", nameOverride: "iban-extractor" });
    expect(codex).toContain("Use the built-in $skill-creator skill");
    expect(codex).toContain("under .agents/skills/ only");
    expect(codex).toContain("Name the skill exactly 'iban-extractor'");
  });

  test("createSkill author-claude authors canonically, installs to the selected agents, and records the manifest", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, ".farrier.json"), JSON.stringify({ farrierVersion: "0.1.0", skills: [] }, null, 2), "utf8");
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(dir, rootFromPrompt(input), "iban-extractor");
      expect(input.cmd[0]).toBe("claude");
      expect(input.cmd).toContain("--permission-mode");
      expect(input.stdin).toContain("Extract IBAN numbers");
    });
    const skills = recordingSkillsRunner();

    const request: SkillCreationRequest = {
      description: "Extract IBAN numbers from user text",
      agents: ["claude", "codex"],
      mode: "author-claude"
    };

    try {
      const outcome = await createSkill(request, dir, { backendRunner: backend.runner, skillsRunner: skills.runner });

      expect(outcome.error).toBeUndefined();
      expect(outcome.name).toBe("iban-extractor");
      expect(outcome.installed).toBe(true);
      expect(outcome.files).toEqual(["skills/iban-extractor/SKILL.md"]);
      expect(skills.calls).toEqual([
        {
          cmd: ["skills", "add", "./skills", "-s", "iban-extractor", "-a", "claude-code", "codex", "-y"],
          cwd: dir
        }
      ]);

      const manifest = JSON.parse(await readFile(join(dir, ".farrier.json"), "utf8")) as { skills: string[]; farrierVersion: string };
      expect(manifest.skills).toEqual(["./skills@iban-extractor"]);
      expect(manifest.farrierVersion).toBe("0.1.0");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill author-codex uses codex in workspace-write mode without installing a creator", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(dir, rootFromPrompt(input), "table-to-markdown");
      expect(input.cmd[0]).toBe("codex");
      expect(input.cmd).toContain("workspace-write");
      expect(input.cmd).not.toContain("--model");
    });
    const skills = recordingSkillsRunner();

    try {
      const outcome = await createSkill(
        { description: "Convert tables", agents: ["codex"], mode: "author-codex" },
        dir,
        { backendRunner: backend.runner, skillsRunner: skills.runner }
      );

      expect(outcome.error).toBeUndefined();
      expect(outcome.installed).toBe(true);
      expect(skills.calls).toEqual([
        { cmd: ["skills", "add", "./skills", "-s", "table-to-markdown", "-a", "codex", "-y"], cwd: dir }
      ]);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill per-agent authors one copy per agent in its native root and skips install", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(dir, rootFromPrompt(input), "pii-masker");
    });
    const skills = recordingSkillsRunner();

    try {
      const outcome = await createSkill(
        { description: "Mask PII before sending text out", agents: ["claude", "codex"], mode: "per-agent" },
        dir,
        { backendRunner: backend.runner, skillsRunner: skills.runner }
      );

      expect(outcome.error).toBeUndefined();
      expect(outcome.installed).toBe(false);
      expect(outcome.files.sort()).toEqual([".agents/skills/pii-masker/SKILL.md", ".claude/skills/pii-masker/SKILL.md"]);
      expect(backend.calls).toHaveLength(2);
      expect(skills.calls).toEqual([]);
      expect(outcome.notes.join(" ")).toContain("may diverge");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill per-agent runs legs in parallel and one leg's collision does not stop the other", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");
    // Claude's copy already exists from a previous run — its leg must fail
    // with a collision while the codex leg still completes.
    await writeSkill(dir, ".claude/skills", "pii-masker");

    let inFlight = 0;
    let maxInFlight = 0;
    const backend: BackendCommandRunner = async (input) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeSkill(dir, rootFromPrompt(input), "pii-masker");
      inFlight -= 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    try {
      const outcome = await createSkill(
        { description: "Mask PII", agents: ["claude", "codex"], mode: "per-agent" },
        dir,
        { backendRunner: backend, skillsRunner: recordingSkillsRunner().runner }
      );

      expect(maxInFlight).toBe(2);
      expect(outcome.error).toContain("claude: .claude/skills/pii-masker already exists");
      expect(outcome.error).toContain("(codex copy succeeded)");
      expect(outcome.files).toEqual([".agents/skills/pii-masker/SKILL.md"]);
      expect(await readFile(join(dir, ".agents/skills", "pii-masker", "SKILL.md"), "utf8")).toContain("pii-masker");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill surfaces backend failures and validation errors without silent downgrades", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");
    const skills = recordingSkillsRunner();

    try {
      const crashed = writingBackendRunner(async () => {}, 7);
      const crashedOutcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: crashed.runner, skillsRunner: skills.runner }
      );
      expect(crashedOutcome.error).toContain("claude backend exited with code 7");

      const wroteNothing = writingBackendRunner(async () => {});
      const emptyOutcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: wroteNothing.runner, skillsRunner: skills.runner }
      );
      expect(emptyOutcome.error).toContain("did not create a skill directory");

      const wroteTwo = writingBackendRunner(async (input) => {
        const root = rootFromPrompt(input);
        await writeSkill(dir, root, "one-skill");
        await writeSkill(dir, root, "two-skill");
      });
      const twoOutcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: wroteTwo.runner, skillsRunner: skills.runner }
      );
      expect(twoOutcome.error).toContain("more than one directory");
      expect(twoOutcome.error).toContain("one-skill, two-skill");

      const wroteStray = writingBackendRunner(async (input) => {
        const root = rootFromPrompt(input);
        await writeFile(join(dir, root, "README.md"), "stray", "utf8");
        await writeSkill(dir, root, "three-skill");
      });
      const strayOutcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: wroteStray.runner, skillsRunner: skills.runner }
      );
      expect(strayOutcome.error).toContain("loose files under");
      expect(strayOutcome.error).toContain("README.md");

      expect(skills.calls).toEqual([]);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill repairs frontmatter name mismatches and truncates oversize descriptions", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(dir, rootFromPrompt(input), "query-router", "Wrong Name", `long. ${"x".repeat(600)}`);
    });
    const skills = recordingSkillsRunner();

    try {
      const outcome = await createSkill(
        { description: "Route queries", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: backend.runner, skillsRunner: skills.runner }
      );

      expect(outcome.error).toBeUndefined();
      expect(outcome.notes.join(" ")).toContain("Repaired frontmatter name");
      expect(outcome.notes.join(" ")).toContain("truncated to 500");

      const rewritten = await readFile(join(dir, "skills", "query-router", "SKILL.md"), "utf8");
      expect(rewritten).toStartWith("---\nname: query-router\n");
      expect(rewritten).toContain("\nBody.\n");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill errors when the agent ignores the requested name and keeps files for inspection", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    let stagingRoot = "";
    const backend = writingBackendRunner(async (input) => {
      stagingRoot = rootFromPrompt(input);
      await writeSkill(dir, stagingRoot, "freestyle-name");
    });

    try {
      const outcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude", nameOverride: "requested-name" },
        dir,
        { backendRunner: backend.runner, skillsRunner: recordingSkillsRunner().runner }
      );

      expect(outcome.error).toContain("requested name was 'requested-name'");
      // Failed validation leaves the staged files in place for inspection.
      expect(await readFile(join(dir, stagingRoot, "freestyle-name", "SKILL.md"), "utf8")).toContain("freestyle-name");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill errors when the canonical destination already exists and keeps staged files", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");
    await writeSkill(dir, "skills", "taken-name");

    let stagingRoot = "";
    const backend = writingBackendRunner(async (input) => {
      stagingRoot = rootFromPrompt(input);
      await writeSkill(dir, stagingRoot, "taken-name");
    });

    try {
      const outcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: backend.runner, skillsRunner: recordingSkillsRunner().runner }
      );

      expect(outcome.error).toContain("skills/taken-name already exists");
      expect(await readFile(join(dir, stagingRoot, "taken-name", "SKILL.md"), "utf8")).toContain("taken-name");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill replaces an existing skill when onCollision says replace", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");
    await writeSkill(dir, "skills", "taken-name", "taken-name", "the OLD copy");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(dir, rootFromPrompt(input), "taken-name", "taken-name", "the NEW copy");
    });
    const collisions: string[] = [];

    try {
      const outcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        {
          backendRunner: backend.runner,
          skillsRunner: recordingSkillsRunner().runner,
          onCollision: async (info) => {
            collisions.push(info.path);
            return "replace";
          }
        }
      );

      expect(outcome.error).toBeUndefined();
      expect(collisions).toEqual(["skills/taken-name"]);
      expect(outcome.notes.join(" ")).toContain("Replaced the existing skills/taken-name");
      expect(await readFile(join(dir, "skills", "taken-name", "SKILL.md"), "utf8")).toContain("the NEW copy");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill reports install failure with a retry command and keeps authored files", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(dir, rootFromPrompt(input), "latency-timer");
    });
    const skills = recordingSkillsRunner(3);

    try {
      const outcome = await createSkill(
        { description: "Time stages", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: backend.runner, skillsRunner: skills.runner }
      );

      expect(outcome.installed).toBe(false);
      expect(outcome.name).toBe("latency-timer");
      expect(outcome.error).toContain("install failed");
      expect(outcome.error).toContain("skills add ./skills -s latency-timer -a claude-code -y");
      expect(await readFile(join(dir, "skills", "latency-timer", "SKILL.md"), "utf8")).toContain("latency-timer");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkills authors concurrently, serializes installs, and reports progress", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    let inFlightAuthoring = 0;
    let maxInFlightAuthoring = 0;
    const backend: BackendCommandRunner = async (input) => {
      inFlightAuthoring += 1;
      maxInFlightAuthoring = Math.max(maxInFlightAuthoring, inFlightAuthoring);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const name = `${input.stdin ?? ""}`.match(/Name the skill exactly '([^']+)'/)![1]!;
      await writeSkill(dir, rootFromPrompt(input), name);
      inFlightAuthoring -= 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    let inFlightInstalls = 0;
    let maxInFlightInstalls = 0;
    const skillsRunner: CommandRunner = async () => {
      inFlightInstalls += 1;
      maxInFlightInstalls = Math.max(maxInFlightInstalls, inFlightInstalls);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlightInstalls -= 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const requests: SkillCreationRequest[] = ["alpha-skill", "beta-skill", "gamma-skill"].map((name) => ({
      description: `make ${name}`,
      agents: ["claude"],
      mode: "author-claude",
      nameOverride: name
    }));

    const events: SkillCreationProgressEvent[] = [];

    try {
      const outcomes = await createSkills(requests, dir, { backendRunner: backend, skillsRunner }, (event) => events.push(event));

      expect(outcomes.map((outcome) => outcome.error)).toEqual([undefined, undefined, undefined]);
      expect(outcomes.map((outcome) => outcome.name)).toEqual(["alpha-skill", "beta-skill", "gamma-skill"]);
      expect(maxInFlightAuthoring).toBeGreaterThan(1);
      expect(maxInFlightInstalls).toBe(1);

      const doneEvents = events.filter((event) => event.phase === "done");
      expect(doneEvents).toHaveLength(3);
      expect(events.some((event) => event.phase === "authoring")).toBe(true);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill streams backend stdout lines into authoring activity progress", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      expect(input.cmd).toContain("stream-json");
      input.onStdoutLine?.(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "iban-extractor/SKILL.md" } }] }
        })
      );
      input.onStdoutLine?.(JSON.stringify({ type: "system", subtype: "thinking_tokens" }));
      await writeSkill(dir, rootFromPrompt(input), "iban-extractor");
    });

    const activities: Array<[string, string | undefined, string | undefined]> = [];

    try {
      const outcome = await createSkill(
        { description: "Extract IBANs", agents: ["claude"], mode: "author-claude" },
        dir,
        {
          backendRunner: backend.runner,
          skillsRunner: recordingSkillsRunner().runner,
          progress: (phase, agent, activity) => activities.push([phase, agent, activity])
        }
      );

      expect(outcome.error).toBeUndefined();
      expect(activities).toContainEqual(["authoring", "claude", "Write iban-extractor/SKILL.md"]);
      // Unrenderable lines never surface as activity events.
      expect(activities.filter(([, , activity]) => activity !== undefined)).toHaveLength(1);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("defaultBackendRunner kills the spawned process when the signal aborts", async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 50);

    const output = await defaultBackendRunner({ cmd: ["sleep", "30"], cwd: process.cwd(), signal: controller.signal });

    expect(output.exitCode).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);

    const preAborted = await defaultBackendRunner({ cmd: ["sleep", "30"], cwd: process.cwd(), signal: AbortSignal.abort() });
    expect(preAborted.exitCode).toBe(130);
    expect(preAborted.stderr).toContain("cancelled before start");
  });

  test("createSkills reports cancellation for requests once the signal aborts", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const controller = new AbortController();
    const backend: BackendCommandRunner = async (input) => {
      // Simulate a long agent run that only ends because the abort killed it.
      controller.abort();
      return { exitCode: 137, stdout: "", stderr: "killed" };
    };

    try {
      const outcomes = await createSkills(
        [
          { description: "first skill", agents: ["claude"], mode: "author-claude" },
          { description: "second skill", agents: ["claude"], mode: "author-claude" },
          { description: "third skill", agents: ["claude"], mode: "author-claude" },
          { description: "fourth skill", agents: ["claude"], mode: "author-claude" }
        ],
        dir,
        { backendRunner: backend, skillsRunner: recordingSkillsRunner().runner, signal: controller.signal }
      );

      expect(outcomes.every((outcome) => outcome.error)).toBe(true);
      expect(outcomes.some((outcome) => outcome.error?.includes("cancelled"))).toBe(true);
      // The fourth request sat behind the concurrency cap and must be skipped, not started.
      expect(outcomes[3]?.error).toBe("cancelled before start");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("installLocalSkill shells out with the mapped agent ids", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    const { runner, calls } = recordingSkillsRunner();

    try {
      const result = await installLocalSkill("my-skill", dir, ["claude"], runner);
      expect(calls).toEqual([{ cmd: ["skills", "add", "./skills", "-s", "my-skill", "-a", "claude-code", "-y"], cwd: dir }]);
      expect(result.ok).toBe(true);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("recordSkillInManifest appends once, preserves fields, and returns false without a manifest", async () => {
    const dir = await tempDir();
    expect(await recordSkillInManifest(dir, "./skills@a")).toBe(false);

    await writeFile(
      join(dir, ".farrier.json"),
      JSON.stringify({ farrierVersion: "0.1.0", packIds: ["python"], skills: ["owner/repo@x"] }, null, 2),
      "utf8"
    );

    expect(await recordSkillInManifest(dir, "./skills@a")).toBe(true);
    expect(await recordSkillInManifest(dir, "./skills@a")).toBe(true);

    const manifest = JSON.parse(await readFile(join(dir, ".farrier.json"), "utf8")) as Record<string, unknown>;
    expect(manifest.skills).toEqual(["owner/repo@x", "./skills@a"]);
    expect(manifest.packIds).toEqual(["python"]);
  });
});
