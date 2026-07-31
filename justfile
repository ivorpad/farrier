check:
  uv run --with ruff ruff check . && uv run pytest

test:
  uv run pytest

fmt:
  uv run ruff format .

# One smoke cell per repo: harness generates, agent runs, hooks fire (grids stay manual)
eval-smoke:
  docs/evaluations/eval-kit-multi/eval-smoke.sh
