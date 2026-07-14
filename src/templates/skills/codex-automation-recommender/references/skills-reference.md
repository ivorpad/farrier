# Codex skills

Source: [Build skills](https://learn.chatgpt.com/docs/build-skills)

Use a skill for a repeatable workflow, team procedure, or task that needs examples, references, scripts, or assets. Check installed plugins and curated skills before proposing a duplicate.

## Locations and loading

- Repo skill: `.agents/skills/<name>/SKILL.md`
- User skill: `$HOME/.agents/skills/<name>/SKILL.md`
- Optional folders beside `SKILL.md`: `scripts/`, `references/`, and `assets/`

Codex scans `.agents/skills` from the working directory up to the repository root. It begins with skill metadata and reads the full instructions only when it selects the skill.

## Invocation

Codex supports explicit `$skill-name` invocation and implicit selection from the `description`. Put precise trigger terms and exclusions in the description.

Add `agents/openai.yaml` beside the skill when it needs UI metadata, invocation policy, or MCP dependencies:

```yaml
interface:
  display_name: "Release checklist"
  short_description: "Prepare and verify a project release"

policy:
  allow_implicit_invocation: false
```

Set `allow_implicit_invocation: false` for workflows with side effects such as commit, push, publish, deploy, or send. Explicit `$skill-name` invocation still works.

Declare an MCP dependency under `dependencies.tools` with `type: mcp`, the server name, transport, and URL when the workflow requires an external system.

Prefer instruction-only skills. Add a script when deterministic computation or a local validation step is necessary. A project skill is an authoring surface; use a plugin when the workflow needs installation and distribution.
