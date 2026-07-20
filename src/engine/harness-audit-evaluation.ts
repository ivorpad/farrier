import type {
  HarnessAuditLayer,
  HarnessAuditRecommendation,
  HarnessAuditReport,
  HarnessAuditSeverity,
} from "./harness-audit-types";

export type HarnessAuditGroundTruthIssue = {
  id: string;
  layer: HarnessAuditLayer;
  severity: HarnessAuditSeverity;
  locations: Array<{ path: string; line: number }>;
};

export type HarnessAuditGroundTruth = {
  repository: string;
  issues: HarnessAuditGroundTruthIssue[];
};

export type HarnessAuditScore = {
  recommendations: number;
  realRecommendations: number;
  falsePositives: string[];
  duplicateRecommendations: string[];
  correctLayerRecommendations: number;
  contractFailures: string[];
  precision: number;
  correctLayerRate: number;
  missedIssues: string[];
  topCorrectLayerAndActionable: boolean;
};

function issueAtCitation(
  recommendation: HarnessAuditRecommendation,
  truth: HarnessAuditGroundTruth,
): HarnessAuditGroundTruthIssue[] {
  return truth.issues.filter((issue) => recommendationCitesIssue(recommendation, issue));
}

function recommendationCitesIssue(
  recommendation: HarnessAuditRecommendation,
  issue: HarnessAuditGroundTruthIssue,
): boolean {
  return issue.locations.some((location) => recommendation.citations.some((citation) =>
    citation.path === location.path && citation.line === location.line));
}

function issuesForRecommendation(
  recommendation: HarnessAuditRecommendation,
  truth: HarnessAuditGroundTruth,
  issueIdsByRecommendation: ReadonlyMap<string, string | null> | undefined,
): HarnessAuditGroundTruthIssue[] {
  if (!issueIdsByRecommendation) return issueAtCitation(recommendation, truth);
  if (!issueIdsByRecommendation.has(recommendation.id)) return [];
  const issueId = issueIdsByRecommendation.get(recommendation.id);
  return typeof issueId === "string" ? truth.issues.filter((issue) => issue.id === issueId) : [];
}

export function hasProhibitedModelAuthorityClaim(content: string): boolean {
  return [
    /\bvalidated\b/i,
    /\bconfidence\s*(?:score|rating|level)\b/i,
    /\bconfidence\s*(?:is\b|[:=])/i,
    /\bconfidence\s+(?:very\s+)?(?:high|medium|low|strong|weak)\b/i,
    /\b(?:high|medium|low|strong|weak)[ -]confidence\b/i,
    /\b\d{1,3}(?:\.\d+)?%\s+(?:confidence|confident)\b/i,
    /\b(?:i|we|the model|the analysis|this assessment)\s+(?:am|are|is)\s+(?:highly\s+|very\s+)?confident\b/i,
  ].some((pattern) => pattern.test(content));
}

export function recommendationContractPass(recommendation: HarnessAuditRecommendation): boolean {
  const authoredAssessment = [
    recommendation.title,
    recommendation.defect,
    recommendation.proposal.change,
    recommendation.risk,
    recommendation.uncertainty,
  ].join(" ");
  return recommendation.citations.length > 0
    && recommendation.citations.every((citation) => Boolean(citation.path) && citation.line > 0 && Boolean(citation.excerpt))
    && recommendation.counterchecks.length > 0
    && recommendation.counterchecks.every((check) => Boolean(check.description) && Boolean(check.result))
    && Boolean(recommendation.proposal.artifact)
    && Boolean(recommendation.proposal.change)
    && Boolean(recommendation.risk)
    && Boolean(recommendation.uncertainty)
    && !hasProhibitedModelAuthorityClaim(authoredAssessment);
}

export function scoreHarnessAudit(
  report: HarnessAuditReport,
  truth: HarnessAuditGroundTruth,
  issueIdsByRecommendation?: ReadonlyMap<string, string | null>,
): HarnessAuditScore {
  const matchedIssues = new Set<string>();
  const falsePositives: string[] = [];
  const duplicateRecommendations: string[] = [];
  const contractFailures: string[] = [];
  let realRecommendations = 0;
  let correctLayerRecommendations = 0;
  for (const recommendation of report.recommendations) {
    const candidates = issuesForRecommendation(recommendation, truth, issueIdsByRecommendation);
    if (!candidates.length) falsePositives.push(recommendation.id);
    else {
      realRecommendations += 1;
      if (candidates.some((issue) => issue.layer === recommendation.layer)) correctLayerRecommendations += 1;
      const issue = candidates.find((candidate) => candidate.layer === recommendation.layer && !matchedIssues.has(candidate.id))
        ?? candidates.find((candidate) => !matchedIssues.has(candidate.id));
      if (issue) matchedIssues.add(issue.id);
      else duplicateRecommendations.push(recommendation.id);
    }
    if (!recommendationContractPass(recommendation)) contractFailures.push(recommendation.id);
  }
  const top = report.recommendations[0];
  const topIssues = top ? issuesForRecommendation(top, truth, issueIdsByRecommendation) : [];
  const topCorrectLayerAndActionable = Boolean(top
    && topIssues.some((issue) => issue.layer === top.layer)
    && topIssues.some((issue) => recommendationCitesIssue(top, issue))
    && recommendationContractPass(top));
  const count = report.recommendations.length;
  return {
    recommendations: count,
    realRecommendations,
    falsePositives,
    duplicateRecommendations,
    correctLayerRecommendations,
    contractFailures,
    precision: count ? realRecommendations / count : truth.issues.length ? 0 : 1,
    correctLayerRate: realRecommendations ? correctLayerRecommendations / realRecommendations : truth.issues.length ? 0 : 1,
    missedIssues: truth.issues.filter((issue) => !matchedIssues.has(issue.id)).map((issue) => issue.id),
    topCorrectLayerAndActionable: truth.issues.length ? topCorrectLayerAndActionable : count === 0,
  };
}
