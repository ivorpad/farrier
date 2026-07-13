---
name: farrier-project-advisor
description: Run Farrier's read-only project advisor for Codex, using exact-project session evidence and Codex-native artifact locations.
---

# Farrier Project Advisor for Codex

Use Farrier's shared advice engine rather than inspecting Codex transcript files directly:

```bash
farrier advise --dir . --sessions auto --since 7d --targets codex
```

If `farrier` is not on `PATH`, use `bunx farrier` or `npx farrier` with the same arguments. Add `--since 14d` for a wider recent window or `--since all` only for an explicit full-history request. Add `--json` for the validated report schema. Add `--sessions none` when the user wants codebase-only analysis.

For a focused report, pass `--only guidance`, `--only hooks`, `--only subagents`, `--only plugins`, or `--only mcp`. `--only skills` preserves Farrier's registry-backed skill-only advisor.

## Codex routes

- Durable shared guidance: `AGENTS.md`
- Codex project settings and lifecycle hooks: `.codex/config.toml`
- Reusable project skills: `.agents/skills/<name>/SKILL.md`
- Specialist agents: the project Codex configuration surface
- Plugins and MCP servers: verified Codex project configuration references

## Safety

- The workflow is report-only and must not mutate project configuration.
- Farrier reads Codex sessions through App Server `thread/list` and read-only `thread/read`, filtered to the exact resolved `cwd`.
- Farrier normalizes and redacts evidence locally and never consumes hidden reasoning records.
- Never turn a hook recommendation into executable code unless the user separately asks to implement it.
