# Codex plugins

Source: [Build plugins](https://learn.chatgpt.com/docs/build-plugins)

Use a plugin when a workflow should be installed or shared, when several related skills belong together, or when the package includes hooks, MCP configuration, connectors, or presentation assets. For one repo workflow still being edited, start with a skill.

## Package shape

The required manifest is `.codex-plugin/plugin.json`. Plugin components stay at the plugin root:

```text
plugin-root/
  .codex-plugin/plugin.json
  skills/
  hooks/hooks.json
  .mcp.json
  .app.json
  assets/
```

The manifest can point to `skills`, `hooks`, `mcpServers`, and `apps`. Do not use a Claude plugin manifest and relabel it as Codex.

Repo marketplaces live at `.agents/plugins/marketplace.json`; personal marketplaces live at `~/.agents/plugins/marketplace.json`. Recommend only a plugin verified in the supplied catalog. If no verified entry fits, recommend a project skill or describe a new plugin as a custom distribution route without inventing an install ref.

Plugin hooks still require review and trust. Installation does not make hook commands trusted automatically.
