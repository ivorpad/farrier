import { randomUUID } from "node:crypto";
import { access, lstat, readlink, realpath, rename, rm, symlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  defaultBackendRunner,
  invokeBackend,
  type AgentBackend,
  type BackendCommandRunner
} from "./backend";
import { nativeSkillRoots, type CreateAgent } from "./create-skill";
import { maxSkillNameLength, skillNamePattern } from "./skill-validate";

export type SkillEvalWinner = CreateAgent | "tie";

export type SkillEvalCopyScore = {
  path: string;
  score: number;
  rationale: string;
  strengths: string[];
  weaknesses: string[];
};

export type SkillEvalVerdict = {
  skillName: string;
  backend: AgentBackend;
  recommendedWinner: SkillEvalWinner;
  rationale: string;
  copies: Record<CreateAgent, SkillEvalCopyScore>;
  notes: string[];
};

export type SkillWinnerResolution = {
  skillName: string;
  winner: CreateAgent;
  loser: CreateAgent;
  winnerPath: string;
  deleted: string[];
  links: Array<{ path: string; target: string; resolvesTo: string }>;
  notes: string[];
};

const pinnedCreatorRoot = ".claude/skills/skill-creator";
const pinnedEvalFiles = [
  "SKILL.md",
  "agents/comparator.md",
  "agents/analyzer.md",
  "references/schemas.md"
];

// Skill names become path segments under the native roots, so anything
// non-kebab-case (separators, dots) could escape them.
function assertSafeSkillName(skillName: string, context: string): void {
  if (!skillNamePattern.test(skillName) || skillName.length > maxSkillNameLength) {
    throw new Error(
      `${context}: skill name '${skillName}' must be kebab-case ([a-z0-9] and single hyphens), at most ${maxSkillNameLength} chars.`
    );
  }
}

function skillPath(agent: CreateAgent, skillName: string): string {
  return `${nativeSkillRoots[agent]}/${skillName}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown, field: string, backend: AgentBackend): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${backend} backend JSON field ${field} must be an array of strings`);
  }

  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);

  if (strings.length !== value.length) {
    throw new Error(`${backend} backend JSON field ${field} must be an array of strings`);
  }

  return strings.map((item) => item.trim());
}

function scoreCopy(raw: unknown, field: string, backend: AgentBackend): SkillEvalCopyScore {
  if (!isRecord(raw)) {
    throw new Error(`${backend} backend JSON field ${field} must be an object`);
  }

  if (typeof raw.path !== "string" || raw.path.trim().length === 0) {
    throw new Error(`${backend} backend JSON field ${field}.path must be a string`);
  }

  if (typeof raw.score !== "number" || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > 10) {
    throw new Error(`${backend} backend JSON field ${field}.score must be a number from 0 to 10`);
  }

  if (typeof raw.rationale !== "string" || raw.rationale.trim().length === 0) {
    throw new Error(`${backend} backend JSON field ${field}.rationale must be a non-empty string`);
  }

  return {
    path: raw.path.trim(),
    score: raw.score,
    rationale: raw.rationale.trim(),
    strengths: stringArray(raw.strengths, `${field}.strengths`, backend),
    weaknesses: stringArray(raw.weaknesses, `${field}.weaknesses`, backend)
  };
}

export function validateSkillEvalVerdict(
  parsed: unknown,
  backend: AgentBackend,
  expected?: { skillName: string; claudePath: string; codexPath: string }
): SkillEvalVerdict {
  if (!isRecord(parsed) || !isRecord(parsed.copies)) {
    throw new Error(`${backend} backend JSON must have shape {"skill_name":"...","recommended_winner":"claude|codex|tie","copies":{...}}`);
  }

  if (typeof parsed.skill_name !== "string" || parsed.skill_name.trim().length === 0) {
    throw new Error(`${backend} backend JSON field skill_name must be a non-empty string`);
  }

  const winner = parsed.recommended_winner;
  if (winner !== "claude" && winner !== "codex" && winner !== "tie") {
    throw new Error(`${backend} backend JSON field recommended_winner must be claude, codex, or tie`);
  }

  if (typeof parsed.rationale !== "string" || parsed.rationale.trim().length === 0) {
    throw new Error(`${backend} backend JSON field rationale must be a non-empty string`);
  }

  const verdict: SkillEvalVerdict = {
    skillName: parsed.skill_name.trim(),
    backend,
    recommendedWinner: winner,
    rationale: parsed.rationale.trim(),
    copies: {
      claude: scoreCopy(parsed.copies.claude, "copies.claude", backend),
      codex: scoreCopy(parsed.copies.codex, "copies.codex", backend)
    },
    notes: stringArray(parsed.notes ?? [], "notes", backend)
  };

  if (expected) {
    if (verdict.skillName !== expected.skillName) {
      throw new Error(`${backend} backend JSON field skill_name must be ${expected.skillName}, got ${verdict.skillName}`);
    }

    if (verdict.copies.claude.path !== expected.claudePath) {
      throw new Error(`${backend} backend JSON field copies.claude.path must be ${expected.claudePath}, got ${verdict.copies.claude.path}`);
    }

    if (verdict.copies.codex.path !== expected.codexPath) {
      throw new Error(`${backend} backend JSON field copies.codex.path must be ${expected.codexPath}, got ${verdict.copies.codex.path}`);
    }
  }

  return verdict;
}

async function assertFile(path: string, message: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

async function assertPinnedCreator(targetDir: string): Promise<void> {
  for (const file of pinnedEvalFiles) {
    await assertFile(
      join(targetDir, pinnedCreatorRoot, file),
      `Pinned Anthropic skill-creator eval tooling is missing: ${pinnedCreatorRoot}/${file}`
    );
  }
}

async function assertPerAgentSkillPair(targetDir: string, skillName: string): Promise<void> {
  for (const agent of ["claude", "codex"] as const) {
    await assertFile(
      join(targetDir, skillPath(agent, skillName), "SKILL.md"),
      `Cannot evaluate ${skillName}: missing ${skillPath(agent, skillName)}/SKILL.md`
    );
  }
}

export function buildEvalSkillPrompt(input: {
  skillName: string;
  description?: string;
  claudePath: string;
  codexPath: string;
}): string {
  const description = input.description?.trim()
    ? `Original request:\n${input.description.trim()}\n\n`
    : "Original request: not provided; infer intended behavior from both SKILL.md files.\n\n";

  return `You are Farrier's per-agent skill evaluator. Return JSON only.

Use the pinned Anthropic skill-creator eval workflow installed in this project:
- Read ${pinnedCreatorRoot}/agents/comparator.md and apply its blind-comparison rubric.
- Read ${pinnedCreatorRoot}/agents/analyzer.md and use its post-hoc analysis guidance to explain why the better skill wins.
- Read ${pinnedCreatorRoot}/references/schemas.md for comparison/analysis field expectations.

This is a read-only static eval of two completed skill directories; do not edit files, create workspaces, run agents, or delete anything. If either skill has evals/evals.json, use its expectations as secondary evidence.

Skill name: ${input.skillName}
${description}Candidate A (Claude copy): ${input.claudePath}
Candidate B (Codex copy): ${input.codexPath}

Return exactly this JSON shape, with no markdown:
{
  "skill_name": "${input.skillName}",
  "recommended_winner": "claude" | "codex" | "tie",
  "rationale": "one concise paragraph explaining the recommendation",
  "copies": {
    "claude": {
      "path": "${input.claudePath}",
      "score": 0,
      "rationale": "why this copy scored this way",
      "strengths": ["specific strength"],
      "weaknesses": ["specific weakness"]
    },
    "codex": {
      "path": "${input.codexPath}",
      "score": 0,
      "rationale": "why this copy scored this way",
      "strengths": ["specific strength"],
      "weaknesses": ["specific weakness"]
    }
  },
  "notes": ["anything the user should know before choosing"]
}

Score each copy from 0 to 10 for instruction clarity, triggering description, progressive disclosure, bundled resource usefulness, safety, and likely reliability for the original request. The recommendation is advisory; the user will choose what to keep.`;
}

export async function evaluatePerAgentSkill(input: {
  targetDir: string;
  skillName: string;
  description?: string;
  backend: AgentBackend;
  model?: string;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
}): Promise<SkillEvalVerdict> {
  assertSafeSkillName(input.skillName, "Cannot evaluate");
  await assertPinnedCreator(input.targetDir);
  await assertPerAgentSkillPair(input.targetDir, input.skillName);

  const parsed = await invokeBackend({
    backend: input.backend,
    model: input.model,
    prompt: buildEvalSkillPrompt({
      skillName: input.skillName,
      description: input.description,
      claudePath: skillPath("claude", input.skillName),
      codexPath: skillPath("codex", input.skillName)
    }),
    targetDir: input.targetDir,
    runner: input.runner ?? defaultBackendRunner,
    signal: input.signal
  });

  return validateSkillEvalVerdict(parsed, input.backend, {
    skillName: input.skillName,
    claudePath: skillPath("claude", input.skillName),
    codexPath: skillPath("codex", input.skillName)
  });
}

async function assertRealSkillDir(targetDir: string, relPath: string): Promise<void> {
  const absPath = join(targetDir, relPath);
  const stat = await lstat(absPath).catch(() => undefined);

  if (!stat) {
    throw new Error(`Cannot resolve winner: missing ${relPath}`);
  }

  if (stat.isSymbolicLink()) {
    const target = await readlink(absPath).catch(() => "unknown target");
    throw new Error(`Cannot resolve winner: ${relPath} is already a symlink to ${target}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Cannot resolve winner: ${relPath} is not a directory`);
  }

  await assertFile(join(absPath, "SKILL.md"), `Cannot resolve winner: missing ${relPath}/SKILL.md`);
}

export async function resolvePerAgentSkillWinner(input: {
  targetDir: string;
  skillName: string;
  winner: CreateAgent;
  confirmDeleteAndLink: boolean;
}): Promise<SkillWinnerResolution> {
  assertSafeSkillName(input.skillName, "Cannot resolve winner");

  if (!input.confirmDeleteAndLink) {
    throw new Error("Refusing to delete and symlink without explicit confirmation.");
  }

  const loser: CreateAgent = input.winner === "claude" ? "codex" : "claude";
  const winnerPath = skillPath(input.winner, input.skillName);
  const loserPath = skillPath(loser, input.skillName);

  await assertRealSkillDir(input.targetDir, winnerPath);
  await assertRealSkillDir(input.targetDir, loserPath);

  const winnerAbs = join(input.targetDir, winnerPath);
  const loserAbs = join(input.targetDir, loserPath);
  const winnerSkillReal = await realpath(join(winnerAbs, "SKILL.md"));
  const backupAbs = `${loserAbs}.farrier-delete-${randomUUID().slice(0, 8)}`;
  const linkTarget = relative(dirname(loserAbs), winnerAbs) || ".";

  await rename(loserAbs, backupAbs);

  try {
    await symlink(linkTarget, loserAbs, "dir");
    const linkedSkillReal = await realpath(join(loserAbs, "SKILL.md"));

    if (linkedSkillReal !== winnerSkillReal) {
      throw new Error(`symlink ${loserPath} resolves to ${linkedSkillReal}, not ${winnerSkillReal}`);
    }

    await rm(backupAbs, { recursive: true, force: false });

    return {
      skillName: input.skillName,
      winner: input.winner,
      loser,
      winnerPath,
      deleted: [loserPath],
      links: [{ path: loserPath, target: linkTarget, resolvesTo: winnerPath }],
      notes: [`Deleted ${loserPath} and linked it to ${winnerPath}.`]
    };
  } catch (error) {
    await rm(loserAbs, { recursive: true, force: true }).catch(() => undefined);
    await rename(backupAbs, loserAbs).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to link ${loserPath} to ${winnerPath}: ${message}`);
  }
}
