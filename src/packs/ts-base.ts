import type { Pack } from "./types";

export const tsBasePack: Pack = {
  id: "ts-base",
  detect: {
    files: ["package.json", "tsconfig.json"]
  },
  skills: [],
  hooks: ["secret-shield", "tool-policy", "write-guard", "verb-runner", "quality-judge", "stop-judge"],
  toolPolicyRules: [
    {
      id: "typescript-use-bunx-not-npx",
      description: "TypeScript projects should not run one-off package binaries with npx.",
      tool: "Bash",
      commandPattern: "(^|[;&|()\\s])npx\\b",
      flags: "i",
      message: "Do not use npx in this TypeScript project.",
      redirect: "Use `bunx <package>` or `pnpm dlx <package>` for one-off package binaries."
    },
    {
      id: "typescript-use-bun-add-not-npm-yarn-pnpm-install",
      description: "TypeScript projects managed by Bun should not add dependencies with npm, yarn, or pnpm.",
      tool: "Bash",
      commandPattern: "(^|[;&|()\\s])(?:npm|yarn|pnpm)\\s+(?:install|add)\\b",
      flags: "i",
      message: "Do not install or add dependencies with npm, yarn, or pnpm in this Bun-managed project.",
      redirect: "Use `bun add <package>` for project dependencies."
    }
  ],
  konsistentTemplate: {
    version: "v1",
    conventions: [
      {
        name: "src-directory-exists",
        description: "TypeScript application code lives under src.",
        paths: "src",
        must: {
          haveType: "directory"
        }
      }
    ]
  },
  verbs: {
    check: "bunx tsc --noEmit && bun test",
    test: "bun test",
    fmt: "bunx prettier --write .",
    konsistent: "bunx konsistent@1.0.0-beta.1 check"
  },
  agentsRules: [
    "Use Bun for TypeScript package and script execution.",
    "Do not use `npx`; use `bunx` or `pnpm dlx` instead.",
    "Do not use `npm install`, `npm add`, `yarn install`, `yarn add`, `pnpm install`, or `pnpm add`; use `bun add` instead.",
    "Keep application code under `src/` unless the framework requires another location."
  ]
};
