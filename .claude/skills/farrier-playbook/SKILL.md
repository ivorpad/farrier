---
name: farrier-playbook
description: "Process playbook distilled from the 2026-07-02-farrier build: 4 phased gate(s) (skeleton-before-features, vertical-slice-before-capabilities, evidence-before-complete, ...) with exit evidence per gate. Use when implementing or resuming a project on this stack."
---

# farrier-playbook

Distilled from the agent sessions that built 2026-07-02-farrier (2026-07-02 to 2026-07-23). Every gate below exists because skipping it cost real time on that build; per-gate rationale and evidence live in `references/gates.md` so a gate can be challenged instead of ossifying.

## Operating style (earned, do not regress)

- An explicit invocation means the user is ready; act, and reserve questions for irreversible decisions. Verbatim steer: "do it"

## Phases and gates

Run gates in order. A gate is a stop: the next phase does not start until the gate's exit evidence exists in the repo.
A gate with an exit check is not passed until `python3 gates/check.py <gate-id>` passes; gates without rules are review work the checker reports as SKIP.

### G1 skeleton-before-features
Build a navigable skeleton of the whole UI with placeholder data and get it approved before writing feature logic.
Binding (ios): SwiftUI screens with stub data, every route reachable; DESIGN_DIRECTION.md written first; screenshots light/dark at smallest and AX5 Dynamic Type.
- Steer (2026-07-15): "so whats the value a TUI would improve their life? i like the coolness of it but i agree with your last message"
- Failures: `git add` 38× across 9 session(s) (2026-07-03 to 2026-07-23)

### G2 vertical-slice-before-capabilities
A deterministic end-to-end path exists and passes before any AI or hardware-dependent feature is added.
Binding (ios): Golden path with deterministic fallbacks; no SpeechAnalyzer/FoundationModels/Vision yet.
- Steer (2026-07-15): "Skills discovery is deterministic by default. Claude/Codex research only runs after explicit activation and is cancellable. how"
- Steer (2026-07-15): "why didnt find anything"

### G3 evidence-before-complete
A feature is complete only with recorded evidence (proof, command, timestamp); bulk status changes are forbidden.
Binding (ios): Evidence-ledger row per feature plus manifest status rules; signing proven by codesign output on the built artifact, never metadata.
- Steer (2026-07-15): "/goal Make Farrier Advice a staff-engineer-grade harness audit that five independent staff/principal engineers, after hands-on use without coaching, unanimously choose to keep i..."
- Steer (2026-07-15): "Review all the code changes. Were there any improvements really? agent said • Repository profiling rejects symlinks, path escapes, special files, oversized files, and files chan..."
- Failures: `just check` 45× across 16 session(s) (2026-07-03 to 2026-07-23)
- Failures: `cat justfile` 26× across 5 session(s) (2026-07-22 to 2026-07-23)

### G4 one-task-one-session
One milestone per fresh session; durable state lives in the repo docs, not in chat memory. Long mixed sessions degrade the model.
Binding (ios): One chat (or worktree chat) per milestone; before ending a session, write plan progress and the ledger row so the next session boots from files.
Exit check: `python3 gates/check.py one-task-one-session` (run from this skill's directory; paths resolve against the repo root).
- Steer (2026-07-15): "review docs/plans/repository-harness-product-2026-07-14.md."
- Steer (2026-07-15): "What's worth implementing from this monastery?"

## After shipping

Write LESSONS.md: which steers were needed, what broke, which gate was missing or too weak. That file feeds the gate catalog and the next playbook version.
