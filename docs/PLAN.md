# farrier — TUI + headless CLI that creates agent-first project harnesses

## Context

Every new project (Python, TypeScript, Rails…) needs the same agents-first harness — hooks protecting `.env`, tool-policy bans, pinned skills, structure rules (konsistent), AGENTS.md, verification verbs — currently hand-assembled per repo. **farrier** (bare npm name verified available) scaffolds that harness for any stack, targeting Claude Code (`.claude/`), Codex (`.codex/`, AGENTS.md), and shared `.agents/` assets.

## Decisions (user interview, all locked)

1. **Harness-first; delegate scaffolding.** Native generators (`uv init`, `create-vite`, `create-next-app`, `rails new`, SAM/CDK) create project code; farrier owns only harness artifacts. A pack may declare its native generator so Farrier can report the command and source, but harness creation never executes it. Works on new AND existing repos (detect stack → layer harness).
2. **Output = checked-in, shared policy with native bindings.** AGENTS.md is the single source of truth (CLAUDE.md imports it); `.agents/` shared assets; one `.claude/hooks/` script/test/rules set; `.claude/settings.json` for Claude; `.codex/hooks.json` for released Codex hooks. `agents` in `.farrier.json` records the selected non-empty target set. Codex interception is partial, so AGENTS.md rules + just checks remain mandatory.
3. **Deterministic core + LLM advisor.** Hooks/settings ship as tested templates in farrier. `claude -p` / `codex exec` (pluggable backend) produces **data only** (skill recommendations, draft konsistent conventions, AGENTS.md content, secondary-stack detection) — never executable hook code at harness-creation time. Shipped hooks MAY call an LLM at runtime as a judge (see hook catalog).
4. **CLI surface: context-aware wizard + headless plan/apply.** Bare `farrier` → TUI wizard. Headless creation supports explicit or detected stacks, `--dry-run`, `--yes`, reviewed `--force`, offline `--no-skills`, and `--json`. Preview and apply share one creation-plan model: detected evidence and assumptions, harness behavior, and per-file actions. This is intentionally not called a work contract: goal, definition-of-done, evidence, delegation, and autonomy remain future `HarnessSpec` work. Subcommands: `farrier` (wizard), `farrier update`, `farrier learn`, `farrier doctor` (doctor performs static harness-shape checks; runtime commands, prerequisites, and skill-lock readiness remain separate work).
5. **V1 stacks (broad, data-driven):** Python/uv → FastAPI, Lambda+Powertools; TypeScript → React (Vite), Next.js, Lambda (SAM/CDK); Rails (+hotwire secondary detection). Packs are declarative — adding one is data, not code — plus a **generic fallback pack** (LLM advisor suggests skills for unrecognized stacks).
6. **Hook catalog v1** (all selected): secret shield (block reading `.env*`/keys), verb runner (`just check` on PostToolUse(Edit|Write), `konsistent run` on Stop), tool policy (wrong-tool bans with redirect messages: npx→pnpm dlx, pip→uv), protected-file write guard (lockfiles, .git, skills-lock.json), **semantic quality** (max LOC per file, cohesion/"no business logic dumped in unrelated modules", language best practices).
7. **Semantic judge: tiered.** Cheap fast model (haiku) per-edit for gross violations; full judge (sonnet or gpt-5.5, pluggable via `claude -p`/`codex exec`) at Stop reviewing the whole turn's diff; blocks with actionable feedback when serious.
8. **Evolution: `farrier update` + in-project `harness-advisor` skill.** Same engine, two entry points: CLI re-detects stack drift (hotwire appears → propose JS skills) and the generated skill lets the in-session agent do the same + suggest skill-creator/automation-recommender when patterns repeat.
9. **Self-learning hooks: `farrier learn` + end-of-wizard toggle.** LLM mines the project's session transcripts (`~/.claude/projects/<slug>/`) for behaviors worth preventing and emits **declarative rule data** (hookify-style matchers/patterns) into farrier's tested rule engine — never free-form hook code. User approves each proposed rule.
10. **structure-linter wiring:** TS packs → npm `konsistent@1.0.0-beta.1` (verified published). Python packs → **konpy** (rebranded from konsistent-py), a **local path dep** on `~/src/tries/2026-07-02-konsistent-python` for now (user choice "while we perfect it"); record upgrade path (git dep → PyPI) in farrier's README and template comment. Portability caveat: generated Python projects only work on this machine until upgraded.
11. **Name/stack of farrier itself:** TypeScript on **Bun**, TUI via **@opentui/react 0.4.2** (`@opentui/core` peer: web-tree-sitter). Published later as npm `farrier`; local `bun link` during development.

## Ground truth gathered (reuse, don't reinvent)

- **skills.sh API** (reverse-engineered from npm `skills` CLI at `~/.npm/_npx/5606f1555d02ef53/node_modules/skills`):
  - `GET https://skills.sh/api/search?q=<query>` → `{query, searchType, skills: [{id, skillId, name, installs, source}], count}` — use for TUI live search (installs = popularity signal).
  - Install via shell-out: `skills add <source> -s <skill> -a <agents> -y` (`-a '*'` = all agents — already handles Claude+Codex dirs, symlinks, lockfile hashing). `skills list --json`, `skills experimental_install` (restore from lock), `skills update`.
  - `skills-lock.json` format (see `~/src/tries/2026-07-02-konsistent-python/skills-lock.json`): `{version: 1, skills: {<name>: {source, sourceType, skillPath, computedHash}}}`.
- **structure-check v1 grammar** — reference `~/src/tries/2026-07-02-konsistent-python/konpy.json` + `konpy.schema.json` (27K). Same grammar for TS (`konsistent.json`) and Python (`konpy.json`).
- **Hook conventions** — `~/.claude/hooks/`: Python scripts with pytest tests alongside (`guard-mutating-api.py` + `test_guard_mutating_api.py`); PreToolUse(Bash) rewriters returning redirect messages (rtk-rewrite.sh, npx-ban pattern). Farrier's catalog follows this: every hook template ships with its test file, copied into the target project.

### Recon addenda (post-approval, from Explore agent)

- `skills` CLI extras: `use <pkg>@<skill>` emits a skill's prompt without installing; universal install target is `.agents/skills/<name>/SKILL.md` (plus per-agent dirs like `.claude/skills/`); download endpoint `https://skills.sh/api/download/<owner>/<repo>/<slug>`; env overrides `SKILLS_API_URL` / `SKILLS_DOWNLOAD_URL` (use to stub network in tests). The real package is npm `skills` (vercel-labs); ignore the unrelated `skills-cli`.
- konsistent.json v1 predicates: `haveType`, `haveFiles`, `export` (with `${module}` backrefs), `importFrom`, negated via `mustNot`; `paths` supports `{module}` capture globs.
- **@opentui version conflict:** one check says 0.4.2, another 0.1.26 — re-verify before M2 pins the dependency.

## Architecture

```
farrier/
├── package.json            # bun, @opentui/react, @opentui/core
├── src/
│   ├── cli.ts              # arg parsing, context detection, headless path
│   ├── tui/                # opentui react app: Wizard steps
│   │   ├── StackStep.tsx   # pack picker (base → sub-flavor)
│   │   ├── SkillsStep.tsx  # live-search input → skills.sh/api/search + pack-recommended preselection
│   │   ├── HooksStep.tsx   # catalog multi-select, judge model pickers
│   │   ├── LearnStep.tsx   # end-of-wizard: enable self-learning loop toggle
│   │   └── ReviewStep.tsx  # creation plan: purpose + create/merge/unchanged/replace/blocked actions
│   ├── packs/              # DECLARATIVE stack packs (one .ts data module each)
│   │   ├── types.ts        # Pack = {id, detect: globs/files, generator: cmd, skills: skillRefs[], hooks: hookIds[], konsistent: template, verbs: {check, test, fmt}}
│   │   ├── python-uv.ts, python-fastapi.ts, python-lambda-powertools.ts
│   │   ├── ts-react-vite.ts, ts-nextjs.ts, ts-lambda.ts
│   │   ├── rails.ts        # + hotwire secondary detector
│   │   └── generic.ts      # fallback: LLM-advisor-driven skill suggestions
│   ├── engine/
│   │   ├── detect.ts       # ordered stack detection + truthful matched-signal evidence
│   │   ├── create-plan.ts  # inspect actions/blockers, require reviewed force, backup + rollback writes
│   │   ├── render.ts       # template rendering → AGENTS.md, CLAUDE.md pointer, .claude/settings.json, .codex/, .agents/, justfile, konsistent.json
│   │   ├── skills.ts       # skills.sh API client + `skills` CLI shell-out
│   │   ├── advisor.ts      # LLM backend abstraction: claude -p | codex exec; JSON-schema'd outputs only
│   │   └── rules.ts        # declarative hook-rule engine model (for farrier learn output)
│   └── templates/
│       ├── hooks/          # Python hook scripts + test_*.py per catalog entry
│       ├── agents-md/      # AGENTS.md skeleton (commands, hard rules, accepted-risks sections)
│       ├── justfile/       # verbs: check, test, fmt — bound per pack
│       └── skills/harness-advisor/SKILL.md   # in-project evolution skill
└── tests/                  # bun test for engine; pytest for hook templates
```

**Generated harness in a target project:**
```
AGENTS.md                    # source of truth; CLAUDE.md → pointer to it
.agents/                     # shared assets (skills installed here by `skills` CLI where supported)
.claude/settings.json        # hook wiring, permissions
.claude/hooks/*.py + test_*  # copied from catalog, parameterized (stack verbs, judge models)
.claude/skills/              # via `skills add -a claude`
.codex/hooks.json            # selected Codex binding to the shared .claude/hooks scripts
konsistent.json              # from pack template, LLM-draft-refined for existing repos
skills-lock.json             # owned by `skills` CLI
justfile                     # check/test/fmt verbs bound to stack tools
.farrier.json                # manifest: selected agents, pack ids, hook ids + versions, judge config → enables `update`/`learn`/`doctor` diffing
.farrier-staging/backups/    # recoverable originals from explicitly forced creation replacements; gitignored
```

**Creation flow (wizard and headless share the same plan):** detect context with matched evidence → select a pack and state assumptions → explain the resulting harness behavior → classify every file as create/unchanged/safe merge/metadata update/replace/blocked → preview without mutation → apply a clean plan with `--yes`, or reviewed replacements with `--yes --force` and backups → atomically commit staged files after path revalidation, with conflict-aware rollback → install selected skills for Claude Code and Codex unless `--no-skills` was chosen → report retry commands and a partial-failure status when installation fails → recommend `farrier doctor`. Path blockers cannot be forced. An existing `.farrier.json` routes to `farrier update`; declared project generators are reported but never run.

## Milestones

- **M1 — engine skeleton + one golden path:** packs/types, python-uv+fastapi pack, render engine, safe creation-plan inspection/application, and headless `farrier --stack python-fastapi --yes` producing the full harness and installing selected pack skills in a temp dir. Hook templates: secret shield + verb runner (with tests).
- **M2 — TUI wizard** (opentui react): all steps over the M1 engine; skills live search against skills.sh API; Review consumes the same per-file creation plan as headless dry-run.
- **M3 — full hook catalog:** tool policy, write guard, semantic quality (deterministic LOC + tiered LLM judge via advisor.ts). Judge prompts as versioned templates.
- **M4 — remaining packs:** ts-react-vite, nextjs, lambda (py-powertools, ts), rails+hotwire secondary detection, generic fallback.
- **M5 — existing-repo mode + `farrier update` + harness-advisor skill** (shared drift-detection engine).
- **M6 — `farrier learn`:** transcript mining → declarative rule proposals → approval UI → rules.ts rendering. `farrier doctor`.

## Verification

- `bun test` for engine (pack detection fixtures: sample pyproject/package.json/Gemfile trees); `uv run pytest` for hook templates.
- E2E golden-path: preview and apply `farrier --stack python-fastapi` into a scratchpad dir; assert evidence, harness behavior, file actions, rendered inventory, and default skill installs; then launch `claude -p` in the generated project and verify (a) reading `.env` is blocked, (b) `just check` runs, (c) konsistent Stop hook fires.
- Creation safety E2E: differing files refuse `--yes`, reviewed `--force` creates recoverable backups, blockers remain unforceable, existing manifests route to update, JSON mirrors the human plan, and partial skill failures exit nonzero with retry commands.
- TUI: drive with the run skill / expect-style script for the wizard happy path.
- Dogfood: farrier's own repo gets a farrier-generated harness (self-hosting, like konsistent dogfooding itself).
