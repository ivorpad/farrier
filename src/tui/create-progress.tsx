import { useKeyboard } from "@opentui/react";
import type { CreateAgent, SkillCreationOutcome, SkillCreationPhase, SkillCreationRequest } from "../engine/create-skill";
import { palette, truncateTo, useSpinner } from "./chrome";
import { CollisionPromptView, type CollisionPrompt } from "./collision";
import type { PendingSkillEval } from "./create-eval";
import { pickForgeVerb } from "./verbs";

// One verb per process so the authoring spinner and done line match.
const runVerb = pickForgeVerb();

export type RequestStatus =
  | { kind: "pending" }
  | {
      kind: "running";
      phase: SkillCreationPhase;
      agent?: CreateAgent;
      /** Latest streamed activity line per agent (per-agent runs stream in parallel). */
      activities?: Partial<Record<CreateAgent, string>>;
    }
  | { kind: "done"; outcome: SkillCreationOutcome };

function statusText(status: RequestStatus, request: SkillCreationRequest): { fg: string; text: string } {
  if (status.kind === "pending") {
    return { fg: palette.faint, text: "queued" };
  }

  if (status.kind === "done") {
    const outcome = status.outcome;
    return outcome.error
      ? { fg: palette.warn, text: `✗ ${truncateTo(outcome.error, 40)}` }
      : { fg: palette.success, text: `✓ ${outcome.name}${outcome.installed ? " (installed)" : ""}` };
  }

  const agent =
    request.mode === "per-agent" && request.agents.length > 1
      ? ` via ${request.agents.join(" + ")} (parallel)`
      : status.agent
        ? ` via ${status.agent}`
        : "";
  const phases: Record<SkillCreationPhase, string> = {
    creator: "pinning skill-creator",
    authoring: `authoring${agent}`,
    validating: "validating",
    installing: "installing"
  };
  return { fg: palette.gold, text: phases[status.phase] };
}

export function CreateProgressScreen(props: {
  requests: SkillCreationRequest[];
  statuses: RequestStatus[];
  cancelling: boolean;
  collision: CollisionPrompt | null;
  onCancel: () => void;
}) {
  const spinner = useSpinner(true);
  const running = props.statuses.some((status) => status.kind !== "done");

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      props.onCancel();
      return;
    }

    if (props.collision) {
      if (key.name === "r") {
        props.collision.resolve("replace");
      } else if (key.name === "k" || key.name === "escape") {
        props.collision.resolve("keep");
      }
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={props.cancelling ? palette.warn : palette.accent}>
        {props.cancelling
          ? `${spinner}  Cancelling — killing the agent runs…`
          : running
            ? `${spinner}  ${runVerb.gerund} ${props.requests.length} skill(s) — up to 3 agent runs in parallel…`
            : "  ⚒  Finishing up…"}
      </text>
      <box style={{ flexDirection: "column", gap: 0 }}>
        {props.requests.map((request, index) => {
          const requestStatus = props.statuses[index] ?? { kind: "pending" };
          const status = statusText(requestStatus, request);
          const plan = `${request.agents.join("+")} · ${request.mode}`;
          const activities =
            requestStatus.kind === "running" && requestStatus.activities
              ? Object.entries(requestStatus.activities).filter(([, activity]) => activity)
              : [];

          return (
            <box key={`${request.description}-${index}`} style={{ flexDirection: "column", gap: 0 }}>
              <text>
                <span fg={palette.text}>{`  ${truncateTo(request.description, 30).padEnd(32)}`}</span>
                <span fg={status.fg}>{truncateTo(status.text, 40).padEnd(42)}</span>
                <span fg={palette.faint}>{plan}</span>
              </text>
              {activities.map(([agent, activity]) => (
                <text key={agent}>
                  <span fg={palette.faint}>{`    ${agent.padEnd(6)} ▸ `}</span>
                  <span fg={palette.muted}>{truncateTo(activity ?? "", 80)}</span>
                </text>
              ))}
            </box>
          );
        })}
      </box>
      {props.collision ? <CollisionPromptView collision={props.collision} /> : null}
      <text fg={palette.muted}>Each skill is a full agent run — expect minutes. ctrl+c cancels and kills the agent runs.</text>
    </box>
  );
}

export function CreateDoneScreen(props: {
  outcomes: SkillCreationOutcome[];
  evalCandidate?: PendingSkillEval;
  onEvaluate: () => void;
  onExit: () => void;
}) {
  useKeyboard((key) => {
    if (key.name === "e" && props.evalCandidate) {
      props.onEvaluate();
      return;
    }

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed" || key.name === "escape" || key.name === "q") {
      props.onExit();
    }
  });

  const failed = props.outcomes.filter((outcome) => outcome.error).length;

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={failed === 0 ? palette.accent : palette.warn}>
        {failed === 0 ? `  ⚒  Skills ${runVerb.past}.` : `  ✗  ${failed} of ${props.outcomes.length} skill(s) failed.`}
      </text>
      <box style={{ flexDirection: "column", gap: 0 }}>
        {props.outcomes.map((outcome, index) => (
          <box key={`${outcome.name ?? index}`} style={{ flexDirection: "column", gap: 0 }}>
            <text>
              <span fg={outcome.error ? palette.warn : palette.success}>{outcome.error ? "✗ " : "✓ "}</span>
              <span fg={palette.text}>
                {outcome.error ? outcome.error : `${outcome.name}${outcome.installed ? " (installed)" : ""}`}
              </span>
            </text>
            {outcome.files.map((file) => (
              <text key={file} fg={palette.muted}>{`    ${file}`}</text>
            ))}
            {outcome.notes.map((note) => (
              <text key={note} fg={palette.faint}>{`    - ${note}`}</text>
            ))}
          </box>
        ))}
      </box>
      {props.evalCandidate ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={palette.gold}>
            {"e "}
            <span fg={palette.muted}>{`evaluate ${props.evalCandidate.skillName} copies & pick a winner · enter close`}</span>
          </text>
          <text fg={palette.faint}>{`  or later: farrier skill eval ${props.evalCandidate.skillName}${props.evalCandidate.names.codex !== props.evalCandidate.skillName ? ` --codex-name ${props.evalCandidate.names.codex}` : ""}`}</text>
        </box>
      ) : (
        <text fg={palette.gold}>
          {"enter "}
          <span fg={palette.muted}>close</span>
        </text>
      )}
    </box>
  );
}
