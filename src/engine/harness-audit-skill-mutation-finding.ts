import { createHash } from "node:crypto";
import type { HarnessAuditCorpus } from "./harness-audit-evidence";
import type {
  HarnessAuditCheck,
  HarnessAuditCitation,
  HarnessAuditLine,
  HarnessAuditRecommendation,
} from "./harness-audit-types";

function citation(line: HarnessAuditLine): HarnessAuditCitation {
  return { path: line.path, line: line.line, excerpt: line.text.trim().slice(0, 320) };
}

function commandOnLine(text: string): string | undefined {
  return Array.from(text.matchAll(/`([^`\n]+)`/g), (match) => match[1]!.trim())
    .find((command) => /^git\s+checkout\s+--\s+\.$/.test(command));
}

function prohibitsCommand(text: string, command: string): boolean {
  const index = text.indexOf(`\`${command}\``);
  if (index < 0) return false;
  const prefix = text.slice(Math.max(0, index - 100), index);
  return /\b(?:never|avoid)\b[^.!?;\n]{0,80}(?:run|use|execute)?\s*$/i.test(prefix)
    || /\b(?:do not|don't|must not)\b[^.!?;\n]{0,80}(?:run|use|execute)?\s*$/i.test(prefix);
}

function directsCommand(text: string, command: string): boolean {
  const token = `\`${command}\``;
  const index = text.indexOf(token);
  if (index < 0) return false;
  const prefix = text.slice(0, index);
  return /(?:\b(?:run|use|execute|invoke)|→|->)\s*$/i.test(prefix)
    || new RegExp(`^\\s*(?:[-*]|\\d+\\.)?\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text);
}

function requiresDedicatedWorktree(text: string): boolean {
  return /\b(?:create|enter|use|inside|within)\b[^.\n]{0,80}\b(?:dedicated|isolated)\b[^.\n]{0,40}\b(?:git\s+)?worktree\b/i.test(text)
    || /\b(?:dedicated|isolated)\b[^.\n]{0,40}\b(?:git\s+)?worktree\b/i.test(text);
}

function requiresCleanTreeAbort(text: string): boolean {
  if (!/git\s+status\s+--porcelain/i.test(text)) return false;
  return /\b(?:abort|exit|fail|refuse|stop)\b[^.\n]{0,100}\b(?:dirty|non-empty|pre-existing|changes?)\b/i.test(text)
    || /\b(?:dirty|non-empty|pre-existing|changes?)\b[^.\n]{0,100}\b(?:abort|exit|fail|refuse|stop)\b/i.test(text);
}

function findingId(line: HarnessAuditLine, command: string): string {
  const digest = createHash("sha256").update(`${line.path}:${line.line}:${command}`, "utf8")
    .digest("hex").slice(0, 10);
  return `skill:${digest}`;
}

function countercheck(description: string, result: string): HarnessAuditCheck {
  return { id: description, layers: ["skill"], description, result };
}

export function skillMutationSafetyFindings(corpus: HarnessAuditCorpus): HarnessAuditRecommendation[] {
  const coverage = corpus.checks.find((check) => check.id === "check:audit-coverage");
  const findings: HarnessAuditRecommendation[] = [];
  for (const document of corpus.documents.filter((item) => item.kind === "skill")) {
    for (const line of corpus.lines.filter((item) => item.path === document.path && item.kind === "skill")) {
      const command = commandOnLine(line.text);
      if (!command || !directsCommand(line.text, command) || prohibitsCommand(line.text, command)) continue;
      const precedingText = document.text.split("\n").slice(0, line.line - 1).join("\n");
      const commandIndex = line.text.indexOf(`\`${command}\``);
      const safetyContext = `${precedingText}\n${line.text.slice(0, commandIndex)}`;
      const worktreeRequired = requiresDedicatedWorktree(safetyContext);
      const cleanTreeAbort = requiresCleanTreeAbort(safetyContext);
      if (worktreeRequired || cleanTreeAbort) continue;
      const checks = [
        countercheck(
          `Inspected the restore scope at ${line.path}:${line.line}.`,
          `${command} restores the entire worktree`,
        ),
        countercheck(
          `Checked ${line.path} before line ${line.line} for required worktree isolation.`,
          "no dedicated-worktree requirement found",
        ),
        countercheck(
          `Checked ${line.path} before line ${line.line} for a pre-existing dirty-tree guard.`,
          "no pre-existing dirty-tree abort found",
        ),
        coverage,
      ].filter((item): item is HarnessAuditCheck => Boolean(item));
      findings.push({
        id: findingId(line, command),
        layer: "skill",
        severity: "blocking",
        title: "Skill can erase unrelated working-tree changes",
        defect: `${line.path} directs agents to run ${command} without first requiring a dedicated worktree or aborting on pre-existing changes.`,
        citations: [citation(line)],
        counterchecks: checks.map((check) => ({ description: check.description, result: check.result })),
        proposal: {
          artifact: line.path,
          change: `Replace \`${command}\` at ${line.path}:${line.line} with: "Discard only files changed by the current experiment inside a dedicated worktree; never restore the whole user checkout."`,
        },
        risk: "The command can erase pre-existing tracked changes that do not belong to the experiment.",
        uncertainty: "The command was not executed; a runtime wrapper could provide isolation that is not required by the selected skill.",
        source: "deterministic",
      });
    }
  }
  return findings;
}
