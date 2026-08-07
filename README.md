# 🐴 farrier

farrier generates the agent harness for a repository: the hooks, rules, verification verbs, and context files that Claude Code and Codex read. You pick a stack or farrier detects one, and it writes 15 to 18 files depending on what your repository proves it needs.

## What it does, and what that is worth

This section separates the two. Everything under "measured" comes from local paired A/B records that are intentionally excluded from this repository; the numbers are project notes, not independently reproducible published evidence. Everything under "unmeasured" may still be useful, but no round has shown it.

**It writes a harness that runs.** AGENTS.md, CLAUDE.md, the native hook bindings, four deterministic Python hooks each with its own pytest suite, a justfile, the manifest, gitignore entries.

**The guards fire, and you can check.** `farrier doctor` pushes fixture payloads through the installed binding commands and reports which blocked: reading `.env`, `pip install` in a uv project, editing `.farrier.json`. Every hook decision also lands in `.farrier/runtime/events.jsonl`. This is behavioral verification rather than config validation, and it is the part of farrier most worth trusting.

**Nothing is written without repository evidence.** Rules render only when the repo proves them (uv rules need `uv.lock`). Verbs work the same way: a project with no linter and no test suite gets no gate and no verb-runner binding rather than a `just check-full` that can never pass. The creation preview names every omitted rule and verb and why.

**The generated harness is portable.** No pack may name an absolute path or an unpublished tool. A render test asserts it across all nine packs.

### Measured

- The repository map cuts navigation tokens on large repos: decisive at 761 files, about -45% on navigation-heavy tasks at 682. It costs tokens on small repos and is negative at 144 files, so it turns on past the size where it pays.
- The check gate is cheap insurance. Its cost sits within noise of an unharnessed control.
- Pack skills were negative: +32% input tokens for zero outcome change.

### Unmeasured, and honestly so

Across six completed A/B rounds, **no arm has ever changed a measured outcome.** The deny hooks prevented nothing observable, because the control agents never violated the standards in the first place; one advise-recommended enforcement hook fired zero times, since the agents complied by imitating neighboring code. The sixth round was the first outcome eval and its pre-registered kill criterion fired.

That is not evidence the harness fails. It means the question is still open: you cannot measure prevention when the control never fails. Every completed round so far is codex-only, so nothing generalizes to Claude yet either. Farrier now has a frozen prospective protocol and deterministic validators for snapshots, native-harness delivery, event origin, independent audit, rescue, and result scoring. Those validators make a future result falsifiable; they do not establish lift by themselves.

`farrier advise` has never been A/B evaluated at all.

### What does not work yet

`farrier learn` mines sessions for repeated failures and proposes primitives. On real data it currently proposes nothing: 35 codex sessions of one project produced zero proposals, 12 of another produced zero. That is not a parsing failure, it is the eligibility filter, which drops exploration commands, drops anything containing a verification verb, and requires the same failure across two distinct sessions. Treat the learning loop as unfinished.

Everything farrier generates is declarative data plus tested templates. The LLM never writes hook code; it only proposes data the tested engine renders.

---

## 5-minute quickstart

Prereqs: [bun](https://bun.sh), [uv](https://docs.astral.sh/uv/) (for Python stacks + hook tests), [just](https://github.com/casey/just) (verification verbs). The [skills](https://www.npmjs.com/package/skills) CLI ships as a farrier dependency (`bun install` pulls it into `node_modules/.bin/skills`), so no global CLI install is required; fetching a skill source can still require network access. Override with `FARRIER_SKILLS_BIN` if you need a different binary.

Run the published CLI with any npm-compatible launcher:

```bash
bunx farrier
pnpm dlx farrier
npx farrier
```

Bare `farrier` on a terminal opens six workflows: **Create harness**, **Find/Create skills**, **Improve harness**, **Compile preferences**, **Export harness**, and **Doctor & update**. Improve starts with local session evidence and can open the deeper advice flow; every write-capable workflow has a separate review and confirmation step.

Every launcher accepts the same headless flags, for example `bunx farrier --detect --dry-run --dir .`. Bun is still required because the published executable runs Farrier's TypeScript entry point directly.

```bash
git clone https://github.com/ivorpad/farrier.git ~/src/farrier
cd ~/src/farrier
bun install
```

### A. New project, interactive (the wizard)

```bash
mkdir ~/src/my-api && cd ~/src/my-api
uv init --package .                                # native generator makes the code
bun run ~/src/farrier/src/cli.ts                   # bare farrier on a TTY = wizard
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
- *Skills*: Farrier derives up to four registry queries from installed libraries and project capabilities, then searches skills.sh without an LLM. Pack defaults remain pre-ticked. Optional **Research with Claude/Codex** is explicit, says that it makes two LLM calls, and can be cancelled.
- *Hooks*: choose Claude, Codex, or both enforcement targets, then toggle any of the six pre-ticked protections. At least one target remains selected. CLI availability is informational and never removes an option or changes the saved selection.
- *Learn*: record intent to mine sessions in `.farrier.json`. See the learn section below for its current status, which is that it proposes nothing on real data yet.
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

Meanwhile every edit triggers `just check-fast` (typecheck-level, plus the tests related to the edited files when they exist). When the agent tries to end its turn, `just check-full` runs once — a failure blocks the stop with actionable feedback. Both are skipped when the recipe does not exist, so a repository with no verification tooling is never blocked by a gate it cannot satisfy. A check-full failure whose normalized fingerprint matches an already-reported baseline failure does not re-block: the agent is told to report it once and stop retrying.

For Codex, trust the project and review the exact project hook commands in `/hooks`; command definitions are approved separately by content hash. Matching Codex hooks can run concurrently, so every Farrier hook is independent and the binding does not rely on handler order. See [Codex enforcement coverage](#codex-enforcement-coverage) for the released interception limits.

### How skill search & installs run

The wizard's Skills step is tuned so neither the network nor the skills CLI ever makes you wait twice. Headless creation uses the same installer for the pack's selected defaults unless `--no-skills` is present:

- **Search** is debounced (300 ms), and a superseded keystroke *aborts* the in-flight HTTP request rather than just discarding its result. Results are cached per query for the wizard session, so backspacing to an earlier query renders instantly. Search runs concurrently with agent advise — neither blocks the other.
- **Installs** are grouped by source: one `skills add <source> -s a b c` per source, so each source repo is cloned once no matter how many of its skills you picked. Different sources install concurrently (capped at 4 via [Effect](https://effect.website)).
- **Lockfile repair**: the skills CLI updates `skills-lock.json` with an unlocked read-modify-write, so concurrent installs can drop each other's lock entries. After a multi-source install, farrier verifies the lock and sequentially re-runs any skills whose entries were clobbered — sequential runs can't race, so one repair pass converges.

---

## What got generated (and why each file exists)

File count depends on what the repository proves. For `python-fastapi` with the default Claude-only binding: 18 files when ruff, pytest, and a test suite are present; 15 when none of them are, because a project with nothing to run gets no `justfile` and no verb-runner. Add the selected installed skills and their `skills-lock.json` entries. Selecting both agents adds `.codex/hooks.json`; `--agents codex` drops `CLAUDE.md` and everything under `.claude/`.

| File | Job |
|---|---|
| `AGENTS.md` | Source of truth: commands and hard rules. Read by every agent. |
| `CLAUDE.md` | Claude-only: imports AGENTS.md via Claude Code's `@AGENTS.md` syntax, so its content actually loads into every session (not just an advisory pointer). |
| `.claude/settings.json` | Claude-only: wires the hooks to Claude Code events. |
| `.codex/hooks.json` | Codex-only: wires the same shared policy scripts to released Codex hook events. |
| `.farrier/hooks/*.py` + `test_*.py` | The provider-neutral deterministic hooks, each with its pytest suite alongside (the self-tests run under `farrier doctor`, not inside the project gate). |
| `.farrier/hooks/tool-policy-rules.json` | **Declarative** wrong-tool rules with probe fixtures (this is where `farrier learn` appends). |
| `justfile` | The verbs the repository has evidence for, from `just check-fast [tests…]` / `check-full` / `test` / `fmt`, with `check` as a `check-full` alias. Each recipe appears only when its tool does, and the file is not written at all when none of them do. |
| `.farrier.json` | Manifest: selected enforcement agents, packs, hooks, skills, advisors flag. **Never edit by hand.** |
| `.gitignore` | Gains `.env`, `.env.*`, `!.env.example`, `.farrier-staging/`, `.farrier/runtime/`. |

With the default Claude-only binding, `rails` renders 18 with rubocop and rails in the Gemfile and 15 without, and `generic` renders 16 (its placeholder verbs are unconditional, since you are expected to replace them). Everything else is opt-in and produces zero files when disabled:

- `--with-advisors` adds the agent-scoped advisor skill trees (`.claude/skills/harness-advisor/`, `.claude/skills/claude-automation-recommender/` with its pinned attributed Anthropic snapshot, `.agents/skills/codex-automation-recommender/`, `.agents/skills/farrier-project-advisor/`).
- The LLM judge hooks (`quality-judge`, `stop-judge`) and their prompts are no longer in any default pack; opt in by adding the hook ids to `.farrier.json` and running `farrier update --yes`.

Binding files are selected independently: Claude uses `.claude/settings.json`, Codex uses `.codex/hooks.json`, and selecting both emits both. The hook scripts, their colocated tests, and the one canonical `.farrier/hooks/tool-policy-rules.json` are provider-neutral and shared; Farrier does not generate a second `.rules` translation. An unselected vendor binding is outside the render/update/doctor inventory, so an existing user-owned file is preserved and left unmanaged. Every hook decision is appended to `.farrier/runtime/events.jsonl` (`{"hook":"tool-policy","event":"PreToolUse","result":"blocked","rule":"..."}`), which is how `farrier doctor` distinguishes a firing hook from dead generated code.

### The hooks

Four deterministic hooks ship by default; the two LLM judges are opt-in:

| Hook | Event | What it does |
|---|---|---|
| `secret-shield` | PreToolUse | Denies reading `.env*` / private keys (tracked examples like `.env.example` allowed). |
| `tool-policy` | PreToolUse | Denies wrong-tool commands per the declarative rules file; every denial names the right tool. |
| `write-guard` | PreToolUse | Denies writes to lockfiles, `.git/`, `skills-lock.json`, `.farrier.json`. |
| `verb-runner` | PostToolUse + Stop | Runs `just check-fast` (with related test files) after edits and `just check-full` once at Stop, skipping either when the repository generated no such recipe. Records a normalized fingerprint of a check-full failure so an identical pre-existing failure blocks once and is then reported instead of retried. Not installed at all when no verb has evidence. |
| `quality-judge` (opt-in) | PostToolUse | Warns when a file exceeds `quality.maxFileLines` (a preference: default 500, `null` disables); optional haiku judge reviews each edit against your `quality.rules` and the repository map, so "this helper already exists in `_internal/…`" surfaces at write time. |
| `stop-judge` (opt-in) | Stop | Optional sonnet/gpt-5.5 review of the whole turn's diff against the same rules and map; blocks only *serious* findings (clear-cut rule violations, recreated helpers/types, secret exposure). |

**Opt-in judges emit zero files until selected**, and their model tiers additionally ship disabled — a generated project never surprise-calls an LLM. What the judges enforce is yours, not farrier's: `quality.rules` is a list of plain-language preferences seeded with two editable examples (reuse-before-recreate, no obvious security risks), and both judges receive it verbatim along with the repo-map section of AGENTS.md (`includeRepoMap`, default true). Enable in `.farrier.json`:

```jsonc
"quality": {
  "maxFileLines": 500,            // or null to disable the length check
  "rules": ["Reuse existing helpers and types instead of recreating them; …"]
},
"judge": {
  "perEdit": { "enabled": true, "backend": "claude", "model": "haiku" },   // ~17 s, ~$0.04 per edit
  "stop":    { "enabled": true, "backend": "claude", "model": "sonnet" }   // ~44 s per stop; or "codex" + "gpt-5.5"
}
```

Enabling after creation: add the two hook ids to `hookIds`, run `farrier update --yes` (materializes the hook files and prompts), then add the judge entries to your binding file — update never rewrites an existing `.claude/settings.json`/`.codex/hooks.json`, though it will regenerate a deleted one. Every verdict lands in `.farrier/runtime/events.jsonl`. The judges ship off because each enabled path makes a model call and no tracked evaluation establishes outcome lift.

Judge failures follow the selected hook event. PostToolUse quality feedback is non-destructive. A selected Stop judge fails closed on malformed input, invalid configuration, timeout, or internal failure and reports how to retry or disable the judge through Farrier's managed configuration.

### Codex enforcement coverage

Farrier uses the released Codex project-hooks surface, not `.codex/config.toml` or a parallel Codex rules language:

| Codex event | Matcher | Shared Farrier hooks |
|---|---|---|
| `PreToolUse` | `^Bash$` | `secret-shield`, `tool-policy` |
| `PreToolUse` | `^apply_patch$` | `write-guard` |
| `PostToolUse` | `^apply_patch$` | `verb-runner` (+ `quality-judge` when opted in) |
| `Stop` | none | `verb-runner` (+ `stop-judge` when opted in) |

`verb-runner` appears in both rows only when the repository has evidence for at least one verb; without it the hook is not bound on either provider.

The coverage boundary matters:

- Released `PreToolUse`/`PostToolUse` interception covers simple Bash and `apply_patch` calls (plus supported MCP tools), but `unified_exec` coverage is incomplete. Native reads, native search, WebSearch, and other non-shell paths are not all intercepted.
- `PostToolUse` feedback can tell Codex what to repair, but it cannot undo a patch or another effect that already happened.
- Project trust and separately approved hook definitions are runtime state. `farrier doctor` validates the static shape, then executes the literal binding commands against fixture payloads (a forbidden package-manager command, a `.env` read, a protected-file patch, one benign command) and verifies the decisions and the event log — proving the scripts and bindings work. What it still cannot prove statically is that *Codex itself* invokes them under trust and administrative policy; `farrier doctor --live` closes that last gap with one real Codex session that must produce a blocked event. Inspect `/hooks` in Codex when it fails.
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

Reports: incompatible primary-pack drift, hook version drift, missing/outdated harness files, and unacknowledged secondary findings (for example, Hotwire files in a Rails repository suggesting JavaScript skills).

Repair (`--yes`) is deliberately conservative — it restores missing files and overwrites **only farrier-owned files** (hooks, prompts, advisor skill). Selected binding files (`.claude/settings.json` and/or `.codex/hooks.json`) and other files you customize — `AGENTS.md`, `justfile`, `tool-policy-rules.json` — are *reported* for manual review when modified, never clobbered; a missing selected binding is restored. Unselected vendor bindings are ignored and preserved. Manifests created before the `agents` field are treated as Claude-only. Headless update never switches packs and never installs skills without you.

The interactive **Doctor & update** workflow handles deterministic incompatible primary-stack drift separately; compatible parent/child packs and an explicitly selected `generic` pack remain valid and produce no migration offer. Enter opens the exact old-pack → new-pack byte plan, including removals and the selected Claude/Codex bindings; nothing changes until the destructive confirmation. Migration preserves custom hooks, project-selected skills, learned tool-policy rules, and relevant registry pins. It removes only byte-exact old-pack output, blocks on locally edited obsolete files or installed old-pack skills, and aborts if the manifest, detection evidence, source material, or reviewed output changes before commit.

### `farrier learn` — mine sessions for repeated failures

Intended to turn *things that went wrong in your sessions* into *rules that prevent them next time*, as declarative data, never generated code.

**Status: it proposes nothing on real data.** Measured against 35 codex sessions from one project and 12 from another, both returned zero proposals. The pipeline reads the transcripts correctly; the eligibility filter is what empties it. It drops any command over 120 characters or containing a pipe, drops around 50 exploration heads (`git`, `python3`, `rg`, `curl`), drops anything containing a verification verb, and then requires the same failure in two distinct sessions. On the sessions measured, 25 distinct failing commands produced exactly one cross-session repeat, and that one was excluded by the vocabulary. The walkthrough below is accurate about the mechanics; do not expect output from it yet.

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

   Accepted rules are **appended** to `.farrier/hooks/tool-policy-rules.json` — existing rules are never modified or removed. The tool-policy hook enforces new rules immediately: the very next time an agent tries the banned command, it gets the deny + redirect.

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
farrier doctor --dir .          # static checks + fixture probes + generated hook tests
farrier doctor --dir . --static # static checks only
farrier doctor --dir . --live   # also require one real blocked Codex session
farrier doctor --dir . --json
```

Static checks cover the manifest, selected inventory, executable digests and permissions, binding entries, tool-policy regexes, skill provenance/cases, and judge/quality config. When static health passes, Doctor executes the literal installed binding commands against deny/allow fixtures, verifies their event-log writes, and runs the generated hook pytest suite; it does not run the project's application tests. `--static` skips that runtime layer. `--live` additionally starts one real Codex session and requires a blocked event, which is the only mode that tests runner delivery rather than just the installed command path. Unrelated user-authored Codex hooks are allowed. Good in CI: `farrier doctor --dir . || exit 1`.

### `farrier advise` — evidence-backed project advice

Farrier profiles the resolved project directory, including dependencies, package manager, scripts, migrations, API specifications, tests, CI, services, and installed agent configuration. It then runs the selected provider's policy for guidance, hooks, skills, subagents, plugins, and MCP servers:

```bash
farrier advise --dir .
farrier advise --dir . --sessions none                         # codebase evidence only
farrier advise --dir . --sessions auto --backend codex         # explicit recent Codex sessions
farrier advise --dir . --backend codex
farrier advise --dir . --only guidance,hooks,mcp
farrier advise --dir . --backend codex --model <name> --json
```

For a read-only harness audit, select an explicit comparison mode:

```bash
farrier advise --dir . --mode quick --json
farrier advise --dir . --mode deep --plan --json              # zero-call cost preflight
farrier advise --dir . --mode baseline --backend codex --json
farrier advise --dir . --mode deep --backend codex --json   # up to three evidence-gated workers
farrier advise --dir . --mode deep --backend codex --max-model-calls 3 --max-estimated-input-tokens 12000 --json
farrier advise --dir . --mode deep --backend claude --max-model-calls 3 --max-estimated-input-tokens 12000 --max-provider-cost-usd-per-call 0.05 --json
```

`quick` reads active repository guidance, task files, installed skills, and provider hook configuration, then runs deterministic checks without resolving or calling a model. `baseline` adds one broad model call when the corpus contains an artifact line that can satisfy the exact citation contract. A zero-line corpus reports the baseline as not run and spends no call or tokens. `deep` considers verification and toolchain specialists plus a generalist, with concurrency three, but calls a worker only when the collected evidence exposes an unresolved claim family that the validator can accept. Guidance, skill, and hook specialists are skipped because their performed checks can only support missing-artifact findings already emitted by quick mode; the final deep report still includes those deterministic findings. A future claim-specific behavioral check can make one of those specialists eligible again. Deep prompts retain claim-bearing verification and toolchain lines with nearby source context instead of repeating every selected line, while the generalist excludes hook and physical-path checks that cannot support a novel accepted claim. It receives up to 12 lines per skill and 128 skill lines overall, with workflow evidence selected before metadata. The generalist runs only for a supplied cross-layer contradiction between an installed skill's repository package command and the declared package manager. Each worker can cite only evidence and checks present in its own prompt. Audit modes use repository files only and reject `--sessions auto`, `--only`, and `--targets` rather than silently ignoring them.

Add `--plan` to any audit mode to collect the same bounded local corpus and show the scopes, exact local prompt bytes, rough input-token estimate, planned call count, and corpus digest. Plan mode returns before backend discovery or model configuration, so it makes zero provider calls even when `--backend` is present. The estimate is UTF-8 bytes divided by four and excludes provider system prompts, cache accounting, provider tokenization, retries, and output tokens. Save this output and approve a call budget before a paid audit. A completed report carries the same digest so an evaluation can reject a wrong-target or changed repository snapshot.

Use `--max-model-calls` and `--max-estimated-input-tokens` on the paid command to enforce the approved local plan. Farrier checks the limits before backend discovery, then checks again after recollecting the repository. It makes no model call when either limit is exceeded. Claude audits that select a model call also require `--max-provider-cost-usd-per-call`; Farrier passes it to each `claude -p` process as Claude's native `--max-budget-usd` limit. Completed JSON reports record all supplied execution limits so an evaluation can prove that the saved plan was enforced. The local input estimate still excludes provider overhead and output. For Claude, multiply the per-call ceiling by planned calls to obtain the enforced run ceiling. Codex CLI exposes no equivalent native dollar cap here, so its budget still needs separate account-level enforcement.

The coordinator can prepare the five-review blinded packet without resolving a backend:

```bash
farrier audit-panel prepare --manifest ./panel.json --output ./panel-packet --json
```

The manifest shape is defined by [`HarnessAuditPanelManifest`](src/engine/harness-audit-panel-packet.ts) and exercised end to end in [`tests/harness-audit-panel-packet.test.ts`](tests/harness-audit-panel-packet.test.ts). The command accepts three distinct committed Git roots with a clean tracked worktree, rejects tracked environment or private-key material, and creates 15 read-only physical snapshots plus all 30 baseline/deep plans. It verifies canonical paths, whole-snapshot and selected-corpus digests, unique reviewer ordering, source-blind reviewer files, and at least one multi-worker deep plan per reviewer. It never calls a provider and refuses to replace an existing output path. The generated budget is a proposal only: the packet stays `awaiting-external-approval`, records zero provider calls, and cannot stand in for the separate external panel approval.

Audit recommendations are report-only. Each one names a real defect, change layer, exact file and line, local counterchecks, affected artifact, proposed correction, operational risk, and remaining uncertainty. Model results cannot use confidence claims, call themselves validated, invent artifact paths, turn absence into speculative creation work, assert link health without a semantic link-health check, contradict a referenced-path result, use a missing result from another artifact or manifest hook, use a package countercheck from a different manifest scope, call an existing mypy module target stale, call a listed verification target missing, misstate the declared package manager, call an exact package-manager declaration unpinned, claim under alternate omitted-stage wording that a named package gate lacks a stage it invokes, or route completion-gate defects to guidance or toolchain. JSON reports include calls, provider-reported input/output tokens when available, wall latency, cumulative model time, corpus bounds, and rejected model candidates.

Blinded evaluation keeps reviewer judgments frozen before ground truth is revealed. A separate post-submission adjudication maps every recommendation to one hidden issue ID or to no issue and records the rationale. Missing, duplicate, unexplained, or unknown mappings invalidate the panel. Claim identity determines precision and recall; the evaluator checks the hidden issue's layer and exact cited location separately, so citing a real seeded line does not give an unrelated claim credit.

The headless CLI defaults to codebase-only analysis. Passing `--sessions auto` explicitly selects and fingerprints up to 20 recent sessions for the chosen backend and window. It lists only that provider's metadata and falls back to repository evidence when none match. The interactive toggle uses the same consent builder. Claude JSONL is accepted only from the matching project directory. Codex history is listed through Codex App Server in bounded metadata pages with the exact resolved `cwd`; spawned and forked tasks are excluded. Changed or missing selections are skipped without reading them. Farrier retains requests, corrections, commands, changed paths, and outcomes within fixed byte and turn limits. Reasoning records, screenshots, image data, raw tool output, and injected instructions are excluded. Known credential formats (provider tokens, JWTs, key material, secret-named assignments) and email addresses are redacted locally before a backend call; personal details or secrets written as free text are not detected, and the consent notice says so.

Sessions enrich codebase analysis but are never required. A single reusable task can support a recommendation. Similar requests carry occurrence and distinct-session counts as evidence metadata; repetition is not a gate. Episode selection uses byte limits and rotates across sessions before taking a second task from one session. Reports show sessions discovered, parsed, retained, omitted, and truncated, plus backend acceptance and rejection counts.

The interactive advice workflow starts with a visible **Reasoning backend** picker and a backend-specific count for **past 7 days**, **past 14 days**, or **all history**. When both backends are available, Claude is initially selected and Left/Right switches to Codex. Enabling **Use recent Claude/Codex sessions** fingerprints up to 20 recent root sessions and moves focus to Analyze. No transcript body is opened yet. Analyze first parses and redacts the selected sessions locally and collapses repeated normalized patterns. One selected category makes one reasoning call. An all-category report runs six same-provider workers with concurrency three, then normally one constrained coordinator call. Claude evidence is never mixed into a Codex analysis, or vice versa. Changing the backend or window invalidates the prior consent. A failed worker produces a visibly partial report; headless mode prints it and exits nonzero. In the report, Up/Down selects a recommendation and immediately shows the observed problem, expected value, strongest evidence, and exact artifact Farrier would create. PageUp/PageDown scrolls the full report. The visible action row contains **Create selected** and **Create all (N)**; Left/Right focuses an action and Enter activates it, so individual creation remains the default.

**Create all** coordinates every supported recommendation in the report. Farrier plans file recommendations and authors skill recommendations concurrently, with at most three backend jobs running at once. The backend recorded in `report.backend` authors every job, including skills; target vendors and session sources never select the authoring backend. Model and reasoning settings for that backend are reloaded when the batch starts, and a backend failure is reported without falling back to the other agent. Unsupported/manual routes such as unverified plugin installation are retained in the result as **skipped** with an explanation. Each recommendation shows queued/running progress followed by **planned**, **created**, **skipped**, **failed**, or **cancelled**; retry runs only failed/cancelled work and preserves successful work.

Concurrent backend work does not mean concurrent filesystem commits. Skill-creator output stays in disposable staging and becomes reviewed project files; cancellation before confirmation leaves no project artifact. Farrier rejects different plans for the same path as an explicit conflict instead of choosing a last writer. All conflict-free results appear in one aggregated review with the exact create/update/replace manifest and complete paged content previews. Nothing is written until confirmation. One transaction then applies the reviewed files, retains backups for replacements, detects changes since review, and rolls back on failure. Any creator installation or other lock-sensitive preparation is serialized.

While batch planning/authoring runs, Ctrl+C or Command-Z requests cancellation through the batch's one abort signal, stops queued work, terminates running backend process groups, and waits for all jobs to settle. A cancellation arriving after the atomic file transaction begins does not interrupt it mid-commit; the transaction finishes or rolls back first. OpenTUI exposes Command as the `super` modifier, so the binding is `super+z`, never plain `z`. The host terminal must deliver an enhanced Super-modified key event (for example through the Kitty keyboard protocol); terminals that intercept Command-Z or cannot encode Super will not deliver it, and Ctrl+C remains the portable cancellation key. Headless users continue to choose with `--backend claude|codex`; headless advice remains report-only, progress stages go to stderr, and `--json` stdout remains valid machine-readable JSON.

Every accepted recommendation has a stable ID, category, one target provider, reason, benefit, validated evidence IDs, confidence, evidence origin, and a provider-supported implementation route. Registry references are meaningful only for skills, plugins, and MCP, where they must match an exact verified candidate; a misplaced ref on guidance, hooks, or subagents is stripped with a validation note so the otherwise valid local recommendation survives. Malformed, duplicated, unsupported, invented, or unsafe results are rejected with reasons. A broad report keeps the top two recommendations per applicable category; a focused category may return up to five. Valid items past that bound remain in `omittedRecommendations` with their ranking reason. There is no global recommendation target and no recovery call that fills missing categories. Hook output is declarative, and hooks that commit, push, publish, or deploy automatically are rejected.

Advice analysis is always read-only, and headless advice remains report-only. The interactive TUI may create one selected recommendation or a reviewed batch only after opening a separate review screen and receiving explicit confirmation; no report result is applied automatically. Human and JSON output remain two renderings of the same validated report.

Provider-native focused skill advice and the earlier skills.sh advisor use different spellings:

```bash
farrier advise skills --dir . --context ./docs/brief.md
farrier advise --dir . --only skills --backend codex --json
```

`--only skills` uses the full codebase profile, optional sessions, and provider policy. The `advise skills` subcommand is registry-only. The harness wizard searches skills.sh from deterministic capability queries. Its optional agent research starts only after the user activates **Research with Claude/Codex**.

### `farrier skill new` — create a skill with each vendor's own skill-creator

Farrier does not own a skill-authoring prompt. It delegates to the vendor's recommended creator — Claude uses the pinned `anthropics/skills` **skill-creator** (installed into the target on first use, refreshed by `skills update`), Codex uses its **built-in `$skill-creator`** (ships with the codex CLI) — then deterministically validates the result (exactly one new kebab-case skill directory, parseable frontmatter, description ≤ 500 chars; frontmatter name repaired to match the directory) and installs it through the same `skills add` path as any third-party skill.

The wizard has a **Create** step (Stack → Skills → Create → Hooks → Learn → Review): describe the skill, check the target agents (`[x] claude [x] codex` — only agents whose CLI answers `--version` are selectable), and when both are checked, pick who authors:

- **Claude authors, install to both** — one canonical `skills/<name>/`, lock-tracked, installed via `skills add ./skills -a claude-code codex`.
- **Codex authors, install to both** — same, codex writes the canonical copy.
- **Each agent authors its own copy** — claude writes `.claude/skills/<name>/`, codex writes `.agents/skills/<name>/`; truest to each vendor, but the copies may diverge and are not lock-tracked.

Vague briefs make dumb skills, so the standalone create flow **asks first**: before authoring, farrier makes one read-only backend call (`claude -p` / `codex exec`) that proposes 2–4 concrete questions about whatever the description leaves open — language, specific libraries, input/output formats — each with recommended options, a "let the creator decide" escape hatch, and free-text input. Escape leaves a focused text field first; outside the field, Escape or `b` finishes the interview with the answers so far. Your answers are folded into the brief as an "Implementation decisions (follow these exactly)" block before it reaches the skill-creator. Toggle it off with the "ask clarifying questions first" checkbox; the wizard's Create step asks the same questions at queue time. Headless `farrier skill new` asks only with `--refine` (interactive: numbers pick options, free text is used verbatim, empty lets the creator decide) — otherwise put the decisions in the description yourself. If the authored skill's directory already exists, the standalone flow and the harness wizard both pause with the shared confirmation grammar: `y` replaces it, while `n` or Escape keeps the existing copy (the new one stays in `.farrier-staging/`); headless replaces only with `--force`.

You don't need the harness wizard to create a skill: choose **Find/Create skills** from bare `farrier`, or run bare `farrier skill new` (optionally with `--dir`) to open the same standalone flow directly: describe → check agents → Create → per-skill results.

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

Projects generated with `--with-advisors` carry `.claude/skills/harness-advisor/SKILL.md`, so the *in-session agent* knows this loop too: it runs `farrier update` when it notices new file types, suggests skills.sh searches for new frameworks, points at `skill-creator` when you repeat yourself, and refuses to hand-edit `.farrier.json`.

Generated projects also carry provider-specific automation recommenders. Both use the same `farrier advise --sessions auto --since 7d` orchestration, but Claude and Codex have separate policies, routes, artifact paths, and reference catalogs. The Claude skill includes Anthropic's upstream `claude-automation-recommender` from commit `a5c7fb5d86a4cd34c4f47819658654c3d8f08dda` unchanged under `upstream/`, together with every reference file, the Apache-2.0 license, source provenance, and per-file SHA-256 hashes. The Codex skill documents `.agents/skills`, `agents/openai.yaml`, Codex plugins and hooks, `.codex/config.toml`, `.codex/agents`, and MCP.

---

## Stacks

| `--stack` | Detected from | Notes |
|---|---|---|
| `python-uv` | `pyproject.toml` | Base Python: uv + ruff + pytest |
| `python-fastapi` | + `fastapi` dep | Adds layering convention (core ⊬ api) |
| `python-lambda-powertools` | + `aws-lambda-powertools` dep | "No live AWS calls in tests" rules |
| `ts-base` | `package.json` + `tsconfig.json` | bun + tsc |
| `ts-react-vite` | + `react` & `vite` deps | |
| `ts-nextjs` | + `next` dep | |
| `ts-lambda` | `aws-cdk-lib` dep or `template.yaml`/`samconfig.toml` | |
| `rails` | `Gemfile` with `rails` | Verbs gated on `rubocop`/`rails` in the Gemfile; **hotwire secondary detection** suggests JS skills |
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
bun run test:evaluations # prospective evidence contracts + typecheck
bun run check         # all of the above — the verb the harness itself would run
just eval-smoke       # one live cell per fixture repo: harness generates, agent runs, hooks fire
```

`test:evaluations` checks the frozen protocol, snapshot isolation, prompt delivery, event provenance, independent-audit parity, rescue accounting, adversarial forgery cases, and result aggregation in [`src/engine/evaluations/`](src/engine/evaluations/). It validates fixtures, not scored runs; no Farrier CLI command launches or records the study, and the Codex prompt proof establishes byte inclusion rather than model reliance or outcome improvement. Live grids remain local artifacts and are not tracked.

Architecture in one breath: **packs are declarative data** (`src/packs/`), the **engine** renders, detects, updates, migrates, evaluates, learns, and doctors (`src/engine/`), **hook templates** are self-contained Python scripts with tests (`src/templates/hooks/`), and the **TUI** is a pure reducer (`src/tui/machine.ts`, zero opentui imports) with thin opentui-react components around it.

## Portability rule

A generated harness must run for anyone who installs farrier, so no pack may name a machine-local path or an unpublished package. A render test asserts it across every pack: an absolute path or a private tool in a verb makes the Stop gate unpassable for every user but its author. Structure linting was removed for exactly this reason.
