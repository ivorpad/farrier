import type { Pack, PackVerbs } from "./types";

/**
 * Shared by every ts pack. tsc is gated on a tsconfig and prettier on the
 * devDependency that provides it; `bun test` needs no evidence because the
 * runtime ships the runner. Without a tsconfig there is no typecheck gate
 * rather than a `bunx tsc` that downloads a compiler and fails on no inputs.
 */
export const tsBaseVerbs: PackVerbs = {
  lint: {
    command: "bunx tsc --noEmit",
    when: { anyFiles: ["tsconfig.json", "tsconfig.base.json"] },
    evidence: "tsconfig.json exists"
  },
  test: {
    command: "bun test",
    evidence: "bun ships the test runner"
  },
  fmt: {
    command: "bunx prettier --write .",
    when: { packageJsonAnyDependencies: ["prettier"] },
    evidence: "prettier is a package.json dependency"
  }
};

export const tsBasePack: Pack = {
  id: "ts-base",
  detect: {
    files: ["package.json", "tsconfig.json"]
  },
  skills: [],
  hooks: ["secret-shield", "tool-policy", "write-guard", "verb-runner"],
  toolPolicyRules: [],
  ruleBlocks: [
    {
      id: "bun-managed",
      when: {
        anyFiles: ["bun.lock", "bun.lockb"]
      },
      evidence: "bun.lock exists",
      agentsRules: [
        "Use Bun for TypeScript package and script execution.",
        "Do not use `npx`; use `bunx` or `pnpm dlx` instead.",
        "Do not use `npm install`, `npm add`, `yarn install`, `yarn add`, `pnpm install`, or `pnpm add`; use `bun add` instead."
      ],
      toolPolicyRules: [
        {
          id: "typescript-use-bunx-not-npx",
          probe: "npx cowsay farrier-doctor-probe",
          description: "TypeScript projects should not run one-off package binaries with npx.",
          tool: "Bash",
          commandPattern: "(^|[;&|()\\s])npx\\b",
          flags: "i",
          message: "Do not use npx in this TypeScript project.",
          redirect: "Use `bunx <package>` or `pnpm dlx <package>` for one-off package binaries."
        },
        {
          id: "typescript-use-bun-add-not-npm-yarn-pnpm-install",
          probe: "npm install left-pad",
          description: "TypeScript projects managed by Bun should not add dependencies with npm, yarn, or pnpm.",
          tool: "Bash",
          commandPattern: "(^|[;&|()\\s])(?:npm|yarn|pnpm)\\s+(?:install|add)\\b",
          flags: "i",
          message: "Do not install or add dependencies with npm, yarn, or pnpm in this Bun-managed project.",
          redirect: "Use `bun add <package>` for project dependencies."
        }
      ]
    }
  ],
  verbs: tsBaseVerbs,
  agentsRules: [
    "Keep application code under `src/` unless the framework requires another location."
  ]
};
