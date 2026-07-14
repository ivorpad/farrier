# Farrier Harness Quality and Safety Repair Plan

## Goal

Make every harness Farrier creates and maintains exceptionally correct, safe, enforceable, reviewable, reproducible, and evidence-backed. Repair every existing workflow in place: create/detect, generated harnesses, hooks/verification, doctor, update, learn, advice, skill search/install, skill authoring/refinement/evaluation, registries, advisor skills, TUI, and headless/JSON.

Do not remove workflows. Do not add commands, feature families, product surfaces, stacks, vendors, or unrelated capabilities. Internal safety primitives, validation, tests, provenance, and evidence are in scope only where they strengthen existing behavior. TUI work is limited to correctness, trust, and verification in existing flows.

## Background

- Creation already has the strongest mutation model: inspected paths, fingerprints, staging, revalidation, backups, rollback, and explicit incomplete-rollback reporting (`src/engine/create-plan.ts`, `src/engine/create-plan-apply.ts:198-264`, `src/engine/create-plan-fs.ts`). Update, learn, registry caching, skill placement/manifest recording, and evaluation winner resolution bypass parts of it (`src/engine/update.ts:660-724`, `src/engine/learn.ts:1048-1101`, `src/registry/client.ts:378-392`, `src/engine/create-skill.ts:234-261`, `src/engine/eval-skill.ts:313-394`).
- Project configuration can replace registry destinations while registry request headers expand ambient environment variables, creating a credential-to-untrusted-destination boundary (`src/config/farrier-config.ts:256-279`, `src/registry/client.ts:240-263`).
- Remote registry hooks pass schema validation and then become executable generated files; their source, exact reviewed bytes, redirect path, cache identity, runtime digest, and timeout are not one enforced chain (`src/registry/schema.ts:44-76`, `src/engine/render.ts:606-681`).
- Detection, catalog ordering, rendered capability language, doctor, update, documentation, and Farrier dogfooding do not share one capability truth (`src/engine/detect.ts:378-394`, `src/engine/render.ts:188-226`, `src/engine/doctor.ts:959-984`, `.farrier.json:2-7`).
- Advice and learn cite or mine evidence, but do not prove improvement against the same bounded before/after corpus; transcript redaction is narrow (`src/engine/advice-patterns.ts:41-49`, `src/engine/learn.ts:960-1101`).
- Skill search/install, authoring, placement, and evaluation cross external-process and filesystem trust boundaries with inconsistent isolation, timeouts, provenance, and rollback (`src/engine/skills.ts`, `src/engine/create-skill.ts:275-379`, `src/engine/eval-skill.ts:295-394`).

## Research-Derived Quality Bar

Primary guidance from OpenAI, Anthropic, NIST SSDF, SLSA, and the OpenSSF Baseline converges on a layered harness: concise durable instructions, least privilege, sandboxing distinct from approvals and hooks, deterministic local/CI parity, bounded delegation, reproducible setup, immutable provenance for executable inputs, adversarial evaluation, and machine-checkable completion evidence.

For this repair, “exceptionally well-built” means:

- For each generated harness, the existing noninteractive aggregate recipe invokes 100% of mandatory generated checks, the same recipe is exercised locally and in CI fixtures, and every documented generated command is exercised in clean fixtures. Farrier repository acceptance remains `just check` plus `just konsistent` as required by `AGENTS.md`.
- Every blocking hook has allow, deny/block, malformed-input, malformed-config, timeout, and actionable-remediation tests.
- Checked-in seeded-secret and out-of-root mutation corpora have zero catastrophic escapes; fixed regressions stay at 100%; adversarial false allows are at most 1%; safe-corpus false blocks are at most 2%. No held-out-study infrastructure is added in this milestone.
- Remote executable bytes have source-bound provenance from fetch/cache through review, manifest, apply, runtime, doctor, and update.
- New or bundled Farrier-authored skills have positive and negative behavioral cases; legacy and third-party skills retain the existing workflow with an explicit evidence warning.
- Learn, advice, and skill evaluation compare the identical bounded dataset before and after a proposed change and report improvement, regression, or inconclusive evidence without inventing success.
- Human CLI, JSON, and TUI surfaces report the same operation, trust facts, mutation state, partial failure, recovery path, and remediation wherever that workflow exists.

These percentages are milestone engineering gates informed by the cited guidance, not claims that the sources prescribe Farrier-specific thresholds.

## Approach

Use creation’s reviewed transaction as the internal baseline, then repair weaker lifecycle paths around four shared contracts:

1. A typed internal capability projection extracted from existing pack and hook data, with explicit consumers in detection, render, doctor, update, documentation generation, and review; it is not a new public configuration surface.
2. A closed internal mutation-operation contract extracted beneath the existing create APIs, with inspected fingerprints, commit-step revalidation, backup/rollback semantics, and strongest-available isolation for external execution.
3. Executable verification and comparable behavioral evidence for hooks, doctor, skills, learn, and advice.
4. Additive, backward-compatible reporting across existing CLI/TUI/JSON surfaces, followed by documentation and dogfood convergence.

Preserve existing user jobs and old manifests/third-party skills through explicit compatibility handling. Safety corrections may fail closed with precise remediation, but the repaired final workflow must remain available. Do not retain unsafe direct-write fallbacks.

## Work Items

### - [x] 1. Bind capability truth, registry trust, provenance, and review

**Depends on:** nothing. This contract must land before lifecycle mutation and evidence work consume it.

**Repair seams:** `src/config/farrier-config.ts`, `src/registry/{client,catalog,ref,schema}.ts`, `src/packs/{types,index}.ts`, `src/engine/{detect,render,create-plan}.ts`, `src/cli/{create,registry}.ts`, and the existing TUI review data path.

**Work:**

- Carry registry configuration scope and source path internally. Project-controlled entries must never attach provider-default ambient tokens or expand credential-bearing headers; private registries continue through the existing user-config surface. Errors name the namespace/config and remediation without revealing values.
- Validate every fetch hop, bound redirects and time, prevent credentialed cross-origin redirects, bind cache entries to normalized source identity and payload digest, write cache data atomically, and reject corrupt or cross-source fallback.
- Separate exact pinned resolution from latest-catalog drift. Preserve old manifests as source-unbound legacy input with warnings and explicit safe migration; never silently bind old bytes to a different source.
- Validate registry references, duplicates, content bounds, and executable metadata before catalog insertion. Carry registry ref, version, source identity, and content digest through render, human/JSON/TUI review, manifest, and apply; revalidate that the committed bytes are exactly the reviewed bytes.
- Derive built-in detection order, explicit-only behavior, supported agents, actual hook mappings, and limitations from a closed typed internal projection of existing pack/hook definitions. Name and test each consumer so detection, render, doctor, update, and generated claims cannot reinterpret it independently. Preserve every existing pack and agent.
- Preserve currently compatible remote-hook bindings while requiring explicit payload/event compatibility for any broader binding. Work Item 1 supplies exact reviewed bytes and digests; Work Item 3 owns bounded runtime execution and failure behavior. Do not add a user-facing registry or hook workflow, and do not disable a working one merely because broader compatibility is unproven.

**Acceptance gates:**

- Project credential forwarding and credentialed cross-origin redirects are rejected before network I/O; user-config private registries continue to work; no secret value appears in logs, errors, JSON, cache metadata, manifests, or review output.
- Public registry, private user registry, exact offline pinned resolution, corrupt-cache rejection, source collision, legacy-pin migration, latest drift, and remote-executable review are covered in existing config/registry/catalog/render/create/CLI/TUI suites.
- CLI human, JSON, and TUI review expose identical executable provenance and complete payload/diff data, and apply refuses changed bytes.
- Built-in detection and rendered Claude/Codex claims are generated from the same tested capability contract; no pack, registry, advisor, CLI, or TUI workflow disappears.

### - [x] 2. Make all existing mutations transactional and external execution isolated

**Depends on:** Work Item 1 provenance and compatibility shapes.

**Repair seams:** `src/engine/{create-plan-apply,create-plan-fs,update,learn,skills,create-skill,skill-creation-plan,eval-skill}.ts`, registry cache writes, manifest/lock recording, and their existing CLI/TUI callers.

**Work:**

- Extract creation’s low-level inspect/apply primitives beneath compatibility adapters for the existing create APIs. Use a closed operation set for file writes, tree replacement/removal, and reviewed in-root links. Inspection captures expected absence or content/type/mode fingerprints; each documented commit step revalidates those fingerprints; replacements are backed up; reverse rollback restores only unchanged transaction outputs and otherwise reports the exact retained recovery path.
- Move update and learn from direct writes to a single reviewed transaction per accepted operation. Preserve user-mutable files, report-only defaults, duplicate learn idempotence, and existing confirmation semantics.
- Move skill placement/collision, install outputs, lock and manifest recording, and evaluation winner resolution onto the same transaction. A failed multi-file phase leaves all old or all new state, or an explicit incomplete rollback with recovery material.
- First inventory the existing supported external CLIs for native sandbox/write-root controls. Always run skill search/install, authoring, and evaluation from a fresh temporary workspace outside the target project with minimal copied inputs, timeout/cancellation, a scrubbed environment allowlist, output allowlists/snapshots, and cleanup; use native confinement when the installed existing CLI supports it. Never describe a temporary `cwd` as an OS sandbox. If native confinement is unavailable, preserve the workflow through staged output plus before/after target fingerprints, mandatory review, and an explicit residual-risk fact; do not silently return to direct project mutation and do not disable the workflow solely for lacking a new sandbox dependency.
- Keep creation’s existing partial outcome when the harness commits but optional skill installation fails; make each phase internally atomic and truthfully reported.

**Acceptance gates:**

- Failure injection after every commit step proves all-old/all-new state or explicit recoverable rollback; concurrent edits, parent substitution, symlink traversal, unexpected output, cancellation, and rollback conflict never overwrite user data.
- Update never includes user-mutable drift and is idempotent; learn rejects read/modify/write races and a second identical apply writes nothing.
- Malicious fake skill/author/eval processes attempting target-project writes, traversal, special files, uncontrolled environment access, lock races, or unexpected outputs are detected in the bounded fixture corpus and cause no accepted project mutation; reports state whether isolation used native confinement or staged best-effort isolation.
- Existing create, update, learn, skill search/install, author/refine/eval, winner-resolution, CLI, TUI, and JSON tests remain present and pass.

### - [x] 3. Make hooks, doctor, skills, learn, and advice prove behavior

**Depends on:** Work Items 1 and 2 for provenance, isolation, and safe apply.

**Repair seams:** `src/templates/hooks/*.py` and matching tests, `src/engine/{doctor,skill-validate,create-skill,refine-skill,eval-skill,eval-judge,advice-patterns,advice-sessions,project-advice,advice-apply,advice-batch,learn}.ts`, generated advisor skills, and existing reports.

**Work:**

- Give existing generated hooks one strict runtime contract: bounded payload/output, event validation, normalized paths, timeouts, privacy-safe actionable errors, fail-closed blocking/stop behavior on malformed selected input/config/internal failure, and non-destructive PostToolUse feedback.
- Repair secret shielding, tool policy, write protection, deterministic verification, and disabled-by-default semantic judges against safe and adversarial corpora. Claims must stop at actually intercepted tools/events; ambiguous recognized mutations fail closed, while unsupported paths are stated honestly.
- Keep doctor diagnostic: statically verify the exact pinned inventory, permissions/digests, presence and integrity of generated hook tests, required just-recipe definitions, structure/policy schemas, installed skill provenance/cases, and capability bindings. It must not become a project test runner; generated-fixture acceptance tests execute the recipes and hook suites with explicit timeouts.
- Define the evidence contract once at the start of this item: each workflow owns a redacted, size-bounded input set derived from its existing candidates/evidence, records its digest, and reuses that exact set before and after. Learn, advice, and skill evaluation share the comparison/result semantics, not one cross-workflow dataset.
- Require positive and negative behavioral cases for newly authored and bundled Farrier skills and evaluate them in temporary workspaces before neutralized swapped-pass judging. Preserve legacy/third-party search, install, and static evaluation with an explicit “behavior cases unavailable” warning.
- Redact and bound session evidence before backend invocation. For learn, advice apply/batch, and skill evaluation, return improved, regressed, or inconclusive evidence against the workflow-owned identical input set. Backends may select from existing deterministic checks but may not inject arbitrary commands.
- Make the selected advice backend a strict provider boundary: Claude analysis consumes only Claude sessions and targets Claude; Codex analysis consumes only Codex sessions and targets Codex. Filter before recurrence detection and backend invocation, carry provider identity in evidence provenance, report selected-provider funnel counts, and deterministically reject opposite-provider evidence, routes, or created artifacts. Preserve neutral/shared routes and artifacts when they are genuinely compatible with the selected provider.

**Acceptance gates:**

- Every blocking hook satisfies the complete test matrix; seeded secret and out-of-root corpora meet the stated zero-escape, false-allow, false-block, and regression gates with stored deterministic fixtures.
- Clean generated fixtures for every existing built-in pack exercise every documented command and mandatory aggregate check; the generated aggregate invokes 100% of required generated checks through the same local/CI entry point.
- Doctor catches static hook/config, declared-timeout, missing-test-artifact, digest, skill-case, and capability mismatches with actionable remediation and no false claim that doctor executed runtime behavior; runtime failures are caught by the existing test/fixture path.
- Skill validation/evaluation covers positive, negative, legacy fallback, deterministic regression veto, judge disagreement, cancellation, and case evidence in existing human/JSON reports.
- Advice/learn tests prove redaction before backend use, identical before/after inputs, bounded evidence, inconclusive handling, and absence of raw transcripts, tokens, emails, or seeded secrets from prompts and JSON.
- Mixed-session advice fixtures prove provider purity in both directions: a dominant Codex corpus cannot influence a Claude report, a dominant Claude corpus cannot influence a Codex report, and no accepted recommendation targets or creates artifacts for a provider other than the selected backend.

### - [ ] 4. Close existing interface, documentation, and dogfood parity

**Depends on:** Work Items 1–3. This is the integration and compatibility pass, not a TUI redesign.

**Status:** Interface, documentation, and recovery-parity repairs are implemented and independently green. Dogfood acceptance remains open: Farrier detects this Bun/TypeScript repository as `ts-base`, but the protected `.farrier.json` still selects `python-fastapi`; two update previews are identical, and the existing update workflow deliberately will not switch packs. Applying that plan would generate the wrong Python harness, so the manifest was not hand-edited or regenerated unsafely. Current evidence: 452 Bun tests, 90 hook tests, TypeScript, Ruff, `just check`, `just konsistent`, and `git diff --check` pass; doctor remains unhealthy until an authorized pack-migration path exists.

**Repair seams:** existing command serializers and exit handling in `src/cli.ts` and `src/cli/*.ts`; existing review/apply components in `src/tui`; `README.md`, `docs/{registries,harness-model,PLAN}.md`; generated advisor skills; and the repository’s generated harness state.

**Work:**

- Additively serialize the same engine result across existing human, JSON, and TUI paths: preview/apply/report mode, trust/provenance, committed/not-started/rolled-back/incomplete state, partial outcome, warnings, evidence, recovery path, and remediation. Keep existing JSON fields and command/exit behavior unless a documented inconsistency is a correctness bug.
- Repair stale async TUI acceptance, fabricated apply results, truncated executable review, cancellation, and partial/recovery presentation inside existing screens. Do not change navigation, keymaps, layout system, launcher, or visual design.
- Update docs and generated advisor skills so every stated command, capability, limitation, trust boundary, and report/apply behavior matches tested output. Keep generated instructions concise, non-conflicting, and idempotent with `AGENTS.md` as the durable source of truth; remove overclaims, not useful workflows.
- Regenerate protected generated files only through the repaired Farrier workflow. Make Farrier’s own manifest reflect this Bun/TypeScript repository and prove that doctor/update agree with render/detection; do not edit `.farrier.json` by hand.

**Acceptance gates:**

- The same create, registry, update, doctor, learn, advice, skill install/author/refine/eval, partial-failure, cancellation, and rollback scenarios have parity assertions across every existing surface that exposes them.
- Generated permissions, hook bindings, environment exposure, and skills are no broader than the selected pack/agents require; regeneration produces concise, non-conflicting instruction snapshots with no unexplained drift.
- Every failure fixture asserts remediation names the failing artifact and an exact existing recovery/check command without leaking secret material.
- No existing command, workflow, pack, agent, registry facility, advisor skill, TUI route, or JSON domain field is removed; no new command, feature family, stack, vendor, or product surface appears.
- `just check` passes after edits and `just konsistent` passes before handoff, along with targeted hook/adversarial/CLI/TUI suites.
- A clean doctor run succeeds, and two consecutive repaired update reports are idempotent with no repairable drift.
- Final evidence records commands, test counts, corpus results, remaining limitations, and any accepted migration warning.

## Open Questions

None. The execution constraints are fixed: repair every current workflow, improve rather than subtract, add no user-facing capability, keep TUI changes functional, and do not run the external user study in this milestone.

## References

- Repository guidance: `AGENTS.md`, `docs/harness-model.md`, `docs/PLAN.md`, `docs/registries.md`
- [OpenAI Codex: AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [OpenAI: Hooks](https://learn.chatgpt.com/docs/hooks)
- [OpenAI: Agent skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI: Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [OpenAI: Sandboxing](https://learn.chatgpt.com/docs/sandboxing)
- [OpenAI: Designing agents to resist prompt injection](https://openai.com/index/designing-agents-to-resist-prompt-injection/)
- [Anthropic Claude Code: Memory](https://code.claude.com/docs/en/memory)
- [Anthropic Claude Code: Hooks](https://code.claude.com/docs/en/hooks)
- [Anthropic Claude Code: Agent skills](https://code.claude.com/docs/en/skills)
- [Anthropic Claude Code: Subagents](https://code.claude.com/docs/en/sub-agents)
- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [NIST SP 800-218, Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)
- [SLSA v1.2](https://slsa.dev/spec/v1.2/)
- [OpenSSF Open Source Project Security Baseline](https://baseline.openssf.org/)
