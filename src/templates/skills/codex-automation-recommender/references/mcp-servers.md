# Codex MCP servers

Source: [Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp)

Use MCP when Codex needs live data or actions outside the repository: issue trackers, design tools, current documentation, observability, browsers, or databases. Do not recommend MCP for a task already handled by local files or a normal CLI.

Project-scoped servers are configured in trusted `.codex/config.toml` under `[mcp_servers.<name>]`. Codex supports local STDIO servers and streamable HTTP servers. Credentials should come from environment-variable fields or the supported OAuth flow, not literal tokens in project files.

Plugins can provide MCP servers from their manifest. If an installed plugin already provides the needed server, prefer its configuration and tool policy instead of adding a duplicate project server.

Every install recommendation must copy an exact verified catalog ref. When no verified server matches, describe the capability gap without inventing a package or URL.

Pair MCP with a skill when the external tools participate in a repeatable workflow. Declare that dependency in the skill's `agents/openai.yaml`.
