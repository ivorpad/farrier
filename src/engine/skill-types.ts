export type SkillProvider = "claude" | "codex";
export type SessionConsentCategory = "requests" | "corrections" | "commands" | "files" | "outcomes";

export type RepositoryFact = {
  id: string;
  kind: "dependency" | "workflow" | "instruction" | "capability" | "installed-skill";
  summary: string;
  path: string;
  line?: number;
  extractor: string;
  confidence: "exact" | "inferred";
  contentDigest: string;
};

export type SessionIndexEntry = {
  opaqueId: string;
  provider: SkillProvider;
  updatedAt: string;
  projectMatch: "directory" | "provider-index" | "unknown";
  approximateTurns?: number;
  sourceFingerprint: string;
};

export type SessionConsentSelection = {
  provider: SkillProvider;
  opaqueId: string;
  expectedFingerprint: string;
  maxBytes: number;
  maxTurns: number;
};

export type SessionConsent = {
  version: 1;
  projectRootDigest: string;
  selected: SessionConsentSelection[];
  categories: SessionConsentCategory[];
  selectionDigest: string;
};

export type ProfileCoverage = {
  visitedPaths: string[];
  skippedPaths: Array<{ path: string; reason: string }>;
  readErrors: Array<{ path: string; reason: string }>;
  truncatedPaths: Array<{ path: string; maxBytes: number }>;
  limits: {
    maxEntries: number;
    maxFacts: number;
    maxFileBytes: number;
  };
  complete: boolean;
};

export type PermissionFinding = {
  status: "unknown" | "none" | "present";
  values: string[];
};

export type SkillPermissionSummary = {
  shell: PermissionFinding;
  filesystemReads: PermissionFinding;
  filesystemWrites: PermissionFinding;
  networkDomains: PermissionFinding;
  browser: PermissionFinding;
  mcpServers: PermissionFinding;
  secretNames: PermissionFinding;
  requiredTools: PermissionFinding;
  unclassified: string[];
};
