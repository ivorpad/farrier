import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { CreateAgent, SkillCreationOutcome } from "../engine/create-skill";
import {
  evaluatePerAgentSkill,
  perAgentEvalCandidates,
  resolvePerAgentSkillWinner,
  type PerAgentSkillNames,
  type SkillEvalCandidate,
  type SkillEvalVerdict,
  type SkillWinnerResolution
} from "../engine/eval-skill";
import { nativeSkillRoots } from "../engine/create-skill";
import { palette, truncateTo, useSpinner } from "./chrome";

export type PendingSkillEval = SkillEvalCandidate;

export const eligiblePerAgentEvals = perAgentEvalCandidates;

/**
 * Decided on the creation form, before authoring starts. "auto" is the only
 * consent that lets the flow delete without a per-verdict confirmation, which
 * is why it must be chosen explicitly upfront and is never the default.
 */
export type SkillEvalPolicy = "ask" | "auto" | "skip";

export const evalPolicyLabels: Record<SkillEvalPolicy, string> = {
  ask: "compare copies & I pick the winner",
  auto: "compare & auto-apply the winner (loser kept in trash)",
  skip: "skip the compare"
};

export function nextEvalPolicy(current: SkillEvalPolicy): SkillEvalPolicy {
  return current === "ask" ? "auto" : current === "auto" ? "skip" : "ask";
}

export function EvalProgressScreen(props: { skillName: string; onCancel: () => void }) {
  const spinner = useSpinner(true);

  useKeyboard((key) => {
    if ((key.ctrl && key.name === "c") || key.name === "escape" || key.name === "q") {
      props.onCancel();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.accent}>{`${spinner}  Evaluating ${props.skillName} copies with the pinned skill-creator guidance…`}</text>
      <text fg={palette.muted}>This is read-only. The recommendation is advisory until you explicitly pick a winner.</text>
      <text fg={palette.gold}>
        {"esc "}
        <span fg={palette.muted}>cancel</span>
      </text>
    </box>
  );
}

export function EvalErrorScreen(props: { message: string; onBack: () => void }) {
  useKeyboard((key) => {
    if (key.name === "enter" || key.name === "return" || key.name === "linefeed" || key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
      props.onBack();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.warn}>{`✗ Eval failed: ${props.message}`}</text>
      <text fg={palette.gold}>
        {"enter "}
        <span fg={palette.muted}>back to results</span>
      </text>
    </box>
  );
}

export function EvalVerdictScreen(props: {
  verdict: SkillEvalVerdict;
  onPick: (winner: CreateAgent) => void;
  onKeepBoth: () => void;
}) {
  // Deliberately no enter/esc fall-through: every way out of this screen is a
  // named choice, so keeping both is a decision rather than a reflex. Ctrl+c
  // is the non-destructive escape and also keeps both.
  useKeyboard((key) => {
    if (key.name === "c" && !key.ctrl) {
      props.onPick("claude");
    } else if (key.name === "x") {
      props.onPick("codex");
    } else if (key.name === "k" || (key.ctrl && key.name === "c")) {
      props.onKeepBoth();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.accent}>{`Eval verdict for ${props.verdict.skillName} — judged blind, twice, candidates swapped`}</text>
      <text>
        <span fg={palette.gold}>{"recommended: "}</span>
        <span fg={palette.text}>{props.verdict.recommendedWinner}</span>
        <span fg={palette.faint}>{"  (advisory — nothing happens until you choose)"}</span>
      </text>
      <text fg={palette.muted}>{truncateTo(props.verdict.rationale, 110)}</text>
      {(["claude", "codex"] as const).map((agent) => {
        const copy = props.verdict.copies[agent];
        const mark = props.verdict.recommendedWinner === agent ? "★ " : "  ";
        return (
          <box key={agent} style={{ flexDirection: "column", gap: 0 }}>
            <text>
              <span fg={palette.gold}>{mark}</span>
              <span fg={palette.text}>{`${agent} ${copy.score}/10`}</span>
              <span fg={palette.faint}>{`  ${copy.path}`}</span>
            </text>
            <text fg={palette.muted}>{`    ${truncateTo(copy.rationale, 100)}`}</text>
            <text fg={palette.success}>{`    + ${truncateTo(copy.strengths.join("; ") || "none noted", 96)}`}</text>
            <text fg={palette.warn}>{`    − ${truncateTo(copy.weaknesses.join("; ") || "none noted", 96)}`}</text>
          </box>
        );
      })}
      {props.verdict.notes.map((note) => (
        <text key={note} fg={palette.faint}>{`- ${truncateTo(note, 108)}`}</text>
      ))}
      {props.verdict.reportPaths ? (
        <text fg={palette.muted}>{`Full reports: ${props.verdict.reportPaths.claude} · ${props.verdict.reportPaths.codex}`}</text>
      ) : null}
      <text fg={palette.gold}>
        {"c "}
        <span fg={palette.muted}>pick claude · </span>
        <span fg={palette.gold}>{"x "}</span>
        <span fg={palette.muted}>pick codex · </span>
        <span fg={palette.gold}>{"k "}</span>
        <span fg={palette.muted}>keep both — an explicit choice is required</span>
      </text>
    </box>
  );
}

export function EvalConfirmScreen(props: { names: PerAgentSkillNames; winner: CreateAgent; onConfirm: () => void; onBack: () => void }) {
  const loser = props.winner === "claude" ? "codex" : "claude";
  const deletePath = `${nativeSkillRoots[loser]}/${props.names[loser]}`;
  const linkPath = `${nativeSkillRoots[loser]}/${props.names[props.winner]}`;

  useKeyboard((key) => {
    if (key.name === "y" && !key.ctrl) {
      props.onConfirm();
    } else if (key.name === "enter" || key.name === "return" || key.name === "linefeed" || key.name === "n" || key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
      props.onBack();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.warn}>{`Delete the ${loser} copy and symlink it to the ${props.winner} copy?`}</text>
      <text fg={palette.muted}>
        {deletePath === linkPath
          ? `${deletePath} will be replaced by a relative symlink.`
          : `${deletePath} will be deleted; ${linkPath} will become a relative symlink.`}
      </text>
      <text fg={palette.gold}>
        {"y "}
        <span fg={palette.muted}>delete + symlink · enter keep both</span>
      </text>
    </box>
  );
}

type EvalFlowPhase = "evaluating" | "verdict" | "confirm" | "applying" | "applied" | "error";

/**
 * The full opt-in eval flow for one per-agent skill pair: run the read-only
 * eval, show the verdict, and only delete+symlink after the user picks a
 * winner AND confirms. "Keep both" (or any cancel) calls onClose unchanged.
 */
export function SkillEvalFlow(props: {
  targetDir: string;
  candidate: PendingSkillEval;
  backend?: CreateAgent;
  /** Upfront consent from the creation form: apply a clear winner without the per-verdict confirm; ties still keep both. */
  autoApply?: boolean;
  onClose: () => void;
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<EvalFlowPhase>("evaluating");
  const [verdict, setVerdict] = useState<SkillEvalVerdict | null>(null);
  const [winner, setWinner] = useState<CreateAgent | null>(null);
  const [resolution, setResolution] = useState<SkillWinnerResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const backend = props.backend;

  useEffect(() => {
    if (phase !== "evaluating") {
      return;
    }

    if (!backend) {
      setError("No backend CLI is available to run the read-only eval.");
      setPhase("error");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    evaluatePerAgentSkill({
      targetDir: props.targetDir,
      skillName: props.candidate.skillName,
      names: props.candidate.names,
      description: props.candidate.description,
      backend,
      signal: controller.signal
    })
      .then((result) => {
        if (cancelled) {
          return;
        }

        setVerdict(result);

        // Auto-apply only ever fires on a clear, swap-consistent winner; a
        // tie always falls back to the manual verdict screen.
        if (props.autoApply && result.recommendedWinner !== "tie") {
          setPhase("applying");
          void applyWinner(result.recommendedWinner, true);
        } else {
          setPhase("verdict");
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setPhase("error");
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [backend, phase, props.candidate, props.targetDir]);

  async function applyWinner(picked: CreateAgent, retainBackupInTrash: boolean): Promise<void> {
    try {
      const applied = await resolvePerAgentSkillWinner({
        targetDir: props.targetDir,
        skillName: props.candidate.skillName,
        names: props.candidate.names,
        winner: picked,
        confirmDeleteAndLink: true,
        retainBackupInTrash
      });
      setResolution(applied);
      setPhase("applied");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("error");
    }
  }

  switch (phase) {
    case "evaluating":
      return (
        <EvalProgressScreen
          skillName={props.candidate.skillName}
          onCancel={() => {
            abortRef.current?.abort();
            props.onClose();
          }}
        />
      );

    case "verdict":
      return verdict ? (
        <EvalVerdictScreen
          verdict={verdict}
          onPick={(picked) => {
            setWinner(picked);
            setPhase("confirm");
          }}
          onKeepBoth={props.onClose}
        />
      ) : (
        <EvalErrorScreen message="Eval finished without a verdict." onBack={props.onClose} />
      );

    case "confirm":
      return winner ? (
        <EvalConfirmScreen
          names={props.candidate.names}
          winner={winner}
          onConfirm={() => void applyWinner(winner, false)}
          onBack={() => setPhase("verdict")}
        />
      ) : (
        <EvalErrorScreen message="No winner is selected." onBack={props.onClose} />
      );

    case "applying":
      return (
        <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
          <text fg={palette.accent}>{`Applying the recommended winner for ${props.candidate.skillName}…`}</text>
        </box>
      );

    case "applied":
      return resolution ? (
        <EvalAppliedScreen resolution={resolution} onExit={props.onExit} />
      ) : (
        <EvalErrorScreen message="Winner resolution finished without a report." onBack={props.onClose} />
      );

    case "error":
      return <EvalErrorScreen message={error ?? "Unknown eval error."} onBack={props.onClose} />;
  }
}

export function EvalAppliedScreen(props: { resolution: SkillWinnerResolution; onExit: () => void }) {
  useKeyboard((key) => {
    if (key.name === "enter" || key.name === "return" || key.name === "linefeed" || key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
      props.onExit();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.success}>{`✓ Kept ${props.resolution.winner} as the ${props.resolution.skillName} winner.`}</text>
      {props.resolution.deleted.map((path) => (
        <text key={path} fg={palette.muted}>{`Deleted ${path}`}</text>
      ))}
      {props.resolution.links.map((link) => (
        <text key={link.path} fg={palette.muted}>{`Linked ${link.path} -> ${link.target}`}</text>
      ))}
      {props.resolution.backupPath ? (
        <text fg={palette.muted}>{`Deleted copy kept at ${props.resolution.backupPath} in case you change your mind.`}</text>
      ) : null}
      <text fg={palette.gold}>
        {"enter "}
        <span fg={palette.muted}>close</span>
      </text>
    </box>
  );
}
