import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PackPlaybook, PackSubagent, PlaybookSkill } from "../packs/types";
import type { EnforcementAgent } from "./agent-selection";
import { normalizeAgents } from "./agent-selection";
import { nativeSkillRoots } from "./skill-paths";
import type { RenderedFile } from "./render";

/**
 * Renders a pack's playbook bundle (orchestrator + phase skills) and review
 * subagents into per-agent native layouts:
 *
 * - Codex: skills under `.agents/skills/<name>/`, subagent TOMLs inside the
 *   orchestrator's `agents/` directory (the layout the hand-authored
 *   ios-prd-playbook shipped with).
 * - Claude: skills under `.claude/skills/<name>/`, subagents as
 *   `.claude/agents/<kebab-name>.md` agent files.
 *
 * Pure content assembly; writing goes through the caller's plan/apply path.
 */

function kebab(name: string): string {
  return name.replaceAll("_", "-");
}

/** YAML-safe single-line frontmatter value (descriptions may carry colons). */
function yamlValue(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, " ").trim());
}

export function renderSkillMd(skill: PlaybookSkill): string {
  const body = skill.body.trimEnd();
  return `---\nname: ${skill.name}\ndescription: ${yamlValue(skill.description)}\n---\n\n${body}\n`;
}

function tomlBasicString(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, " ").trim());
}

function tomlMultilineString(value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"""', '""\\"');
  return `"""\n${escaped.trim()}\n"""`;
}

export function renderSubagentToml(subagent: PackSubagent): string {
  return [
    `name = ${tomlBasicString(subagent.name)}`,
    `description = ${tomlBasicString(subagent.description)}`,
    `sandbox_mode = ${tomlBasicString(subagent.sandboxMode ?? "read-only")}`,
    `developer_instructions = ${tomlMultilineString(subagent.developerInstructions)}`,
    ...(subagent.skills ?? []).flatMap((skill) => [
      "",
      "[[skills.config]]",
      `path = ${tomlBasicString(`.agents/skills/${skill}`)}`
    ]),
    ""
  ].join("\n");
}

export function renderClaudeSubagentMd(subagent: PackSubagent): string {
  const readOnly = (subagent.sandboxMode ?? "read-only") === "read-only";
  const tools = readOnly ? "\ntools: Read, Grep, Glob, Bash" : "";
  const skills = subagent.skills?.length
    ? `\nskills:\n${subagent.skills.map((skill) => `  - ${skill}`).join("\n")}`
    : "";
  return `---\nname: ${kebab(subagent.name)}\ndescription: ${yamlValue(subagent.description)}${tools}${skills}\n---\n\n${subagent.developerInstructions.trim()}\n`;
}

function skillFiles(root: string, skill: PlaybookSkill): RenderedFile[] {
  const dir = `${root}/${skill.name}`;
  return [
    { path: `${dir}/SKILL.md`, content: renderSkillMd(skill) },
    ...(skill.references ?? []).map((reference) => ({
      path: `${dir}/references/${reference.name}`,
      content: reference.content
    }))
  ];
}

async function gateCheckerTemplate(): Promise<string> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return readFile(join(currentDir, "..", "templates", "playbook", "check-gates.py"), "utf8");
}

/**
 * The gates/ directory of an orchestrator: declarative rules as gates.json
 * plus the engine-owned checker. The checker is the only executable; gate
 * rules from a catalog or a model are data it evaluates.
 */
function gateFiles(orchestratorDir: string, playbook: PackPlaybook, checker: string): RenderedFile[] {
  if (!playbook.gateChecks || playbook.gateChecks.length === 0) return [];
  return [
    {
      path: `${orchestratorDir}/gates/gates.json`,
      content: `${JSON.stringify({ version: 1, gates: playbook.gateChecks }, null, 2)}\n`
    },
    { path: `${orchestratorDir}/gates/check.py`, content: checker, mode: 0o755 }
  ];
}

export async function playbookFiles(input: {
  playbook?: PackPlaybook;
  subagents?: readonly PackSubagent[];
  agents: readonly EnforcementAgent[];
}): Promise<RenderedFile[]> {
  const agents = normalizeAgents(input.agents);
  const subagents = input.subagents ?? [];
  const checker = input.playbook?.gateChecks?.length ? await gateCheckerTemplate() : "";
  const files: RenderedFile[] = [];

  for (const agent of agents) {
    const root = nativeSkillRoots[agent];
    if (input.playbook) {
      files.push(...skillFiles(root, input.playbook.orchestrator));
      files.push(...gateFiles(`${root}/${input.playbook.orchestrator.name}`, input.playbook, checker));
      for (const phase of input.playbook.phases) {
        files.push(...skillFiles(root, phase));
      }
    }
    if (agent === "claude") {
      for (const subagent of subagents) {
        files.push({
          path: `.claude/agents/${kebab(subagent.name)}.md`,
          content: renderClaudeSubagentMd(subagent)
        });
      }
    } else if (input.playbook) {
      // Codex subagents live inside the skill that dispatches them; without a
      // playbook there is no natural codex home, so they render Claude-only.
      for (const subagent of subagents) {
        files.push({
          path: `${root}/${input.playbook.orchestrator.name}/agents/${subagent.name}.toml`,
          content: renderSubagentToml(subagent)
        });
      }
    }
  }

  return files;
}
