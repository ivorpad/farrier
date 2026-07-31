import type { Pack, PackDetect, PackVerbs } from "./types";

/**
 * Any one of the layouts pytest's default discovery finds a project's own
 * tests in. `globs` within a single detect are ANDed, so the alternatives have
 * to be separate branches. Deliberately anchored: a bare `**` + `test_*.py`
 * would also match the hook self-tests farrier writes under `.farrier/`, which
 * would make every generated harness look like it had a test suite.
 */
const pythonTestFiles: PackDetect = {
  any: [
    { globs: ["tests/**/*.py"] },
    { globs: ["test/**/*.py"] },
    { globs: ["src/**/test_*.py"] },
    { globs: ["src/**/*_test.py"] }
  ]
};

/**
 * Shared by every python pack. `uv init` produces neither ruff nor pytest, so
 * both are gated: a project that has not adopted them gets no gate rather than
 * one that fails with "Failed to spawn: ruff" on the first edit. Configuration
 * counts as evidence alongside a dependency entry, because the common uv
 * pattern is `uv run --with ruff` plus a `[tool.ruff]` table and no dependency.
 */
export const pythonUvVerbs: PackVerbs = {
  lint: {
    command: "uv run ruff check . --extend-exclude .farrier",
    when: {
      any: [
        { pyprojectDependencies: ["ruff"] },
        { pyprojectTables: ["tool.ruff"] },
        { anyFiles: ["ruff.toml", ".ruff.toml"] }
      ]
    },
    evidence: "ruff is configured or declared"
  },
  test: {
    command: "uv run pytest",
    // Both halves are required. Installing pytest is not evidence that there
    // is a suite to run: pytest exits 5 on "no tests collected", so a repo
    // with the dependency and no tests yet would get a gate that fails on
    // every stop until someone writes the first test.
    when: {
      any: [
        { ...pythonTestFiles, pyprojectDependencies: ["pytest"] },
        { ...pythonTestFiles, pyprojectTables: ["tool.pytest.ini_options"] },
        { ...pythonTestFiles, anyFiles: ["pytest.ini", "tox.ini"] }
      ]
    },
    evidence: "pytest is available and the repository has tests"
  },
  fmt: {
    command: "uv run ruff format . --extend-exclude .farrier",
    when: {
      any: [
        { pyprojectDependencies: ["ruff"] },
        { pyprojectTables: ["tool.ruff"] },
        { anyFiles: ["ruff.toml", ".ruff.toml"] }
      ]
    },
    evidence: "ruff is configured or declared"
  }
};

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
  hooks: ["secret-shield", "tool-policy", "write-guard", "verb-runner"],
  ruleBlocks: [
    {
      id: "uv-managed",
      when: {
        anyFiles: ["uv.lock"]
      },
      evidence: "uv.lock exists",
      agentsRules: [
        "Use `uv` for Python dependency and command execution.",
        "Do not use `pip install`, `pip3 install`, or `python -m pip`; use `uv add` or `uv run --with` instead.",
        "Run Python scripts through `uv run python ...`, not raw `python script.py`."
      ],
      toolPolicyRules: [
        {
          id: "python-use-uv-not-python-m-pip",
          probe: "python -m pip install requests",
          description: "Python projects managed by uv must not install dependencies with python -m pip.",
          tool: "Bash",
          commandPattern: "(^|[;&|()\\s])python3?\\s+-m\\s+pip\\b",
          flags: "i",
          message: "Do not use python -m pip in this uv-managed project.",
          redirect: "Use `uv add <package>` for project dependencies, or `uv run --with <package> <command>` for one-off tools."
        },
        {
          id: "python-use-uv-not-pip-install",
          probe: "pip install requests",
          description: "Python projects managed by uv must not install dependencies with pip or pip3.",
          tool: "Bash",
          commandPattern: "(^|[;&|()\\s])pip3?\\s+install\\b",
          flags: "i",
          message: "Do not use pip or pip3 install in this uv-managed project.",
          redirect: "Use `uv add <package>` for project dependencies, or `uv run --with <package> <command>` for one-off tools."
        },
        {
          id: "python-run-scripts-through-uv",
          probe: "python scripts/farrier_doctor_probe.py",
          description: "Run Python scripts through uv so the project environment is active.",
          tool: "Bash",
          commandPattern: "(^|[;&|]{1,2}\\s*)python3?\\s+(?!-m\\s+)(?:\\./|/|[A-Za-z0-9_./-]+\\.py\\b)",
          flags: "i",
          message: "Do not run raw `python script.py` commands in this uv-managed project.",
          redirect: "Use `uv run python <script.py> ...` so the project environment and dependencies are active."
        }
      ]
    }
  ],
  verbs: pythonUvVerbs
};
