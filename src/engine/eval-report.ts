import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillEvalVerdict } from "./eval-skill";

export type EvalReportPaths = {
  claude: string;
  codex: string;
  verdict: string;
};

function copyReport(verdict: SkillEvalVerdict, agent: "claude" | "codex"): string {
  const copy = verdict.copies[agent];
  const recommended = verdict.recommendedWinner === agent;

  return `# ${verdict.skillName} — ${agent} copy${recommended ? " (recommended)" : ""}

- Path: ${copy.path}
- Score: ${copy.score}/10 (average of two blind judge passes)

## Rationale

${copy.rationale}

## Strengths

${copy.strengths.map((item) => `- ${item}`).join("\n") || "- none noted"}

## Weaknesses

${copy.weaknesses.map((item) => `- ${item}`).join("\n") || "- none noted"}

## Overall recommendation

${verdict.recommendedWinner} — ${verdict.rationale}
${verdict.notes.map((note) => `\n> ${note}`).join("")}
`;
}

/**
 * Persist both per-copy reports plus the raw verdict so the user can open and
 * compare them before deciding. Lives under .farrier-staging/ (gitignored);
 * these are deliberate artifacts, not residue — a later eval of the same skill
 * overwrites them.
 */
export async function writeEvalReports(targetDir: string, verdict: SkillEvalVerdict): Promise<EvalReportPaths> {
  const dir = `.farrier-staging/eval/${verdict.skillName}`;
  await mkdir(join(targetDir, dir), { recursive: true });

  const paths: EvalReportPaths = {
    claude: `${dir}/claude.md`,
    codex: `${dir}/codex.md`,
    verdict: `${dir}/verdict.json`
  };

  await writeFile(join(targetDir, paths.claude), copyReport(verdict, "claude"), "utf8");
  await writeFile(join(targetDir, paths.codex), copyReport(verdict, "codex"), "utf8");
  await writeFile(join(targetDir, paths.verdict), `${JSON.stringify(verdict, null, 2)}\n`, "utf8");

  return paths;
}
