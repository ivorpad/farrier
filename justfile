check:
  uv run --with ruff ruff check . && uv run pytest

test:
  uv run pytest

fmt:
  uv run ruff format .

konsistent:
  bun run konsistent

# One smoke cell per repo: harness generates, agent runs, acceptance passes,
# hooks fire. Needs codex CLI + the fixture repos from repos.json. Minutes,
# not hours — full grids stay manual (see docs/evaluations/README.md).
eval-smoke:
  docs/evaluations/eval-kit-multi/eval-smoke.sh
