# Provider-Native Automation Advice Plan

## Goal

Make `farrier advise` a codebase-first automation recommender for both Claude and Codex.

- Claude advice follows the pinned Anthropic `claude-automation-recommender` specification.
- Codex advice follows an equivalent Codex-specific recommender built from current Codex extension surfaces.
- The codebase is always analyzed, including when the project has no sessions.
- Matching provider sessions add user tasks, corrections, tool use, failures, and outcomes when sessions exist.
- One useful session can justify a recommendation. Repetition raises confidence but is not a requirement.
- Advice remains report-only until the user separately chooses a create or install flow.

The result should handle both of these cases:

1. A new TypeScript project with PostgreSQL and Drizzle but no sessions receives relevant codebase-derived skill, plugin, MCP, hook, subagent, and guidance recommendations.
2. A project session containing a request to create a goal-oriented metaprompt can produce a metaprompt skill recommendation even if that request appears only once.

## Sources of Truth

### Claude

Use the unchanged pinned snapshot under `src/templates/skills/claude-automation-recommender/upstream/` as the Claude recommendation specification. It defines:

- codebase inspection before recommendation;
- MCP, skills, hooks, subagents, and plugins as the automation categories;
- the decision rules for choosing among those categories;
- one or two top recommendations per category by default;
- three to five recommendations when the user focuses on one category;
- codebase indicators such as language, framework, database, testing, CI, external APIs, and existing agent configuration;
- skills for reusable tasks and workflows, including commit and release work.

Do not modify the snapshot. Farrier wrappers and engine prompts may cite or encode its decision rules.

### Codex

Create an equivalent Codex recommendation specification from the current Codex manual:

- `AGENTS.md` for durable repository instructions;
- `.agents/skills/<name>/SKILL.md` for repository skills;
- `agents/openai.yaml` for skill presentation, invocation policy, and MCP dependencies;
- Codex plugins for distributing skills, hooks, MCP configuration, connectors, and assets;
- project `.codex/config.toml` for trusted project configuration and MCP servers;
- Codex hooks for lifecycle enforcement and feedback;
- `.codex/agents/<name>.toml` for project-scoped custom agents;
- MCP for external systems and live data;
- existing plugins or curated skills before proposing a new custom skill when a verified match exists.

The Codex recommender must use Codex terms, paths, invocation controls, and installation routes. It must not rename Claude artifacts and call them Codex-compatible.

## Current Problems

### The engine is not the upstream recommender

The local Claude wrapper calls Farrier's shared advice engine. It does not execute the upstream codebase-analysis workflow. The Codex project advisor calls that same engine. The shared engine currently has its own small project profiler, regex event classifier, signal hash, recurrence rules, and recommendation prompt.

This preserves the upstream category names but not its analysis behavior.

### Codebase evidence is too shallow for skill discovery

`profileProject` detects broad stacks, languages, tests, CI, services, structure, and selected configuration. Skill registry queries use at most three stack or language names. That misses combinations and domain signals such as:

- TypeScript plus PostgreSQL plus Drizzle;
- a migration directory and database scripts;
- OpenAPI generation in an API service;
- a release workflow visible in package scripts and GitHub Actions;
- project-specific component or test generation conventions.

A new project with no sessions therefore receives generic registry searches instead of recommendations grounded in its dependencies and workflows.

### Session evidence is reduced before the recommender sees it

Session messages are classified by regex, truncated to 240 characters, converted into lexical hashes, ranked, and capped at 40. This loses actual user requests when Codex wraps them in browser or goal context. It also treats frequency as the main signal and lets generic MCP activity crowd out useful tasks.

The recommender should inspect bounded user tasks and outcomes, not preselected verb hashes.

### Recommendation generation is category-driven

The prompt asks for coverage of six categories and aims for three to eight recommendations overall. Validation caps broad reports at two per category, while recovery looks only for missing categories. This encourages one item per category and can ignore another useful skill candidate once the skills category is represented.

The upstream contract is to recommend the best applicable automations, not to fill a category matrix or require recurrence.

### Claude and Codex lack separate recommendation specifications

Provider filtering exists, but both providers receive the same prompt and nearly the same generic route logic. The project contains a Claude upstream snapshot and a Codex project-advisor wrapper, but no Codex automation recommender with its own references and decision table.

## Target Architecture

`farrier advise` has one orchestration flow and two provider-native recommendation specifications.

```text
codebase profile, always
        +
selected-provider session episodes, when available
        +
verified skills/plugins/MCP catalog
        |
        v
Claude automation recommender OR Codex automation recommender
        |
        v
validated report-only recommendations
```

There is no separate recurrence gate. Session grouping and occurrence counts are evidence metadata. The selected recommender decides whether a single task is reusable enough to warrant a skill or another automation.

## 1. Build a Capability-Rich Codebase Profile

Extend `src/engine/project-profile.ts` so the advisor receives concrete project capabilities rather than only broad stack labels.

### Dependency inventory

Parse supported manifests without executing project code:

- `package.json` dependencies, dev dependencies, scripts, workspaces, and package manager;
- `pyproject.toml` project dependencies and tool configuration;
- `Gemfile` and Rails configuration;
- existing supported stack manifests already used by detection.

Record exact evidence paths and bounded values. Normalize package names but preserve distinctions such as PostgreSQL driver versus ORM versus migration tool.

For the TypeScript, PostgreSQL, and Drizzle example, the profile should expose at least:

- TypeScript runtime and package manager;
- PostgreSQL driver or service configuration evidence;
- Drizzle packages and migration/config files;
- relevant scripts such as schema generation, migration, test, lint, and deploy;
- existing database, testing, CI, and agent configuration.

### Workflow inventory

Derive bounded workflow facts from codebase files:

- test, lint, type-check, format, build, database, release, and deployment scripts;
- GitHub Actions or other detected CI workflow names and triggers;
- migrations, schema files, API specifications, component templates, test fixtures, and documentation generators;
- existing `AGENTS.md`, `CLAUDE.md`, skills, plugins, hooks, custom agents, MCP configuration, and Farrier manifest state.

These are facts for the recommender. Do not convert every script into a recommendation.

### Search queries from capabilities

Replace the current three-query stack/language search with query planning based on detected capabilities and requested categories.

Examples:

- `typescript drizzle postgres`
- `drizzle migrations`
- `postgres schema review`
- `typescript api testing`
- `release deployment github actions`

Deduplicate queries and retain the evidence that produced each one. Search remains bounded, but the bound is applied after distinct capability groups are represented. Registry results must still pass source, category, provider, and installation validation.

If no verified registry entry matches, a codebase-derived custom skill remains valid through the existing project-skill route.

## 2. Preserve Session Tasks as Evidence

Replace regex-first session signals with bounded session episodes in `src/engine/advice-sessions.ts`.

An episode contains:

- the user-authored request;
- explicit corrections or follow-up requirements;
- typed visible actions when the provider exposes them;
- the final visible outcome or blocker;
- session and turn identity;
- provider and exact resolved project identity.

### Extract the actual request

- Remove ambient blocks such as `<in-app-browser-context>` before bounding text.
- Retain the section after `## My request for Codex:` when present.
- Retain user browser comments, but exclude page text and screenshot payloads.
- For persistent goal continuation messages, retain the user-provided `<objective>` and discard continuation boilerplate.
- Exclude injected repository instructions, skill bodies, developer messages, image data, hidden reasoning, and raw tool output.

Classification occurs after request extraction. URLs are not workflow verbs. A `.run` domain cannot create a run-workflow candidate.

### Do not require repetition

Pass each useful bounded episode to the provider recommender. Include occurrence and distinct-session counts when similar requests can be grouped without losing their original evidence, but do not filter singletons before recommendation.

Examples:

- one metaprompt request can be a skill candidate because it describes a reusable authored workflow;
- one commit/push/deploy request can match an existing commit or release skill;
- repeated occurrences strengthen the reason and confidence;
- generic tool calls without a user task do not become automation candidates;
- a one-off bug fix normally stays a task, not a new skill, unless it exposes a reusable project procedure.

### Bounds

Use byte budgets and round-robin selection across sessions. Every eligible session contributes a user episode before any session contributes a second one. If the selected sessions exceed one recommendation prompt, summarize per session into bounded episodes and batch the recommender input without replacing tasks with keyword hashes.

The report distinguishes discovered sessions, parsed sessions, retained episodes, omitted episodes, and truncated episodes.

## 3. Create Provider-Native Recommender Specifications

Add a typed recommendation policy contract in `src/engine/advice-policy.ts`.

```ts
type AdviceProviderPolicy = {
  provider: "claude" | "codex";
  categories: AdviceCategoryPolicy[];
  routes: AdviceRouteDefinition[];
  artifactLocations: AdviceArtifactLocation[];
  decisionRules: AdviceDecisionRule[];
  referenceCatalog: AdviceReferenceEntry[];
};
```

### Claude policy

Encode the pinned Anthropic workflow and references:

- inspect codebase type, framework, libraries, database, testing, CI, issue tracking, documentation, and existing Claude configuration;
- use the upstream MCP, skill, hook, subagent, and plugin decision tables;
- keep Claude locations and invocation controls;
- allow Farrier's durable-guidance category as an explicit extension, not as something claimed by the upstream snapshot.

The wrapper at `src/templates/skills/claude-automation-recommender/SKILL.md` continues to delegate execution to Farrier, but the selected policy now matches the snapshot it references.

### Codex policy

Create `src/templates/skills/codex-automation-recommender/` with:

- `SKILL.md` describing codebase and optional session analysis;
- `references/skills-reference.md` for `.agents/skills`, implicit and explicit invocation, `agents/openai.yaml`, scripts, and references;
- `references/plugins-reference.md` for Codex plugin and marketplace routes;
- `references/hooks-patterns.md` for supported Codex lifecycle events and project hook locations;
- `references/mcp-servers.md` for project `.codex/config.toml` and plugin-provided MCP servers;
- `references/subagent-templates.md` for `.codex/agents/*.toml` and current custom-agent fields;
- positive and negative eval cases.

The Codex references are authored from official Codex documentation. They are not copied from the Claude files where behavior or configuration differs.

The existing `farrier-project-advisor` and `harness-advisor` skills should delegate to the new Codex recommender rather than carry a second incomplete Codex decision framework.

## 4. Generate Recommendations from All Available Evidence

Refactor `src/engine/project-advice.ts` so one provider-specific prompt receives:

- the capability-rich codebase profile;
- clean selected-provider session episodes, possibly empty;
- existing installed automation inventory;
- verified registry candidates and the evidence-backed search queries that found them;
- the selected provider policy and supported routes.

### Decision order

For each opportunity, the recommender considers:

1. Is the need already covered by project guidance, a skill, plugin, hook, custom agent, MCP server, or ordinary project tooling?
2. Does a verified existing plugin or skill fit?
3. If not, is a project skill the right reusable workflow?
4. Is this instead durable guidance, automatic lifecycle behavior, specialist delegation, or external-system access?
5. Is it merely a one-off task with no useful automation recommendation?

The model returns recommendations plus evidence decisions. Each accepted recommendation cites codebase evidence, session episodes, or both.

### Recommendation count

Remove the global “aim for 3 to 8” instruction. Follow the upstream presentation rule instead:

- default report: the top one or two applicable recommendations per category;
- focused report: up to five useful recommendations for that category;
- skip irrelevant categories;
- never create filler to reach a count;
- do not stop evaluating skill opportunities because one skill was already found.

Validation retains per-category presentation bounds but has no global six-item cap. When more valid opportunities exist than the presentation bound, report the omitted opportunities and their ranking reason rather than making them disappear.

### Existing and new projects

Sessions are optional enrichment:

- With zero matching sessions, run the full provider recommender from codebase and registry evidence.
- With sessions, combine them with the same codebase evidence.
- With sparse codebase evidence but useful sessions, session-derived recommendations remain valid.
- `--sessions none` disables only session enrichment, not codebase analysis.

## 5. Align Focused Advice, CLI, and TUI

The current CLI changes `--only skills` into the legacy registry-only advisor, while the TUI calls project advice. Remove this mismatch.

- `farrier advise --only skills` uses codebase plus optional session evidence through the provider policy.
- `farrier advise skills` remains the explicit legacy registry-only spelling.
- TUI and headless CLI receive the same report model and recommendation counts.
- Focused Claude and Codex reports use their respective provider policy.

Human, JSON, and TUI output show:

- codebase evidence used;
- session count and retained episode count;
- registry queries and verified matches;
- recommendations grouped by category;
- opportunities omitted by presentation bounds;
- validation rejection reasons;
- whether each recommendation came from codebase evidence, session evidence, or both.

## 6. Privacy and Trust Boundaries

Codebase and session evidence must be redacted and bounded before backend invocation.

- Structural session extraction happens before text truncation.
- Redaction covers named fields, authorization headers, private keys, credential URLs, token formats, and whitespace-delimited credential tables.
- Raw transcripts, screenshots, image data, hidden reasoning, and full command output never enter recommendation prompts or reports.
- Provider filtering occurs before session episode creation and again before backend invocation.
- Registry references must be exact verified entries. The recommender cannot invent installable plugins, skills, or MCP packages.
- Hook recommendations remain declarative and route only to supported provider events and locations.

## Work Items

### - [ ] 1. Lock provider policies and fixtures

**Files:** new `src/engine/advice-policy.ts`, `src/engine/advice-types.ts`, fixtures under `tests/fixtures/advice/`, new `tests/advice-policy.test.ts`.

- Encode the pinned Claude categories, indicators, decision rules, references, and routes.
- Encode current Codex guidance, skill, plugin, hook, MCP, and custom-agent surfaces.
- Add provider-parity fixtures that describe the same project and expect provider-native artifact paths.
- Add the TypeScript, PostgreSQL, and Drizzle codebase-only fixture.

**Gate:** both policies cover the same recommendation jobs while producing only provider-supported artifacts and terms.

### - [ ] 2. Expand deterministic codebase evidence

**Files:** `src/engine/project-profile.ts`, detection helpers, `tests/project-profile.test.ts`, `tests/project-advice.test.ts`.

- Parse dependency and script inventories from supported manifests.
- Detect database, ORM, migration, API, testing, CI, release, and existing automation signals.
- Preserve bounded path-backed evidence for every capability.
- Generate registry queries from capability groups rather than only stack names.

**Gate:** the no-session Drizzle fixture causes Drizzle/PostgreSQL-aware searches and gives the recommender enough evidence to propose relevant automations without inventing project facts.

### - [ ] 3. Replace regex signals with clean session episodes

**Files:** `src/engine/advice-sessions.ts`, `src/engine/advice-patterns.ts`, `tests/advice-sessions.test.ts`.

- Extract user-authored requests from Claude and Codex session shapes.
- Attach bounded typed action and outcome metadata.
- Remove the lexical-hash recurrence gate and global 40-signal competition from recommendation input.
- Retain single useful episodes and use recurrence only as evidence metadata.
- Report omitted and truncated episodes explicitly.

**Gate:** a single browser-wrapped metaprompt request reaches the recommender as metaprompt text; a single commit/deploy request reaches it as release-workflow evidence; ambient context and generic MCP loops do not replace either request.

### - [ ] 4. Add the Codex automation recommender package

**Files:** new `src/templates/skills/codex-automation-recommender/`, packaging inventory, skill evals, `tests/advice-packaging.test.ts`, `tests/create-cli.test.ts`.

- Author Codex-specific `SKILL.md` and references from official Codex documentation.
- Cover repo guidance, skills, plugins, hooks, MCP, and custom agents.
- Add codebase-only, session-enriched, focused-category, and unrelated-task evals.
- Update `farrier-project-advisor` and `harness-advisor` to delegate to it.

**Gate:** generated Codex projects receive a real automation-recommender skill comparable in purpose to the Claude skill, without Claude paths or unsupported Codex claims.

### - [ ] 5. Refactor recommendation generation and validation

**Files:** `src/engine/project-advice.ts`, `src/engine/advice-catalog.ts`, provider prompt builders, `tests/project-advice.test.ts`.

- Build prompts from the selected provider policy.
- Combine codebase, optional session, installed-capability, and registry evidence.
- Validate every evidence and route citation.
- Remove global count targeting and category-recovery heuristics.
- Preserve valid excess opportunities with explicit omission reasons.
- Keep report-only behavior and opposite-provider rejection.

**Gate:** one-session metaprompt evidence can yield a skill; no-session Drizzle evidence can yield a skill or verified plugin; six categories do not imply exactly six recommendations.

### - [ ] 6. Unify CLI, JSON, TUI, docs, and evals

**Files:** `src/cli/advise.ts`, `src/tui/advise-app.tsx`, `src/tui/advice-actions.ts`, advice docs, generated skill docs, CLI/TUI tests.

- Make focused skill advice use project advice in every surface.
- Show evidence origin, session episode counts, registry searches, and bounded omissions.
- Preserve existing JSON fields where possible and add provider-policy and evidence-origin fields.
- Update docs so sessions are described as optional enrichment.

**Gate:** the same request produces the same accepted recommendations and diagnostics in human, JSON, and TUI output.

## Acceptance Scenarios

### New codebase, no sessions

Given a TypeScript project with PostgreSQL and Drizzle dependencies, migration files, database scripts, tests, and CI:

- advice runs with zero matching sessions;
- the report identifies TypeScript, PostgreSQL, Drizzle, migrations, tests, and CI from exact files;
- skill searches include the detected database and ORM capabilities;
- Claude advice uses Claude locations and verified Claude plugins or skills;
- Codex advice uses `.agents/skills`, Codex plugins, `.codex/config.toml`, Codex hooks, or `.codex/agents` as appropriate;
- no recommendation claims a dependency or workflow absent from the fixture.

### Single useful session

Given one exact-project Codex session asking for a goal-oriented metaprompt:

- the actual request survives wrapper removal and redaction;
- it is available to the Codex recommender even with one occurrence;
- the recommender may propose a repo or user skill based on reusability;
- lack of recurrence does not force low confidence or suppress the recommendation.

### Release task

Given one session asking to commit, push, and monitor deployment:

- the request is available as a complete task episode;
- existing verified commit or release capabilities are considered first;
- a new skill is proposed only when no verified existing capability fits;
- no automatic hook is proposed that commits, pushes, or deploys without an explicit user action.

### Provider parity

Given identical codebase facts and equivalent provider sessions:

- Claude and Codex consider the same underlying opportunities;
- each provider selects only its supported routes and artifact paths;
- provider-specific recommendations can differ when the products differ;
- no Claude session or route influences a Codex report, and no Codex session or route influences a Claude report.

### Evidence safety

Given session and manifest fixtures containing seeded credentials:

- no secret canary appears in backend prompts, JSON, human output, TUI text, errors, or snapshots;
- structural wrappers and raw tool payloads are absent;
- bounded omissions are counted and visible.

## Completion Gates

- Existing codebase-only advice continues to work and becomes dependency-aware.
- Advice with zero sessions is a first-class tested path, not a fallback note.
- Single session tasks can produce recommendations.
- Repetition influences evidence strength only.
- Claude behavior matches the pinned Anthropic recommendation specification.
- Codex has a separately authored and tested automation recommender based on current official Codex surfaces.
- The default report has no global recommendation target or six-item behavior.
- Focused skills behave the same in CLI and TUI.
- Provider isolation, report-only behavior, cancellation, route validation, and registry validation remain enforced.
- `just check` and `just konsistent` pass.

## Non-goals

- Do not modify the pinned Anthropic snapshot.
- Do not require sessions before advice can run.
- Do not require repeated evidence before recommending an automation.
- Do not create or install recommendations during analysis.
- Do not mine hidden reasoning or raw screenshots.
- Do not add embeddings, a vector database, or a persistent transcript index.
- Do not claim Claude and Codex have identical extension mechanics where official behavior differs.
