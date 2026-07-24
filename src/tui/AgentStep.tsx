import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { enforcementAgentCombos, type EnforcementAgent } from "../engine/agent-selection";
import { ButtonBar } from "./ButtonBar";
import { palette, StepHeader } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

type AgentChoice = {
  label: string;
  agents: EnforcementAgent[];
  detail: string;
};

/**
 * The Agent step owns the enforcement-target choice for the whole harness: it
 * decides which native bindings farrier writes (CLAUDE.md + .claude, AGENTS.md +
 * .codex, or both) and which agents skills install for. It is a single-select of
 * three concrete choices, not a per-agent toggle — the Hooks step no longer owns
 * this decision. The choices come from enforcementAgentCombos, ordered to match
 * this presentation list.
 */
const comboPresentation = [
  {
    label: "Claude Code",
    detail: "writes CLAUDE.md (imports AGENTS.md), hooks in .claude/settings.json, skills in .claude/skills/",
  },
  {
    label: "Codex",
    detail: "writes AGENTS.md, hooks in .codex/hooks.json, skills in .agents/skills/",
  },
  {
    label: "Both",
    detail: "writes both bindings; skills installed for both",
  },
];

const agentChoices: AgentChoice[] = enforcementAgentCombos.map((agents, index) => ({
  ...comboPresentation[index]!,
  agents: [...agents],
}));

type AgentStepProps = {
  selectedAgents: EnforcementAgent[];
  onSelectAgents: (agents: EnforcementAgent[]) => void;
  onNext: () => void;
  /** esc/b: this is the first step, so back leaves the wizard one level up. */
  onBack: () => void;
  /** q/ctrl+c: quit farrier. */
  onQuit: () => void;
};

const agentBindings = defineBindings(
  binding(["up", "down"], "move", "move"),
  binding("enter", "choose", "choose"),
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);

function sameAgents(a: readonly EnforcementAgent[], b: readonly EnforcementAgent[]): boolean {
  return a.length === b.length && a.every((agent, index) => agent === b[index]);
}

export function AgentStep(props: AgentStepProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(() => Math.max(agentChoices.findIndex((choice) => sameAgents(choice.agents, props.selectedAgents)), 0));

  function moveFocus(delta: -1 | 1): void {
    setFocusedIndex((current) => Math.min(Math.max(current + delta, 0), agentChoices.length - 1));
  }

  useKeyboard((key) => {
    const intent = resolveIntent(agentBindings, key);
    if (intent === "back") {
      props.onBack();
      return;
    }
    if (intent === "quit") {
      props.onQuit();
      return;
    }
    if (intent === "move" && key.name === "down") {
      moveFocus(1);
      return;
    }
    if (intent === "move") {
      moveFocus(-1);
      return;
    }
    if (intent === "choose") {
      const choice = agentChoices[focusedIndex];
      if (choice) {
        props.onSelectAgents(choice.agents);
      }
      props.onNext();
    }
  });

  const focused = agentChoices[focusedIndex] ?? agentChoices[0]!;

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Agent" subtitle="Which agent is this harness for?" />
      <box style={{ flexDirection: "column", gap: 0 }}>
        {agentChoices.map((choice, index) => {
          const isFocused = index === focusedIndex;
          const isSelected = sameAgents(choice.agents, props.selectedAgents);
          const bg = isFocused ? palette.selBg : undefined;
          const cursor = isFocused ? "▸ " : "  ";

          return (
            <text key={choice.label} bg={bg}>
              <span fg={palette.accent}>{cursor}</span>
              <span fg={isSelected ? palette.success : palette.faint}>{isSelected ? "◉ " : "○ "}</span>
              <span fg={palette.text}>{choice.label}</span>
            </text>
          );
        })}
      </box>
      <text fg={palette.muted}>{focused.detail}</text>
      <text fg={palette.faint}>The agent decides which native bindings farrier writes and where skills install; you can share skills with the other agent later.</text>
      <ButtonBar hint={bindingsHint(agentBindings)} />
    </box>
  );
}
