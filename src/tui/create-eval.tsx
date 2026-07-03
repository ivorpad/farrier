import { useKeyboard } from "@opentui/react";
import type { CreateAgent, SkillCreationOutcome } from "../engine/create-skill";
import type { SkillEvalVerdict, SkillWinnerResolution } from "../engine/eval-skill";
import { nativeSkillRoots } from "../engine/create-skill";
import { palette, truncateTo, useSpinner } from "./chrome";

export type PendingSkillEval = {
  skillName: string;
  description: string;
};

export function eligiblePerAgentEvals(outcomes: SkillCreationOutcome[]): PendingSkillEval[] {
  return outcomes.flatMap((outcome) => {
    if (outcome.error || !outcome.name || outcome.request.mode !== "per-agent") {
      return [];
    }

    const expected = ["claude", "codex"].map((agent) => `${nativeSkillRoots[agent as CreateAgent]}/${outcome.name}/SKILL.md`);

    if (!expected.every((file) => outcome.files.includes(file))) {
      return [];
    }

    return [{ skillName: outcome.name, description: outcome.request.description }];
  });
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
    if (key.name === "enter" || key.name === "return" || key.name === "linefeed" || key.name === "escape" || key.name === "q") {
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
  useKeyboard((key) => {
    if (key.name === "c") {
      props.onPick("claude");
    } else if (key.name === "x") {
      props.onPick("codex");
    } else if (key.name === "enter" || key.name === "return" || key.name === "linefeed" || key.name === "b" || key.name === "escape" || key.name === "q") {
      props.onKeepBoth();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.accent}>{`Eval verdict for ${props.verdict.skillName}`}</text>
      <text>
        <span fg={palette.gold}>{"recommended: "}</span>
        <span fg={palette.text}>{props.verdict.recommendedWinner}</span>
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
          </box>
        );
      })}
      <text fg={palette.gold}>
        {"c "}
        <span fg={palette.muted}>pick claude · </span>
        <span fg={palette.gold}>{"x "}</span>
        <span fg={palette.muted}>pick codex · enter keep both</span>
      </text>
    </box>
  );
}

export function EvalConfirmScreen(props: { skillName: string; winner: CreateAgent; onConfirm: () => void; onBack: () => void }) {
  const loser = props.winner === "claude" ? "codex" : "claude";

  useKeyboard((key) => {
    if (key.name === "y") {
      props.onConfirm();
    } else if (key.name === "enter" || key.name === "return" || key.name === "linefeed" || key.name === "n" || key.name === "escape" || key.name === "q") {
      props.onBack();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.warn}>{`Delete the ${loser} copy and symlink it to the ${props.winner} copy?`}</text>
      <text fg={palette.muted}>{`${nativeSkillRoots[loser]}/${props.skillName} will be replaced by a relative symlink.`}</text>
      <text fg={palette.gold}>
        {"y "}
        <span fg={palette.muted}>delete + symlink · enter keep both</span>
      </text>
    </box>
  );
}

export function EvalAppliedScreen(props: { resolution: SkillWinnerResolution; onExit: () => void }) {
  useKeyboard((key) => {
    if (key.name === "enter" || key.name === "return" || key.name === "linefeed" || key.name === "escape" || key.name === "q") {
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
      <text fg={palette.gold}>
        {"enter "}
        <span fg={palette.muted}>close</span>
      </text>
    </box>
  );
}
