import type { HumanInterventionLedger } from "./human-intervention-ledger";
import type { ProspectiveNativeEventLogReport } from "./prospective-native-event-log";
import { text } from "./contracts/prospective-autonomy-protocol-items";
import type { ProspectiveRunEvidenceBundle } from "./contracts/prospective-run-evidence-types";

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function validateProspectiveRescue(input: {
  bundle: ProspectiveRunEvidenceBundle;
  eventReport: ProspectiveNativeEventLogReport;
  ledger: HumanInterventionLedger;
  problems: string[];
}): number {
  const { bundle, eventReport, ledger, problems } = input;
  const evidence = bundle.rescue;
  const selected = bundle.plannedCell.rescueSelected;
  const rescueSeconds = ledger.derived.postFreezeRescueSeconds;
  const starts = bundle.eventLog.events.filter((event) => event.kind === "rescue-start");
  const ends = bundle.eventLog.events.filter((event) => event.kind === "rescue-end");
  const rescueEdits = bundle.eventLog.events.filter((event) =>
    event.kind === "human-workspace-edit" && eventReport.phases.get(event.eventId) === "rescue");
  let editedFiles = 0;
  let changedLines = 0;
  for (const event of rescueEdits) {
    if (!integer(event.payload.editedFiles) || !integer(event.payload.changedLines)) {
      problems.push("rescue workspace edits must record nonnegative file and line counts.");
      continue;
    }
    editedFiles += Number(event.payload.editedFiles);
    changedLines += Number(event.payload.changedLines);
  }
  const categories = evidence.correctionCategories;
  const validCategories = Array.isArray(categories) && categories.every(text)
    && new Set(categories).size === categories.length;
  if (!integer(evidence.editedFiles) || !integer(evidence.changedLines) || !validCategories) {
    problems.push("rescue summary has invalid edit counts or correction categories.");
  }
  if (!selected) {
    if (evidence.status !== "not-required" || evidence.rescuerAlias !== null || categories.length !== 0
      || evidence.editedFiles !== 0 || evidence.changedLines !== 0 || eventReport.rescueObserved || rescueSeconds !== 0) {
      problems.push("an unselected repetition cannot contain rescue work or burden.");
    }
    return rescueSeconds;
  }
  const alias = text(evidence.rescuerAlias);
  if ((evidence.status !== "completed" && evidence.status !== "capped") || starts.length !== 1 || ends.length !== 1
    || !alias || /native|oracle|brief/i.test(alias) || starts[0]?.payload.rescuerAlias !== alias
    || ends[0]?.payload.status !== evidence.status || rescueSeconds < 1 || rescueSeconds > 20 * 60) {
    problems.push("a preselected rescue requires a bound, blinded, positive, capped lifecycle.");
  }
  if ((evidence.status === "capped") !== (rescueSeconds === 20 * 60)) {
    problems.push("rescue capped status must equal the frozen 20-minute active-time cap.");
  }
  if (evidence.editedFiles !== editedFiles || evidence.changedLines !== changedLines) {
    problems.push("rescue edit summaries do not match rescue-phase workspace events.");
  }
  if (editedFiles === 0) {
    if (categories.length !== 1 || categories[0] !== "none-needed") {
      problems.push("an edit-free rescue must record only the none-needed category.");
    }
  } else if (categories.length === 0 || categories.includes("none-needed")) {
    problems.push("a rescue with edits needs nonempty correction categories.");
  }
  return rescueSeconds;
}
