check:
  uv run --with ruff ruff check . && uv run pytest

test:
  uv run pytest

fmt:
  uv run ruff format .

konsistent:
  bun run konsistent
