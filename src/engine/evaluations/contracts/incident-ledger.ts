type UnknownRecord = Record<string, unknown>;

export type IncidentLedgerValidation = {
  problems: string[];
  candidateIncidentCount: number;
  independentCandidateClusters: number;
  qualifiedIncidentCount: number;
  independentQualifiedClusters: number;
  gatePassed: boolean;
};

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RECOVERY_RESULTS = new Set(["not-assessed", "none", "partial", "full"]);
const INCIDENT_STATUSES = new Set(["candidate", "qualified", "excluded"]);

function record(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as UnknownRecord;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function date(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => !text(item))) return undefined;
  return value as string[];
}

function validateSnapshot(
  incidentId: string,
  snapshot: UnknownRecord | undefined,
  exactSnapshot: boolean | undefined,
  problems: string[],
): void {
  if (!snapshot) {
    problems.push(`${incidentId}: snapshot must be an object.`);
    return;
  }

  for (const key of ["commit", "tree"] as const) {
    const value = text(snapshot[key]);
    if (!value || !COMMIT_PATTERN.test(value)) {
      problems.push(`${incidentId}: snapshot.${key} must be a full lowercase Git object id.`);
    }
  }

  const overlay = text(snapshot.overlay);
  if (!overlay || !["clean-commit", "reconstructed"].includes(overlay)) {
    problems.push(`${incidentId}: snapshot.overlay must be clean-commit or reconstructed.`);
  }
  if (exactSnapshot === true && !overlay) {
    problems.push(`${incidentId}: an exact snapshot requires an explicit overlay disposition.`);
  }
}

function validateEvidenceCutoff(
  incidentId: string,
  cutoff: number | undefined,
  evidence: unknown,
  problems: string[],
): number {
  if (!Array.isArray(evidence)) {
    problems.push(`${incidentId}: preincidentEvidence must be an array.`);
    return 0;
  }

  let eligibleSessions = 0;
  for (const [index, rawEvidence] of evidence.entries()) {
    const item = record(rawEvidence);
    if (!item) {
      problems.push(`${incidentId}: preincidentEvidence[${index}] must be an object.`);
      continue;
    }

    const kind = text(item.kind);
    const use = text(item.use);
    if (!kind || !["source", "ast", "documentation", "session", "existing-test", "ci"].includes(kind)) {
      problems.push(`${incidentId}: preincidentEvidence[${index}].kind is invalid.`);
    }
    if (!use || !["selector", "ground-truth-only"].includes(use)) {
      problems.push(`${incidentId}: preincidentEvidence[${index}].use is invalid.`);
    }

    if (kind !== "session" || use !== "selector") continue;
    eligibleSessions += 1;
    const observedAt = date(item.observedAt);
    if (observedAt === undefined) {
      problems.push(`${incidentId}: selector session evidence needs observedAt.`);
    } else if (cutoff !== undefined && observedAt > cutoff) {
      problems.push(`${incidentId}: selector session evidence occurs after the incident cutoff.`);
    }
  }
  return eligibleSessions;
}

function validateRecoveryAblation(
  incidentId: string,
  ablation: UnknownRecord | undefined,
  eligibleSessions: number,
  problems: string[],
): void {
  if (!ablation) {
    problems.push(`${incidentId}: recoveryAblation must be an object.`);
    return;
  }

  for (const key of ["pathsLoc", "static", "staticPlusEligibleSessions"] as const) {
    if (!RECOVERY_RESULTS.has(String(ablation[key]))) {
      problems.push(`${incidentId}: recoveryAblation.${key} is invalid.`);
    }
  }

  if (
    ablation.static !== "full" &&
    ablation.staticPlusEligibleSessions === "full" &&
    eligibleSessions === 0
  ) {
    problems.push(`${incidentId}: session-driven recovery lift has no eligible preincident session evidence.`);
  }
}

function validateQualifiedIncident(
  incidentId: string,
  qualification: UnknownRecord,
  blockers: string[],
  problems: string[],
): void {
  const required = [
    "material",
    "preventable",
    "exactSnapshot",
    "originalRequestRecovered",
    "environmentRecovered",
    "prevalenceMeasured",
  ];
  for (const key of required) {
    if (qualification[key] !== true) {
      problems.push(`${incidentId}: qualified incident requires qualification.${key}=true.`);
    }
  }
  if (blockers.length > 0) {
    problems.push(`${incidentId}: qualified incident cannot retain blockers.`);
  }
}

export function validateIncidentLedger(value: unknown): IncidentLedgerValidation {
  const problems: string[] = [];
  const root = record(value);
  if (!root) {
    return {
      problems: ["Incident ledger must be an object."],
      candidateIncidentCount: 0,
      independentCandidateClusters: 0,
      qualifiedIncidentCount: 0,
      independentQualifiedClusters: 0,
      gatePassed: false,
    };
  }

  if (root.schemaVersion !== 1) problems.push("schemaVersion must be 1.");
  const gate = record(root.gate);
  const minimum = finiteNumber(gate?.minimumIndependentIncidents);
  if (!minimum || minimum < 1 || !Number.isInteger(minimum)) {
    problems.push("gate.minimumIndependentIncidents must be a positive integer.");
  }

  const incidents = Array.isArray(root.incidents) ? root.incidents : [];
  if (!Array.isArray(root.incidents)) problems.push("incidents must be an array.");

  const seenIds = new Set<string>();
  const candidateClusters = new Set<string>();
  const qualifiedClusters = new Set<string>();
  let candidateIncidentCount = 0;
  let qualifiedIncidentCount = 0;

  for (const [index, rawIncident] of incidents.entries()) {
    const incident = record(rawIncident);
    const fallbackId = `incidents[${index}]`;
    if (!incident) {
      problems.push(`${fallbackId} must be an object.`);
      continue;
    }

    const incidentId = text(incident.id) ?? fallbackId;
    if (!text(incident.id)) problems.push(`${fallbackId}.id is required.`);
    if (seenIds.has(incidentId)) problems.push(`${incidentId}: duplicate incident id.`);
    seenIds.add(incidentId);

    const status = text(incident.status);
    if (!status || !INCIDENT_STATUSES.has(status)) {
      problems.push(`${incidentId}: status is invalid.`);
    }
    const cluster = text(incident.independentCluster);
    if (!cluster) problems.push(`${incidentId}: independentCluster is required.`);

    const repository = record(incident.repository);
    if (!text(repository?.slug)) problems.push(`${incidentId}: repository.slug is required.`);
    if (text(repository?.slug)?.startsWith("/")) {
      problems.push(`${incidentId}: repository.slug must not be a machine-local path.`);
    }

    const qualification = record(incident.qualification);
    if (!qualification) {
      problems.push(`${incidentId}: qualification must be an object.`);
      continue;
    }
    for (const key of [
      "material",
      "preventable",
      "exactSnapshot",
      "originalRequestRecovered",
      "environmentRecovered",
      "prevalenceMeasured",
    ]) {
      if (boolean(qualification[key]) === undefined) {
        problems.push(`${incidentId}: qualification.${key} must be boolean.`);
      }
    }
    const blockers = stringArray(qualification.blockers);
    if (!blockers) problems.push(`${incidentId}: qualification.blockers must be a string array.`);

    validateSnapshot(incidentId, record(incident.snapshot), boolean(qualification.exactSnapshot), problems);

    const task = record(incident.task);
    const cutoff = date(task?.evidenceCutoff);
    if (!task) problems.push(`${incidentId}: task must be an object.`);
    if (cutoff === undefined) problems.push(`${incidentId}: task.evidenceCutoff must be an ISO timestamp.`);
    if (!text(task?.summary)) problems.push(`${incidentId}: task.summary is required.`);

    const eligibleSessions = validateEvidenceCutoff(
      incidentId,
      cutoff,
      incident.preincidentEvidence,
      problems,
    );
    validateRecoveryAblation(
      incidentId,
      record(incident.recoveryAblation),
      eligibleSessions,
      problems,
    );

    if (!text(record(incident.groundTruth)?.fixCommit)?.match(COMMIT_PATTERN)) {
      problems.push(`${incidentId}: groundTruth.fixCommit must be a full lowercase Git commit id.`);
    }
    const criteria = record(incident.rubric)?.criteria;
    if (!Array.isArray(criteria) || criteria.length === 0) {
      problems.push(`${incidentId}: rubric.criteria must contain at least one objective criterion.`);
    }

    if (status !== "excluded") {
      candidateIncidentCount += 1;
      if (cluster) candidateClusters.add(cluster);
    }
    if (status === "qualified") {
      qualifiedIncidentCount += 1;
      if (cluster) qualifiedClusters.add(cluster);
      validateQualifiedIncident(incidentId, qualification, blockers ?? [], problems);
    }
  }

  const independentCandidateClusters = candidateClusters.size;
  const independentQualifiedClusters = qualifiedClusters.size;
  const gatePassed = independentQualifiedClusters >= (minimum ?? Number.POSITIVE_INFINITY);

  const expected = record(gate?.observed);
  const observedValues: Array<[string, number]> = [
    ["candidateIncidents", candidateIncidentCount],
    ["independentCandidateClusters", independentCandidateClusters],
    ["qualifiedIncidents", qualifiedIncidentCount],
    ["independentQualifiedClusters", independentQualifiedClusters],
  ];
  for (const [key, actual] of observedValues) {
    if (expected?.[key] !== actual) {
      problems.push(`gate.observed.${key} must equal derived value ${actual}.`);
    }
  }
  if (gate?.status !== (gatePassed ? "pass" : "collecting")) {
    problems.push(`gate.status must be ${gatePassed ? "pass" : "collecting"}.`);
  }

  return {
    problems,
    candidateIncidentCount,
    independentCandidateClusters,
    qualifiedIncidentCount,
    independentQualifiedClusters,
    gatePassed,
  };
}
