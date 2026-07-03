import type { Pack } from "./types";

export const tsNextjsPack: Pack = {
  id: "ts-nextjs",
  extends: "ts-base",
  detect: {
    packageJsonAnyDependencies: ["next"]
  },
  generator: {
    command: "bunx",
    args: ["create-next-app@latest", ".", "--ts", "--use-bun", "--yes"],
    onlyWhenEmptyDir: true
  },
  skills: [],
  hooks: [],
  verbs: {
    check: "bunx tsc --noEmit && bun test",
    test: "bun test",
    fmt: "bunx prettier --write .",
    konsistent: "bunx konsistent@1.0.0-beta.1 check"
  },
  agentsRules: [
    "Prefer Next.js conventions over custom routing or build abstractions.",
    "Keep server and client component boundaries explicit.",
    "Do not move framework-owned files without preserving Next.js routing semantics."
  ]
};
