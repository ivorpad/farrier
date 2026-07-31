import type { Pack } from "./types";
import { tsBaseVerbs } from "./ts-base";

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
  verbs: tsBaseVerbs,
  agentsRules: [
    "Prefer Next.js conventions over custom routing or build abstractions.",
    "Keep server and client component boundaries explicit.",
    "Do not move framework-owned files without preserving Next.js routing semantics."
  ]
};
