import type { AgentBackend } from "./backend";

const descriptionCharLimit = 16_000;

function truncateRequest(text: string): string {
  return text.length <= descriptionCharLimit
    ? text
    : `${text.slice(0, descriptionCharLimit)}\n\n[request truncated to ${descriptionCharLimit} characters]`;
}

export function buildAuthoringPrompt(input: {
  agent: AgentBackend;
  description: string;
  outputRoot: string;
  nameOverride?: string;
}): string {
  const creator = input.agent === "claude"
    ? "Use the skill-creator skill installed in this project"
    : "Use the built-in $skill-creator skill";
  const nameLine = input.nameOverride ? `\n- Name the skill exactly '${input.nameOverride}'.` : "";
  return `${creator} to create exactly one agent skill for the request below.
Requirements:
- Create the skill directory under ${input.outputRoot}/ only, as ${input.outputRoot}/<skill-name>/SKILL.md plus any supporting files inside that same directory. Do not create or modify any other files.
- SKILL.md must start with YAML frontmatter containing name (kebab-case, at most 64 characters, matching the directory name) and description (one sentence saying what the skill does and when to use it).${nameLine}
- Create evals/cases.json with {\"version\":1,\"cases\":[...]} containing at least one positive and one negative case. Each case needs a kebab-case id, kind (positive or negative), a bounded prompt, and expectedBehavior. Do not include transcripts, credentials, tokens, or personal data.
- Do not ask questions; make reasonable decisions and finish.
Skill request:
${truncateRequest(input.description)}
`;
}
