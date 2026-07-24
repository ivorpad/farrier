# Gate catalog (distilled)

Each gate carries a portable statement, a stack binding, the transcript symptom it was matched on, its catalog origin, and the evidence from 2026-07-02-farrier that selected it. Evidence stays inline so a gate can be challenged later instead of ossifying.

## skeleton-before-features
- Portable: Build a navigable skeleton of the whole UI with placeholder data and get it approved before writing feature logic.
- Binding (ios): SwiftUI screens with stub data, every route reachable; DESIGN_DIRECTION.md written first; screenshots light/dark at smallest and AX5 Dynamic Type.
- Symptom: The user rejects UI quality after features already exist; a redesign is demanded mid-build.
- Catalog origin: "the UI is stupidly shitty as you haven't used any of the skills" (day 1), "they're looking really awful and off", "extremely confusing" (day 2). The redesign consumed the second afternoon; complaints stopped once the screenshot review loop existed.
- Evidence from this project:
  - Steer (2026-07-15): "so whats the value a TUI would improve their life? i like the coolness of it but i agree with your last message"
  - Failures: `git add` 38× across 9 session(s) (2026-07-03 to 2026-07-23)
## vertical-slice-before-capabilities
- Portable: A deterministic end-to-end path exists and passes before any AI or hardware-dependent feature is added.
- Binding (ios): Golden path with deterministic fallbacks; no SpeechAnalyzer/FoundationModels/Vision yet.
- Symptom: Capability bugs and product bugs are entangled; nothing works while everything is half-integrated.
- Catalog origin: Crystallized in WalkLedger's CODEX_GOAL milestone ordering ("reliability floor + App Review fallback").
- Evidence from this project:
  - Steer (2026-07-15): "Skills discovery is deterministic by default. Claude/Codex research only runs after explicit activation and is cancellable. how"
  - Steer (2026-07-15): "why didnt find anything"
## evidence-before-complete
- Portable: A feature is complete only with recorded evidence (proof, command, timestamp); bulk status changes are forbidden.
- Binding (ios): Evidence-ledger row per feature plus manifest status rules; signing proven by codesign output on the built artifact, never metadata.
- Symptom: "Done" claims that unravel on inspection; archive metadata claiming signatures codesign cannot find.
- Catalog origin: WalkLedger's signing-proof incident and its forbidden_shortcuts list.
- Evidence from this project:
  - Steer (2026-07-15): "/goal Make Farrier Advice a staff-engineer-grade harness audit that five independent staff/principal engineers, after hands-on use without coaching, unanimously choose to keep i..."
  - Steer (2026-07-15): "Review all the code changes. Were there any improvements really? agent said • Repository profiling rejects symlinks, path escapes, special files, oversized files, and files chan..."
  - Failures: `just check` 45× across 16 session(s) (2026-07-03 to 2026-07-23)
  - Failures: `cat justfile` 26× across 5 session(s) (2026-07-22 to 2026-07-23)
## one-task-one-session
- Portable: One milestone per fresh session; durable state lives in the repo docs, not in chat memory. Long mixed sessions degrade the model.
- Binding (ios): One chat (or worktree chat) per milestone; before ending a session, write plan progress and the ledger row so the next session boots from files.
- Symptom: Context compactions piling up mid-session; error rate climbing with session length; one session mixing scaffold, UI, and release work.
- Catalog origin: The 62MB day-1 WalkLedger session hit 17 context compactions, 239 build runs, and ~30 failed builds while mixing everything; later single-purpose sessions ran 0-3 errors each.
- Evidence from this project:
  - Steer (2026-07-15): "review docs/plans/repository-harness-product-2026-07-14.md."
  - Steer (2026-07-15): "What's worth implementing from this monastery?"
## execute-dont-interrogate (style rule)
- Portable: An explicit invocation means the user is ready; act, and reserve questions for irreversible decisions.
- Binding (ios): Lives in the playbook operating style, not as a phase.
- Symptom: The user snaps at clarifying-question menus.
- Catalog origin: "when i invoke the skill is coz im ready. no questions asked."
- Evidence from this project:
  - Steer (2026-07-15): "do it"
  - Steer (2026-07-15): "fix fully"

# Proposed catalog entries

## single-harness-backend-per-project (PROPOSED — not yet in the gate catalog; review before relying on it)
- Portable: Commit to one agentic coding backend/provider for a project or task span; don't interleave sessions from multiple backends mid-build, since that fragments both the build process and any evidence later used to reason about it.
- Binding: For Farrier: a build task declares Claude Code or Codex CLI up front and stays on it until the task completes; session evidence used for analysis is not silently pooled across providers.
- Symptom: The user explicitly bans switching backends mid-project ('use codex for all. no claude') or flags mixed-provider sessions as unreliable for analysis ('we're mixing Codex with Claude... not a good start').
- Rationale: No catalog gate addresses agentic-backend consistency; 'one-capability-per-change' covers integrating external libraries into a change, not which AI tool builds the change. The user's explicit backend ban (idx2) and repeated complaint about mixed-provider sessions (idx17/34/51) show this is a distinct, recurring failure mode.
- Evidence from this project:
  - Steer (2026-07-20): "use codex for all. no claude"
  - Steer (2026-07-15): "Also we're mixing Codex with Claude. I don't think that's a good start. Should be able to extract from sessions we want."
## cost-budget-gate-before-heavy-run (PROPOSED — not yet in the gate catalog; review before relying on it)
- Portable: Before launching a multi-call, multi-agent, or long-running job that spends real money/tokens, surface an upfront cost/scope estimate (and a cheaper single-call alternative if one exists), and expose live progress so the user isn't left guessing.
- Binding: For Farrier: the harness-audit deep/multi-worker mode reports an estimated call count and offers a quick single-model-call mode before running, and shows progress percentage during the run.
- Symptom: The user warns about token spend twice and demands an ack ('careful consuming real claude tokens you will break my bank'), asks for progress mid-run ('at what % we are'), and separately asks whether a cheaper single-call mode exists ('1 model call for all advises?').
- Rationale: Adjacent to 'human-stop-gate-irreversible' but distinct: that gate is a discrete per-action approval before an irreversible/money action, while this evidence is about visibility and budgeting for an ongoing multi-call spend with no natural single approval point. No catalog gate covers cost/progress transparency for heavy automated runs.
- Evidence from this project:
  - Steer (2026-07-15): "carefull consuming real claude tokens you will break my bank"
  - Steer (2026-07-15): "carefull consuming real claude tokens you will break my bank. ack this please"
