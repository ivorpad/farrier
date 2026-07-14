---
name: farrier-project-advisor
description: Compatibility entry point for Farrier's read-only Codex automation advice. Delegates to codex-automation-recommender.
---

# Farrier Project Advisor

Use `$codex-automation-recommender` for codebase-first, provider-native advice. It covers `AGENTS.md`, `.agents/skills`, Codex plugins, trusted project hooks, `.codex/agents`, and project MCP configuration.

The underlying report command is:

```bash
farrier advise --dir . --sessions auto --since 7d --targets codex
```

Sessions are optional enrichment. Use `--sessions none` for codebase-only analysis and `--only <category>` for a focused provider-native report. `farrier advise skills` is the separate legacy registry-only command.

Keep the result report-only. Do not create or install a recommendation until the user separately asks for that action.
