import type { Pack } from "./types";
import { tsBaseVerbs } from "./ts-base";

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
  verbs: tsBaseVerbs,
  agentsRules: [
    "Keep React components small and focused.",
    "Colocate UI-only logic with components.",
    "Keep business and domain logic outside React components."
  ]
};
