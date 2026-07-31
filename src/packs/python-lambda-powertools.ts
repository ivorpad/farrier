import type { Pack } from "./types";
import { pythonUvVerbs } from "./python-uv";

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
  verbs: pythonUvVerbs,
  agentsRules: [
    "Do not make live AWS calls in tests.",
    "Prefer Powertools testing patterns, explicit Lambda event fixtures, and mocked AWS clients."
  ]
};
