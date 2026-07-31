import type { Pack } from "./types";
import { pythonUvVerbs } from "./python-uv";

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
  verbs: pythonUvVerbs
};
