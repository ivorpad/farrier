import type { AdviceVendor } from "./advice-types";

export const harnessAuditModes = ["quick", "baseline", "deep"] as const;
export const harnessAuditLayers = ["guidance", "verification", "skill", "hook", "toolchain"] as const;
export const harnessAuditSeverities = ["blocking", "high", "medium", "low"] as const;

export type HarnessAuditMode = (typeof harnessAuditModes)[number];
export type HarnessAuditLayer = (typeof harnessAuditLayers)[number];
export type HarnessAuditSeverity = (typeof harnessAuditSeverities)[number];

export type HarnessAuditLine = {
  id: string;
  path: string;
  line: number;
  text: string;
  kind: "guidance" | "skill" | "hook" | "toolchain";
  referenceRoot?: string;
};

export type HarnessAuditCheck = {
  id: string;
  layers: HarnessAuditLayer[];
  description: string;
  result: string;
};

export type HarnessAuditCitation = {
  path: string;
  line: number;
  excerpt: string;
};

export type HarnessAuditCountercheck = {
  description: string;
  result: string;
};

export type HarnessAuditRecommendation = {
  id: string;
  layer: HarnessAuditLayer;
  severity: HarnessAuditSeverity;
  title: string;
  defect: string;
  citations: HarnessAuditCitation[];
  counterchecks: HarnessAuditCountercheck[];
  proposal: {
    artifact: string;
    change: string;
  };
  risk: string;
  uncertainty: string;
  source: "deterministic" | "model";
};

export type HarnessAuditLayerCoverage = {
  layer: HarnessAuditLayer;
  status: "finding" | "no-finding" | "worker-failed" | "not-run";
  reason: string;
};

export type HarnessAuditMetrics = {
  modelCalls: number;
  successfulModelCalls: number;
  failedModelCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  cumulativeModelTimeMs: number;
  tokenAccounting: "none" | "provider" | "estimated-from-utf8" | "mixed";
};

export type HarnessAuditReport = {
  schemaVersion: 1;
  reportOnly: true;
  targetDir: string;
  mode: HarnessAuditMode;
  backend?: AdviceVendor;
  model?: string;
  executionBudget?: {
    maxModelCalls?: number;
    maxEstimatedInputTokens?: number;
    maxProviderCostUsdPerCall?: number;
  };
  recommendations: HarnessAuditRecommendation[];
  coverage: HarnessAuditLayerCoverage[];
  metrics: HarnessAuditMetrics;
  corpus: {
    digest: string;
    filesRead: number;
    linesSupplied: number;
    checksPerformed: number;
    skipped: Array<{ path: string; reason: string }>;
  };
  notes: string[];
};

export function isHarnessAuditMode(value: string): value is HarnessAuditMode {
  return (harnessAuditModes as readonly string[]).includes(value);
}

export function isHarnessAuditLayer(value: string): value is HarnessAuditLayer {
  return (harnessAuditLayers as readonly string[]).includes(value);
}

export function isHarnessAuditSeverity(value: string): value is HarnessAuditSeverity {
  return (harnessAuditSeverities as readonly string[]).includes(value);
}
