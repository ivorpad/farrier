---
name: codex-automation-recommender
description: Analyze a repository and optional matching Codex sessions, then recommend Codex-native guidance, skills, plugins, hooks, custom agents, and MCP servers without changing files.
---

# Codex Automation Recommender

Run Farrier's Codex policy from the repository root:

```bash
farrier advise --dir . --sessions auto --since 7d --targets codex
```

Use `bunx farrier` or `npx farrier` if `farrier` is not on `PATH`. Sessions enrich the report but are not required. Use `--sessions none` for codebase-only advice, `--since 14d` for a wider recent window, and `--json` for the validated report model.

For a focused report, pass `--only guidance`, `--only hooks`, `--only skills`, `--only subagents`, `--only plugins`, or `--only mcp`. The explicit legacy registry-only spelling is `farrier advise skills`.

## Decision order

1. Check whether ordinary tooling, `AGENTS.md`, or an installed automation already covers the need.
2. Prefer a verified existing plugin or curated skill when it is an exact fit.
3. Use a repo skill at `.agents/skills/<name>/SKILL.md` for a reusable task or workflow.
4. Use `AGENTS.md` for durable instructions, hooks for lifecycle checks, `.codex/agents/*.toml` for specialist delegation, and MCP for external systems or live data.
5. Skip one-off tasks that do not reveal a reusable procedure.

A single useful session task can support a recommendation. Repetition raises confidence; it is not a prerequisite.

## Boundaries

- Advice is report-only. Do not install or create anything unless the user asks in a separate step.
- Use Codex paths and controls. Do not substitute Claude files or frontmatter fields.
- Keep commit, push, publish, deploy, send, and other side effects explicitly invoked. Do not recommend an automatic hook for them.
- Cite exact codebase evidence, session episode evidence, or both.
- Use only verified registry references returned in the report.

Read the matching reference before explaining or implementing a recommendation:

- `references/skills-reference.md`
- `references/plugins-reference.md`
- `references/hooks-patterns.md`
- `references/mcp-servers.md`
- `references/subagent-templates.md`

Official source links are recorded in each reference.
