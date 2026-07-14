# 🐴 farrier

**The craftsman who equips your coding agents.**

farrier generates an *agents-first harness* for any project: the hooks, rules, skills, verification verbs, and context files that let Claude Code and Codex work in your repo safely and productively — without you hand-assembling the same setup for the hundredth time.

You pick a stack (or farrier detects it), and farrier writes a complete, tested harness:

- **Hooks that protect** — no reading `.env`, no writing lockfiles, no `pip install` in a uv project (the deny message tells the agent the *right* command instead).
- **Hooks that verify** — `just check` after every edit, structure linting (konpy for Python, konsistent for TypeScript) before the agent yields.
- **Skills that teach** — stack-appropriate skills from [skills.sh](https://skills.sh), pinned in a lockfile.
- **Context that steers** — one `AGENTS.md` source of truth (`CLAUDE.md` imports it via Claude Code's `@AGENTS.md` syntax, so Codex and Claude read the same rules).
- **A harness that evolves** — it detects stack drift, repairs itself, and *learns new rules from your session transcripts*.
- **Enterprise registries** — teams publish private packs, hook payloads, and skill bundles behind namespaced refs (`@acme/demo`); farrier fetches, schema-validates, caches, and pins them exactly like a built-in pack.

Everything is declarative data + tested templates. The LLM never writes hook code; it only proposes data that farrier's tested engine renders.

---

## 5-minute quickstart

Prereqs: [bun](https://bun.sh), [uv](https://docs.astral.sh/uv/) (for Python stacks + hook tests), [just](https://github.com/casey/just) (verification verbs). The [skills](https://www.npmjs.com/package/skills) CLI ships as a farrier dependency (`bun install` pulls it into `node_modules/.bin/skills`), so no global CLI install is required; fetching a skill source can still require network access. Override with `FARRIER_SKILLS_BIN` if you need a different binary.

Run the published CLI with any npm-compatible launcher:

```bash
bunx farrier
pnpm dlx farrier
npx farrier
```

Bare `farrier` on a terminal opens exactly three primary workflows: **⚒ Create a harness**, **✚ Create a skill**, and **✦ Advise this project**. Advice inspects the project and optionally its exact-project Claude/Codex sessions, then reports configuration improvements without changing the project.

Every launcher accepts the same headless flags, for example `bunx farrier --detect --dry-run --dir .`. Bun is still required because the published executable runs Farrier's TypeScript entry point directly.

```bash
cd ~/src/tries/2026-07-02-farrier
bun install
```

### A. New project, interactive (the wizard)

```bash
mkdir ~/src/my-api && cd ~/src/my-api
uv init --package .                                # native generator makes the code
bun run ~/src/tries/2026-07-02-farrier/src/cli.ts  # bare farrier on a TTY = wizard
```

The wizard walks: **Stack → Skills → Create → Hooks → Learn → Review → write**. Claude and Codex enforcement targets are checkboxes at the top of the existing Hooks screen; this does not add another wizard step.

**Navigation (same on every step):**

- **Enter** — continue (on lists it picks the highlighted item; in toggle lists it toggles).
- **Space** — toggle the highlighted item in Skills/Create/Hooks/Learn.
- **Tab** — cycle focus zones: input → list → the button bar at the bottom.
- **Button bar** — `←`/`→` choose between `← Back` / `Next →`, Enter activates; press `↑` (or `←` past the leftmost button) to jump back up to the content.
- **Esc** — always goes back one step (on the first step: exits without writing anything).

Step by step:

- *Stack*: your detected stack is preselected and annotated; Enter continues with it.
- *Skills*: recommended skills are pre-ticked; type to live-search skills.sh; Space/Enter toggles.
- *Hooks*: choose Claude, Codex, or both enforcement targets, then toggle any of the six pre-ticked protections. At least one target remains selected. CLI availability is informational and never removes an option or changes the saved selection.
- *Learn*: opt this project into the self-learning loop (records intent in `.farrier.json`; see the learn walkthrough below).
- *Review*: the same creation plan used by headless mode, including per-file create/merge/unchanged/replace/blocked actions and why each file exists. Enter writes only an accepted plan, then installs skills into `.claude/skills/` and `.agents/skills/` for Claude Code and Codex.

### B. New project, headless (for scripts, CI, or agents driving farrier)

```bash
farrier --detect --dry-run --dir ./existing-repo          # inspect evidence and every planned action
farrier --detect --yes --dir ./existing-repo              # apply a clean detected plan + install skills
farrier --stack python-fastapi --yes --dir ./my-api       # apply a clean explicitly selected plan
farrier --stack python-fastapi --agents codex --yes --dir ./my-api
farrier --stack python-fastapi --agents claude,codex --yes --dir ./my-api
farrier --stack rails --dry-run --json --dir ./app        # machine-readable preview
farrier --stack python-fastapi --yes --no-skills --dir .  # offline: write files, record skills, skip install
```

(When developing from this repository, substitute `bun run src/cli.ts` for `farrier`; `bun link` also makes the checkout available globally.)

Creation is deliberately **plan, then apply**. `--dry-run` shows the selected stack, every detected stack with the signals that actually matched, any selection assumptions, the resulting harness behavior (rules, hooks, commands, skills, judge defaults), and each file's action and purpose. Add `--json` to either preview or apply for the same information as structured output, including machine-readable failures.

`--agents claude|codex|claude,codex` selects native enforcement bindings and defaults to `claude` for backward compatibility. Farrier normalizes the selection into deterministic order and persists it as the non-empty `agents` array in `.farrier.json`. Environment variables, installed CLIs, backend discovery, and fallback behavior never alter that value.

`--yes` by itself accepts only a clean plan: new files, unchanged files, safe `.gitignore` additions, and metadata/permission updates. If an existing file differs, review it in `--dry-run`, then opt into replacement with `--yes --force`; Farrier first copies the old version under `.farrier-staging/backups/<timestamp>/`. Writes are staged, path identities are revalidated, and complete files are committed atomically so symlinks and hard-linked peers are not followed or mutated. If rollback encounters a concurrent edit, Farrier preserves it, retains an ignored recovery backup, and reports the incomplete state instead of overwriting the edit. `--force` cannot bypass unsafe paths such as symlinks, directories where files belong, or non-directory parents. If `.farrier.json` already exists, creation refuses even with `--force` and directs you to `farrier update --dir <target>` so lifecycle settings are not reset.

Headless creation installs the selected pack skills for Claude Code and Codex by default. A failed install is an explicit partial result: harness files remain applied, Farrier reports an exact `skills add ...` retry command for each failure (in human and JSON output), and the process exits nonzero. Use `--no-skills` when deliberately working offline; the selected refs remain in the manifest, but no install or lockfile mutation is attempted.

Some packs declare a native project generator such as `uv init` or `rails new`. Farrier reports that command in the harness behavior summary but does **not** execute it; run the project generator yourself before or after creating the harness as appropriate.

### C. See it work

Open a selected agent in the generated project and try to misbehave:

```
> cat .env
⛔ Blocked secret access. Use .env.example, documented configuration, or ask the user.

> pip install requests
⛔ Do not use pip in this uv-managed project.
   Redirect: Use `uv add <package>`.

> (edit uv.lock directly)
⛔ Lockfiles are owned by their package manager. Use `uv`.
```

Meanwhile every edit triggers `just check`, and when the agent tries to end its turn, the structure linter (`just konpy` on Python, `just konsistent` on TypeScript) verifies the project structure — failures block the stop with actionable feedback, so the agent fixes them before yielding.

For Codex, trust the project and review the exact project hook commands in `/hooks`; command definitions are approved separately by content hash. Matching Codex hooks can run concurrently, so every Farrier hook is independent and the binding does not rely on handler order. See [Codex enforcement coverage](#codex-enforcement-coverage) for the released interception limits.

### How skill search & installs run

The wizard's Skills step is tuned so neither the network nor the skills CLI ever makes you wait twice. Headless creation uses the same installer for the pack's selected defaults unless `--no-skills` is present:

- **Search** is debounced (300 ms), and a superseded keystroke *aborts* the in-flight HTTP request rather than just discarding its result. Results are cached per query for the wizard session, so backspacing to an earlier query renders instantly. Search runs concurrently with agent advise — neither blocks the other.
- **Installs** are grouped by source: one `skills add <source> -s a b c` per source, so each source repo is cloned once no matter how many of its skills you picked. Different sources install concurrently (capped at 4 via [Effect](https://effect.website)).
- **Lockfile repair**: the skills CLI updates `skills-lock.json` with an unlocked read-modify-write, so concurrent installs can drop each other's lock entries. After a multi-source install, farrier verifies the lock and sequentially re-runs any skills whose entries were clobbered — sequential runs can't race, so one repair pass converges.

---

## What got generated (and why each file exists)

For `python-fastapi` with the default Claude-only binding, 45 rendered harness files, plus the selected installed skills and their `skills-lock.json` entries (selecting both agents adds `.codex/hooks.json`):

| File | Job |
|---|---|
| `AGENTS.md` | Source of truth: commands, hard rules, accepted risks. Read by every agent. |
| `CLAUDE.md` | Imports AGENTS.md via Claude Code's `@AGENTS.md` syntax, so its content actually loads into every session (not just an advisory pointer) — keeps Claude + Codex on one ruleset. |
| `.claude/settings.json` | Wires the hooks to Claude Code events. |
| `.codex/hooks.json` | Wires the same shared policy scripts to released Codex hook events when Codex is selected. |
| `.claude/hooks/*.py` + `test_*.py` | The six hooks, each with its pytest suite alongside. |
| `.claude/hooks/tool-policy-rules.json` | **Declarative** wrong-tool rules (this is where `farrier learn` appends). |
| `.claude/hooks/prompts/*.txt` | Versioned prompts for the LLM judges. |
| `.claude/skills/harness-advisor/SKILL.md` | Teaches the in-session agent to manage the harness itself. |
| `.claude/skills/claude-automation-recommender/` | Claude wrapper plus an unchanged, pinned Anthropic reference snapshot with Apache-2.0 attribution, provenance, and SHA-256 hashes. |
| `.agents/skills/codex-automation-recommender/` | Codex recommender plus references for skills, plugins, hooks, MCP, and custom agents. |
| `.agents/skills/farrier-project-advisor/SKILL.md` | Compatibility entry point that delegates to the Codex automation recommender. |
| `justfile` | The stable verbs: `just check` / `test` / `fmt` / `konpy` (Python) or `konsistent` (TypeScript). |
| `konpy.json` / `konsistent.json` | Structure conventions (v1 grammar) enforced at Stop — `konpy.json` on Python, `konsistent.json` on TypeScript. |
| `.farrier.json` | Manifest: selected enforcement agents, packs, hooks, skills, judge config. **Never edit by hand.** |
| `.gitignore` | Gains `.env`, `.env.*`, `!.env.example`. |

With the default Claude-only binding, Rails renders 44 (no structure linter because konpy/konsistent are TS/Python-only) and `generic` renders 39.

Binding files are selected independently: Claude uses `.claude/settings.json`, Codex uses `.codex/hooks.json`, and selecting both emits both. The six scripts, their colocated tests, prompts, and the one canonical `.claude/hooks/tool-policy-rules.json` remain shared; Farrier does not generate a second `.rules` translation. An unselected vendor binding is outside the render/update/doctor inventory, so an existing user-owned file is preserved and left unmanaged.

### The six hooks

| Hook | Event | What it does |
|---|---|---|
| `secret-shield` | PreToolUse | Denies reading `.env*` / private keys (tracked examples like `.env.example` allowed). |
| `tool-policy` | PreToolUse | Denies wrong-tool commands per the declarative rules file; every denial names the right tool. |
| `write-guard` | PreToolUse | Denies writes to lockfiles, `.git/`, `skills-lock.json`, `.farrier.json`. |
| `verb-runner` | PostToolUse + Stop | Runs `just check` after edits; the structure check (`just konpy` / `just konsistent`) at Stop (blocks the stop on failure). |
| `quality-judge` | PostToolUse | Always: warns when a file exceeds `quality.maxFileLines` (500). Optional: haiku judge for gross cohesion violations. |
| `stop-judge` | Stop | Optional: sonnet/gpt-5.5 reviews the whole turn's diff; blocks only *serious* findings. |

**LLM judge tiers ship disabled** — a generated project never surprise-calls an LLM. Enable in `.farrier.json`:

```jsonc
"judge": {
  "perEdit": { "enabled": true, "backend": "claude", "model": "haiku" },
  "stop":    { "enabled": true, "backend": "claude", "model": "sonnet" }   // or "codex" + "gpt-5.5"
}
```

Judge failures follow the selected hook event. PostToolUse quality feedback is non-destructive. A selected Stop judge fails closed on malformed input, invalid configuration, timeout, or internal failure and reports how to retry or disable the judge through Farrier's managed configuration.

### Codex enforcement coverage

Farrier uses the released Codex project-hooks surface, not `.codex/config.toml` or a parallel Codex rules language:

| Codex event | Matcher | Shared Farrier hooks |
|---|---|---|
| `PreToolUse` | `^Bash$` | `secret-shield`, `tool-policy` |
| `PreToolUse` | `^apply_patch$` | `write-guard` |
| `PostToolUse` | `^apply_patch$` | `verb-runner`, `quality-judge` |
| `Stop` | none | `verb-runner`, `stop-judge` |

The coverage boundary matters:

- Released `PreToolUse`/`PostToolUse` interception covers simple Bash and `apply_patch` calls (plus supported MCP tools), but `unified_exec` coverage is incomplete. Native reads, native search, WebSearch, and other non-shell paths are not all intercepted.
- `PostToolUse` feedback can tell Codex what to repair, but it cannot undo a patch or another effect that already happened.
- Project trust and separately approved hook definitions are runtime state. `farrier doctor` validates static files, required Farrier entries, executable shared targets, and allows unrelated user hooks, but it cannot prove trust, administrative policy, enablement, or complete interception. Inspect `/hooks` in Codex.
- Remote registry hooks remain Claude-only because the current registry schema has no explicit Codex event/payload compatibility metadata. Their payload files may be rendered as shared inventory, but they are never inserted into `.codex/hooks.json`.
- `AGENTS.md` and the project verification commands remain mandatory on every path, including paths no hook can intercept.

---

## Living with the harness: the day-2 loop

### `farrier update` — did the project drift?

```bash
farrier update --dir .          # report only
farrier update --dir . --json   # machine-readable
farrier update --dir . --yes    # repair
```

Reports: stack drift (e.g. hotwire files appeared in your Rails repo → suggests JS skills), hook version drift, missing/outdated harness files, unacknowledged secondary findings.

Repair (`--yes`) is deliberately conservative — it restores missing files and overwrites **only farrier-owned files** (hooks, prompts, advisor skill). Selected binding files (`.claude/settings.json` and/or `.codex/hooks.json`) and other files you customize — `AGENTS.md`, `justfile`, `tool-policy-rules.json`, `konpy.json`/`konsistent.json` — are *reported* for manual review when modified, never clobbered; a missing selected binding is restored. Unselected vendor bindings are ignored and preserved. Manifests created before the `agents` field are treated as Claude-only. Update never switches packs and never installs skills without you.

### `farrier learn` — the harness improves itself

The self-learning loop turns *things that went wrong in your sessions* into *rules that prevent them next time* — as declarative data, never generated code.

**How to use it, start to finish:**

1. **Just work.** Use Claude Code in the project normally. Every session is transcribed automatically to `~/.claude/projects/<your-project-path-with-dashes>/*.jsonl` — you don't set anything up. (The wizard's Learn toggle only records intent in `.farrier.json`; learn runs either way.)

2. **After a few sessions, ask farrier what it noticed:**

   ```bash
   farrier learn --dir .
   ```

   It mines the transcripts for Bash commands that were repeatedly denied by hooks or kept failing, then proposes new tool-policy rules. Nothing is written yet — this is report-only. Add `--json` for machine-readable output.

3. **Read the proposals.** Each one is a complete declarative rule — id, regex, deny message, redirect — e.g. after `docker compose up` failed in three sessions:

   ```text
   learn-ban-docker-compose
     pattern:  (^|[;&|()\s])docker\s+compose\b
     message:  Avoid `docker compose` in this project. Learned from repeated failing transcript events.
   ```

   Proposals are validated hard before you ever see them: the regex must compile, the id must be new kebab-case, `tool` must be `"Bash"`. Invalid or duplicate proposals are dropped.

4. **Accept them:**

   ```bash
   farrier learn --dir . --yes
   ```

   Accepted rules are **appended** to `.claude/hooks/tool-policy-rules.json` — existing rules are never modified or removed. The tool-policy hook enforces new rules immediately: the very next time an agent tries the banned command, it gets the deny + redirect.

**Options:**

```bash
farrier learn --dir . --no-llm                      # deterministic only: bans commands that failed ≥2 times
farrier learn --dir . --backend claude --model haiku    # default LLM proposal mode
farrier learn --dir . --backend codex --model gpt-5.5   # or via Codex
farrier learn --dir . --transcripts ./some/dir      # explicit transcript location (tests, other layouts)
```

LLM mode sends the extracted candidates (not your whole transcript) to the backend and falls back to deterministic mode on any failure. Run `farrier doctor --dir .` afterwards if you want confirmation the rules file is still healthy.

### `farrier doctor` — is the harness healthy?

```bash
farrier doctor --dir .          # exit 1 if problems
farrier doctor --dir . --json
```

Static checks: manifest and its non-empty agent selection parse, all selected inventory files exist, executable digests and permissions match, generated hook tests are present, selected Claude/Codex bindings contain their required Farrier entries, every tool-policy regex compiles, skill provenance/cases are reported, and judge/quality config is shape-valid. Doctor does not run hooks or project tests. Unrelated user-authored Codex hooks are allowed. Runtime Codex trust/approval remains a `/hooks` check. Good in CI: `farrier doctor --dir . || exit 1`.

### `farrier advise` — evidence-backed project advice

Farrier profiles the resolved project directory, including dependencies, package manager, scripts, migrations, API specifications, tests, CI, services, and installed agent configuration. It then runs the selected provider's policy for guidance, hooks, skills, subagents, plugins, and MCP servers:

```bash
farrier advise --dir .
farrier advise --dir . --sessions none                         # codebase evidence only
farrier advise --dir . --since 14d                             # exact-project sessions from the past 14 days
farrier advise --dir . --since all                             # explicit full-history opt-in
farrier advise --dir . --targets codex --backend codex
farrier advise --dir . --only guidance,hooks,mcp
farrier advise --dir . --backend codex --model <name> --json
```

With `--sessions auto` (the default), Farrier includes only the past 7 days of exact-project sessions for the selected provider. Use `--since 14d` for a two-week window or `--since all` to opt into full history. Claude JSONL is accepted only from the matching project directory. Codex history is read through Codex App Server: Farrier pages `thread/list` newest-first by `updated_at` with the exact resolved `cwd`, applies the window before any `thread/read`, verifies the returned directory, and calls read-only `thread/read`. Visible user requests, corrections, typed actions, outcomes, and blockers become bounded episodes. Reasoning records, screenshots, image data, raw tool output, and injected instructions are excluded. Secrets and personal identifiers are redacted locally before a backend call.

Sessions enrich codebase analysis but are never required. A single reusable task can support a recommendation. Similar requests carry occurrence and distinct-session counts as evidence metadata; repetition is not a gate. Episode selection uses byte limits and rotates across sessions before taking a second task from one session. Reports show sessions discovered, parsed, retained, omitted, and truncated, plus backend acceptance and rejection counts.

The interactive advice workflow starts with a visible **Reasoning backend** picker and shows Claude/Codex counts for **past 7 days**, **past 14 days**, and **all history**. When both backends are available, Claude is initially selected for compatibility and Left/Right switches to Codex; when only one is available, Farrier selects it and labels the other unavailable. Claude selection consumes Claude sessions and targets Claude artifacts; Codex selection consumes Codex sessions and targets Codex artifacts. Compatible shared routes remain available. Move to a visible setup control with Up/Down or Tab, then use Left/Right to change that control's value. In the report, Up/Down selects a recommendation and immediately shows the observed problem, expected value, strongest evidence, and exact artifact Farrier would create. PageUp/PageDown scrolls the full report. The visible action row contains **Create selected** and **Create all (N)**; Left/Right focuses an action and Enter activates it, so individual creation remains the default.

**Create all** coordinates every supported recommendation in the report. Farrier plans file recommendations and authors skill recommendations concurrently, with at most three backend jobs running at once. The backend recorded in `report.backend` authors every job, including skills; target vendors and session sources never select the authoring backend. Model and reasoning settings for that backend are reloaded when the batch starts, and a backend failure is reported without falling back to the other agent. Unsupported/manual routes such as unverified plugin installation are retained in the result as **skipped** with an explanation. Each recommendation shows queued/running progress followed by **planned**, **created**, **skipped**, **failed**, or **cancelled**; retry runs only failed/cancelled work and preserves successful work.

Concurrent backend work does not mean concurrent filesystem commits. Skill-creator output stays in disposable staging and becomes reviewed project files; cancellation before confirmation leaves no project artifact. Farrier rejects different plans for the same path as an explicit conflict instead of choosing a last writer. All conflict-free results appear in one aggregated review with the exact create/update/replace manifest and complete paged content previews. Nothing is written until confirmation. One transaction then applies the reviewed files, retains backups for replacements, detects changes since review, and rolls back on failure. Any creator installation or other lock-sensitive preparation is serialized.

While batch planning/authoring runs, Ctrl+C or Command-Z requests cancellation through the batch's one abort signal, stops queued work, terminates running backend process groups, and waits for all jobs to settle. A cancellation arriving after the atomic file transaction begins does not interrupt it mid-commit; the transaction finishes or rolls back first. OpenTUI exposes Command as the `super` modifier, so the binding is `super+z`, never plain `z`. The host terminal must deliver an enhanced Super-modified key event (for example through the Kitty keyboard protocol); terminals that intercept Command-Z or cannot encode Super will not deliver it, and Ctrl+C remains the portable cancellation key. Headless users continue to choose with `--backend claude|codex`; headless advice remains report-only, progress stages go to stderr, and `--json` stdout remains valid machine-readable JSON.

Every accepted recommendation has a stable ID, category, one target provider, reason, benefit, validated evidence IDs, confidence, evidence origin, and a provider-supported implementation route. Registry references must match an exact verified candidate. Malformed, duplicated, unsupported, invented, or unsafe results are rejected with reasons. A broad report keeps the top two recommendations per applicable category; a focused category may return up to five. Valid items past that bound remain in `omittedRecommendations` with their ranking reason. There is no global recommendation target and no recovery call that fills missing categories. Hook output is declarative, and hooks that commit, push, publish, or deploy automatically are rejected.

Advice analysis is always read-only, and headless advice remains report-only. The interactive TUI may create one selected recommendation or a reviewed batch only after opening a separate review screen and receiving explicit confirmation; no report result is applied automatically. Human and JSON output remain two renderings of the same validated report.

Provider-native focused skill advice and the earlier skills.sh advisor use different spellings:

```bash
farrier advise skills --dir . --context ./docs/brief.md
farrier advise --dir . --only skills --backend codex --json
```

`--only skills` uses the full codebase profile, optional sessions, and provider policy. The `advise skills` subcommand is registry-only and also remains available as the optional ★ advice toggle in the harness wizard's Skills step.

### `farrier skill new` — create a skill with each vendor's own skill-creator

Farrier does not own a skill-authoring prompt. It delegates to the vendor's recommended creator — Claude uses the pinned `anthropics/skills` **skill-creator** (installed into the target on first use, refreshed by `skills update`), Codex uses its **built-in `$skill-creator`** (ships with the codex CLI) — then deterministically validates the result (exactly one new kebab-case skill directory, parseable frontmatter, description ≤ 500 chars; frontmatter name repaired to match the directory) and installs it through the same `skills add` path as any third-party skill.

The wizard has a **Create** step (Stack → Skills → Create → Hooks → Learn → Review): describe the skill, check the target agents (`[x] claude [x] codex` — only agents whose CLI answers `--version` are selectable), and when both are checked, pick who authors:

- **Claude authors, install to both** — one canonical `skills/<name>/`, lock-tracked, installed via `skills add ./skills -a claude-code codex`.
- **Codex authors, install to both** — same, codex writes the canonical copy.
- **Each agent authors its own copy** — claude writes `.claude/skills/<name>/`, codex writes `.agents/skills/<name>/`; truest to each vendor, but the copies may diverge and are not lock-tracked.

Vague briefs make dumb skills, so the standalone create flow **asks first**: before authoring, farrier makes one read-only backend call (`claude -p` / `codex exec`) that proposes 2–4 concrete questions about whatever the description leaves open — language, specific libraries, input/output formats — each with recommended options, a "let the creator decide" escape hatch, and free-text input. Escape leaves a focused text field first; outside the field, Escape or `b` finishes the interview with the answers so far. Your answers are folded into the brief as an "Implementation decisions (follow these exactly)" block before it reaches the skill-creator. Toggle it off with the "ask clarifying questions first" checkbox; the wizard's Create step asks the same questions at queue time. Headless `farrier skill new` asks only with `--refine` (interactive: numbers pick options, free text is used verbatim, empty lets the creator decide) — otherwise put the decisions in the description yourself. If the authored skill's directory already exists, the standalone flow and the harness wizard both pause with the shared confirmation grammar: `y` replaces it, while `n` or Escape keeps the existing copy (the new one stays in `.farrier-staging/`); headless replaces only with `--force`.

You don't need the full wizard to create a skill: bare `farrier` opens the three-workflow launcher—**⚒ Create a harness**, **✚ Create a skill**, or **✦ Advise this project**—and bare `farrier skill new` (optionally with `--dir`) on a terminal opens the same standalone create flow directly: describe → check agents → ⚒ Create → per-skill results.

#### Interactive keyboard grammar

| Key | Behavior |
| --- | --- |
| Up / Down | Move through the focused list. |
| Left / Right | Change the value inside the focused control; never change wizard pages. |
| Tab / Shift+Tab | Move between visible focus zones. |
| Space | Toggle the focused option. |
| Enter | Activate the focused row or visible action. |
| Escape / `b` | Leave a text field first, otherwise go back or close the transient screen. |
| `q` | Quit when a text field is not focused. |
| Ctrl+C | Interrupt running work and its child processes; otherwise quit. |
| Command-Z | Cancel advice batch planning/authoring when the terminal delivers OpenTUI's `super+z` event. |
| PageUp / PageDown | Scroll long reports and file previews. |
| `r` | Retry or rerun only. |
| `y` | Confirm replacement, overwrite, deletion, or another destructive operation. |
| `n` / Escape | Reject a destructive operation. |

Every screen renders its hints from the same typed bindings used by its handler. Ordinary letters stay in a focused text field, and Enter in the skill-description field only leaves that field—it cannot submit the workflow. Use Tab to focus the visible **Queue another** or **Create/Next** action, then Enter to activate it.

Queue as many skills as you like with the visible **Queue another** action, then activate **Create**. They are authored **in parallel** — up to 3 agent runs at once, each in its own staging root so runs can't cross-contaminate, with lockfile-touching installs serialized — while a progress screen shows each skill's phase (pinning creator → authoring via claude/codex → validating → installing → ✓/✗). Each run is a full agent session, so expect minutes. Headless:

```bash
farrier skill new "Convert financial tables to markdown before sending them to the LLM" --yes
farrier skill new "Mask PII in outgoing prompts" --agents claude,codex --mode per-agent --yes
farrier skill new "Route queries to docs or the balance API" --name query-router --yes --json
farrier skill new "Log token costs as JSON" --no-llm --yes    # offline scaffold, no agent run
farrier skill eval pii-masker --json                         # compare per-agent copies, read-only
```

`--mode` is required when more than one agent is selected (headless never guesses). Authoring failures never silently downgrade: a failed backend or a malformed result exits 1 with the files left on disk for inspection, and a failed install prints the exact `skills add` retry command. Override the pinned creators with `FARRIER_CREATOR_CLAUDE` / `FARRIER_CREATOR_CODEX` (`<source>@<skillId>`).

When `per-agent` creates both copies successfully, Farrier compares them and asks you to pick a winner. The creation form carries an eval policy (space cycles): **compare & I pick** (default), **compare & auto-apply the winner**, or **skip**. The eval is deliberately bias-hardened: both copies are staged at neutral paths and judged blind — the judge never sees which vendor wrote which — twice with the candidates swapped, using the pinned Anthropic skill-creator's comparator/analyzer guidance; a winner is only recommended when both passes agree, otherwise it's a tie. Per-copy reports land in `.farrier-staging/eval/<name>/` for you to open. The verdict screen then requires an explicit choice — `c` picks Claude, `x` picks Codex, `k` keeps both; there is no silent enter-through — and a picked winner still needs a `y` confirmation before Farrier deletes the losing directory and replaces it with a relative symlink to the survivor (created under the winner's name when the copies chose different names, so both agents keep discovering the skill). Auto-apply only fires on a clear winner, keeps the deleted copy in `.farrier-staging/trash/`, and falls back to the manual screen on a tie. Changed your mind later? `farrier skill eval <name>` reruns the comparison any time (add `--claude-name`/`--codex-name` for diverged copies). Headless mirrors the same safety shape: `farrier skill new ... --eval` folds a read-only verdict into the output, and deletion+symlink always requires both `--apply-winner claude|codex|recommended` and `--delete-loser-and-link` (`recommended` keeps the trash backup and refuses to act on a tie).

### The harness-advisor skill

Every generated project carries `.claude/skills/harness-advisor/SKILL.md`, so the *in-session agent* knows this loop too: it runs `farrier update` when it notices new file types, suggests skills.sh searches for new frameworks, points at `skill-creator` when you repeat yourself, and refuses to hand-edit `.farrier.json`.

Generated projects also carry provider-specific automation recommenders. Both use the same `farrier advise --sessions auto --since 7d` orchestration, but Claude and Codex have separate policies, routes, artifact paths, and reference catalogs. The Claude skill includes Anthropic's upstream `claude-automation-recommender` from commit `a5c7fb5d86a4cd34c4f47819658654c3d8f08dda` unchanged under `upstream/`, together with every reference file, the Apache-2.0 license, source provenance, and per-file SHA-256 hashes. The Codex skill documents `.agents/skills`, `agents/openai.yaml`, Codex plugins and hooks, `.codex/config.toml`, `.codex/agents`, and MCP.

---

## Stacks

| `--stack` | Detected from | Notes |
|---|---|---|
| `python-uv` | `pyproject.toml` | Base Python: uv + ruff + pytest + konpy |
| `python-fastapi` | + `fastapi` dep | Adds layering convention (core ⊬ api) |
| `python-lambda-powertools` | + `aws-lambda-powertools` dep | "No live AWS calls in tests" rules |
| `ts-base` | `package.json` + `tsconfig.json` | bun + tsc + upstream konsistent |
| `ts-react-vite` | + `react` & `vite` deps | |
| `ts-nextjs` | + `next` dep | |
| `ts-lambda` | `aws-cdk-lib` dep or `template.yaml`/`samconfig.toml` | |
| `rails` | `Gemfile` with `rails` | No structure linter; **hotwire secondary detection** suggests JS skills |
| `generic` | never auto-detected | Minimal safety harness for any repo; explicit `--stack generic` only |

Detection returns most-specific-first; packs inherit (`python-fastapi extends python-uv`), and adding a stack is a data module in `src/packs/`, not engine code.

---

## Private registries

A team or enterprise can publish its own packs, hook payloads, and skill bundles as static, schema-validated JSON in a private GitHub/GitLab/Bitbucket repo (or any HTTPS endpoint) and reference them by namespaced ref, alongside the built-in stacks:

```jsonc
// farrier.config.json (project) or ~/.config/farrier/config.json (user)
{
  "registries": {
    "@acme": "github:acme/farrier-registry@main"
  }
}
```

```bash
farrier registry list --dir .                     # namespaces + item counts, no payloads executed
farrier --stack @acme/demo --dry-run --dir .       # preview a registry pack before writing anything
farrier --stack @acme/demo --yes --dir .
```

Registries are something the owning team builds and hosts — farrier does not search or browse across them; every item is resolved by its exact ref (`@acme/demo`, `@acme/guard`, `@acme/platform-skills`). Fetches are cached to disk with a sha256 pin recorded in `.farrier.json`, so `farrier update` can report drift and still work offline once a registry pack has been rendered. A complete, schema-valid worked example — pack, hook, and skill bundle — is checked into this repo at [`examples/registries/acme/`](examples/registries/acme/); it's also the fixture `tests/cli-e2e.test.ts` drives the real CLI against. Full schema and trust-model docs: [`docs/registries.md`](docs/registries.md).

For a **private** GitHub/GitLab/Bitbucket repo, export the matching token (`GITHUB_TOKEN`, `GITLAB_TOKEN`, or `BITBUCKET_TOKEN`) before running farrier. If you forget, farrier tells you which one: these hosts return a plain 404 for unauthenticated access to a private repo (to avoid confirming it exists), so a missing token surfaces as *"If this is a private repository, set GITHUB_TOKEN and retry"* rather than a generic not-found error.

---

## Model configuration

The LLM-backed commands (`skill new`, `skill eval`, `advise`, `learn`) pick a model — and, for codex, a reasoning effort — per backend and per role. Set them under a `models` key in the same config files that hold registries: the user config (`${XDG_CONFIG_HOME:-~/.config}/farrier/config.json`) and the project config (`<project>/farrier.config.json`).

```jsonc
{
  "models": {
    "claude": {
      "default": "sonnet",     // fallback for every claude role
      "skillCreation": "opus"  // authoring uses Opus by default
    },
    "codex": {
      "default": { "model": "gpt-5.5", "reasoningEffort": "medium" },
      "skillCreation": { "reasoningEffort": "xhigh" }  // inherits model from default
    }
  }
}
```

Each backend (`claude`, `codex`) takes a `default` plus any of the roles `skillCreation`, `eval`, `refine`, `advise`, `learn`. An entry is either a model-name string or a `{ model?, reasoningEffort? }` object. `reasoningEffort` is one of `minimal | low | medium | high | xhigh` and is **codex-only** — setting it under `claude` is a config error. Unknown backends or role keys are rejected so typos fail fast.

Precedence for a given call, first match wins: **explicit `--model`** → project role entry → project `default` → user role entry → user `default` → built-in defaults. Field resolution is independent: a role can set only `reasoningEffort` and inherit `model` from `default`.

Built-in defaults when nothing is configured: skill creation authors with **Opus** on claude and **high** reasoning effort on codex; every other claude role uses **sonnet**; `learn` falls back to `haiku` (claude) / `gpt-5.5` (codex). Codex is deliberately left with **no default model** — an explicit `--model` for a model your account lacks fails silently, so omitting it lets codex use your account's default (reasoning effort still applies).

---

## Developing farrier itself

```bash
bun test              # engine + CLI + wizard-machine tests
bun run typecheck     # tsc --noEmit
bun run test:hooks    # pytest for the hook templates (needs uv)
bun run check         # all of the above — the verb the harness itself would run
```

Architecture in one breath: **packs are declarative data** (`src/packs/`), the **engine** renders/detects/updates/learns/doctors (`src/engine/`), **hook templates** are self-contained Python scripts with tests (`src/templates/hooks/`), and the **TUI** is a pure reducer (`src/tui/machine.ts`, zero opentui imports) with thin opentui-react components around it.

## Known caveat

Generated Python projects reference konpy as a **local path dependency** (`/Users/ivor/src/tries/2026-07-02-konsistent-python`) while it's being perfected — they only work on this machine for now. Upgrade path: git dependency, then PyPI.
