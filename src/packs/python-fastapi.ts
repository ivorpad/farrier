import type { Pack } from "./types";
import { PYTHON_KONSISTENT_PATH } from "./python-uv";

export const pythonFastapiPack: Pack = {
  id: "python-fastapi",
  extends: "python-uv",
  detect: {
    pyprojectDependencies: ["fastapi"]
  },
  generator: {
    command: "uv",
    args: ["init", "--package"],
    onlyWhenEmptyDir: true
  },
  skills: [],
  hooks: [],
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
      },
      {
        name: "core-independent-of-api",
        description: "Domain/core modules never import the FastAPI layer.",
        paths: ["src/{pkg}/core/*.py"],
        mustNot: {
          importFrom: "{pkg}.api"
        }
      }
    ]
  },
  verbs: {
    check: "uv run ruff check . && uv run pytest",
    test: "uv run pytest",
    fmt: "uv run ruff format .",
    konsistent: `uv run --with ${PYTHON_KONSISTENT_PATH} konsistent check`
  }
};
