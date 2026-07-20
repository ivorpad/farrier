import type { HarnessAuditGroundTruth, HarnessAuditGroundTruthIssue } from "./harness-audit-evaluation";
import type { HarnessAuditMode, HarnessAuditRecommendation } from "./harness-audit-types";

export type HarnessAuditRecommendationAdjudication = {
  alias: string;
  mode: HarnessAuditMode;
  recommendationId: string;
  issueId: string | null;
  rationale: string;
};

type AdjudicationRun = {
  alias: string;
  mode: HarnessAuditMode;
  report: { recommendations: HarnessAuditRecommendation[] };
};

type AdjudicationAlias = { truth: HarnessAuditGroundTruth };

export function harnessAuditAdjudicationKey(
  alias: string,
  mode: HarnessAuditMode,
  recommendationId: string,
): string {
  return `${alias}\u0000${mode}\u0000${recommendationId}`;
}

export function indexHarnessAuditAdjudications(
  adjudications: HarnessAuditRecommendationAdjudication[] | undefined,
): Map<string, HarnessAuditRecommendationAdjudication> {
  return new Map((adjudications ?? []).map((item) => [
    harnessAuditAdjudicationKey(item.alias, item.mode, item.recommendationId),
    item,
  ]));
}

export function adjudicatedHarnessAuditIssue(
  adjudication: HarnessAuditRecommendationAdjudication | undefined,
  truth: HarnessAuditGroundTruth,
): HarnessAuditGroundTruthIssue | undefined {
  if (!adjudication || typeof adjudication.issueId !== "string") return undefined;
  return truth.issues.find((issue) => issue.id === adjudication.issueId);
}

export function recommendationCitesIssue(
  recommendation: HarnessAuditRecommendation,
  issue: HarnessAuditGroundTruthIssue,
): boolean {
  return issue.locations.some((location) => recommendation.citations.some((citation) =>
    citation.path === location.path && citation.line === location.line));
}

export function harnessAuditAdjudicationProblems(input: {
  reviewerId: string;
  aliases: Record<string, AdjudicationAlias> | undefined;
  runs: AdjudicationRun[];
  adjudications: HarnessAuditRecommendationAdjudication[] | undefined;
}): string[] {
  const prefix = `Reviewer ${input.reviewerId || "(missing id)"}`;
  const expected = new Set(input.runs.flatMap((run) => run.report.recommendations.map((recommendation) =>
    harnessAuditAdjudicationKey(run.alias, run.mode, recommendation.id))));
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const item of input.adjudications ?? []) {
    const key = harnessAuditAdjudicationKey(item.alias, item.mode, item.recommendationId);
    if (seen.has(key)) problems.push(`${prefix}: duplicate claim adjudication for ${item.alias}:${item.mode}:${item.recommendationId}.`);
    seen.add(key);
    if (!expected.has(key)) problems.push(`${prefix}: claim adjudication references an unknown recommendation ${item.alias}:${item.mode}:${item.recommendationId}.`);
    if (!item.rationale?.trim()) problems.push(`${prefix}: claim adjudication ${item.recommendationId} has no rationale.`);
    if (item.issueId !== null) {
      const truth = input.aliases?.[item.alias]?.truth;
      if (typeof item.issueId !== "string" || !truth?.issues.some((issue) => issue.id === item.issueId)) {
        problems.push(`${prefix}: claim adjudication ${item.recommendationId} names an unknown ground-truth issue.`);
      }
    }
  }
  for (const key of expected) {
    if (!seen.has(key)) problems.push(`${prefix}: missing claim adjudication for ${key.replaceAll("\u0000", ":")}.`);
  }
  return problems;
}
