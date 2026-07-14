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
  allowedCategories?: AdviceCategory[];
  targetVendors?: AdviceVendor[];
  implementationRoutes?: string[];
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
  evidence: AdviceEvidence[];
};

export type AdviceSessionSourceSummary = {
  source: AdviceVendor;
  count: number;
};

export type AdviceSessionEvidence = {
  sources: AdviceSessionSourceSummary[];
  signals: AdviceEvidence[];
  notes: string[];
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
};

export type AdviceRecommendationFunnel = {
  patternsSent: number;
  returned: number;
  accepted: number;
  merged: number;
  rejected: number;
  rejectionReasons: string[];
  recoveryCalls: number;
};

export type AdviceEvidenceFunnel = {
  sources: AdviceSourceFunnel[];
  visibleEvents: number;
  recurringPatterns: number;
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
};

export type AdviceArtifact = {
  vendor: AdviceVendor | "shared";
  path: string;
  kind: "config" | "guidance" | "hook" | "skill" | "agent";
  linkTarget?: string;
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
  status: "accepted" | "no-evidence" | "weak-evidence" | "supported-no-route" | "backend-omission" | "validation-rejection" | "recommended" | "no-strong-evidence";
  reason: string;
};

export type AdviceReport = {
  schemaVersion: 1;
  targetDir: string;
  /** Canonical in new reports; optional while schema-v1 legacy reports remain readable. */
  author?: AdviceVendor;
  /** @deprecated JSON compatibility alias for author. */
  backend: AdviceVendor;
  model?: string;
  reportOnly: true;
  /** @deprecated JSON compatibility alias; always [author] in new reports. */
  targets?: AdviceVendor[];
  sessions: {
    mode: "auto" | "none";
    lookback: AdviceSessionLookback;
    included: boolean;
    requestedSources?: AdviceVendor[];
    sources: AdviceSessionSourceSummary[];
    evidence: AdviceEvidence[];
    funnel?: AdviceEvidenceFunnel;
  };
  profile: ProjectProfile;
  recommendations: AdviceRecommendation[];
  weakLeads?: AdviceRecommendation[];
  coverage: AdviceCoverage[];
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
