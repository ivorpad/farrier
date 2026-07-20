import type { EvidenceComparison } from "./behavior-evidence";

export type { SessionConsent, SessionIndexEntry } from "./skill-types";

export const adviceCategories = ["guidance", "hooks", "skills", "subagents", "plugins", "mcp"] as const;
export const adviceSessionLookbacks = ["7d", "14d", "all"] as const;

export type AdviceCategory = (typeof adviceCategories)[number];
export type AdviceSessionLookback = (typeof adviceSessionLookbacks)[number];
export type AdviceVendor = "claude" | "codex";
export type AdviceConfidence = "high" | "medium" | "low";
export type AdviceEvidenceSource = "project" | AdviceVendor;

export type AdviceEvidence = {
  id: string;
  source: AdviceEvidenceSource;
  kind: string;
  summary: string;
  path?: string;
  sessionId?: string;
  occurrences?: number;
  distinctSessions?: number;
  lastSeenAt?: number;
  targetVendors?: AdviceVendor[];
  implementationRoutes?: string[];
  selectedProvider?: AdviceVendor;
  line?: number;
  extractor?: string;
  factConfidence?: "exact" | "inferred";
  contentDigest?: string;
};

export type ProjectRepositoryFact = {
  id: string;
  kind: "dependency" | "workflow" | "instruction" | "capability" | "installed-skill";
  summary: string;
  path: string;
  line?: number;
  extractor: string;
  confidence: "exact" | "inferred";
  contentDigest: string;
};

export type ProjectProfileCoverage = {
  visitedPaths: string[];
  skippedPaths: Array<{ path: string; reason: string }>;
  readErrors: Array<{ path: string; reason: string }>;
  truncatedPaths: Array<{ path: string; maxBytes: number }>;
  complete: boolean;
};

export type ProjectInstalledSkill = {
  name: string;
  paths: string[];
  topologies: string[];
  provenance: string;
  provenanceEvidence: string[];
};

export type ProjectSkillInventory = {
  entries: ProjectInstalledSkill[];
  malformedLocations: Array<{ path: string; reason: string }>;
  roots: Array<{ path: string; status: string; skillLocations: number }>;
  complete: boolean;
  notes: string[];
};

export type ProjectDependency = {
  name: string;
  manifest: string;
  group: "runtime" | "development" | "optional" | "tooling";
  version?: string;
};

export type ProjectWorkflow = {
  kind: "test" | "lint" | "typecheck" | "format" | "build" | "database" | "release" | "deployment" | "ci" | "api" | "docs" | "generation";
  name: string;
  path: string;
  command?: string;
  triggers?: string[];
  evidence: string[];
};

export type ProjectCapability = {
  id: string;
  group: "runtime" | "language" | "framework" | "database" | "orm" | "migrations" | "testing" | "ci" | "api" | "release" | "deployment" | "automation";
  name: string;
  evidence: string[];
};

export type ProjectAutomation = {
  category: AdviceCategory;
  path: string;
  summary: string;
};

export type ProjectProfile = {
  targetDir: string;
  stacks: string[];
  languages: string[];
  tests: string[];
  ci: string[];
  services: string[];
  structure: string[];
  configuration: Record<string, string[]>;
  dependencies?: ProjectDependency[];
  packageManagers?: string[];
  workspaces?: string[];
  workflows?: ProjectWorkflow[];
  capabilities?: ProjectCapability[];
  automations?: ProjectAutomation[];
  repositoryFacts?: ProjectRepositoryFact[];
  repositoryCoverage?: ProjectProfileCoverage;
  skillInventory?: ProjectSkillInventory;
  evidence: AdviceEvidence[];
};

export type AdviceSessionAction = {
  type: "command" | "verification" | "file-change" | "web" | "mcp" | "delegation" | "other";
  summary: string;
  status?: "completed" | "failed" | "blocked" | "unknown";
};

export type AdviceSessionEpisode = {
  id: string;
  provider: AdviceVendor;
  sessionId: string;
  turnId: string;
  request: string;
  corrections: string[];
  actions: AdviceSessionAction[];
  outcome?: string;
  occurrences: number;
  distinctSessions: number;
  truncated: boolean;
};

export type AdviceSessionSourceSummary = {
  source: AdviceVendor;
  count: number;
};

export type AdviceSessionEvidence = {
  sources: AdviceSessionSourceSummary[];
  episodes?: AdviceSessionEpisode[];
  signals: AdviceEvidence[];
  notes: string[];
  consentDigest?: string;
  funnel?: AdviceEvidenceFunnel;
};

export type AdviceDiscardCounts = {
  filtering: number;
  redaction: number;
  deduplication: number;
  malformed: number;
  limits: number;
};

export type AdviceSourceFunnel = {
  source: AdviceVendor;
  discovered: number;
  eligible: number;
  read: number;
  parsed: number;
  visibleEvents: number;
  discarded: AdviceDiscardCounts;
  retainedPatterns: number;
  retainedEpisodes?: number;
  omittedEpisodes?: number;
  truncatedEpisodes?: number;
};

export type AdviceRecommendationFunnel = {
  /** Distinct retained session episodes supplied to the analysis, not repeated worker deliveries. */
  patternsSent: number;
  /** Raw recommendation records returned by recommendation workers. */
  returned: number;
  /** Locally validated candidates, including weak leads and later omissions. */
  accepted: number;
  /** Coordinator overlap omissions. */
  merged: number;
  rejected: number;
  rejectionReasons: string[];
  localRecoveries?: number;
  modelCalls?: number;
  successfulModelCalls?: number;
  failedModelCalls?: number;
  recoveryCalls: number;
};

export type AdviceEvidenceFunnel = {
  sources: AdviceSourceFunnel[];
  visibleEvents: number;
  recurringPatterns: number;
  retainedEpisodes?: number;
  omittedEpisodes?: number;
  truncatedEpisodes?: number;
  recommendation?: AdviceRecommendationFunnel;
};

export type AdviceSessionCountInventory = Record<AdviceSessionLookback, AdviceSessionSourceSummary[]>;

export type AdviceImplementationRoute = {
  id: string;
  description: string;
};

export type AdviceRecommendation = {
  id: string;
  category: AdviceCategory;
  targetVendors: AdviceVendor[];
  reason: string;
  benefit: string;
  evidence: string[];
  confidence: AdviceConfidence;
  implementationRoute: AdviceImplementationRoute;
  creates?: AdviceArtifact[];
  registryRef?: string;
  evidenceOrigin?: "codebase" | "sessions" | "both";
};

export type AdviceOmittedRecommendation = {
  recommendation: AdviceRecommendation;
  reason: string;
};

export type AdviceRegistryQuery = {
  query: string;
  evidence: string[];
  matches: string[];
};

export type AdviceRegistrySummary = {
  queries: AdviceRegistryQuery[];
  verifiedMatches: string[];
};

export type AdviceArtifact = {
  vendor: AdviceVendor | "shared";
  path: string;
  kind: "config" | "guidance" | "hook" | "skill" | "agent";
};

const defaultAdviceBenefits: Record<AdviceCategory, string> = {
  guidance: "Makes the project expectation persistent and visible to every supported agent.",
  hooks: "Automates the observed check so completion is consistent and requires less manual repetition.",
  skills: "Turns a repeated workflow into a reusable capability instead of requiring it to be explained again.",
  subagents: "Keeps specialist work and its context bounded so the main agent can stay focused.",
  plugins: "Adds a packaged capability that can be reused without rebuilding the integration each time.",
  mcp: "Gives agents direct, governed access to the relevant tool or data instead of relying on manual transfer."
};

export function adviceCategoryBenefit(category: AdviceCategory): string {
  return defaultAdviceBenefits[category];
}

export type AdviceCoverage = {
  category: AdviceCategory;
  status: "accepted" | "no-evidence" | "weak-evidence" | "supported-no-route" | "backend-omission" | "validation-rejection" | "presentation-omission" | "recommended" | "no-strong-evidence";
  reason: string;
};

export type AdviceAnalysisCategoryExecution = {
  category: AdviceCategory;
  status: "completed" | "failed";
  returned: number;
  validated: number;
};

export type AdviceAnalysisSummary = {
  mode: "focused" | "category-workers";
  status: "complete" | "partial";
  concurrency: number;
  workerCalls: number;
  coordinatorCalls: number;
  recoveryCalls: number;
  categories: AdviceAnalysisCategoryExecution[];
};

export type AdviceReport = {
  schemaVersion: 1;
  targetDir: string;
  backend: AdviceVendor;
  model?: string;
  reportOnly: true;
  targets?: AdviceVendor[];
  sessions: {
    mode: "auto" | "none";
    lookback: AdviceSessionLookback;
    included: boolean;
    requestedSources?: AdviceVendor[];
    sources: AdviceSessionSourceSummary[];
    evidence: AdviceEvidence[];
    episodes?: AdviceSessionEpisode[];
    funnel?: AdviceEvidenceFunnel;
  };
  profile: ProjectProfile;
  policy?: { provider: AdviceVendor; id: string };
  registry?: AdviceRegistrySummary;
  analysis?: AdviceAnalysisSummary;
  recommendations: AdviceRecommendation[];
  omittedRecommendations?: AdviceOmittedRecommendation[];
  weakLeads?: AdviceRecommendation[];
  coverage: AdviceCoverage[];
  evidence?: EvidenceComparison;
  notes: string[];
};

export function isAdviceCategory(value: string): value is AdviceCategory {
  return (adviceCategories as readonly string[]).includes(value);
}

export function isAdviceSessionLookback(value: string): value is AdviceSessionLookback {
  return (adviceSessionLookbacks as readonly string[]).includes(value);
}

export function adviceSessionLookbackLabel(value: AdviceSessionLookback): string {
  if (value === "7d") return "past 7 days";
  if (value === "14d") return "past 14 days";
  return "all history";
}
