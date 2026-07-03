import type { Pack } from "./types";

export const tsReactVitePack: Pack = {
  id: "ts-react-vite",
  extends: "ts-base",
  detect: {
    packageJsonAnyDependencies: ["react", "vite"]
  },
  generator: {
    command: "bun",
    args: ["create", "vite", ".", "--template", "react-ts"],
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
    "Keep React components small and focused.",
    "Colocate UI-only logic with components.",
    "Keep business and domain logic outside React components."
  ]
};
