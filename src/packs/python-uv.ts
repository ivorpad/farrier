import type { Pack } from "./types";

export const PYTHON_KONSISTENT_PATH = "/Users/ivor/src/tries/2026-07-02-konsistent-python";

export const pythonUvPack: Pack = {
  id: "python-uv",
  detect: {
    files: ["pyproject.toml"]
  },
  generator: {
    command: "uv",
    args: ["init", "--package"],
    onlyWhenEmptyDir: true
  },
  skills: [
    "wshobson/agents@python-code-style",
    "wshobson/agents@python-project-structure",
    "wshobson/agents@python-testing-patterns"
  ],
  hooks: ["secret-shield", "tool-policy", "write-guard", "verb-runner", "quality-judge", "stop-judge"],
  toolPolicyRules: [
    {
      id: "python-use-uv-not-python-m-pip",
      description: "Python projects managed by uv must not install dependencies with python -m pip.",
      tool: "Bash",
      commandPattern: "(^|[;&|()\\s])python3?\\s+-m\\s+pip\\b",
      flags: "i",
      message: "Do not use python -m pip in this uv-managed project.",
      redirect: "Use `uv add <package>` for project dependencies, or `uv run --with <package> <command>` for one-off tools."
    },
    {
      id: "python-use-uv-not-pip-install",
      description: "Python projects managed by uv must not install dependencies with pip or pip3.",
      tool: "Bash",
      commandPattern: "(^|[;&|()\\s])pip3?\\s+install\\b",
      flags: "i",
      message: "Do not use pip or pip3 install in this uv-managed project.",
      redirect: "Use `uv add <package>` for project dependencies, or `uv run --with <package> <command>` for one-off tools."
    },
    {
      id: "python-run-scripts-through-uv",
      description: "Run Python scripts through uv so the project environment is active.",
      tool: "Bash",
      commandPattern: "(^|[;&|]{1,2}\\s*)python3?\\s+(?!-m\\s+)(?:\\./|/|[A-Za-z0-9_./-]+\\.py\\b)",
      flags: "i",
      message: "Do not run raw `python script.py` commands in this uv-managed project.",
      redirect: "Use `uv run python <script.py> ...` so the project environment and dependencies are active."
    }
  ],
  konsistentTemplate: {
    version: "v1",
    conventions: [
      {
        name: "packages-have-init",
        description: "Every source package is a regular package.",
        paths: ["src/{pkg}"],
        must: {
          haveType: "directory",
          haveFiles: ["__init__.py"]
        }
      }
    ]
  },
  konsistentTool: "konpy",
  verbs: {
    check: "uv run ruff check . && uv run pytest",
    test: "uv run pytest",
    fmt: "uv run ruff format .",
    konsistent: `uv run --with ${PYTHON_KONSISTENT_PATH} konpy check`
  },
  agentsRules: [
    "Use `uv` for Python dependency and command execution.",
    "Do not use `pip install`, `pip3 install`, or `python -m pip`; use `uv add` or `uv run --with` instead.",
    "Run Python scripts through `uv run python ...`, not raw `python script.py`."
  ]
};
