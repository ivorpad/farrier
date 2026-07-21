import type { Pack } from "./types";
import { PYTHON_KONSISTENT_PATH } from "./python-uv";

export const pythonLambdaPowertoolsPack: Pack = {
  id: "python-lambda-powertools",
  extends: "python-uv",
  detect: {
    pyprojectDependencies: ["aws-lambda-powertools"]
  },
  generator: {
    command: "uv",
    args: ["init", "--package"],
    onlyWhenEmptyDir: true
  },
  skills: [],
  hooks: [],
  verbs: {
    check: "uv run ruff check . --extend-exclude .farrier && uv run pytest",
    checkFast: "uv run ruff check . --extend-exclude .farrier",
    test: "uv run pytest",
    fmt: "uv run ruff format . --extend-exclude .farrier",
    konsistent: `uv run --with ${PYTHON_KONSISTENT_PATH} konpy check`
  },
  agentsRules: [
    "Do not make live AWS calls in tests.",
    "Prefer Powertools testing patterns, explicit Lambda event fixtures, and mocked AWS clients."
  ]
};
