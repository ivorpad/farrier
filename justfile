check:
  uv run ruff check . && uv run pytest

test:
  uv run pytest

fmt:
  uv run ruff format .

konsistent:
  # Temporary local path dependency; upgrade path: git dependency, then PyPI.
  uv run --with /Users/ivor/src/tries/2026-07-02-konsistent-python konsistent check
