export type HookId =
  | "secret-shield"
  | "tool-policy"
  | "write-guard"
  | "verb-runner"
  | "quality-judge"
  | "stop-judge"
  | "large-file-commit-guard"
  | "process-teardown-audit";

export type PackHookRef = HookId | `@${string}`;

export type CapabilityAgent = "claude" | "codex";
export type CapabilityHookEvent = "PreToolUse" | "PostToolUse" | "Stop";

export type HookCapabilityBinding = {
  event: CapabilityHookEvent;
  matcher?: string;
  fileName: string;
};

export type HookCapability = {
  agents: Partial<Record<CapabilityAgent, HookCapabilityBinding[]>>;
};

export type PackCapabilityProjection = {
  packId: string;
  detection: { order: number | null; explicitOnly: boolean };
  supportedAgents: readonly CapabilityAgent[];
  hooks: Array<{ id: PackHookRef; agents: readonly CapabilityAgent[] }>;
  limitations: string[];
};

export type ResolvedRemoteHook = {
  id: `@${string}`;
  version: string;
  sha256: string;
  sourceIdentity?: string;
  registryRef?: string;
  fromCache: boolean;
  hookVersion: number;
  events: {
    event: "PreToolUse" | "PostToolUse" | "Stop";
    matcher?: string;
  }[];
  entry: string;
  runner: "python3" | "bash" | "bun";
  files: {
    path: string;
    content: string;
    executable?: boolean;
  }[];
};

export type SkillRef = string;

export type ToolPolicyRule = {
  id: string;
  description: string;
  tool: "Bash";
  commandPattern: string;
  flags?: string;
  message: string;
  redirect: string;
  /**
   * A harmless command that this rule must deny, used by `farrier doctor`
   * runtime probes to prove the installed hook actually fires. Rules without
   * a probe (e.g. learned rules) are skipped by the probe pass.
   */
  probe?: string;
};

export type PackDetect = {
  files?: string[];
  anyFiles?: string[];
  globs?: string[];
  pyprojectDependencies?: string[];
  packageJsonDependencies?: string[];
  packageJsonDevDependencies?: string[];
  packageJsonAnyDependencies?: string[];
  gemfileGems?: string[];
  any?: PackDetect[];
};

export type SecondaryDetector = {
  id: string;
  description: string;
  detect: PackDetect;
  suggestSkills?: SkillRef[];
  suggestPackIds?: string[];
  notes?: string[];
};

export type SecondaryDetectionFinding = {
  id: string;
  description: string;
  suggestSkills: SkillRef[];
  suggestPackIds: string[];
  notes: string[];
};

export type KonsistentHaveTypePredicate = {
  haveType: "directory" | "file";
};

export type KonsistentHaveFilesPredicate = {
  haveFiles: string[];
};

export type KonsistentExportPredicate = {
  export: string[];
};

export type KonsistentImportFromPredicate = {
  importFrom: string;
};

export type KonsistentPredicate =
  | KonsistentHaveTypePredicate
  | KonsistentHaveFilesPredicate
  | KonsistentExportPredicate
  | KonsistentImportFromPredicate
  | (KonsistentHaveTypePredicate & Partial<KonsistentHaveFilesPredicate>)
  | (KonsistentHaveTypePredicate & Partial<KonsistentExportPredicate>)
  | (KonsistentHaveFilesPredicate & Partial<KonsistentExportPredicate>);

export type KonsistentConvention = {
  name: string;
  description: string;
  paths: string | string[];
  excludeFiles?: string[];
} & (
  | { must: KonsistentPredicate; mustNot?: never }
  | { mustNot: KonsistentPredicate; must?: never }
);

export type KonsistentTemplate = {
  version: "v1";
  conventions: KonsistentConvention[];
};

export type PackVerbs = {
  check: string;
  /**
   * Fast task-scoped gate run after every edit (format/lint/typecheck level).
   * Targeted tests are appended by the generated `check-fast` recipe from the
   * `test` verb when the caller passes test files.
   */
  checkFast: string;
  test: string;
  fmt: string;
  konsistent?: string;
};

/**
 * A group of rules that only applies when repository evidence for it exists.
 * `when` is evaluated against the target directory at plan time; when it does
 * not match, the block's rules are omitted entirely instead of being emitted
 * as generic advice. `evidence` is the human-readable justification shown in
 * previews (e.g. "bun.lock exists").
 */
export type PackRuleBlock = {
  id: string;
  when: PackDetect;
  evidence: string;
  agentsRules?: string[];
  toolPolicyRules?: ToolPolicyRule[];
};

export type Pack = {
  id: string;
  extends?: string;
  detect: PackDetect;
  generator?: {
    command: string;
    args: string[];
    onlyWhenEmptyDir: boolean;
  };
  skills: SkillRef[];
  hooks: PackHookRef[];
  toolPolicyRules?: ToolPolicyRule[];
  konsistentTemplate?: KonsistentTemplate;
  /**
   * Name of the structure-linting tool the pack scaffolds. Drives the rendered
   * config filename (`${konsistentTool}.json`), the justfile recipe name, and
   * the AGENTS.md label. Python packs use "konpy"; TypeScript packs use the npm
   * "konsistent" package. Defaults to "konsistent" when omitted.
   */
  konsistentTool?: string;
  verbs: PackVerbs;
  agentsRules?: string[];
  ruleBlocks?: PackRuleBlock[];
  secondaryDetectors?: SecondaryDetector[];
};

export type ResolvedPack = Omit<Pack, "toolPolicyRules" | "agentsRules" | "ruleBlocks" | "secondaryDetectors"> & {
  toolPolicyRules: ToolPolicyRule[];
  agentsRules: string[];
  ruleBlocks: PackRuleBlock[];
  secondaryDetectors: SecondaryDetector[];
  packIds: string[];
  remoteHooks: ResolvedRemoteHook[];
};
