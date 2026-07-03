import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import type { AgentAvailability } from "../engine/backend";
import type { AuthoringMode, CreateAgent, SkillCreationRequest } from "../engine/create-skill";
import { DetailPane, KeyHints, palette, StepHeader, truncateTo, useSpinner, type PaneLine } from "./chrome";

type CreateStepProps = {
  requests: SkillCreationRequest[];
  availability?: AgentAvailability;
  /** Standalone create flow (farrier skill new / launcher): own header, forge verb. */
  standalone?: boolean;
  /** When set, renders the "ask clarifying questions first" toggle. */
  refine?: boolean;
  refineBackend?: string;
  onToggleRefine?: () => void;
  onAddRequest: (request: SkillCreationRequest) => void;
  onRemoveRequest: (index: number) => void;
  /** Confirm: `pending` is the filled-but-unqueued form to include, if any. */
  onSubmit: (pending?: SkillCreationRequest) => void;
  onBack: () => void;
};

type Zone = "input" | "agents" | "mode" | "queued" | "refine" | "actions";

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

function isSpace(key: unknown): boolean {
  const candidate = key as { name?: string; sequence?: string };
  return candidate.name === "space" || candidate.sequence === " ";
}

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
        : `Next →${total > 0 ? ` (${total} at forge)` : ""}`,
      ember: props.standalone && total > 0,
      disabled: props.standalone && total === 0
    },
    { id: "queue", label: "＋ Queue another", disabled: !canQueue },
    { id: "back", label: props.standalone ? "✕ Cancel" : "← Back" }
  ];

  const showRefine = Boolean(props.onToggleRefine && props.refineBackend);

  const zones: Zone[] = [
    "input",
    "agents",
    ...(showMode ? (["mode"] as Zone[]) : []),
    ...(props.requests.length > 0 ? (["queued"] as Zone[]) : []),
    ...(showRefine ? (["refine"] as Zone[]) : []),
    "actions"
  ];

  function cycleZone(): void {
    setZone((current) => {
      const index = zones.indexOf(current);
      return zones[(index + 1) % zones.length] ?? "input";
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

  // What enter does, always spelled out on screen right above the chips.
  const enterLine = props.standalone
    ? total === 0
      ? "Nothing to create yet — describe a skill above, or enter exits."
      : `enter ⚒ creates ${total} skill${total > 1 ? "s" : ""} now${canQueue ? "" : " (queued)"}`
    : total === 0
      ? "Nothing queued — enter continues to Hooks."
      : `enter continues — ${total} skill${total > 1 ? "s" : ""} will be authored at forge time`;

  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onBack();
      return;
    }

    if (key.name === "tab") {
      cycleZone();
      return;
    }

    if (zone !== "input" && (key.name === "q" || key.name === "b")) {
      props.onBack();
      return;
    }

    if (key.name === "down") {
      if (zone === "input") {
        setZone("agents");
      } else if (zone === "agents") {
        agentIndex < agentRows.length - 1 ? setAgentIndex(agentIndex + 1) : cycleZone();
      } else if (zone === "mode") {
        modeIndex < modeRows.length - 1 ? setModeIndex(modeIndex + 1) : cycleZone();
      } else if (zone === "queued") {
        queuedIndex < props.requests.length - 1 ? setQueuedIndex(queuedIndex + 1) : cycleZone();
      } else if (zone === "refine") {
        setZone("actions");
      }
      return;
    }

    if (key.name === "up") {
      if (zone === "agents") {
        agentIndex > 0 ? setAgentIndex(agentIndex - 1) : setZone("input");
      } else if (zone === "mode") {
        modeIndex > 0 ? setModeIndex(modeIndex - 1) : setZone("agents");
      } else if (zone === "queued") {
        queuedIndex > 0 ? setQueuedIndex(queuedIndex - 1) : setZone(showMode ? "mode" : "agents");
      } else if (zone === "refine") {
        setZone(zones[Math.max(zones.indexOf("refine") - 1, 0)] ?? "input");
      } else if (zone === "actions") {
        setZone(zones[zones.length - 2] ?? "input");
      }
      return;
    }

    if (zone === "actions" && key.name === "left") {
      setActionIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (zone === "actions" && key.name === "right") {
      setActionIndex((current) => Math.min(current + 1, actions.length - 1));
      return;
    }

    if (isSpace(key)) {
      if (zone === "agents") {
        const agent = agentRows[agentIndex]!;

        if (availability?.[agent]) {
          setAgents((current) => (current.includes(agent) ? current.filter((item) => item !== agent) : [...current, agent]));
        }
        return;
      }

      if (zone === "mode") {
        setMode(modeRows[modeIndex]!.mode);
        return;
      }

      if (zone === "queued") {
        props.onRemoveRequest(queuedIndex);
        return;
      }

      if (zone === "refine") {
        props.onToggleRefine?.();
        return;
      }
    }

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed") {
      if (zone === "actions") {
        const action = actions[actionIndex]!;

        if (action.id === "back") {
          props.onBack();
        } else if (action.id === "queue") {
          queueSkill();
        } else if (!action.disabled) {
          submit();
        }
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

      // Enter creates (or continues) with everything pending — the status
      // line right above the chips says exactly this.
      submit();
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
        <StepHeader current="Create" subtitle="Forge new skills — each vendor's own skill-creator does the authoring." />
      )}

      <box style={{ flexDirection: "column", gap: 0 }}>
        <text fg={palette.muted}>Describe the skill:</text>
        <input
          value={description}
          focused={zone === "input"}
          onInput={(value) => setDescription(String(value))}
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
          <span fg={palette.faint}>{`  ${props.refineBackend} picks libraries/formats with you before authoring`}</span>
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
        <KeyHints hint="enter create · space toggle/remove · tab zone · ↑↓ move · esc quit" />
      </box>
    </box>
  );
}
