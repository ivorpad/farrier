export type HookId =
  | "secret-shield"
  | "tool-policy"
  | "write-guard"
  | "verb-runner"
  | "quality-judge"
  | "stop-judge";

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
  hooks: HookId[];
  toolPolicyRules?: ToolPolicyRule[];
  konsistentTemplate?: KonsistentTemplate;
  verbs: PackVerbs;
  agentsRules?: string[];
  secondaryDetectors?: SecondaryDetector[];
};

export type ResolvedPack = Omit<Pack, "toolPolicyRules" | "agentsRules" | "secondaryDetectors"> & {
  toolPolicyRules: ToolPolicyRule[];
  agentsRules: string[];
  secondaryDetectors: SecondaryDetector[];
  packIds: string[];
};
