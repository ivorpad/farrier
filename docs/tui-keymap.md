# TUI keyboard contract

Farrier's interactive screens share one keyboard grammar. The implementation source of truth is `src/tui/keymap.ts`; screen hints are generated from the binding objects their handlers resolve.

| Intent | Keys |
| --- | --- |
| Move in the focused list | Up / Down |
| Change the focused control's value | Left / Right |
| Move between visible focus zones | Tab / Shift+Tab |
| Toggle the focused option | Space |
| Activate the focused row or action | Enter |
| Back, close a transient screen, or disarm | Escape / `b` |
| Quit outside text input | `q` |
| Interrupt running work and its process tree; quit while idle | Ctrl+C |
| Cancel advice batch planning/authoring | Command-Z (`super+z`) or Ctrl+C |
| Scroll a long report or preview | PageUp / PageDown |
| Retry or rerun | `r` |
| Confirm a destructive operation | `y` |
| Reject a destructive operation | `n` / Escape |

While text input is focused, ordinary letters and Space remain text. Escape leaves the field before it can navigate back. Enter may submit that field locally, but the skill-description field only moves focus and cannot submit the whole workflow.

Advice setup has five focusable controls: reasoning backend, project-session inclusion, session window, recommendation scope, and Analyze. Claude is initially selected when both reasoning backends are available; the sole installed backend is selected when only one is available, with the other labeled unavailable. The picker changes only the process used to analyze evidence, independently of recommendation target vendors, session evidence sources, lookback, and scope. Headless advice uses `--backend claude|codex`.

The advice report has a visible two-action row. **Create selected** remains focused by default; Left/Right focuses **Create all (N)** and Enter activates the focused action. Create all uses bounded concurrency (three backend jobs), but every planning and skill-authoring job uses `report.backend` with freshly resolved settings. Manual-only recommendations are shown as skipped. Different plans for one path become explicit conflicts. Conflict-free files are combined into one exact create/update/replace review, then applied only after confirmation by the existing transactional writer with replacement backups and rollback.

During advice batch planning/authoring, Command-Z is represented by OpenTUI as `{ name: "z", super: true }`; plain `z` is intentionally unbound. One owning AbortController feeds all running and queued jobs. Ctrl+C and Command-Z abort it once, stop new launches, terminate backend process groups, and wait for in-flight jobs to settle. If cancellation arrives after the atomic apply begins, Farrier lets that transaction finish or roll back. Super-modified keys require a host terminal that emits an enhanced key event, such as Kitty keyboard protocol input. Terminals or OS shortcuts that intercept Command-Z cannot deliver it; Ctrl+C remains available everywhere.

## Screen migration inventory

| Screen group | Previous behavior | Current behavior |
| --- | --- | --- |
| Launcher | Up/Down plus workflow-specific `h`, `c`, `a` shortcuts | Up/Down and Enter; Escape/`b` backs out; `q` or Ctrl+C quits |
| Harness Stack | Invisible button zone; Right and `n` advanced | One visible list; Up/Down selects and Enter continues |
| Harness Skills | Invisible button zone; `a`, Left/Right, and `n` navigated or activated | Input, advice, and skill-list zones only; Tab changes visible zone, Space toggles, Enter activates |
| Skill creation | Enter could submit while the description field was focused | Tab reaches visible action chips; Enter in the description only leaves the field |
| Hooks and Learn | Invisible button zones; Left/Right and `n` changed pages | Visible controls only; Space toggles and Enter continues |
| Harness review | Invisible button zone; `r` confirmed replacement | Up/Down inspects files, PageUp/PageDown scrolls preview, Enter arms replacement, `y` confirms, `n`/Escape rejects |
| Advice setup | Tab silently changed scope and controls lacked focus markers | All five controls, including Reasoning backend and Analyze, have a visible focus marker; Left/Right changes only the focused value |
| Advice report | `j`/`k` selected, `c` created, arrow keys scrolled | Up/Down selects, PageUp/PageDown scrolls, Left/Right focuses Create selected/Create all, and Enter activates |
| Advice creation review | `r` confirmed replacements | Enter arms, `y` confirms, `n`/Escape rejects; `r` is reserved for retry after errors |
| Refinement | `s` skipped; Escape always ended the interview, including inside text input | Up/Down and Enter choose; Escape leaves free text first, then Escape/`b` finishes questions |
| Evaluation verdict | `c`, `x`, and `k` made business decisions | A visible Up/Down list chooses Claude, Codex, or both; Enter activates |
| Collision and destructive prompts | Mixed `r`/`k`, Enter, and `y` conventions | Shared `y` confirmation and `n`/Escape rejection grammar |
| Running work | Cancellation varied by phase and killed only the root backend process | Ctrl+C aborts work; advice batches also accept delivered Command-Z (`super+z`); backend process groups ensure descendants terminate |
| Error and completion screens | Mixed letter shortcuts and implicit close keys | `r` retries errors; visible result actions use Up/Down and Enter; Escape/`b` closes and `q` quits |

The only intentional timing exception is an already-started transactional advice file commit: Ctrl+C or `q` records the request, lets the short atomic transaction finish or roll back, and closes immediately afterward. There is no model subprocess in this critical section.
