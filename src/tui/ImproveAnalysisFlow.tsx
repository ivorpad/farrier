import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { AdviceCreationPlan } from "../engine/advice-apply";
import type { SessionIndexEntry } from "../engine/advice-sessions";
import type { ApplyHarnessChangePlanResult } from "../engine/create-plan";
import type { PlannedImprove } from "../engine/improve-apply";
import type { DroppedImproveProposal, HarnessSnapshot, ImproveProposal } from "../engine/improve-authoring";
import { improveSessionSelection, type ImproveSessionList } from "../engine/improve-sessions";
import type { ReviewDecision } from "../engine/review-ledger";
import type { SessionEvidence, SessionSelection } from "../engine/session-evidence";
import { AdviceApplyFlow, advicePlanPreviewLines } from "./AdviceApplyFlow";
import { AdviceSessionPicker } from "./AdviceSessionPicker";
import { DetailPane, KeyHints, palette, useSpinner, type PaneLine } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

/**
 * The Improve LLM pass: the user selects sessions, optionally states what
 * matters now, farrier mines them locally, and — after explicit consent —
 * the backend diffs the evidence against the current harness snapshot into
 * typed, cited proposals. Every apply goes through the shared AdviceApplyFlow
 * review; new skills hand off to the skill flow; pruning stays advisory.
 */

export type Mined = { evidence: SessionEvidence; snapshot: HarnessSnapshot };
export type Authored = { proposals: ImproveProposal[]; dropped: DroppedImproveProposal[] };

/** What a runner must supply (the flow adds its own navigation callbacks). */
export type ImproveAnalysisDeps = {
  backendLabel: string;
  onListSessions: () => Promise<ImproveSessionList>;
  onMine: (selection: SessionSelection | undefined) => Promise<Mined>;
  onAuthor: (input: { evidence: SessionEvidence; snapshot: HarnessSnapshot; focus?: string }) => Promise<Authored>;
  onPlan: (proposal: ImproveProposal) => Promise<PlannedImprove>;
  onApply: (plan: AdviceCreationPlan, force: boolean) => Promise<ApplyHarnessChangePlanResult>;
  /**
   * Records an accept/reject into the local review ledger. Optional: absent in
   * tests or when the runner does not persist. Failures must never block the
   * action being recorded — the caller surfaces a warning instead.
   */
  onRecordDecision?: (decision: ReviewDecision) => Promise<void>;
};

type Phase =
  | { kind: "listing" }
  | { kind: "picking"; list: ImproveSessionList }
  | { kind: "focus"; selection?: SessionSelection; sessionCount: number }
  | { kind: "mining"; focus?: string }
  | { kind: "consent"; mined: Mined; focus?: string; sessionCount: number }
  | { kind: "authoring"; mined: Mined }
  | { kind: "proposals"; mined: Mined; authored: Authored }
  | { kind: "error"; message: string };

const detailWidth = 56;

/** Ecosystem noun for each proposal kind — the vocabulary the list uses. */
export function improveKindNoun(kind: ImproveProposal["kind"]): string {
  if (kind === "new-skill") return "new skill";
  if (kind === "kb-rule") return "preference rule";
  if (kind === "agents-md-edit") return "AGENTS.md edit";
  if (kind === "guard-instance") return "hook";
  if (kind === "subagent") return "subagent";
  if (kind === "skill-rescope") return "skill re-scope";
  return "prune";
}

const nounColumn = "preference rule".length + 4;

export function improveProposalDetailLines(
  proposal: ImproveProposal,
  evidence: SessionEvidence,
  applied: boolean
): PaneLine[] {
  const lines: PaneLine[] = [
    { fg: palette.gold, text: proposal.evidence },
    ...advicePlanPreviewLines(proposal.rationale, detailWidth).map((text) => ({ fg: palette.muted, text }))
  ];
  for (const index of proposal.citations.steerIndexes.slice(0, 2)) {
    const steer = evidence.steers[index];
    if (steer) lines.push({ fg: palette.faint, text: `steer: ${steer.text.replace(/\s+/g, " ").slice(0, 120)}` });
  }
  for (const index of proposal.citations.clusterIndexes.slice(0, 2)) {
    const cluster = evidence.failureClusters[index];
    if (cluster) lines.push({ fg: palette.faint, text: `failures: ${cluster.key} ${cluster.count}× / ${cluster.sessionCount} session(s)` });
  }
  if (proposal.kind === "new-skill") {
    lines.push({ fg: palette.gold, text: `Skill: ${proposal.name}. Enter opens the skill flow; nothing installs from here.` });
  } else if (proposal.kind === "prune-skill") {
    lines.push({ fg: palette.gold, text: "Advisory only: farrier never deletes files." });
  } else if (proposal.kind === "kb-rule") {
    lines.push({ fg: palette.gold, text: `Tier: ${proposal.tier}${proposal.owner ? ` · owner: ${proposal.owner}` : ""}. Enter reviews the exact files.` });
  } else {
    lines.push({ fg: palette.gold, text: "Enter reviews the exact files before anything is saved." });
  }
  if (applied) lines.push({ fg: palette.success, text: "Applied in this session." });
  return lines;
}

export function ImproveAnalysisFlow(props: ImproveAnalysisDeps & {
  onFindSkills: (query: string) => void;
  onBack: () => void;
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "listing" });
  const [focusText, setFocusText] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [reviewing, setReviewing] = useState<{ proposal: ImproveProposal; planned: Extract<PlannedImprove, { kind: "files" }> }>();
  const [appliedIds, setAppliedIds] = useState<ReadonlySet<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<ReadonlySet<string>>(new Set());
  const [actionMessage, setActionMessage] = useState<string>();
  const bodyScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const busy = phase.kind === "listing" || phase.kind === "mining" || phase.kind === "authoring";
  const spinner = useSpinner(busy);

  useEffect(() => {
    let cancelled = false;
    props.onListSessions()
      .then((list) => {
        if (cancelled) return;
        // No discoverable sessions: mine everything the directories hold.
        if (list.entries.length === 0) setPhase({ kind: "focus", sessionCount: 0 });
        else setPhase({ kind: "picking", list });
      })
      .catch((error) => {
        if (!cancelled) setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startMining = (selection: SessionSelection | undefined, focus: string | undefined, sessionCount: number) => {
    setPhase({ kind: "mining", ...(focus ? { focus } : {}) });
    props.onMine(selection)
      .then((mined) => setPhase({ kind: "consent", mined, ...(focus ? { focus } : {}), sessionCount }))
      .catch((error) => setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) }));
  };

  const startAuthoring = (mined: Mined, focus: string | undefined) => {
    setPhase({ kind: "authoring", mined });
    props.onAuthor({ evidence: mined.evidence, snapshot: mined.snapshot, ...(focus ? { focus } : {}) })
      .then((authored) => setPhase({ kind: "proposals", mined, authored }))
      .catch((error) => setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) }));
  };

  // Records an accept/reject locally; a ledger write failure only warns — it
  // must never undo or block the action it is recording.
  const recordDecision = (proposal: ImproveProposal, decision: ReviewDecision["decision"]) => {
    if (!props.onRecordDecision) return;
    props
      .onRecordDecision({ proposalId: proposal.id, kind: proposal.kind, title: proposal.title, decision, at: new Date().toISOString() })
      .catch((error) => setActionMessage(`Couldn't record the review decision: ${error instanceof Error ? error.message : String(error)}`));
  };

  const consentBindings = defineBindings(
    binding("y", "consent", "analyze"),
    binding("n", "decline", "cancel"),
    binding(["escape", "b"], "back", "back"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );
  const proposalsBindings = defineBindings(
    binding(["up", "down"], "move", "proposals"),
    binding("enter", "activate", "review"),
    binding("n", "reject", "not now"),
    binding(["pageup", "pagedown"], "scroll", "scroll"),
    binding(["escape", "b"], "back", "improve"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );
  const idleBindings = defineBindings(
    binding(["escape", "b"], "back", "back"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );

  const proposals = phase.kind === "proposals" ? phase.authored.proposals : [];
  const activeBindings =
    phase.kind === "consent" ? consentBindings : phase.kind === "proposals" && proposals.length > 0 ? proposalsBindings : idleBindings;

  useKeyboard((key) => {
    if (reviewing || phase.kind === "picking" || phase.kind === "focus") return;
    const intent = resolveIntent(activeBindings, key);
    if (intent === "quit") {
      props.onExit();
      return;
    }
    if (intent === "back") {
      props.onBack();
      return;
    }
    if (phase.kind === "consent") {
      if (intent === "consent") startAuthoring(phase.mined, phase.focus);
      else if (intent === "decline") props.onBack();
      return;
    }
    if (phase.kind !== "proposals") return;
    if (intent === "scroll") bodyScrollRef.current?.scrollBy(key.name === "pagedown" ? 0.85 : -0.85, "viewport");
    else if (intent === "move") {
      setActionMessage(undefined);
      setSelectedIndex((current) => Math.min(Math.max(0, current + (key.name === "down" ? 1 : -1)), proposals.length - 1));
    } else if (intent === "reject") {
      const proposal = proposals[selectedIndex];
      if (!proposal || appliedIds.has(proposal.id) || rejectedIds.has(proposal.id)) return;
      setRejectedIds((current) => new Set(current).add(proposal.id));
      setActionMessage(`Marked "${proposal.title}" as not now — recorded so it is not proposed again unchanged.`);
      recordDecision(proposal, "rejected");
    } else if (intent === "activate") {
      const proposal = proposals[selectedIndex];
      if (!proposal) return;
      setActionMessage(undefined);
      props.onPlan(proposal)
        .then((planned) => {
          if (planned.kind === "skill") props.onFindSkills(planned.query);
          else if (planned.kind === "advisory") setActionMessage(planned.message);
          else setReviewing({ proposal, planned });
        })
        .catch((error) => setActionMessage(error instanceof Error ? error.message : String(error)));
    }
  });

  if (phase.kind === "picking") {
    return (
      <AdviceSessionPicker
        entries={phase.list.entries}
        selectionCap={Math.max(phase.list.entries.length, 1)}
        presets
        title="✦ Choose the sessions Improve learns from"
        subtitle="mining stays on this computer; sending anything comes later, behind its own consent"
        onConfirm={(chosen: SessionIndexEntry[]) => {
          const selection = improveSessionSelection(chosen, phase.list);
          setPhase({ kind: "focus", selection, sessionCount: chosen.length });
        }}
        onCancel={props.onBack}
      />
    );
  }

  if (phase.kind === "focus") {
    return (
      <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          <text fg={palette.accent}>✦ What matters to you now? (optional)</text>
          <text fg={palette.muted}>Steers the analysis toward it — strong evidence outside the focus is still reported, never filtered.</text>
        </box>
        <input
          value={focusText}
          focused
          onInput={(value) => setFocusText(String(value))}
          onSubmit={() => startMining(phase.selection, focusText.trim() || undefined, phase.sessionCount)}
          onKeyDown={(key) => {
            if (key.name === "escape" || key.sequence === "\u001b") {
              key.preventDefault();
              key.stopPropagation();
              props.onBack();
            }
          }}
          placeholder="e.g. design consistency, disk hygiene — Enter to continue"
        />
        <text fg={palette.faint}>Enter continues (empty is fine) · Esc cancels</text>
      </box>
    );
  }

  if (reviewing) {
    const { proposal, planned } = reviewing;
    return (
      <AdviceApplyFlow
        recommendation={{ id: proposal.title }}
        onPlan={async () => ({ plan: planned.plan, inspection: planned.inspection })}
        onApply={async (plan, force) => {
          const result = await props.onApply(plan, force);
          setAppliedIds((current) => new Set(current).add(proposal.id));
          recordDecision(proposal, "accepted");
          return result;
        }}
        onBack={() => setReviewing(undefined)}
        onCancel={props.onExit}
        onDone={() => setReviewing(undefined)}
      />
    );
  }

  const selected = proposals[Math.min(selectedIndex, Math.max(proposals.length - 1, 0))];

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text fg={palette.accent}>✦ Improve from sessions</text>
        <text fg={palette.muted}>Your selected sessions against the current harness: typed, cited proposals you review one by one.</text>
      </box>
      {/* Bounded scroll region with flexShrink:0 children (short-terminal overlap rule). */}
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
        {phase.kind === "listing" ? (
          <text style={{ flexShrink: 0 }} fg={palette.agent}>{`${spinner}  Finding this project's sessions… nothing leaves this computer.`}</text>
        ) : null}
        {phase.kind === "mining" ? (
          <text style={{ flexShrink: 0 }} fg={palette.agent}>{`${spinner}  Reading the selected sessions locally… nothing leaves this computer.`}</text>
        ) : null}
        {phase.kind === "authoring" ? (
          <text style={{ flexShrink: 0 }} fg={palette.agent}>{`${spinner}  Analyzing with ${props.backendLabel}… usually a minute or two.`}</text>
        ) : null}
        {phase.kind === "error" ? (
          <text style={{ flexShrink: 0 }} fg={palette.warn}>Improve analysis failed: {phase.message}</text>
        ) : null}
        {phase.kind === "consent" ? (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            <text style={{ flexShrink: 0 }} fg={palette.gold}>
              {`Mined locally from ${phase.sessionCount > 0 ? `${phase.sessionCount} selected` : "all"} session(s): ${phase.mined.evidence.steers.length} steer(s), ${phase.mined.evidence.failureClusters.length} failure cluster(s), ${phase.mined.evidence.skillUsage.filter((skill) => skill.installed).length} installed skill(s) tracked.`}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.text}>{`Analyze with ${props.backendLabel}?`}</text>
            {/*
              One category per line so the full disclosure stays honest and
              readable on any width (consent accuracy is a repo P0). Each line
              is its own item, so wrapping never hides a category.
            */}
            <text style={{ flexShrink: 0 }} fg={palette.text}>{"Sends to the model, only after you say yes:"}</text>
            <text style={{ flexShrink: 0 }} fg={palette.muted}>
              {"• redacted quotes of your steering messages"}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.muted}>
              {"• the assistant action each steering message followed (redacted and shortened)"}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.muted}>
              {"• per-session counts of your steers, edits, and commands, plus the top folders you worked in"}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.muted}>
              {"• how often commands failed, and how often each installed skill was used"}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.muted}>
              {"• your harness text: AGENTS.md, CLAUDE.md, and skill and subagent descriptions"}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.muted}>
              {"Never sent: session ids, file contents outside the harness, other projects."}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.warn}>
              {"Limit: redaction is a deterministic denylist; secrets or personal details typed as ordinary prose are NOT caught."}
            </text>
            {phase.focus ? <text style={{ flexShrink: 0 }} fg={palette.gold}>{`Focus: ${phase.focus}`}</text> : null}
            <text style={{ flexShrink: 0 }} fg={palette.text}>{"[y] analyze   [n] cancel"}</text>
          </box>
        ) : null}
        {phase.kind === "proposals" ? (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            {phase.mined.evidence.notes.slice(-2).map((note, index) => (
              <text key={`note-${index}`} style={{ flexShrink: 0 }} fg={palette.faint}>{note}</text>
            ))}
            {phase.authored.dropped.length > 0 ? (
              <text style={{ flexShrink: 0 }} fg={palette.faint}>
                {`${phase.authored.dropped.length} proposal(s) failed validation and were dropped (uncited or out of bounds).`}
              </text>
            ) : null}
          </box>
        ) : null}
        {phase.kind === "proposals" && proposals.length === 0 ? (
          <text style={{ flexShrink: 0 }} fg={palette.muted}>The analysis proposed nothing that survived validation. The harness may already match these sessions.</text>
        ) : null}
        {phase.kind === "proposals" && proposals.length > 0 ? (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            <text style={{ flexShrink: 0 }} fg={palette.gold}>{`${proposals.length} proposal(s) · every one cites its evidence · nothing applies without review`}</text>
            {proposals.map((proposal, index) => {
              const focused = index === selectedIndex;
              const applied = appliedIds.has(proposal.id);
              const rejected = rejectedIds.has(proposal.id);
              const marker = applied ? "✓ " : rejected ? "✗ " : "";
              return (
                <text key={proposal.id} style={{ flexShrink: 0 }} bg={focused ? palette.selBg : undefined}>
                  <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
                  <span fg={applied ? palette.success : rejected ? palette.muted : palette.gold}>{`${marker + improveKindNoun(proposal.kind)}`.padEnd(nounColumn)}</span>
                  <span fg={palette.text}>{proposal.title}</span>
                </text>
              );
            })}
          </box>
        ) : null}
        {phase.kind === "proposals" && selected ? (
          <DetailPane
            title={improveKindNoun(selected.kind)}
            lines={improveProposalDetailLines(selected, phase.mined.evidence, appliedIds.has(selected.id))}
          />
        ) : null}
        {actionMessage ? <text style={{ flexShrink: 0 }} fg={palette.gold}>{actionMessage}</text> : null}
      </scrollbox>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text fg={palette.muted}>Nothing is sent or written without confirmation; the file review comes before any save.</text>
        <KeyHints hint={bindingsHint(activeBindings)} />
      </box>
    </box>
  );
}
