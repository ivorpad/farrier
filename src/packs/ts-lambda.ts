import type { Pack } from "./types";
import { tsBaseVerbs } from "./ts-base";

export const tsLambdaPack: Pack = {
  id: "ts-lambda",
  extends: "ts-base",
  detect: {
    any: [
      {
        packageJsonAnyDependencies: ["aws-cdk-lib"]
      },
      {
        files: ["template.yaml"]
      },
      {
        files: ["samconfig.toml"]
      }
    ]
  },
  skills: [],
  hooks: [],
  verbs: tsBaseVerbs,
  agentsRules: [
    "Do not make live AWS calls in tests.",
    "Use stubs, fakes, local emulators, or explicitly gated integration tests for AWS behavior.",
    "Document CDK or SAM initialization steps instead of running destructive cloud setup implicitly."
  ]
};
