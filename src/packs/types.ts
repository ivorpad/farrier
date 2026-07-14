export type HookId =
  | "secret-shield"
  | "tool-policy"
  | "write-guard"
  | "verb-runner"
  | "quality-judge"
  | "stop-judge";

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
  test: string;
  fmt: string;
  konsistent?: string;
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
  secondaryDetectors?: SecondaryDetector[];
};

export type ResolvedPack = Omit<Pack, "toolPolicyRules" | "agentsRules" | "secondaryDetectors"> & {
  toolPolicyRules: ToolPolicyRule[];
  agentsRules: string[];
  secondaryDetectors: SecondaryDetector[];
  packIds: string[];
  remoteHooks: ResolvedRemoteHook[];
};
