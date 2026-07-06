# Project Agent Instructions

AGENTS.md is the source of truth for agent behavior in this repository.

## Commands

- Check: `uv run ruff check . && uv run pytest`
- Test: `uv run pytest`
- Format: `uv run ruff format .`
- Konsistent: `uv run --with /Users/ivor/src/tries/2026-07-02-konsistent-python konpy check`

## Hard Rules

- Do not read real `.env*` files or private key material; tracked examples such as `.env.example` are allowed.
- Use `uv` for Python dependency and command execution.
- Do not use `pip install`, `pip3 install`, or `python -m pip`; use `uv add` or `uv run --with` instead.
- Run Python scripts through `uv run python ...`, not raw `python script.py`.
- Do not directly edit protected generated/owned files: lockfiles, `.git/`, `skills-lock.json`, or `.farrier.json`.
- Run `just check` after edits.
- Run `just konsistent` before stopping.
- Keep files under `quality.maxFileLines` from `.farrier.json` unless there is a deliberate architectural reason.
- Keep generated hook scripts and their tests together.
- LLM semantic judge hooks are present but disabled by default in `.farrier.json`; deterministic checks still run where configured.
- Do not bypass Claude hooks; Codex and other agents must follow these rules from AGENTS.md and the justfile.

## Accepted Risks

- Python konpy currently uses a local path dependency:
-   `/Users/ivor/src/tries/2026-07-02-konsistent-python`
- Upgrade path: git dependency, then PyPI package.
- Until that upgrade, generated Python projects are portable only on machines with that path.
