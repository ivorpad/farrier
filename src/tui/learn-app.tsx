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
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

/**
 * The learn surface: deterministic failure mining over this project's local
 * session transcripts, each mined failure routed to the cheapest primitive
 * (hook, AGENTS.md rule, skill) as a reviewable proposal. Mining counts on
 * this computer only; nothing is sent anywhere. Applying goes through the
 * shared AdviceApplyFlow review — exact files first, explicit confirmation,
 * atomic write with backups.
 */

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
    lines.push({ fg: palette.muted, text: "Nothing is installed from here; use Create skill from the main menu." });
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
}) {
  const [phase, setPhase] = useState<LearnPhase>({ kind: "mining" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [reviewing, setReviewing] = useState<PrimitiveProposal>();
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

  const listBindings = defineBindings(
    binding(["up", "down"], "move", "proposals"),
    binding("enter", "activate", "review"),
    binding(["pageup", "pagedown"], "scroll", "scroll"),
    binding(["escape", "b"], "back", "launcher"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );
  const idleBindings = defineBindings(
    binding(["escape", "b"], "back", "launcher"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );

  const proposals = phase.kind === "list" ? phase.result.proposals : [];
  const activeBindings = phase.kind === "list" && proposals.length > 0 ? listBindings : idleBindings;

  useKeyboard((key) => {
    if (reviewing) return;
    const intent = resolveIntent(activeBindings, key);
    if (intent === "back" || intent === "quit") props.onExit();
    else if (intent === "scroll") bodyScrollRef.current?.scrollBy(key.name === "pagedown" ? 0.85 : -0.85, "viewport");
    else if (intent === "move") {
      setActionMessage(undefined);
      setSelectedIndex((current) => Math.min(Math.max(0, current + (key.name === "down" ? 1 : -1)), proposals.length - 1));
    } else if (intent === "activate") {
      const proposal = proposals[selectedIndex];
      if (!proposal) return;
      if (proposal.kind === "skill-suggestion") {
        setActionMessage(`Nothing to install for a skill. Use Create skill from the main menu and search: ${proposal.query}`);
        return;
      }
      setActionMessage(undefined);
      setReviewing(proposal);
    }
  });

  if (reviewing) {
    const proposal = reviewing;
    return (
      <AdviceApplyFlow
        recommendation={{ id: proposal.title }}
        onPlan={async () => {
          const planned = await props.onPlan(proposal);
          if (planned.kind !== "files") {
            throw new Error("This proposal does not create files; use Create skill from the main menu.");
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
        <text fg={palette.accent}>✦ Learn from failures</text>
        <text fg={palette.muted}>Counts repeated failures in this project's local session transcripts. Counting stays on this computer.</text>
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
          <text style={{ flexShrink: 0 }} fg={palette.warn}>Learn failed: {phase.message}</text>
        ) : null}
        {phase.kind === "list" ? (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            <text style={{ flexShrink: 0 }} fg={palette.faint}>{`Transcripts: ${phase.result.transcriptsDir}`}</text>
            {phase.result.notes.map((note, index) => (
              <text key={`note-${index}`} style={{ flexShrink: 0 }} fg={palette.faint}>{note}</text>
            ))}
          </box>
        ) : null}
        {phase.kind === "list" && proposals.length === 0 ? (
          <text style={{ flexShrink: 0 }} fg={palette.muted}>No repeated failures found in the local transcripts. Nothing to propose.</text>
        ) : null}
        {phase.kind === "list" && proposals.length > 0 ? (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            <text style={{ flexShrink: 0 }} fg={palette.gold}>{`${proposals.length} proposal(s) from ${phase.result.signals.length} failure signal(s) · nothing applied yet`}</text>
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

export async function runLearnApp(targetDir: string): Promise<void> {
  const loadCatalog = async () => {
    const { loadConfiguredCatalog, registryRefsFromManifest } = await import("../cli/registry");
    const requireRefs = await registryRefsFromManifest(targetDir);
    return loadConfiguredCatalog({ targetDir, requireRefs });
  };
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  try {
    renderer = await createCliRenderer();
    const cliRenderer = renderer;
    await new Promise<void>((done) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        cliRenderer.destroy();
        done();
      };
      createRoot(cliRenderer).render(
        <LearnApp
          onMine={async () => minePrimitiveProposals({ targetDir, catalog: await loadCatalog() })}
          onPlan={async (proposal) => planPrimitiveProposal({ targetDir, proposal, catalog: await loadCatalog() })}
          onApply={(plan, force) => applyProposalPlan(targetDir, plan, force)}
          onExit={finish}
        />
      );
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier: ${error instanceof Error ? error.message : String(error)}`);
  }
}
