import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import type { AgentAvailability } from "../engine/backend";
import type { AuthoringMode, CreateAgent, SkillCreationRequest } from "../engine/create-skill";
import { DetailPane, KeyHints, palette, StepHeader, truncateTo, useSpinner, type PaneLine } from "./chrome";
import { evalPolicyLabels, type SkillEvalPolicy } from "./create-eval";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

type CreateStepProps = {
  requests: SkillCreationRequest[];
  availability?: AgentAvailability;
  /** Standalone create flow (farrier skill new / launcher): own header, harness verb. */
  standalone?: boolean;
  /** When set, renders the "ask clarifying questions first" toggle. */
  refine?: boolean;
  refineBackend?: string;
  onToggleRefine?: () => void;
  /** When set, renders the per-agent eval policy cycler (only shown for per-agent mode). */
  evalPolicy?: SkillEvalPolicy;
  onCycleEvalPolicy?: () => void;
  onAddRequest: (request: SkillCreationRequest) => void;
  onRemoveRequest: (index: number) => void;
  /** Confirm: `pending` is the filled-but-unqueued form to include, if any. */
  onSubmit: (pending?: SkillCreationRequest) => void;
  onBack: () => void;
  onQuit: () => void;
};

type Zone = "input" | "agents" | "mode" | "queued" | "refine" | "eval" | "actions";

type ActionId = "create" | "queue" | "back";

const agentRows: readonly CreateAgent[] = ["claude", "codex"];

/**
 * Each vendor authors with its own recommended creator: claude via the pinned
 * anthropics skill-creator, codex via its built-in $skill-creator. The mode
 * picker only exists because "both agents" has three honest answers.
 */
const modeRows: ReadonlyArray<{ mode: AuthoringMode; label: string; detail: string }> = [
  { mode: "author-claude", label: "Claude authors, install to both", detail: "one canonical skills/<name>/, lock-tracked" },
  { mode: "author-codex", label: "Codex authors, install to both", detail: "one canonical skills/<name>/, lock-tracked" },
  { mode: "per-agent", label: "Each agent authors its own copy", detail: "native dirs, copies may diverge, no lock entry" }
];

const createBindings = defineBindings(
  binding(["tab", "shift+tab"], "focus", "focus zone"),
  binding(["up", "down"], "move", "move"),
  binding(["left", "right"], "adjust", "change action"),
  binding("space", "toggle", "toggle/remove"),
  binding("enter", "activate", "activate"),
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);
const createInputBindings = defineBindings(
  binding(["tab", "shift+tab"], "focus", "focus zone"),
  binding(["enter", "escape"], "leaveField", "leave text field"),
  binding("ctrl+c", "quit", "quit")
);

function modeFor(agents: CreateAgent[], chosen: AuthoringMode): AuthoringMode {
  if (agents.length === 1) {
    return agents[0] === "claude" ? "author-claude" : "author-codex";
  }

  return chosen;
}

function requestSummary(request: SkillCreationRequest): string {
  return `${request.agents.join("+")} · ${request.mode}`;
}

function ActionChip(props: { label: string; focused: boolean; ember?: boolean; disabled?: boolean }) {
  const bg = props.focused ? (props.ember ? palette.accent : palette.selBg) : undefined;
  const fg = props.disabled ? palette.faint : props.focused && props.ember ? palette.accentText : props.ember ? palette.accent : palette.text;

  return (
    <text bg={bg}>
      <span fg={fg}>{` ${props.label} `}</span>
    </text>
  );
}

export function CreateStep(props: CreateStepProps) {
  const [description, setDescription] = useState("");
  const [agents, setAgents] = useState<CreateAgent[]>([]);
  const [mode, setMode] = useState<AuthoringMode>("author-claude");
  const [zone, setZone] = useState<Zone>("input");
  const [agentIndex, setAgentIndex] = useState(0);
  const [modeIndex, setModeIndex] = useState(0);
  const [queuedIndex, setQueuedIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const spinner = useSpinner(!props.availability);

  const availability = props.availability;
  const availableAgents = agentRows.filter((agent) => availability?.[agent]);
  const showMode = agents.length > 1;

  // Preselect every working agent once the probe lands; pick a valid default mode.
  useEffect(() => {
    if (availability && agents.length === 0 && availableAgents.length > 0) {
      setAgents(availableAgents);
      setMode(availability.claude ? "author-claude" : "author-codex");
      setModeIndex(availability.claude ? 0 : 1);
    }
  }, [availability]);

  useEffect(() => {
    if (queuedIndex > props.requests.length - 1) {
      setQueuedIndex(Math.max(props.requests.length - 1, 0));
    }

    if (props.requests.length === 0 && zone === "queued") {
      setZone("input");
    }
  }, [props.requests.length, queuedIndex, zone]);

  const canQueue = description.trim().length > 0 && agents.length > 0;
  const total = props.requests.length + (canQueue ? 1 : 0);

  const actions: Array<{ id: ActionId; label: string; ember?: boolean; disabled?: boolean }> = [
    {
      id: "create",
      label: props.standalone
        ? `⚒ Create${total > 0 ? ` ${total} skill${total > 1 ? "s" : ""}` : ""}`
        : `Next →${total > 0 ? ` (${total} queued)` : ""}`,
      ember: props.standalone && total > 0,
      disabled: props.standalone && total === 0
    },
    { id: "queue", label: "＋ Queue another", disabled: !canQueue },
    { id: "back", label: props.standalone ? "✕ Cancel" : "← Back" }
  ];

  const showRefine = Boolean(props.onToggleRefine && props.refineBackend);
  // The eval policy only matters when both copies will exist to compare.
  const perAgentPlanned =
    modeFor(agents, mode) === "per-agent" || props.requests.some((request) => request.mode === "per-agent");
  const showEval = Boolean(props.onCycleEvalPolicy && props.evalPolicy && perAgentPlanned);

  const zones: Zone[] = [
    "input",
    "agents",
    ...(showMode ? (["mode"] as Zone[]) : []),
    ...(props.requests.length > 0 ? (["queued"] as Zone[]) : []),
    ...(showRefine ? (["refine"] as Zone[]) : []),
    ...(showEval ? (["eval"] as Zone[]) : []),
    "actions"
  ];

  function cycleZone(delta: -1 | 1 = 1): void {
    setZone((current) => {
      const index = zones.indexOf(current);
      return zones[(index + delta + zones.length) % zones.length] ?? "input";
    });
  }

  function pendingRequest(): SkillCreationRequest | undefined {
    if (!canQueue) {
      return undefined;
    }

    return { description: description.trim(), agents: [...agents], mode: modeFor(agents, mode) };
  }

  function queueSkill(): void {
    const pending = pendingRequest();

    if (!pending) {
      return;
    }

    props.onAddRequest(pending);
    setDescription("");
    setZone("input");
  }

  function submit(): void {
    props.onSubmit(pendingRequest());
  }

  // The primary visible action, selected with Tab and activated with Enter.
  const enterLine = props.standalone
    ? total === 0
      ? "Nothing to create yet — describe a skill above."
      : `⚒ Create will author ${total} skill${total > 1 ? "s" : ""} now${canQueue ? "" : " (queued)"}`
    : total === 0
      ? "Next continues to Hooks with no new skills queued."
      : `Next continues — ${total} skill${total > 1 ? "s" : ""} will be authored when the harness is created`;

  useKeyboard((key) => {
    const activeBindings = zone === "input" ? createInputBindings : createBindings;
    const intent = resolveIntent(activeBindings, key, { textInputFocused: zone === "input" });
    if (intent === "leaveField") {
      setZone("agents");
      return;
    }
    if (intent === "back") {
      if (zone === "input") setZone("agents");
      else props.onBack();
      return;
    }
    if (intent === "quit") {
      props.onQuit();
      return;
    }
    if (intent === "focus") {
      cycleZone(key.shift ? -1 : 1);
      return;
    }
    if (intent === "move") {
      if (zone === "input") return;
      const down = key.name === "down";
      if (zone === "agents") {
        if (down && agentIndex < agentRows.length - 1) setAgentIndex(agentIndex + 1);
        else if (!down && agentIndex > 0) setAgentIndex(agentIndex - 1);
      } else if (zone === "mode") {
        if (down && modeIndex < modeRows.length - 1) setModeIndex(modeIndex + 1);
        else if (!down && modeIndex > 0) setModeIndex(modeIndex - 1);
      } else if (zone === "queued") {
        if (down && queuedIndex < props.requests.length - 1) setQueuedIndex(queuedIndex + 1);
        else if (!down && queuedIndex > 0) setQueuedIndex(queuedIndex - 1);
      }
      return;
    }
    if (intent === "adjust") {
      if (zone === "actions") setActionIndex((current) => Math.min(Math.max(current + (key.name === "right" ? 1 : -1), 0), actions.length - 1));
      return;
    }
    if (intent === "toggle") {
      if (zone === "agents") {
        const agent = agentRows[agentIndex]!;
        if (availability?.[agent]) setAgents((current) => (current.includes(agent) ? current.filter((item) => item !== agent) : [...current, agent]));
      } else if (zone === "mode") setMode(modeRows[modeIndex]!.mode);
      else if (zone === "queued") props.onRemoveRequest(queuedIndex);
      else if (zone === "refine") props.onToggleRefine?.();
      else if (zone === "eval") props.onCycleEvalPolicy?.();
      return;
    }
    if (intent === "activate") {
      if (zone === "input") {
        setZone("agents");
        return;
      }
      if (zone === "agents") {
        const agent = agentRows[agentIndex]!;
        if (availability?.[agent]) setAgents((current) => (current.includes(agent) ? current.filter((item) => item !== agent) : [...current, agent]));
        return;
      }
      if (zone === "mode") {
        setMode(modeRows[modeIndex]!.mode);
        return;
      }
      if (zone === "refine") {
        props.onToggleRefine?.();
        return;
      }
      if (zone === "eval") {
        props.onCycleEvalPolicy?.();
        return;
      }
      if (zone !== "actions") return;
      const action = actions[actionIndex]!;
      if (action.id === "back") props.onBack();
      else if (action.id === "queue") queueSkill();
      else if (!action.disabled) submit();
    }
  });

  function paneLines(): PaneLine[] {
    if (zone === "queued" && props.requests[queuedIndex]) {
      const request = props.requests[queuedIndex]!;
      return [
        { fg: palette.muted, text: truncateTo(request.description, 56) },
        { fg: palette.gold, text: requestSummary(request) }
      ];
    }

    if (agents.length === 0) {
      return [{ fg: palette.warn, text: "Check at least one agent to create a skill." }];
    }

    const effective = modeFor(agents, mode);

    if (effective === "per-agent") {
      return [
        { fg: palette.muted, text: "claude + skill-creator → .claude/skills/<name>/" },
        { fg: palette.muted, text: "codex + $skill-creator → .agents/skills/<name>/" },
        { fg: palette.gold, text: "native dirs, copies may diverge, no lock entry" }
      ];
    }

    const author = effective === "author-claude" ? "claude + pinned skill-creator" : "codex + built-in $skill-creator";
    return [
      { fg: palette.muted, text: `${author} → skills/<name>/` },
      { fg: palette.muted, text: `then: skills add ./skills -a ${agents.join(" ")}` },
      { fg: palette.gold, text: "one canonical copy, lock-tracked" }
    ];
  }

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      {props.standalone ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={palette.accent}>{"⚒ farrier skill new"}</text>
          <text fg={palette.muted}>Each vendor's own skill-creator authors; farrier validates and installs.</text>
        </box>
      ) : (
        <StepHeader current="Create" subtitle="Queue new skills — each vendor's own skill-creator does the authoring." />
      )}

      <box style={{ flexDirection: "column", gap: 0 }}>
        <text fg={palette.muted}>Describe the skill:</text>
        <input
          value={description}
          focused={zone === "input"}
          onInput={(value) => setDescription(String(value))}
          onSubmit={() => setZone("agents")}
          onKeyDown={(key) => {
            if (resolveIntent(createInputBindings, key) === "leaveField" && (key.name === "escape" || key.sequence === "\u001b")) {
              key.preventDefault();
              key.stopPropagation();
              setZone("agents");
            }
          }}
          placeholder="e.g. Convert financial tables to markdown before sending them to the LLM"
        />
      </box>

      <box style={{ flexDirection: "column", gap: 0 }}>
        <text>
          <span fg={palette.gold}>{"Agents"}</span>
          <span fg={palette.faint}>{" — who gets this skill"}</span>
          {!availability ? <span fg={palette.muted}>{`  ${spinner} probing…`}</span> : null}
        </text>
        {agentRows.map((agent, index) => {
          const available = availability?.[agent] ?? false;
          const selected = agents.includes(agent);
          const focused = zone === "agents" && index === agentIndex;

          return (
            <text key={agent} bg={focused ? palette.selBg : undefined}>
              <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
              <span fg={selected ? palette.success : palette.faint}>{selected ? "[x] " : "[ ] "}</span>
              <span fg={available ? palette.text : palette.faint}>{agent.padEnd(8)}</span>
              <span fg={palette.faint}>{available ? (agent === "claude" ? "authors via pinned skill-creator" : "authors via built-in $skill-creator") : `not detected (${agent} --version failed)`}</span>
            </text>
          );
        })}
      </box>

      {showMode ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text>
            <span fg={palette.gold}>{"Both checked"}</span>
            <span fg={palette.faint}>{" — you decide how to author"}</span>
          </text>
          {modeRows.map((row, index) => {
            const focused = zone === "mode" && index === modeIndex;
            const selected = mode === row.mode;

            return (
              <text key={row.mode} bg={focused ? palette.selBg : undefined}>
                <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
                <span fg={selected ? palette.success : palette.faint}>{selected ? "(•) " : "( ) "}</span>
                <span fg={palette.text}>{row.label}</span>
              </text>
            );
          })}
        </box>
      ) : null}

      {props.requests.length > 0 ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text>
            <span fg={palette.gold}>{String(props.requests.length)}</span>
            <span fg={palette.muted}>{" queued (space removes) — authored in parallel, up to 3 agent runs at once"}</span>
          </text>
          {props.requests.map((request, index) => {
            const focused = zone === "queued" && index === queuedIndex;

            return (
              <text key={`${request.description}-${index}`} bg={focused ? palette.selBg : undefined}>
                <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
                <span fg={palette.text}>{truncateTo(request.description, 44).padEnd(46)}</span>
                <span fg={palette.faint}>{requestSummary(request)}</span>
              </text>
            );
          })}
        </box>
      ) : null}

      {showRefine ? (
        <text bg={zone === "refine" ? palette.selBg : undefined}>
          <span fg={palette.accent}>{zone === "refine" ? "▸ " : "  "}</span>
          <span fg={props.refine ? palette.success : palette.faint}>{props.refine ? "[x] " : "[ ] "}</span>
          <span fg={palette.text}>{`ask clarifying questions first`}</span>
          <span fg={palette.faint}>{`  ${props.refineBackend} interviews you one question at a time before authoring`}</span>
        </text>
      ) : null}

      {showEval ? (
        <text bg={zone === "eval" ? palette.selBg : undefined}>
          <span fg={palette.accent}>{zone === "eval" ? "▸ " : "  "}</span>
          <span fg={palette.gold}>{"after authoring: "}</span>
          <span fg={props.evalPolicy === "skip" ? palette.faint : palette.text}>{evalPolicyLabels[props.evalPolicy!]}</span>
          <span fg={palette.faint}>{"  space cycles"}</span>
        </text>
      ) : null}

      <DetailPane title="what will run" lines={paneLines()} />

      <box style={{ flexDirection: "column", gap: 0 }}>
        <text fg={total > 0 ? palette.gold : palette.faint}>{enterLine}</text>
        <box style={{ flexDirection: "row", gap: 2 }}>
          {actions.map((action, index) => (
            <ActionChip
              key={action.id}
              label={action.label}
              focused={zone === "actions" && index === actionIndex}
              ember={action.ember}
              disabled={action.disabled}
            />
          ))}
        </box>
        <KeyHints hint={bindingsHint(zone === "input" ? createInputBindings : createBindings)} />
      </box>
    </box>
  );
}
