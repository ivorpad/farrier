import type { Pack } from "./types";

export const genericPack: Pack = {
  id: "generic",
  detect: {},
  skills: [],
  hooks: ["secret-shield", "tool-policy", "write-guard"],
  toolPolicyRules: [],
  verbs: {
    lint: {
      command: 'echo "farrier generic pack: configure check-fast in justfile"',
      evidence: "explicit generic pack placeholder"
    },
    test: {
      command: 'echo "farrier generic pack: configure test in justfile"',
      evidence: "explicit generic pack placeholder"
    },
    fmt: {
      command: 'echo "farrier generic pack: configure fmt in justfile"',
      evidence: "explicit generic pack placeholder"
    }
  },
  agentsRules: [
    "Replace placeholder justfile commands with real project commands before relying on this harness.",
    "Follow project-local conventions when a stack-specific farrier pack is unavailable."
  ]
};
