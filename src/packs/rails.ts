import type { Pack } from "./types";

export const railsPack: Pack = {
  id: "rails",
  detect: {
    gemfileGems: ["rails"]
  },
  generator: {
    command: "rails",
    args: ["new", "."],
    onlyWhenEmptyDir: true
  },
  skills: [],
  hooks: ["secret-shield", "tool-policy", "write-guard", "verb-runner", "quality-judge", "stop-judge"],
  toolPolicyRules: [
    {
      id: "rails-use-bundle-add-not-gem-install",
      description: "Rails projects should not install dependencies with gem install.",
      tool: "Bash",
      commandPattern: "(^|[;&|()\\s])gem\\s+install\\b",
      flags: "i",
      message: "Do not use gem install in this Rails project.",
      redirect: "Use `bundle add <gem>` so the dependency is recorded in the Gemfile."
    },
    {
      id: "rails-avoid-npx",
      description: "Rails projects should avoid npx unless a JavaScript toolchain explicitly owns the command.",
      tool: "Bash",
      commandPattern: "(^|[;&|()\\s])npx\\b",
      flags: "i",
      message: "Do not use npx by default in this Rails project.",
      redirect: "Use Rails binstubs, `bin/importmap`, or Bun where JavaScript tooling is explicitly present."
    }
  ],
  verbs: {
    check: "bundle exec rails test && bundle exec rubocop",
    test: "bundle exec rails test",
    fmt: "bundle exec rubocop -A"
  },
  agentsRules: [
    "Use `bundle exec` for Rails and Ruby project commands.",
    "Prefer Rails generators and framework conventions.",
    "Do not install gems with `gem install`; use `bundle add` instead."
  ],
  secondaryDetectors: [
    {
      id: "rails-hotwire",
      description: "Hotwire, Turbo, Stimulus, or Rails JavaScript app structure detected.",
      detect: {
        any: [
          {
            gemfileGems: ["turbo-rails"]
          },
          {
            gemfileGems: ["stimulus-rails"]
          },
          {
            globs: ["app/javascript/**"]
          }
        ]
      },
      suggestSkills: [],
      suggestPackIds: [],
      notes: ["Hotwire detected; search skills.sh for Rails/Hotwire skills before adding one."]
    }
  ]
};
