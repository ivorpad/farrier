# Farrier harness model — product vocabulary, gap analysis, next iteration

> Status: historical proposal / working note. Written 2026-07-03. Native Codex binding, provider-isolated advice, transactional lifecycle writes, provenance, and behavioral evidence were later implemented. The broader HarnessSpec proposal remains future work.
> Source inputs: `README.md`, `docs/PLAN.md`, `src/packs/types.ts`, `src/engine/render.ts`,
> `src/engine/backend.ts`, `.farrier.json`, and the research brief
> `~/Downloads/harness-farrier-whatever-cloud.md`.

## 0. TL;DR

Farrier today ships an excellent **protection + verification + context bundle**, scoped by
*stack*. It markets that bundle as a "harness," but the code has no first-class `Harness`
entity: the top-level unit is `Pack` (a stack profile), and the only variance axes are
*stack* and *registry source*. The research brief argues — correctly — that a **harness is an
operational contract** with more axes than stack: **surface** (local / cloud / remote),
**model/provider** (Opus 4.8 / Sonnet 5 / Fable 5 / GPT‑5.5·Codex), and a **work contract**
(goal, definition-of-done, evidence, delegation, autonomy, output shape). Those axes are
absent.

Fixing the *model first* (per the session brief) means: name the harness as the unit, name
its components, and make the missing axes explicit — before generating more assets. This doc
does that and sequences the build.

## 1. Vocabulary (settle this before writing more assets)

One sentence each. Use these words consistently in README, code identifiers, and TUI copy.

| Term | Definition | In code today |
|---|---|---|
| **Harness** | The complete, portable operational contract that turns a model into a reliable working agent on a specific surface: intent + done-definition + boot context + allowed tools + delegation rules + validation + safety/autonomy + exit criteria + output/evidence shape. | **Missing as an entity.** Approximated by `Pack` + the fixed set of rendered files. |
| **Pack** | A *stack profile*: how to detect a stack and which components/verbs/rules it implies (`python-fastapi`, `ts-nextjs`, …). One input to a harness, not the harness. | `src/packs/*` — this is the real unit today. |
| **Component** | A subordinate mechanism the harness composes: **skill, hook, subagent, verb, rule, prompt, memory/learn loop, eval**. None is "the product." | hooks (`src/templates/hooks`), skills (registry), verbs (justfile), tool-policy rules, judge prompts. |
| **Surface** | Where the agent runs: local CLI, cloud/background VM, remote-control. Changes what config/secrets/network exist at boot. | **Missing.** Everything assumes local Claude Code. |
| **Overlay** | A thin, composable modifier applied on top of the reusable core for a given surface or model/provider. | **Missing.** Backend model strings exist only for *judge/advisor CLI calls*, not the harness. |
| **Work contract** | The part of the harness that states goal, definition-of-done, required evidence, delegation policy, autonomy tier, output shape. | **Missing.** Generated `AGENTS.md` has Commands + Hard Rules + Accepted Risks — enforcement, but no goal/done/evidence. |

**The one conceptual decision (from the brief):** *a harness is not a collection of assets; it
is a specification of agentic behavior with validation built in.* Farrier's assets should be
generated **from** a harness spec, not **be** the harness.

## 2. The operational-contract model → what Farrier has

Seven dimensions a harness must express. Farrier is strong on 3, weak/absent on 4.

| # | Dimension | Farrier today | Verdict |
|---|---|---|---|
| 1 | **Persistent instructions / boot context** | `AGENTS.md` (source of truth) + `CLAUDE.md` pointer; harness-advisor skill; pinned skills. | ✅ Strong |
| 2 | **Tool policy / permissions / guardrails** | secret-shield, tool-policy (declarative bans + redirect), write-guard. | ✅ Strong |
| 3 | **Validation / definition-of-done gate** | verb-runner (`just check` on edit, konsistent at Stop), quality-judge, stop-judge. | ✅ Strong (enforcement), ⚠️ no *goal-level* done |
| 4 | **Goal + definition-of-done + evidence** | Not generated. No "what does done look like / what evidence to attach." | ❌ Missing |
| 5 | **Delegation policy (subagents)** | Nothing emitted. Claude auto-delegates; Codex only on request — harness is silent on both. | ❌ Missing |
| 6 | **Surface awareness (local/cloud/remote)** | Assumes local Claude Code. Cloud VM (clean clone, no personal config/secrets) is not modeled or verified. | ❌ Missing |
| 7 | **Model/provider overlay** | Only judge/advisor CLI model strings. No harness-level tuning for Opus/Sonnet/Fable/GPT‑5.5 prompting, autonomy, thinking, refusals. | ❌ Missing |

Note the happy accident: because Farrier only writes **repo‑checked‑in files**, its output is
already *cloud‑portable in practice* (a cloud VM cloning the repo gets AGENTS.md + `.claude/`).
But nothing **models or verifies** that — e.g. hooks are Claude-only and Codex-cloud gets prose
only; no CI is emitted so a non-Claude surface has no enforcement teeth.

## 3. Concrete problems found (broken / vague / missing / inconsistent)

Ranked by how much they undercut "the harness works."

1. **Farrier's own harness is mis-targeted (and the mandated check can't run).**
   `.farrier.json` declares `packIds: ["python-uv","python-fastapi"]`, so the generated
   `AGENTS.md` mandates `just check` / `just konsistent` running `uv run ruff … && uv run pytest`.
   But this repo is **TypeScript/bun**, there is **no `pyproject.toml`**, and **`just` is not
   installed** in this environment. The real, working verification is
   `bun test` + `tsc --noEmit` + `uvx pytest src/templates/hooks` (= `bun run check`, per
   `package.json` + README "Developing farrier itself"). An agent obeying AGENTS.md literally
   verifies *nothing about the TypeScript engine*. This is the dogfood equivalent of the
   product's core symptom. **Safe path to use in this repo: `bun run check` (or `bun test` +
   `bun run typecheck`).** *(Do not hand-edit `.farrier.json`/`AGENTS.md`; fix via detection —
   see §5.)*

2. **"Harness" means two different things.** README/marketing call the generated bundle "the
   harness"; the brief (and this doc) reserve "harness" for the operational contract. Until the
   vocabulary is one thing, every new asset deepens the confusion.

3. **No surface axis.** The brief's central risk: *cloud is not "your machine but remote."* A
   cloud/Codex session boots from a clean clone with no personal `~/.claude`, skills, or secrets.
   Farrier neither generates a cloud-appropriate overlay nor verifies cloud-readiness.

4. **No model/provider overlay for the harness itself.** Branch `model-config-and-polish` polishes
   *judge* model config (`backend`+`model` on `judge.perEdit`/`judge.stop`), not harness behavior.
   Opus 4.8 (xhigh, long-horizon, adaptive thinking), Sonnet 5 (budget-sensitive, new tokenizer,
   no manual extended-thinking), Fable 5 (always-on thinking, `reasoning_extraction` refusals,
   Opus fallback routing), and GPT‑5.5/Codex (outcome-first, short prompts, approvals) want
   *different* instructions. One voice for all is a documented anti-pattern.

5. **No work contract in generated `AGENTS.md`.** It carries Commands + Hard Rules + Accepted
   Risks. It does not carry goal, definition-of-done, or an evidence requirement ("state what you
   read, changed, verified, and what's still uncertain"). Codex's `/goal` and OpenAI's
   outcome-first guidance both reward this; its absence is why generated agents can do generic,
   unverified work and still "finish."

6. **No delegation policy.** Nothing tells Claude when to spin an Explore/Plan subagent, and
   nothing tells Codex that it must be asked explicitly. The harness is silent on one of the
   biggest reliability levers.

7. **Codex enforcement is bounded, not universal.** `render.ts` emits `.codex/hooks.json` only when Codex is selected and `.claude/settings.json` only when Claude is selected. Shared compatible scripts remain canonical. Released Codex interception still has gaps for `unified_exec`, native reads/search, and WebSearch, so AGENTS.md and the generated check recipe remain mandatory.

8. **Skills story is thin for a "skills product."** The dogfood pins three generic
   `wshobson/agents@python-*` skills; there is no curated catalog of **harness-component skills**
   (planner / verifier / explorer behavior patterns) nor the "viral/social/product" skills the
   objective calls for. Skill authoring is (correctly) delegated to vendor creators, but there is
   no *recommended set* per harness class.

## 4. Proposed model: `HarnessSpec = core + overlays`

Introduce a `HarnessSpec` as the top-level unit. A `Pack` becomes one input to it.

```
HarnessSpec
├── class:      "interactive-local" | "autonomous-cloud"     // start with exactly two
├── stack:      Pack (existing)                               // detection + verbs + rules
├── surface:    SurfaceOverlay      // local | cloud | remote — boot assumptions, network, secrets
├── model:      ModelOverlay        // opus-4.8 | sonnet-5 | fable-5 | gpt-5.5  — voice/autonomy/thinking
├── contract:   WorkContract        // goal template, definition-of-done, evidence rules, output shape
├── delegation: DelegationPolicy    // auto | suggested | explicit; which work leaves the main thread
├── autonomy:   AutonomyTier        // plan | contained-exec | broad-exec-with-review
└── components: { hooks[], skills[], verbs, rules[], prompts[], evals[] }   // existing machinery
```

Rules of the model:
- **Core is reusable; overlays are thin.** A surface/model overlay adds or rewrites a few
  instruction blocks and toggles a few components — it never forks the whole template.
- **Two classes first, not a matrix.** Ship `interactive-local` and `autonomous-cloud`; layer
  model overlays on top. Resist a full surface×model×stack grid on day one (brief's advice).
- **Everything still renders to checked-in data.** No new runtime magic; overlays are data that
  the existing tested renderer consumes. Keeps the "LLM proposes data, engine renders" invariant.

## 5. Next-iteration plan (sequenced, small increments)

Each step is independently shippable and green-testable with `bun run check`.

### Step A — Vocabulary + honesty pass (docs only, zero risk)
- Land this doc. Add a "Harness vs. Pack vs. Component" box to `README.md`.
- Fix Farrier's own dogfood target: re-detect this repo as `ts-base` so `.farrier.json`/`AGENTS.md`
  describe `bun run check`, not `just check`. **Do this by running detection + regenerate, not by
  hand-editing protected files.** Detection is *not* the bug — `ts-base` matches on
  `package.json` + `tsconfig.json`, both present here, and `python-uv` matches on `pyproject.toml`,
  which is absent; the Python target could only have come from an explicit
  `--stack python-fastapi` during early dogfooding. So the fix is a deliberate re-run of the wizard, and it
  raises a product question: should `farrier update` warn when the manifest's `packIds` no longer
  match what detection would choose (i.e. **manifest-vs-reality stack drift**)?

### Step B — Work contract in `AGENTS.md` (small, high-leverage)
- Extend `renderAgentsMd` with an optional **"Definition of done"** + **"Evidence to report"**
  section, sourced from a new `Pack.workContract?` / `HarnessSpec.contract` field (declarative
  strings, same pattern as `agentsRules`).
- Default evidence rule: *"When you finish, state what you read, what you changed, what you ran to
  verify, and what is still uncertain."* This is the single highest-ROI text change.
- Tests: extend `tests/render.test.ts` snapshot/assertions.

### Step C — Surface overlay (`local` vs `cloud`)
- Add `SurfaceOverlay` with two values. `cloud` overlay: assert repo-only config (no personal
  `~/.claude`), require secrets via env/`.env.example`, and **emit a CI check** (`.github/…` or a
  `farrier doctor` gate) so cloud/Codex get real teeth, not prose.
- `farrier doctor --surface cloud` verifies cloud-readiness (no absolute local paths — catches the
  konsistent-python path issue; no reliance on un-checked-in assets).
- Tests: doctor + render fixtures per surface.

### Step D — Model overlay (align with `model-config-and-polish`)
- Coordinate with the in-flight branch. Add `ModelOverlay` keyed by
  `opus-4.8 | sonnet-5 | fable-5 | gpt-5.5`, each contributing a small instruction block
  (autonomy/thinking/verbosity/refusal-handling) into `AGENTS.md` and choosing sensible judge
  defaults. Keep overlays data-only.
- Explicitly encode the anti-patterns from the brief (don't over-prompt Claude into tool
  overtriggering; keep GPT‑5.5 prompts outcome-first/short).

### Step E — Delegation policy block
- `DelegationPolicy` renders one `AGENTS.md` paragraph: for Claude, when to use Explore/Plan
  subagents; for Codex, that subagents are explicit-only. Ship as component text, not machinery.

### Step F — Component skills + prebuilt hooks catalog
- **Harness-component skills** (recommended per class, installed via existing `skills add` path):
  a *verifier/reviewer* pattern skill, an *explorer/investigator* skill, a *planner* skill — these
  encode the subagent roles the brief endorses without inventing new engine surfaces.
- **Product/viral/social skills** (the objective's ask): treat as normal skills authored by the
  vendor skill-creator + pinned; curate a short recommended list rather than hand-writing SKILL.md
  files into the repo (preserves the delegation invariant).
- **Prebuilt hooks**: candidate new builtin hooks — `evidence-gate` (Stop hook: block yielding
  until the turn's final message contains the required evidence sections), `cloud-portability-guard`
  (PreToolUse: warn on absolute-path / personal-config references). Adding a builtin hook touches
  `HookId`, `hookTemplateFiles`, `hookCatalogVersions`, `render.ts` wiring, `doctor`, `update`, and
  needs a pytest suite — **medium risk, do one at a time behind its own tests.**

### Step G — Eval loop hook-up (advanced, later)
- Wire `farrier learn` output and a lightweight eval set into a "harness improvement" report
  (traces → proposed component/overlay changes), matching the brief's continuous-improvement layer.
  Keep it report-only first.

## 6. Repo files likely to change (map for the next agent)

| Concern | Files |
|---|---|
| Model entity | `src/packs/types.ts` (add `workContract`, `surface`, `model` — or a new `src/harness/spec.ts`) |
| Render | `src/engine/render.ts` (`renderAgentsMd`, settings, new sections), `tests/render.test.ts` |
| Detection fix (dogfood) | `src/engine/detect.ts`, `tests/detect.test.ts` |
| Surface/CI + cloud verify | `src/engine/doctor.ts`, `src/cli/doctor.ts`, new CI template under `src/templates/` |
| Model overlays | coordinate with `model-config-and-polish`; `src/config/farrier-config.ts`, `src/engine/backend.ts` |
| New hooks | `src/templates/hooks/*` (+ `test_*.py`), `HookId` in `types.ts`, `render.ts`, `doctor.ts`, `update.ts` |
| Wizard copy | `src/tui/*Step.tsx` (surface/model/class pickers), `src/tui/machine.ts` (pure reducer + `machine.test.ts`) |
| Docs | `README.md` (vocabulary box), this file |

## 7. Verification path for THIS repo (important)

`AGENTS.md` is mandatory even while the protected dogfood manifest remains mis-targeted. Run its required gates and the repository's Bun gates:

```bash
just check
just konsistent
bun test
bunx tsc --noEmit
```

The `src/templates/hooks/*.py` files are generated hook templates and their colocated tests. Farrier's package check runs them with `uvx pytest src/templates/hooks`. The root `just check` remains required by AGENTS.md; the protected manifest cannot be retargeted by hand.

## 8. Open product questions (need Ivor's call before large build)

From the brief's "questions to resolve before implementing":
1. **Distribution scope** — is a harness shared per repo, per user, per org, per cloud env? (Drives
   what goes in checked-in files vs. server-managed policy.)
2. **Target surfaces v1** — commit to `interactive-local` + `autonomous-cloud` as the two classes?
3. **Invocation** — is harness/overlay selection manual, detected, or suggested?
4. **Validation contract** — what minimum evidence must a generated agent attach when it can't fully
   verify? (Sets the default Definition-of-done text.)
5. **Model matrix depth** — overlays for all four model families now, or Opus + GPT‑5.5 first?
