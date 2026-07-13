import type { AdviceCategory, AdviceImplementationRoute, AdviceVendor } from "./advice-types";
import type { AdviceArtifact } from "./advice-types";

export type AdviceRouteDefinition = AdviceImplementationRoute & {
  category: AdviceCategory;
  vendors: AdviceVendor[];
};

export type AdviceRegistryEntry = {
  ref: string;
  category: "skills" | "plugins" | "mcp";
  name: string;
  vendors: AdviceVendor[];
};

export const adviceRoutes: AdviceRouteDefinition[] = [
  { id: "guidance:agents-md", category: "guidance", vendors: ["claude", "codex"], description: "Add or refine durable project guidance in AGENTS.md." },
  { id: "guidance:claude-md", category: "guidance", vendors: ["claude"], description: "Add Claude-specific guidance in CLAUDE.md." },
  { id: "guidance:codex-config", category: "guidance", vendors: ["codex"], description: "Add Codex-specific project defaults in .codex/config.toml." },
  { id: "hooks:claude-settings", category: "hooks", vendors: ["claude"], description: "Configure a declarative Claude lifecycle hook in .claude/settings.json; implementation code is intentionally not generated." },
  { id: "hooks:codex-hooks-json", category: "hooks", vendors: ["codex"], description: "Configure a Codex-native hook in .codex/hooks.json with project trust review." },
  { id: "hooks:codex-config", category: "hooks", vendors: ["codex"], description: "Configure a declarative Codex hook in .codex/config.toml; implementation code is intentionally not generated." },
  { id: "hooks:shared-policy", category: "hooks", vendors: ["claude", "codex"], description: "Define one reviewed project policy and connect vendor-specific lifecycle hooks to it." },
  { id: "skills:agents-shared", category: "skills", vendors: ["claude", "codex"], description: "Create or install a shared skill under .agents/skills/<name>/SKILL.md." },
  { id: "skills:claude-local", category: "skills", vendors: ["claude"], description: "Create or install a Claude project skill under .claude/skills/<name>/SKILL.md." },
  { id: "subagents:claude-agent", category: "subagents", vendors: ["claude"], description: "Define a focused Claude subagent under .claude/agents/<name>.md." },
  { id: "subagents:codex-agent", category: "subagents", vendors: ["codex"], description: "Define a focused Codex specialist agent in the project Codex configuration surface." },
  { id: "subagents:cross-vendor", category: "subagents", vendors: ["claude", "codex"], description: "Document one specialist role and render vendor-specific subagent definitions." },
  { id: "plugins:claude-install", category: "plugins", vendors: ["claude"], description: "Review and install the referenced Claude plugin through its verified marketplace." },
  { id: "plugins:codex-install", category: "plugins", vendors: ["codex"], description: "Review and install the referenced Codex plugin through its verified marketplace." },
  { id: "mcp:claude-project", category: "mcp", vendors: ["claude"], description: "Configure the verified MCP server for Claude at project scope." },
  { id: "mcp:codex-project", category: "mcp", vendors: ["codex"], description: "Configure the verified MCP server in the project Codex configuration." },
  { id: "mcp:shared-project", category: "mcp", vendors: ["claude", "codex"], description: "Configure the verified MCP integration at project scope for both vendors." }
];

const routeFiles: Record<string, Partial<Record<AdviceVendor | "shared", string[]>>> = {
  "guidance:agents-md": { shared: ["AGENTS.md"] },
  "guidance:claude-md": { claude: ["CLAUDE.md"] },
  "guidance:codex-config": { codex: [".codex/config.toml"] },
  "hooks:claude-settings": { claude: [".claude/settings.json", ".farrier/hooks/claude_verify.py"] },
  "hooks:codex-hooks-json": { codex: [".codex/hooks.json", ".farrier/hooks/codex_verify.py"] },
  "hooks:codex-config": { codex: [".codex/config.toml", ".farrier/hooks/codex_verify.py"] },
  "hooks:shared-policy": {
    claude: [".claude/settings.json", ".farrier/hooks/claude_verify.py"],
    codex: [".codex/hooks.json", ".farrier/hooks/codex_verify.py"]
  },
  "skills:agents-shared": { shared: [".agents/skills/<name>/SKILL.md"] },
  "skills:claude-local": { claude: [".claude/skills/<name>/SKILL.md"] },
  "subagents:claude-agent": { claude: [".claude/agents/<name>.md"] },
  "subagents:codex-agent": { codex: [".codex/agents/<name>.toml", ".codex/config.toml"] },
  "subagents:cross-vendor": { claude: [".claude/agents/<name>.md"], codex: [".codex/agents/<name>.toml", ".codex/config.toml"] },
  "mcp:claude-project": { claude: [".mcp.json"] },
  "mcp:codex-project": { codex: [".codex/config.toml"] },
  "mcp:shared-project": { claude: [".mcp.json"], codex: [".codex/config.toml"] }
};

export function adviceRouteArtifacts(route: AdviceRouteDefinition, targets: AdviceVendor[]): AdviceArtifact[] {
  const files = routeFiles[route.id] ?? {};
  const kind: AdviceArtifact["kind"] = route.category === "hooks" ? "hook"
    : route.category === "guidance" ? "guidance"
    : route.category === "skills" ? "skill"
    : route.category === "subagents" ? "agent"
    : "config";
  const artifacts = targets.flatMap((vendor) => (files[vendor] ?? []).map((path) => ({ vendor, path, kind })));
  return [...artifacts, ...(files.shared ?? []).map((path) => ({ vendor: "shared" as const, path, kind }))];
}

export const builtinAdviceRegistry: AdviceRegistryEntry[] = [
  { ref: "anthropics/claude-plugins-official@frontend-design", category: "plugins", name: "frontend-design", vendors: ["claude"] },
  { ref: "anthropics/claude-plugins-official@feature-dev", category: "plugins", name: "feature-dev", vendors: ["claude"] },
  { ref: "anthropics/claude-plugins-official@hookify", category: "plugins", name: "hookify", vendors: ["claude"] },
  { ref: "mcp@context7", category: "mcp", name: "Context7", vendors: ["claude", "codex"] },
  { ref: "mcp@playwright", category: "mcp", name: "Playwright", vendors: ["claude", "codex"] },
  { ref: "mcp@github", category: "mcp", name: "GitHub", vendors: ["claude", "codex"] },
  { ref: "mcp@supabase", category: "mcp", name: "Supabase", vendors: ["claude", "codex"] },
  { ref: "mcp@sentry", category: "mcp", name: "Sentry", vendors: ["claude", "codex"] },
  { ref: "mcp@aws", category: "mcp", name: "AWS", vendors: ["claude", "codex"] }
];
