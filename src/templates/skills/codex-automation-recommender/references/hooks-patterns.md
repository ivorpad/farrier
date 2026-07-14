# Codex hooks

Source: [Hooks](https://learn.chatgpt.com/docs/hooks)

Use hooks for automatic checks, feedback, or enforcement at supported lifecycle events. Project hooks are loaded only for trusted projects and each non-managed command definition must be reviewed.

## Project locations

- `.codex/hooks.json`
- Inline `[hooks]` tables in `.codex/config.toml`

Prefer one representation per config layer. Repo hook commands should resolve helper files from the git root because Codex can start in a subdirectory.

Current events include `SessionStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, and `Stop`. Matcher support varies by event. Recommend only an event that can observe the intended action.

Good candidates include blocking edits to protected files, checking a supported tool call, reporting validation failures, or adding bounded context at session start. Ordinary formatters, linters, CI, and pre-commit hooks remain preferable when the check should apply outside Codex too.

Never recommend a hook that commits, pushes, publishes, deploys, sends a message, or performs another side effect without a fresh user action. Keep advice declarative; executable code belongs to a later implementation request.
