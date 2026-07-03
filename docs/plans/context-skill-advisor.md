# Context-driven skill advisor ("agent advise")

Status: implemented 2026-07-02; revised 2026-07-03.

Post-implementation revisions (2026-07-03): registry searches run in parallel
(`Promise.allSettled`, per-query failures become notes); an explicit
`--context` flag auto-enables advise and research starts at wizard launch
(auto-detected PRP.md stays opt-in); codex gets no default `--model` (an
explicit model the account lacks fails silently — omit the flag to use the
account default); wizard chrome reworked (breadcrumb StepHeader, spinner,
★ recommendation badges, capped Review file list) and the duplicate
select-onSelect/keyboard handlers removed (Enter used to double-fire).

## Feature

When starting farrier, the user may optionally provide **project context** (a PRP
or any free text). When context is available and the user explicitly opts in,
farrier shells out to a detected agent backend (`claude -p`, else `codex exec`)
that researches the skills.sh registry and **proposes recommended skills** with
one-line reasons. The existing manual skills.sh search stays exactly as-is; the
advise option is **disabled by default** and never blocks the wizard on failure
(fail-soft, like `farrier learn`'s LLM fallback).

Research is two-phase and orchestrated by farrier (NOT agentic tool-use — the
`skills find` CLI has no machine-readable output, verified 2026-07-02):

1. **Queries**: prompt the backend with the context + stack → strict JSON
   `{"queries": ["...", ...]}` (2–4 short registry search queries).
2. Farrier runs each query through the existing `searchSkills()` HTTP API
   (`src/engine/skills.ts:66`), dedupes by ref, caps candidates at 30.
3. **Selection**: prompt the backend with context + the candidate list
   (ref/name/installs) → strict JSON
   `{"recommendations": [{"ref": "<source>@<skillId>", "reason": "..."}]}`.
   The prompt instructs: choose at most `maxRecommendations` (default 6),
   exact ref strings only, empty array if nothing fits.
4. Farrier **validates** every returned ref: must parse via the
   `<source>@<skillId>` shape (same rule as `parseSkillRef`,
   `src/engine/skills.ts:86`) AND be present in the candidate set. Drop
   violations and record them in `notes` — a hallucinated ref must never reach
   `installSkills` or the manifest.

Accepted recommendations join `selectedSkills` and flow through the existing
`createRenderPlan`/`renderManifest` path — **no changes to
`src/engine/render.ts` and no new manifest fields.**

## Context resolution

New helpers in the new engine module (see Files):

- `resolveContext({ targetDir, context, deps })`:
  - `context` provided and resolves to an existing file (try as-given, then
    relative to `targetDir`) → read it, `source: "file:<path>"`.
  - `context` provided but not a file → treat as literal text,
    `source: "text"`.
  - `context` absent → probe, in order: `PRP.md`, `PRP.txt`, `docs/PRP.md`
    inside `targetDir` → `source: "detected:<relative path>"`.
  - Nothing found → `undefined` (advise option is then unavailable/hidden).
  - Truncate context text to 16 000 chars; append a truncation note.
- `detectAgentBackend(deps)` → `"claude"` if `Bun.which("claude")`, else
  `"codex"` if found, else `undefined`. `--backend` overrides; if an explicitly
  requested backend binary is missing, the CLI errors (TUI never shows an
  unavailable backend).

## Backend invocation (mirror `src/engine/learn.ts:843-910`, do NOT modify learn.ts)

- claude: `["claude", "-p", "--model", model ?? "sonnet"]`, prompt via stdin.
- codex: `["codex", "exec", "--model", model ?? "gpt-5.5", "-s", "read-only",
  "-a", "never", prompt]` (sandbox/approval flags are deliberate: prompts need
  no tools; keeps non-interactive runs safe regardless of `~/.codex/config.toml`).
- JSON recovery: same trimmed-slice heuristic as `parseBackendJson`
  (`learn.ts:775-794`) — reimplement locally in the new module; leave learn.ts
  untouched (it is 1155 lines and frozen for this change; extracting a shared
  helper is an explicitly deferred follow-up, note it in the plan doc only).
- Non-zero exit / empty stdout / malformed JSON → throw `Error` with the
  backend name and stderr snippet; callers catch and surface as a warning.

## Files (hard constraint: every new/touched source file ≤ 500 lines)

**New: `src/engine/advise.ts`** — all logic above. Exports:
`AdviseBackend`, `SkillRecommendation = { ref, name, installs, reason }`,
`ResolvedContext = { text, source }`, `resolveContext`, `detectAgentBackend`,
`adviseSkills(input)`. Dependency injection everywhere, mirroring
`skills.ts`/`learn.ts`: a command-runner (`{cmd, cwd, stdin}` →
`{exitCode, stdout, stderr}`), a `search: (q) => Promise<SkillSearchResult[]>`
(default `searchSkills`), and `{ which, exists, readFile }` deps for
detection/context. Defaults use `Bun.spawn`/`Bun.which`/`node:fs` like the
existing modules.

**New: `src/cli/advise.ts`** — `parseAdviseArgs` + `runAdvise` for a new
report-only subcommand:

```
farrier advise --dir <target> [--context <path|text>] [--backend claude|codex] [--model <name>] [--json]
```

Prints backend, context source, queries used, and each recommendation as
`ref — reason (N installs)`, plus the install hint
(`npx skills add <source> -s <skillId>` or "re-run the farrier wizard").
`--json` emits `{ backend, contextSource, queries, recommendations, notes }`.
Exit 0 on success (including zero recommendations); exit 1 with a clear message
when no context or no backend is available. Follow the `--transcripts`/
`--backend` arg-parsing idiom from `src/cli.ts:263-306` (both `--flag value`
and `--flag=value` forms).

**Edit: `src/cli.ts`** (576 lines already — keep the diff ≤ ~25 lines):
dispatch `advise` in `main()` next to `update`/`learn`/`doctor`
(`src/cli.ts:541-551`), add the subcommand + `--context` lines to `usage()`,
and add `context?: string` to `RenderCliOptions` + `parseRenderArgs`. TTY
routing rule in `main()`: when stdout is a TTY and the parsed render options
contain **no** `--stack`/`--detect`/`--yes`/`--dry-run` (i.e. bare, or only
`--context`/`--dir`), launch the wizard, passing the context argument through.
Headless render behavior is otherwise unchanged.

**Edit: `src/tui/machine.ts`** (290 lines): add to `WizardState`:
`contextText?`, `contextSource?`, `adviseBackend?`, `adviseEnabled: boolean`
(initial `false` — this is the "optional disabled option"),
`adviseStatus: "idle" | "running" | "ready" | "error"`, `adviseError?`,
`recommendations: SkillRecommendation[]`. New events, mirroring the
`SKILL_SEARCH_*` triple and its stale-result guards (`machine.ts:183-216`):
`TOGGLE_ADVISE` (flipping off resets status/recommendations to idle/[]),
`ADVISE_STARTED` / `ADVISE_SUCCEEDED { recommendations }` /
`ADVISE_FAILED { error }` — SUCCEEDED/FAILED are ignored unless status is
`"running"` and adviseEnabled is still true. `SELECT_PACK` resets advise
results (recommendations were computed against the old stack). Extend
`CreateInitialWizardStateInput` with optional `contextText`/`contextSource`/
`adviseBackend`.

**Edit: `src/tui/app.tsx`** (275 lines): `runWizard(targetDir, options?)` gains
`{ context?: string }`; before mounting, await `resolveContext` +
`detectAgentBackend` (both failures tolerated → advise simply unavailable) and
pass results into `WizardApp` / initial state. New `useEffect` following the
Skills-search effect shape (`app.tsx:70-94`, guard + dispatch triple + the
Review effect's `cancelled` flag): fires when `step === "Skills" &&
adviseEnabled && adviseStatus === "idle"`, calls `adviseSkills`, dispatches
SUCCEEDED/FAILED. Wire the new SkillsStep props.

**Edit: `src/tui/SkillsStep.tsx`** (169 lines): add an advise section between
the search input and the results list, following the LearnStep toggle
precedent: when context + backend are available, a toggle line
`[ ] Agent advise (<backend>): recommend skills from project context` bound to
key `a` (any zone except `input`) and to Space/Enter when focused; when
unavailable, a dim hint `No project context (pass --context or add PRP.md) —
agent advise off`. Status line while running: `Researching skills with
<backend>…`; on error a warning line (search stays usable). Ready
recommendations merge into the existing `options` list as
`[ ]/[x] <name> — <reason>` with description `<ref> · agent recommended ·
N installs`, toggled with the existing `TOGGLE_SKILL` — recommendations are
**proposed, not auto-selected**. If the file approaches 500 lines, extract the
advise section as a sibling component; do not exceed the cap.

**Edit: `README.md`**: one concise section (~15 lines) documenting
`--context`, the wizard toggle, and `farrier advise`.

**Do NOT touch**: `src/engine/learn.ts`, `src/engine/render.ts`,
`src/engine/update.ts`, `src/engine/doctor.ts`, `src/packs/*`,
`skills-lock.json`, `.farrier.json`, `justfile`, hook templates, `.git/`.
No new dependencies. Do not run `git commit`.

## Prompts (verbatim starting points; keep JSON-only discipline like `buildProposalPrompt`, learn.ts:806)

Phase 1:

```
You are farrier's skill-research assistant. Return JSON only, with this exact shape:
{"queries": ["short search query"]}
- 2 to 4 queries, each 1-4 words, suited to a skills registry search (frameworks, tasks, domains).
- No prose, no markdown, no explanations.
Project stack: <packId>
Project description:
<contextText>
```

Phase 2:

```
You are farrier's skill-recommendation assistant. Return JSON only, with this exact shape:
{"recommendations": [{"ref": "<source>@<skillId>", "reason": "one short sentence"}]}
- Choose at most <maxRecommendations> skills from the candidate list below. Copy ref strings exactly.
- Recommend only skills genuinely useful for this project. If none fit, return {"recommendations": []}.
- No prose, no markdown.
Project stack: <packId>
Project description:
<contextText>
Candidates:
<JSON array of {ref, name, installs}>
```

## Tests (bun:test, strictly offline — no network, no real claude/codex/skills spawns; lean: parametrize and reuse fixtures, do not pad)

**New `tests/advise.test.ts`** (model on `tests/learn.test.ts` fakes and
`tests/skills.test.ts` naming — `<function> <behavior>` sentences):
- `resolveContext`: file via flag, literal text via flag, detected `PRP.md`
  (and precedence over `docs/PRP.md`), none found, truncation at 16 000 chars.
  Use `mkdtemp` dirs like learn.test.ts.
- `detectAgentBackend`: claude preferred, codex fallback, neither → undefined
  (fake `which`).
- `adviseSkills` happy path: fake runner returns queries JSON then
  recommendations JSON; fake `search` returns fixed candidates; assert exact
  claude cmd array + stdin prompt content, and exact codex cmd array including
  `-s read-only -a never` with prompt as trailing positional.
- Validation: refs not in the candidate set or malformed are dropped and noted.
- Failures: non-zero exit, empty stdout, non-JSON stdout → rejects with
  backend-named error. Dedup/cap of candidates across queries.

**Extend `tests/machine.test.ts`**: advise defaults off; TOGGLE_ADVISE on/off
resets results; STARTED/SUCCEEDED/FAILED transitions incl. stale-guard
(SUCCEEDED ignored when idle/disabled); SELECT_PACK clears recommendations.

**Extend `tests/cli-e2e.test.ts`** only if the existing harness makes it cheap
(e.g. `farrier advise` with no context in an empty tmp dir → exit 1 with clear
message; `--help` shows advise). No test may reach the network or spawn real
backends.

## Acceptance checks (run from the repo root; all must pass)

1. `bun test` — green, including all pre-existing tests unchanged.
2. `bunx tsc --noEmit` — clean.
3. `wc -l` on every new/edited file in `src/` and `tests/` ≤ 500.
4. `grep -rn "skills.sh\|fetch(" tests/` shows no live-network test (local
   `Bun.serve` fakes only, per existing convention).
5. `farrier advise --help` behavior via `bun src/cli.ts advise --help` prints
   usage and exits 0; `bun src/cli.ts advise --dir <empty tmp>` exits 1 with
   the no-context message (no backend call attempted).
6. Advise is off by default: `createInitialWizardState` returns
   `adviseEnabled: false`; nothing in the render/manifest output changes when
   the feature is unused.
