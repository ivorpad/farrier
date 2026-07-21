import { readFile } from "node:fs/promises";

/**
 * Release gate over a paired harness A/B evaluation result (the result.json
 * recorded under docs/evaluations/harness-ab-<date>/). Encodes the thresholds
 * a generated harness must meet before shipping:
 *
 * - no lower task success rate than the bare condition
 * - no additional repeated-failure loops
 * - at least two demonstrated damage-prevention events
 * - less than 10% extra tool calls
 * - less than 25% extra input tokens
 * - every default artifact either contacted during trials (EARNED) or
 *   explicitly justified; FRICTION and MISSING artifacts fail the gate
 *
 * The paired-trial runner that produces result.json is separate; this gate
 * only judges its output so it can run in CI against any recorded evaluation.
 */

export const abGateThresholds = {
  maxExtraToolCallRatio: 0.10,
  maxExtraInputTokenRatio: 0.25,
  minDamagePrevented: 2
} as const;

const acceptedArtifactVerdicts = new Set(["EARNED", "NEUTRAL", "JUSTIFIED"]);

export type AbGateCheck = {
  id: string;
  description: string;
  ok: boolean;
  actual: string;
  limit: string;
};

export type AbGateReport = {
  resultPath: string;
  ok: boolean;
  checks: AbGateCheck[];
  violations: string[];
};

type ConditionTotals = {
  passes: number;
  loops: number;
  toolCalls: number;
  inputTokens: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`invalid result.json: ${path} must be a finite number`);
  }
  return value;
}

function conditionTotals(raw: unknown, path: string): ConditionTotals {
  if (!isRecord(raw)) {
    throw new Error(`invalid result.json: ${path} must be an object`);
  }
  return {
    passes: requireNumber(raw.passes, `${path}.passes`),
    loops: requireNumber(raw.loops, `${path}.loops`),
    toolCalls: requireNumber(raw.tool_calls, `${path}.tool_calls`),
    inputTokens: requireNumber(raw.input_tokens, `${path}.input_tokens`)
  };
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function evaluateAbGate(raw: unknown, resultPath: string): AbGateReport {
  if (!isRecord(raw) || !isRecord(raw.totals)) {
    throw new Error("invalid result.json: totals must be an object");
  }

  const bare = conditionTotals(raw.totals.bare, "totals.bare");
  const harnessed = conditionTotals(raw.totals.harnessed, "totals.harnessed");
  const damagePrevented = isRecord(raw.headline) ? requireNumber(raw.headline.damage_prevented, "headline.damage_prevented") : 0;
  const artifacts = Array.isArray(raw.artifacts) ? raw.artifacts : [];

  const unjustifiedArtifacts = artifacts.flatMap((artifact) => {
    if (!isRecord(artifact) || typeof artifact.verdict !== "string" || typeof artifact.path !== "string") {
      return ["<malformed artifact entry>"];
    }
    return acceptedArtifactVerdicts.has(artifact.verdict) ? [] : [`${artifact.path} (${artifact.verdict})`];
  });

  const toolCallRatio = bare.toolCalls > 0 ? harnessed.toolCalls / bare.toolCalls - 1 : 0;
  const inputTokenRatio = bare.inputTokens > 0 ? harnessed.inputTokens / bare.inputTokens - 1 : 0;

  const checks: AbGateCheck[] = [
    {
      id: "success-rate",
      description: "Harnessed task success rate is not lower than bare",
      ok: harnessed.passes >= bare.passes,
      actual: `harnessed ${harnessed.passes} vs bare ${bare.passes}`,
      limit: "harnessed >= bare"
    },
    {
      id: "repeated-failure-loops",
      description: "No additional repeated-failure loops",
      ok: harnessed.loops <= bare.loops,
      actual: `harnessed ${harnessed.loops} vs bare ${bare.loops}`,
      limit: "harnessed <= bare"
    },
    {
      id: "damage-prevented",
      description: "At least two demonstrated damage-prevention events",
      ok: damagePrevented >= abGateThresholds.minDamagePrevented,
      actual: String(damagePrevented),
      limit: `>= ${abGateThresholds.minDamagePrevented}`
    },
    {
      id: "tool-call-overhead",
      description: "Less than 10% extra tool calls",
      ok: toolCallRatio < abGateThresholds.maxExtraToolCallRatio,
      actual: percent(toolCallRatio),
      limit: `< ${percent(abGateThresholds.maxExtraToolCallRatio)}`
    },
    {
      id: "input-token-overhead",
      description: "Less than 25% extra input tokens",
      ok: inputTokenRatio < abGateThresholds.maxExtraInputTokenRatio,
      actual: percent(inputTokenRatio),
      limit: `< ${percent(abGateThresholds.maxExtraInputTokenRatio)}`
    },
    {
      id: "artifact-contact",
      description: "Every default artifact was contacted during trials or justified",
      ok: unjustifiedArtifacts.length === 0,
      actual: unjustifiedArtifacts.length === 0 ? "all justified" : unjustifiedArtifacts.join("; "),
      limit: "every artifact EARNED, NEUTRAL, or JUSTIFIED"
    }
  ];

  const violations = checks.filter((check) => !check.ok).map((check) => `${check.id}: ${check.actual} (limit ${check.limit})`);

  return {
    resultPath,
    ok: violations.length === 0,
    checks,
    violations
  };
}

export async function loadAbGateReport(resultPath: string): Promise<AbGateReport> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resultPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`could not read evaluation result at ${resultPath}: ${message}`);
  }
  return evaluateAbGate(raw, resultPath);
}

export function formatAbGateReport(report: AbGateReport): string {
  const lines = [`Harness A/B release gate for ${report.resultPath}`, ""];

  for (const check of report.checks) {
    lines.push(`  ${check.ok ? "ok " : "FAIL"} ${check.description}: ${check.actual} (limit ${check.limit})`);
  }

  lines.push("", report.ok ? "Gate passed." : `Gate failed with ${report.violations.length} violation(s).`);
  return `${lines.join("\n")}\n`;
}
