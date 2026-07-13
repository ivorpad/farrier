---
name: harness-advisor
description: Advise on Farrier harness drift, stack changes, hooks, skills, and update workflow.
---

# Harness Advisor

Use this skill when the user asks about Farrier harness drift, stack changes, generated hooks, skill recommendations, or how to evolve this repository's agent harness.

## Operating rules

- Treat `.farrier.json` as Farrier-owned metadata. Never edit `.farrier.json` by hand.
- Inspect `.farrier.json` for:
  - `farrierVersion`
  - `agents`
  - `packIds`
  - `hookIds`
  - `secondaryAcknowledged`
  - `versions.hooks`
- Prefer Farrier commands over manual edits to generated harness files.
- Ask before running repair commands that write files.

## Drift workflow

1. Run a report-only update check:

   ```bash
   farrier update --dir .
   ```

   If `farrier` is not on PATH, use:

   ```bash
   bunx farrier update --dir .
   ```

2. For structured output, run:

   ```bash
   farrier update --dir . --json
   ```

3. If the user approves repairs, run:

   ```bash
   farrier update --dir . --yes
   ```

4. Explain that update mode:
   - reports stack drift without switching packs automatically,
   - repairs missing files, including a missing selected Claude/Codex binding,
   - repairs outdated Farrier-owned hook and harness-advisor files,
   - reports modified selected binding files and other user-mutable files for manual review,
   - preserves and ignores unselected vendor bindings,
   - acknowledges detected secondary findings,
   - does not install suggested skills automatically.

5. Use `farrier doctor --dir .` for static harness health checks and `farrier learn --dir .` to review transcript-derived tool-policy rule proposals.

## Skill recommendations

When new frameworks, file types, or secondary stacks appear:

- Search skills.sh with the CLI:

  ```bash
  skills find <query>
  ```

- Or use the API shape:

  ```text
  GET https://skills.sh/api/search?q=<query>
  ```

- Suggest relevant skills to the user, but do not install them without explicit approval.
- If repeated project-specific manual behavior appears, suggest creating a reusable skill with `skill-creator`.

## Advice boundaries

- Do not invent hook code.
- Do not rewrite Farrier-owned hook templates manually in the project.
- Suggest declarative Farrier updates, skill installation, or `skill-creator` for repeatable behavior.
- Keep user-customized files such as `AGENTS.md`, `CLAUDE.md`, `justfile`, `.gitignore`, selected `.claude/settings.json` / `.codex/hooks.json` bindings, `.claude/hooks/tool-policy-rules.json`, and the structure-check config (`konsistent.json` or `konpy.json`) under manual review when they drift.
