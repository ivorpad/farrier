import { adviceRoutes, type AdviceRouteDefinition } from "./advice-catalog";
import type { AdviceCategory, AdviceVendor } from "./advice-types";

export type AdviceCategoryPolicy = {
  category: AdviceCategory;
  purpose: string;
  defaultLimit: number;
  focusedLimit: number;
};

export type AdviceArtifactLocation = {
  category: AdviceCategory;
  location: string;
  scope: "project" | "user" | "distribution";
  notes: string;
};

export type AdviceDecisionRule = {
  id: string;
  rule: string;
};

export type AdviceReferenceEntry = {
  id: string;
  title: string;
  source: string;
  topics: AdviceCategory[];
};

export type AdviceProviderPolicy = {
  id: string;
  provider: AdviceVendor;
  categories: AdviceCategoryPolicy[];
  routes: AdviceRouteDefinition[];
  artifactLocations: AdviceArtifactLocation[];
  decisionRules: AdviceDecisionRule[];
  referenceCatalog: AdviceReferenceEntry[];
};

const categoryPurposes: Record<AdviceCategory, string> = {
  guidance: "Durable repository instructions that should apply to ordinary work.",
  hooks: "Automatic lifecycle checks, feedback, or enforcement around supported events.",
  skills: "Reusable tasks and authored workflows with instructions, references, scripts, or templates.",
  subagents: "Narrow specialist work that benefits from separate context or parallel delegation.",
  plugins: "Installable distribution of related skills, hooks, MCP configuration, connectors, or assets.",
  mcp: "Live access to external systems, tools, or current data."
};

function categories(): AdviceCategoryPolicy[] {
  return (Object.keys(categoryPurposes) as AdviceCategory[]).map((category) => ({
    category,
    purpose: categoryPurposes[category],
    defaultLimit: 2,
    focusedLimit: 5
  }));
}

function routes(provider: AdviceVendor, ids: string[]): AdviceRouteDefinition[] {
  return ids.map((id) => {
    const route = adviceRoutes.find((candidate) => candidate.id === id && candidate.vendors.includes(provider));
    if (!route) throw new Error(`Advice policy route '${id}' is not supported for ${provider}.`);
    return route;
  });
}

const sharedRules: AdviceDecisionRule[] = [
  { id: "existing-first", rule: "First decide whether project guidance, ordinary tooling, or an installed automation already covers the need." },
  { id: "verified-before-custom", rule: "Prefer a verified existing plugin or skill when it is an exact fit; never invent an installable reference." },
  { id: "single-useful-episode", rule: "A single useful task may justify a reusable automation. Occurrence counts strengthen evidence but are not a gate." },
  { id: "skip-one-off", rule: "Skip one-off tasks unless they expose a reusable project procedure or durable correction." },
  { id: "report-only", rule: "Recommend only. Do not create, install, or modify an automation during advice." },
  { id: "presentation", rule: "Return the top one or two applicable recommendations per category, or up to five for one focused category. Skip irrelevant categories and never add filler." }
];

export const claudeAdvicePolicy: AdviceProviderPolicy = {
  id: "claude-pinned-anthropic-a5c7fb5",
  provider: "claude",
  categories: categories(),
  routes: routes("claude", [
    "guidance:agents-md", "guidance:claude-md", "hooks:claude-settings", "skills:claude-local",
    "subagents:claude-agent", "plugins:claude-install", "mcp:claude-project"
  ]),
  artifactLocations: [
    { category: "guidance", location: "AGENTS.md or CLAUDE.md", scope: "project", notes: "Farrier guidance extension; the pinned snapshot does not define a separate guidance category." },
    { category: "hooks", location: ".claude/settings.json", scope: "project", notes: "Claude lifecycle hook configuration." },
    { category: "skills", location: ".claude/skills/<name>/SKILL.md", scope: "project", notes: "Claude project skill with Claude invocation controls." },
    { category: "subagents", location: ".claude/agents/<name>.md", scope: "project", notes: "Claude subagent definition." },
    { category: "plugins", location: "Claude plugin marketplace", scope: "distribution", notes: "Verified marketplace plugin installation." },
    { category: "mcp", location: ".mcp.json", scope: "project", notes: "Claude project MCP configuration." }
  ],
  decisionRules: [
    ...sharedRules,
    { id: "inspect-first", rule: "Inspect language, framework, libraries, database, testing, CI, issue tracking, documentation, and existing Claude configuration before recommending." },
    { id: "side-effect-invocation", rule: "Skills that commit, deploy, publish, or send must remain explicitly user invoked; never replace that consent with an automatic hook." },
    { id: "claude-native", rule: "Use Claude names, paths, hook events, invocation controls, plugin routes, and MCP configuration only." }
  ],
  referenceCatalog: [
    { id: "claude-workflow", title: "Pinned Claude automation recommender", source: "src/templates/skills/claude-automation-recommender/upstream/SKILL.md", topics: ["hooks", "skills", "subagents", "plugins", "mcp"] },
    { id: "claude-hooks", title: "Pinned Claude hook patterns", source: "src/templates/skills/claude-automation-recommender/upstream/references/hooks-patterns.md", topics: ["hooks"] },
    { id: "claude-skills", title: "Pinned Claude skills reference", source: "src/templates/skills/claude-automation-recommender/upstream/references/skills-reference.md", topics: ["skills"] },
    { id: "claude-plugins", title: "Pinned Claude plugins reference", source: "src/templates/skills/claude-automation-recommender/upstream/references/plugins-reference.md", topics: ["plugins"] },
    { id: "claude-mcp", title: "Pinned Claude MCP reference", source: "src/templates/skills/claude-automation-recommender/upstream/references/mcp-servers.md", topics: ["mcp"] },
    { id: "claude-subagents", title: "Pinned Claude subagent reference", source: "src/templates/skills/claude-automation-recommender/upstream/references/subagent-templates.md", topics: ["subagents"] }
  ]
};

export const codexAdvicePolicy: AdviceProviderPolicy = {
  id: "codex-official-manual-2026-07",
  provider: "codex",
  categories: categories(),
  routes: routes("codex", [
    "guidance:agents-md", "guidance:codex-config", "hooks:codex-hooks-json", "hooks:codex-config",
    "skills:agents-shared", "subagents:codex-agent", "plugins:codex-install", "mcp:codex-project"
  ]),
  artifactLocations: [
    { category: "guidance", location: "AGENTS.md", scope: "project", notes: "Durable repository commands, conventions, and review expectations." },
    { category: "hooks", location: ".codex/hooks.json or .codex/config.toml", scope: "project", notes: "Trusted project lifecycle hooks; exact definitions require review." },
    { category: "skills", location: ".agents/skills/<name>/SKILL.md", scope: "project", notes: "Optional agents/openai.yaml controls presentation, invocation, and MCP dependencies." },
    { category: "subagents", location: ".codex/agents/<name>.toml", scope: "project", notes: "Project custom agent with name, description, and developer_instructions." },
    { category: "plugins", location: ".agents/plugins/marketplace.json or plugin directory", scope: "distribution", notes: "Verified Codex plugin or marketplace installation." },
    { category: "mcp", location: ".codex/config.toml", scope: "project", notes: "Trusted project MCP server configuration." }
  ],
  decisionRules: [
    ...sharedRules,
    { id: "codex-order", rule: "Use AGENTS.md for durable instructions, install an existing plugin before authoring a duplicate skill, use a project skill for reusable workflows, hooks for lifecycle enforcement, custom agents for specialist delegation, and MCP for external systems." },
    { id: "codex-skill-invocation", rule: "Use agents/openai.yaml allow_implicit_invocation=false when a side-effecting skill should require explicit invocation." },
    { id: "codex-hook-events", rule: "Hook recommendations must use current Codex lifecycle events and project hook locations, and must account for project trust review." },
    { id: "codex-native", rule: "Use Codex terms and paths. Do not rename Claude artifacts or invocation controls." }
  ],
  referenceCatalog: [
    { id: "codex-guidance", title: "Custom instructions with AGENTS.md", source: "https://learn.chatgpt.com/docs/agent-configuration/agents-md", topics: ["guidance"] },
    { id: "codex-skills", title: "Build skills", source: "https://learn.chatgpt.com/docs/build-skills", topics: ["skills"] },
    { id: "codex-plugins", title: "Build plugins", source: "https://learn.chatgpt.com/docs/build-plugins", topics: ["plugins"] },
    { id: "codex-hooks", title: "Hooks", source: "https://learn.chatgpt.com/docs/hooks", topics: ["hooks"] },
    { id: "codex-mcp", title: "Model Context Protocol", source: "https://learn.chatgpt.com/docs/extend/mcp", topics: ["mcp"] },
    { id: "codex-subagents", title: "Subagents", source: "https://learn.chatgpt.com/docs/agent-configuration/subagents", topics: ["subagents"] }
  ]
};

export function advicePolicyFor(provider: AdviceVendor): AdviceProviderPolicy {
  return provider === "claude" ? claudeAdvicePolicy : codexAdvicePolicy;
}
