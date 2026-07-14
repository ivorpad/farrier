# Codex custom agents

Source: [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

Use a custom agent for a narrow specialist role that benefits from separate context, its own model or sandbox defaults, or parallel read-heavy work. Do not add one for a routine sequential task.

Project agents are standalone TOML files under `.codex/agents/<name>.toml`; personal agents live under `~/.codex/agents/`.

Required fields:

```toml
name = "reviewer"
description = "Review changes for correctness, security, and missing tests."
developer_instructions = """
Review only. Cite files and return findings to the parent task.
"""
```

Optional fields include `nickname_candidates`, `model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, and `skills.config`. Omitted values inherit from the parent session. The `name` field, not the filename, identifies the agent.

Good roles include focused security review, read-heavy codebase exploration, log analysis, or independent test-gap review. Parallel agents cost more tokens and simultaneous writers can conflict, so do not recommend delegation just to split an ordinary edit.
