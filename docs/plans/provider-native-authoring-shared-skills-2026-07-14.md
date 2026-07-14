# Provider-Native Authoring and Shared Skills Plan

## Goal

Give Farrier one public author choice for agent-generated project artifacts: Claude authors Claude-native files and Codex authors Codex-native files. For skills intentionally shared by both, keep one real tree under `.agents/skills/<name>` and expose it to Claude through a reviewed relative symlink under `.claude/skills/<name>`.

## Background

- Project advice already enforces one provider for backend, session evidence, recommendation targets, and created artifacts, making the separately exposed `--targets` redundant (`src/engine/project-advice.ts:370-381`, `src/cli/advise.ts:40-68`).
- Standalone skill creation still models destinations and authorship through `--agents` plus `author-claude`, `author-codex`, or `per-agent`; single-author runs write `skills/<name>` and install copies, while advice writes directly to native roots (`src/cli/skill-new.ts:47-105`, `src/engine/create-skill.ts:341-437`, `src/engine/advice-apply.ts:253-276`).
- Native project roots are `.claude/skills` for Claude and `.agents/skills` for Codex (`src/engine/skill-paths.ts:23-32`). The mutation engine already supports reviewed in-root relative links, and evaluation winner resolution already replaces a losing native copy with a relative link transactionally (`src/engine/mutation-transaction.ts:20-24`, `src/engine/eval-skill.ts:358-425`).
- Current help and README still advertise multi-provider advice targets that the parser rejects (`src/cli.ts:39-61`, `README.md:260-291`).

## Open Questions

None at scaffold time. The builder should make compatibility, repeatable author selection, shared-skill collision handling, manifest/lock representation, TUI parity, and migration behavior explicit.

## References

- `README.md:70-89`, `README.md:287-342`
- `src/engine/backend.ts:51-82`
- `src/engine/advice-types.ts:132-151`
- `src/engine/advice-catalog.ts:16-66`
- `src/engine/skill-paths.ts:6-41`
- `src/engine/create-skill.ts:321-437`
- `src/engine/eval-skill.ts:338-425`
- `src/engine/mutation-transaction.ts:180-207`, `src/engine/mutation-transaction.ts:344-496`
- `tests/project-advice.test.ts`, `tests/create-skill.test.ts`, `tests/skill-new-cli.test.ts`, `tests/eval-skill.test.ts`
