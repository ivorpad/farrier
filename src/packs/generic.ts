import type { Pack } from "./types";

export const genericPack: Pack = {
  id: "generic",
  detect: {},
  skills: [],
  hooks: ["secret-shield", "tool-policy", "write-guard", "quality-judge"],
  toolPolicyRules: [],
  verbs: {
    check: 'echo "farrier generic pack: configure check in justfile"',
    test: 'echo "farrier generic pack: configure test in justfile"',
    fmt: 'echo "farrier generic pack: configure fmt in justfile"'
  },
  agentsRules: [
    "Replace placeholder justfile commands with real project commands before relying on this harness.",
    "Follow project-local conventions when a stack-specific farrier pack is unavailable."
  ]
};
