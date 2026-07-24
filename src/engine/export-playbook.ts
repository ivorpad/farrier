import { basename } from "node:path";
import type { PackPlaybook, PackSubagent, PlaybookGateCheck, PlaybookGateCheckRule, PlaybookSkill } from "../packs/types";
import type { AdviceCreationFile } from "./advice-apply";
import type { EnforcementAgent } from "./agent-selection";
import type { AnnotatedSessionEvidence, GateCatalogEntry } from "./gate-catalog";
import { playbookFiles } from "./render-playbook";

/**
 * Deterministic playbook assembly: classified lessons + the gate catalog in,
 * an installable orchestrator skill (with a gates.md reference carrying this
 * project's evidence) plus review subagents out. The LLM layer decides WHICH
 * gates apply (review-gated); this builder only renders that decision, so a
 * reviewed lesson list always produces the same bytes.
 */

export type ProposedGate = {
  id: string;
  portable: string;
  binding: string;
  symptom: string;
};

export type ExportLesson = {
  gateId: string;
  /** Only portable lessons enter the playbook; app-specific ones stay evidence. */
  classification: "portable" | "app-specific";
  steerIndexes: number[];
  clusterIndexes: number[];
  rationale: string;
  /** Set when the model proposed a NEW catalog entry (review-gated). */
  proposedGate?: ProposedGate;
  /**
   * Deterministic exit-evidence rules authored by the model FROM the
   * project's own evidence (which artifacts this build actually used as
   * proof), never from a hardcoded template: farrier ships no artifact
   * paths of its own. Declarative data evaluated by the engine-owned
   * checker; validated and review-gated like every other model output.
   */
  exitChecks?: PlaybookGateCheckRule[];
  source: "llm" | "hints";
};

/**
 * Review subagents keyed by the gate that needs them. Seeded from the
 * hand-authored WalkLedger playbook (ios-prd-playbook agents/, 2026-07-23).
 */
export const gateSubagents: Readonly<Record<string, PackSubagent>> = {
  "visual-review-multi": {
    name: "ux_hig_reviewer",
    description:
      "Read-only UX/UI reviewer that judges real rendered screenshots of every screen against platform interface guidelines, alignment, hierarchy, accessibility text sizes, dark mode, and state coverage.",
    sandboxMode: "read-only",
    developerInstructions: `Review like a human design reviewer looking at the rendered app, not the code. Require current screenshots for every screen in scope, in the variants the playbook demands (light and dark, smallest and largest accessibility text size). If screenshots are missing or stale, list them as the first finding and stop. Judge alignment, spacing, visual hierarchy, platform-guideline conformance, truncation, contrast, empty/loading/error/denied states, and flow confusion a first-time user would hit. Report per screen with severity and a concrete fix. Do not edit files. Never approve a screen you have not seen rendered.`
  }
};

export type PlaybookProposalInput = {
  projectDir: string;
  playbookName: string;
  lessons: readonly ExportLesson[];
  annotated: AnnotatedSessionEvidence;
  catalog: readonly GateCatalogEntry[];
  agents: readonly EnforcementAgent[];
};

export type PlaybookProposal = {
  playbook: PackPlaybook;
  subagents: PackSubagent[];
  files: AdviceCreationFile[];
  summary: string;
  /** Gates the model proposed beyond the catalog; shipped in gates.md marked as proposed. */
  proposedGateIds: string[];
};

function boundedQuote(text: string, maxChars = 180): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  return flattened.length > maxChars ? `${flattened.slice(0, maxChars - 3)}...` : flattened;
}

function lessonEvidenceLines(lesson: ExportLesson, annotated: AnnotatedSessionEvidence): string[] {
  const lines: string[] = [];
  for (const index of lesson.steerIndexes.slice(0, 2)) {
    const steer = annotated.steers[index];
    if (!steer) continue;
    lines.push(`- Steer${steer.date ? ` (${steer.date})` : ""}: "${boundedQuote(steer.text)}"`);
  }
  for (const index of lesson.clusterIndexes.slice(0, 2)) {
    const cluster = annotated.failureClusters[index];
    if (!cluster) continue;
    const when = cluster.dates.length > 0 ? ` (${cluster.dates[0]}${cluster.dates.length > 1 ? ` to ${cluster.dates[cluster.dates.length - 1]}` : ""})` : "";
    lines.push(`- Failures: \`${cluster.key}\` ${cluster.count}× across ${cluster.sessionCount} session(s)${when}`);
  }
  return lines;
}

function evidenceDateSpan(annotated: AnnotatedSessionEvidence): string | undefined {
  const dates = [
    ...annotated.steers.flatMap((steer) => (steer.date ? [steer.date] : [])),
    ...annotated.failureClusters.flatMap((cluster) => cluster.dates)
  ].sort();
  if (dates.length === 0) return undefined;
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  return first === last ? first : `${first} to ${last}`;
}

type SelectedGate = { entry: GateCatalogEntry; lesson: ExportLesson };

function selectGates(input: PlaybookProposalInput): { selected: SelectedGate[]; proposed: ExportLesson[] } {
  const byId = new Map(input.catalog.map((entry) => [entry.id, entry]));
  const selected: SelectedGate[] = [];
  const proposed: ExportLesson[] = [];
  for (const lesson of input.lessons) {
    if (lesson.classification !== "portable") continue;
    if (lesson.proposedGate) {
      proposed.push(lesson);
      continue;
    }
    const entry = byId.get(lesson.gateId);
    if (entry) selected.push({ entry, lesson });
  }
  selected.sort((left, right) => left.entry.order - right.entry.order);
  return { selected, proposed };
}

function gatesReference(input: PlaybookProposalInput, selected: SelectedGate[], proposed: ExportLesson[]): string {
  const sections = selected.map(({ entry, lesson }) => {
    const evidence = lessonEvidenceLines(lesson, input.annotated);
    return [
      `## ${entry.id}${entry.kind === "style" ? " (style rule)" : ""}`,
      `- Portable: ${entry.portable}`,
      `- Binding (${entry.stack}): ${entry.binding}`,
      `- Symptom: ${entry.symptom}`,
      `- Catalog origin: ${entry.origin}`,
      ...(evidence.length > 0 ? ["- Evidence from this project:", ...evidence.map((line) => `  ${line}`)] : [])
    ].join("\n");
  });

  const proposedSections = proposed.map((lesson) => {
    const gate = lesson.proposedGate!;
    const evidence = lessonEvidenceLines(lesson, input.annotated);
    return [
      `## ${gate.id} (PROPOSED — not yet in the gate catalog; review before relying on it)`,
      `- Portable: ${gate.portable}`,
      `- Binding: ${gate.binding}`,
      `- Symptom: ${gate.symptom}`,
      `- Rationale: ${lesson.rationale}`,
      ...(evidence.length > 0 ? ["- Evidence from this project:", ...evidence.map((line) => `  ${line}`)] : [])
    ].join("\n");
  });

  return [
    "# Gate catalog (exported)",
    "",
    `Each gate carries a portable statement, a stack binding, the transcript symptom it was matched on, its catalog origin, and the evidence from ${basename(input.projectDir)} that selected it. Evidence stays inline so a gate can be challenged later instead of ossifying.`,
    "",
    ...sections,
    ...(proposedSections.length > 0 ? ["", "# Proposed catalog entries", "", ...proposedSections] : []),
    ""
  ].join("\n");
}

function orchestratorSkill(input: PlaybookProposalInput, selected: SelectedGate[], subagents: PackSubagent[]): PlaybookSkill {
  const gates = selected.filter(({ entry }) => entry.kind === "gate");
  const styles = selected.filter(({ entry }) => entry.kind === "style");
  const span = evidenceDateSpan(input.annotated);
  const project = basename(input.projectDir);

  const styleSection = styles.length > 0
    ? [
        "## Operating style (earned, do not regress)",
        "",
        ...styles.map(({ entry, lesson }) => {
          const quote = lesson.steerIndexes
            .slice(0, 1)
            .map((index) => input.annotated.steers[index])
            .filter(Boolean)
            .map((steer) => ` Verbatim steer: "${boundedQuote(steer!.text, 140)}"`)
            .join("");
          return `- ${entry.portable}${quote}`;
        }),
        ""
      ]
    : [];

  const gateSections = gates.flatMap(({ entry, lesson }, index) => {
    const evidence = lessonEvidenceLines(lesson, input.annotated);
    const checkLine = (lesson.exitChecks?.length ?? 0) > 0
      ? [`Exit check: \`python3 gates/check.py ${entry.id}\` (run from this skill's directory; paths resolve against the repo root).`]
      : [];
    return [
      `### G${index + 1} ${entry.id}`,
      entry.portable,
      `Binding (${entry.stack}): ${entry.binding}`,
      ...checkLine,
      ...(evidence.length > 0 ? [...evidence] : []),
      ""
    ];
  });

  const subagentSection = subagents.length > 0
    ? [
        "## Review subagents",
        "",
        ...subagents.map((subagent) => `- \`${subagent.name}\`: ${subagent.description}`),
        ""
      ]
    : [];

  const anyChecks = gates.some(({ lesson }) => (lesson.exitChecks?.length ?? 0) > 0);
  const body = [
    `# ${input.playbookName}`,
    "",
    `Exported from the agent sessions that built ${project}${span ? ` (${span})` : ""}. Every gate below exists because skipping it cost real time on that build; per-gate rationale and evidence live in \`references/gates.md\` so a gate can be challenged instead of ossifying.`,
    "",
    ...styleSection,
    "## Phases and gates",
    "",
    "Run gates in order. A gate is a stop: the next phase does not start until the gate's exit evidence exists in the repo.",
    ...(anyChecks
      ? ["A gate with an exit check is not passed until `python3 gates/check.py <gate-id>` passes; gates without rules are review work the checker reports as SKIP."]
      : []),
    "",
    ...gateSections,
    ...subagentSection,
    "## After shipping",
    "",
    "Write LESSONS.md: which steers were needed, what broke, which gate was missing or too weak. That file feeds the gate catalog and the next playbook version."
  ].join("\n");

  const gateIds = gates.slice(0, 3).map(({ entry }) => entry.id).join(", ");
  return {
    name: input.playbookName,
    description: `Process playbook exported from the ${project} build: ${gates.length} phased gate(s)${gateIds ? ` (${gateIds}, ...)` : ""} with exit evidence per gate. Use when implementing or resuming a project on this stack.`,
    body,
    references: [{ name: "gates.md", content: gatesReference(input, selected, input.lessons.filter((lesson) => lesson.proposedGate && lesson.classification === "portable")) }]
  };
}

function filePurpose(path: string): string {
  if (path.endsWith("gates/gates.json")) return "Declarative exit-evidence rules per gate, authored from this project's evidence and reviewed here.";
  if (path.endsWith("gates/check.py")) return "Engine-owned gate checker; evaluates gates.json, never model-authored code.";
  if (path.endsWith("SKILL.md")) return "The exported playbook orchestrator: phased gates with exit evidence.";
  if (path.includes("/references/")) return "Gate catalog with this project's evidence per gate.";
  return "Review subagent the playbook's visual gate dispatches.";
}

export async function buildPlaybookProposal(input: PlaybookProposalInput): Promise<PlaybookProposal> {
  const { selected, proposed } = selectGates(input);
  const subagents = selected.flatMap(({ entry }) => (gateSubagents[entry.id] ? [gateSubagents[entry.id]!] : []));
  const orchestrator = orchestratorSkill(input, selected, subagents);
  // Every selected gate is listed in gates.json — rule-less gates render as
  // SKIP — so the gate set and its checkable subset stay visibly in sync.
  const checkedGates = selected.filter(({ entry }) => entry.kind === "gate");
  const gateChecks: PlaybookGateCheck[] = checkedGates.map(({ entry, lesson }) => ({
    gateId: entry.id,
    description: `Exit evidence for ${entry.id}`,
    rules: lesson.exitChecks ?? []
  }));
  const anyRules = gateChecks.some((check) => check.rules.length > 0);
  const playbook: PackPlaybook = { orchestrator, phases: [], ...(anyRules ? { gateChecks } : {}) };

  const files: AdviceCreationFile[] = (await playbookFiles({ playbook, subagents, agents: input.agents })).map((file) => ({
    ...file,
    purpose: filePurpose(file.path)
  }));

  const gateCount = checkedGates.length;
  const checkedCount = gateChecks.filter((check) => check.rules.length > 0).length;
  const summary = `Installs the ${input.playbookName} playbook: ${gateCount} gate(s) (${checkedCount} with deterministic exit checks), ${subagents.length} review subagent(s), for ${input.agents.join(", ")}. Session evidence stays cited inline; nothing enforces automatically.`;

  return {
    playbook,
    subagents,
    files,
    summary,
    proposedGateIds: proposed.map((lesson) => lesson.proposedGate!.id)
  };
}
