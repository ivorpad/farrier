import { createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { AdviceCreationPlan } from "../engine/advice-apply";
import type { ApplyHarnessChangePlanResult } from "../engine/create-plan";
import { citeEvidence, type PrimitiveProposal } from "../engine/failure-router";
import {
  applyProposalPlan,
  minePrimitiveProposals,
  planPrimitiveProposal,
  type PlannedProposal,
  type ProposalMiningResult
} from "../engine/proposal-apply";
import { AdviceApplyFlow, advicePlanPreviewLines } from "./AdviceApplyFlow";
import { DetailPane, KeyHints, palette, useSpinner, type PaneLine } from "./chrome";
import { ImproveAnalysisFlow, type ImproveAnalysisDeps } from "./ImproveAnalysisFlow";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";
import { loadSessionBackendSettings, type SessionAgentContext } from "./session-context";

/**
 * The Improve surface, tier one: deterministic failure mining over this
 * project's local session transcripts, each mined failure routed to the
 * cheapest primitive (hook, AGENTS.md rule, skill) as a reviewable proposal.
 * Mining counts on this computer only; nothing is sent anywhere. Applying
 * goes through the shared AdviceApplyFlow review — exact files first,
 * explicit confirmation, atomic write with backups. Tier two (the consented
 * LLM analysis) is the existing advise wizard, reached via onDeeper; skill
 * suggestions jump to the Skills surface via onFindSkills.
 */

export type ImproveOutcome = "back" | { kind: "advise" } | { kind: "find-skills"; query: string };

type LearnPhase =
  | { kind: "mining" }
  | { kind: "list"; result: ProposalMiningResult }
  | { kind: "error"; message: string };

/** Ecosystem noun for each proposal kind — the only vocabulary the list uses. */
export function proposalKindNoun(kind: PrimitiveProposal["kind"]): string {
  if (kind === "guard-instance") return "hook";
  if (kind === "rules-line") return "AGENTS.md rule";
  return "skill";
}

// Wide enough for the longest noun with the applied marker ("✓ AGENTS.md rule").
const nounColumn = "AGENTS.md rule".length + 4;
const detailWidth = 56;

export function proposalDetailLines(proposal: PrimitiveProposal, applied: boolean): PaneLine[] {
  const lines: PaneLine[] = [
    { fg: palette.gold, text: citeEvidence(proposal.evidence) },
    ...advicePlanPreviewLines(proposal.message, detailWidth).map((text) => ({ fg: palette.muted, text }))
  ];
  for (const sample of proposal.evidence.flatMap((signal) => signal.samples).slice(0, 3)) {
    lines.push({ fg: palette.faint, text: `e.g. ${sample}` });
  }
  if (proposal.kind === "skill-suggestion") {
    lines.push({ fg: palette.gold, text: `Skill search: ${proposal.query}` });
    lines.push({ fg: palette.muted, text: "Nothing is installed from here; enter searches the Skills registry." });
  }
  if (applied) {
    lines.push({ fg: palette.success, text: "Applied in this session." });
  }
  return lines;
}

export function LearnApp(props: {
  onMine: () => Promise<ProposalMiningResult>;
  onPlan: (proposal: PrimitiveProposal) => Promise<PlannedProposal>;
  onApply: (plan: AdviceCreationPlan, force: boolean) => Promise<ApplyHarnessChangePlanResult>;
  onExit: () => void;
  /** Tier two: hands off to the consented LLM analysis (the advise wizard). */
  onDeeper?: () => void;
  /** Label for the tier-two hint line, e.g. "claude (default model)". */
  llmBackendLabel?: string;
  /** Skill suggestions jump to the Skills surface with the query prefilled. */
  onFindSkills?: (query: string) => void;
  /** The session-evidence analysis (select sessions → consent → typed proposals). */
  analysis?: ImproveAnalysisDeps;
}) {
  const [phase, setPhase] = useState<LearnPhase>({ kind: "mining" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [reviewing, setReviewing] = useState<PrimitiveProposal>();
  const [analyzing, setAnalyzing] = useState(false);
  const [appliedIds, setAppliedIds] = useState<ReadonlySet<string>>(new Set());
  const [actionMessage, setActionMessage] = useState<string>();
  const bodyScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const spinner = useSpinner(phase.kind === "mining");

  useEffect(() => {
    let cancelled = false;
    props.onMine()
      .then((result) => {
        if (!cancelled) setPhase({ kind: "list", result });
      })
      .catch((error) => {
        if (!cancelled) setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const deeperBindings = props.onDeeper ? [binding("a", "deeper", "LLM analysis")] : [];
  const analysisBindings = props.analysis ? [binding("s", "analyze", "learn from sessions")] : [];
  const listBindings = defineBindings(
    binding(["up", "down"], "move", "proposals"),
    binding("enter", "activate", "review"),
    ...analysisBindings,
    ...deeperBindings,
    binding(["pageup", "pagedown"], "scroll", "scroll"),
    binding(["escape", "b"], "back", "launcher"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );
  const idleBindings = defineBindings(
    ...analysisBindings,
    ...deeperBindings,
    binding(["escape", "b"], "back", "launcher"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );

  const proposals = phase.kind === "list" ? phase.result.proposals : [];
  const activeBindings = phase.kind === "list" && proposals.length > 0 ? listBindings : idleBindings;

  useKeyboard((key) => {
    if (reviewing || analyzing) return;
    const intent = resolveIntent(activeBindings, key);
    if (intent === "back" || intent === "quit") props.onExit();
    else if (intent === "analyze" && phase.kind !== "mining") setAnalyzing(true);
    else if (intent === "deeper" && phase.kind !== "mining") props.onDeeper?.();
    else if (intent === "scroll") bodyScrollRef.current?.scrollBy(key.name === "pagedown" ? 0.85 : -0.85, "viewport");
    else if (intent === "move") {
      setActionMessage(undefined);
      setSelectedIndex((current) => Math.min(Math.max(0, current + (key.name === "down" ? 1 : -1)), proposals.length - 1));
    } else if (intent === "activate") {
      const proposal = proposals[selectedIndex];
      if (!proposal) return;
      if (proposal.kind === "skill-suggestion") {
        if (props.onFindSkills) {
          props.onFindSkills(proposal.query);
          return;
        }
        setActionMessage(`Nothing to install for a skill. Open Find skills from the main menu and search: ${proposal.query}`);
        return;
      }
      // Guard/hook proposals write into farrier's manifest and hook bindings;
      // without .farrier.json planProposal would refuse after the review
      // screen, so say so here. Rules lines only write AGENTS.md and apply to
      // a hand-harnessed repo — sessions exist regardless of the manifest.
      // If the repo already has agent files, never claim "no harness": the
      // manifest is farrier's bookkeeping, not the user's setup.
      if (phase.kind === "list" && !phase.result.harnessPresent && proposal.kind === "guard-instance") {
        setActionMessage(
          phase.result.existingAgentFiles.length > 0
            ? "This hook writes into farrier's manifest (.farrier.json), which this project doesn't have yet. Run Create harness from the main menu; your existing files are reviewed and can be kept."
            : "This hook installs into the harness. Choose Create harness from the main menu first, then come back to apply it."
        );
        return;
      }
      setActionMessage(undefined);
      setReviewing(proposal);
    }
  });

  if (analyzing && props.analysis) {
    return (
      <ImproveAnalysisFlow
        {...props.analysis}
        onFindSkills={(query) => {
          if (props.onFindSkills) props.onFindSkills(query);
          else setAnalyzing(false);
        }}
        onBack={() => setAnalyzing(false)}
        onExit={props.onExit}
      />
    );
  }

  if (reviewing) {
    const proposal = reviewing;
    return (
      <AdviceApplyFlow
        recommendation={{ id: proposal.title }}
        onPlan={async () => {
          const planned = await props.onPlan(proposal);
          if (planned.kind !== "files") {
            throw new Error("This proposal does not create files; use Find skills from the main menu.");
          }
          return { plan: planned.plan, inspection: planned.inspection };
        }}
        onApply={async (plan, force) => {
          const result = await props.onApply(plan, force);
          setAppliedIds((current) => new Set(current).add(proposal.id));
          return result;
        }}
        onBack={() => setReviewing(undefined)}
        onCancel={props.onExit}
        onDone={props.onExit}
      />
    );
  }

  const selected = proposals[Math.min(selectedIndex, Math.max(proposals.length - 1, 0))];

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text fg={palette.accent}>✦ Improve</text>
        <text fg={palette.muted}>Counts repeated failures in this project's local session transcripts. Counting stays on this computer.</text>
        {props.analysis ? (
          <text fg={palette.faint}>
            {`Learn from sessions: s picks sessions and proposes typed harness changes (with ${props.analysis.backendLabel}).`}
          </text>
        ) : null}
        {props.onDeeper ? (
          <text fg={palette.faint}>
            {`Deeper pass: a runs the LLM analysis (repo + consented session evidence${props.llmBackendLabel ? ` with ${props.llmBackendLabel}` : ""}).`}
          </text>
        ) : null}
      </box>
      {/*
        The body is a bounded scroll region with flexShrink:0 children — on a
        short terminal opentui otherwise shrinks flex siblings while their text
        keeps its rows, and lines overwrite one another.
      */}
      <scrollbox
        ref={bodyScrollRef}
        focused={false}
        scrollX={false}
        scrollY
        stickyScroll
        stickyStart="top"
        viewportCulling
        style={{ flexGrow: 1, flexShrink: 1, width: "100%" }}
        contentOptions={{ flexDirection: "column", gap: 1, width: "100%" }}
      >
        {phase.kind === "mining" ? (
          <text style={{ flexShrink: 0 }} fg={palette.agent}>{`${spinner}  Reading local session transcripts…`}</text>
        ) : null}
        {phase.kind === "error" ? (
          <text style={{ flexShrink: 0 }} fg={palette.warn}>Failure mining failed: {phase.message}</text>
        ) : null}
        {phase.kind === "list" ? (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            <text style={{ flexShrink: 0 }} fg={palette.faint}>{`Transcripts: ${phase.result.transcriptsDir}`}</text>
            {phase.result.notes.map((note, index) => (
              <text key={`note-${index}`} style={{ flexShrink: 0 }} fg={palette.faint}>{note}</text>
            ))}
            {!phase.result.harnessPresent ? (
              phase.result.existingAgentFiles.length > 0 ? (
                <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
                  <text style={{ flexShrink: 0 }} fg={palette.gold}>
                    {`Found ${phase.result.existingAgentFiles.join(" and ")}, but farrier isn't set up in this project yet: rule lines apply into AGENTS.md now; hook proposals need Create harness first.`}
                  </text>
                  <text style={{ flexShrink: 0 }} fg={palette.muted}>
                    Create harness (main menu) sets it up; existing files are reviewed first and can be kept as-is.
                  </text>
                </box>
              ) : (
                <text style={{ flexShrink: 0 }} fg={palette.gold}>
                  No harness in this project yet: rule lines still apply (they create AGENTS.md); hook proposals need Create harness from the main menu first.
                </text>
              )
            ) : null}
          </box>
        ) : null}
        {phase.kind === "list" && proposals.length === 0 ? (
          <text style={{ flexShrink: 0 }} fg={palette.muted}>
            {`No repeated failures found in the local transcripts. Nothing to propose.${props.onDeeper ? " The deeper LLM analysis (a) may still find improvements." : ""}`}
          </text>
        ) : null}
        {phase.kind === "list" && proposals.length > 0 ? (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            <text style={{ flexShrink: 0 }} fg={palette.gold}>{`${proposals.length} proposal(s) from ${phase.result.signals.length} failure signal(s) · ${phase.result.harnessPresent ? "nothing applied yet" : "hook proposals locked until farrier is set up"}`}</text>
            {proposals.map((proposal, index) => {
              const focused = index === selectedIndex;
              const applied = appliedIds.has(proposal.id);
              return (
                <text key={proposal.id} style={{ flexShrink: 0 }} bg={focused ? palette.selBg : undefined}>
                  <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
                  <span fg={applied ? palette.success : palette.gold}>{`${(applied ? "✓ " : "") + proposalKindNoun(proposal.kind)}`.padEnd(nounColumn)}</span>
                  <span fg={palette.text}>{proposal.title}</span>
                </text>
              );
            })}
          </box>
        ) : null}
        {selected ? (
          <DetailPane
            title={proposalKindNoun(selected.kind)}
            lines={proposalDetailLines(selected, appliedIds.has(selected.id))}
          />
        ) : null}
        {actionMessage ? <text style={{ flexShrink: 0 }} fg={palette.gold}>{actionMessage}</text> : null}
      </scrollbox>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text fg={palette.muted}>Nothing is applied without confirmation; reviewing a proposal shows the exact files first.</text>
        <KeyHints hint={bindingsHint(activeBindings)} />
      </box>
    </box>
  );
}

export async function runImproveApp(
  targetDir: string,
  options: { llmAnalysisAvailable?: boolean; llmBackendLabel?: string; session?: SessionAgentContext } = {}
): Promise<ImproveOutcome> {
  // Memoized: the review keypress path plans against the same catalog; do
  // not re-read manifest refs and registry files on every Enter. A rejection
  // is not cached — a transient read failure must stay retryable.
  let catalogPromise: ReturnType<typeof loadCatalogOnce> | undefined;
  const loadCatalogOnce = async () => {
    const { loadConfiguredCatalog, registryRefsFromManifest } = await import("../cli/registry");
    const requireRefs = await registryRefsFromManifest(targetDir);
    return loadConfiguredCatalog({ targetDir, requireRefs });
  };
  const loadCatalog = () =>
    (catalogPromise ??= loadCatalogOnce().catch((error: unknown) => {
      catalogPromise = undefined;
      throw error;
    }));

  let analysis: ImproveAnalysisDeps | undefined;
  if (options.llmAnalysisAvailable) {
    // The consent screen names exactly what would run: the startup-picked
    // model/effort when set, the config default otherwise. The engine
    // modules load lazily inside each callback so the Improve list renders
    // without paying for an analysis the user may never start.
    const { backend, settings, backendLabel } = await loadSessionBackendSettings({
      projectDir: targetDir,
      session: options.session,
      role: "advise"
    });

    analysis = {
      backendLabel,
      onListSessions: async () => {
        const { listImproveSessions } = await import("../engine/improve-sessions");
        return listImproveSessions({ targetDir });
      },
      onMine: async (selection) => {
        const { mineImproveEvidence } = await import("../engine/improve-authoring");
        return mineImproveEvidence({ targetDir, ...(selection ? { selection } : {}) });
      },
      onAuthor: async (input) => {
        const { authorImproveProposals } = await import("../engine/improve-authoring");
        const { defaultBackendRunner } = await import("../engine/backend");
        return authorImproveProposals({
          targetDir,
          ...input,
          backend,
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
          runner: defaultBackendRunner
        });
      },
      onPlan: async (proposal) => {
        const { planImproveProposal } = await import("../engine/improve-apply");
        return planImproveProposal({ targetDir, proposal, catalog: await loadCatalog() });
      },
      onApply: async (plan, force) => {
        const { applyImprovePlan } = await import("../engine/improve-apply");
        return applyImprovePlan(targetDir, plan, force);
      },
      onRecordDecision: async (decision) => {
        const { appendReviewDecision } = await import("../engine/review-ledger");
        await appendReviewDecision(targetDir, decision);
      }
    };
  }

  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  try {
    renderer = await createCliRenderer();
    const cliRenderer = renderer;
    return await new Promise<ImproveOutcome>((done) => {
      let settled = false;
      const finish = (outcome: ImproveOutcome) => {
        if (settled) return;
        settled = true;
        cliRenderer.destroy();
        done(outcome);
      };
      createRoot(cliRenderer).render(
        <LearnApp
          onMine={async () => minePrimitiveProposals({ targetDir, catalog: await loadCatalog() })}
          onPlan={async (proposal) => planPrimitiveProposal({ targetDir, proposal, catalog: await loadCatalog() })}
          onApply={(plan, force) => applyProposalPlan(targetDir, plan, force)}
          onExit={() => finish("back")}
          onDeeper={options.llmAnalysisAvailable ? () => finish({ kind: "advise" }) : undefined}
          llmBackendLabel={options.llmBackendLabel}
          onFindSkills={(query) => finish({ kind: "find-skills", query })}
          analysis={analysis}
        />
      );
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier: ${error instanceof Error ? error.message : String(error)}`);
    return "back";
  }
}
