import type { SelectOption } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { AdviseBackend, SkillRecommendation } from "../engine/advise";
import type { SkillSearchResult } from "../engine/skills";
import type { SkillRef } from "../packs/types";
import { adjacentButtonId, ButtonBar, type ButtonSpec } from "./ButtonBar";
import { formatInstalls, palette, StepHeader, useSpinner } from "./chrome";
import type { AdviseStatus, SkillSearchStatus } from "./machine";

type SkillsStepProps = {
  query: string;
  results: SkillSearchResult[];
  selectedSkills: SkillRef[];
  status: SkillSearchStatus;
  error?: string;
  onQueryChange: (query: string) => void;
  onToggleSkill: (ref: SkillRef) => void;
  onNext: () => void;
  onBack: () => void;
  adviseAvailable: boolean;
  adviseBackend?: AdviseBackend;
  adviseEnabled: boolean;
  adviseStatus: AdviseStatus;
  adviseError?: string;
  recommendations: SkillRecommendation[];
  onToggleAdvise: () => void;
};

type Zone = "input" | "advise" | "list" | "buttons";

const buttons: ButtonSpec[] = [
  { id: "back", label: "← Back" },
  { id: "next", label: "Next →" }
];

function refForResult(result: SkillSearchResult): SkillRef {
  return `${result.source}@${result.skillId}`;
}

function isSpace(key: unknown): boolean {
  const candidate = key as { name?: string; sequence?: string };
  return candidate.name === "space" || candidate.sequence === " ";
}

function nextZone(current: Zone, adviseAvailable: boolean): Zone {
  if (current === "input") {
    return adviseAvailable ? "advise" : "list";
  }

  if (current === "advise") {
    return "list";
  }

  if (current === "list") {
    return "buttons";
  }

  return "input";
}

export function SkillsStep(props: SkillsStepProps) {
  const [focus, setFocus] = useState<Zone>("input");
  const [focusedRef, setFocusedRef] = useState<SkillRef | undefined>(props.selectedSkills[0]);
  const [focusedButtonId, setFocusedButtonId] = useState<string>(buttons[0].id);

  const options = useMemo<SelectOption[]>(() => {
    const optionByRef = new Map<string, SelectOption>();

    for (const result of props.results) {
      const ref = refForResult(result);
      const selected = props.selectedSkills.includes(ref);

      optionByRef.set(ref, {
        name: `${selected ? "◉" : "○"} ${result.name}`,
        description: `${ref} · ${formatInstalls(result.installs)} installs`,
        value: ref
      });
    }

    for (const recommendation of props.recommendations) {
      const selected = props.selectedSkills.includes(recommendation.ref);

      optionByRef.set(recommendation.ref, {
        name: `${selected ? "◉" : "○"} ★ ${recommendation.name}`,
        description: `${recommendation.reason} — ${recommendation.ref} · ${formatInstalls(recommendation.installs)} installs`,
        value: recommendation.ref
      });
    }

    for (const ref of props.selectedSkills) {
      if (!optionByRef.has(ref)) {
        optionByRef.set(ref, {
          name: `◉ ${ref}`,
          description: "Pack default or previously selected skill",
          value: ref
        });
      }
    }

    return Array.from(optionByRef.values());
  }, [props.recommendations, props.results, props.selectedSkills]);

  useEffect(() => {
    if (options.length === 0) {
      setFocusedRef(undefined);
      return;
    }

    if (!focusedRef || !options.some((option) => option.value === focusedRef)) {
      setFocusedRef(String(options[0].value));
    }
  }, [focusedRef, options]);

  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onBack();
      return;
    }

    if (key.name === "tab") {
      setFocus((current) => nextZone(current, props.adviseAvailable));
      return;
    }

    if (key.name === "a" && focus !== "input") {
      if (props.adviseAvailable) {
        props.onToggleAdvise();
      }
      return;
    }

    if (key.name === "left") {
      if (focus === "buttons") {
        if (focusedButtonId === buttons[0].id) {
          setFocus("list");
        } else {
          setFocusedButtonId((current) => adjacentButtonId(buttons, current, -1) ?? current);
        }
      } else if (focus !== "input") {
        props.onBack();
      }
      return;
    }

    if (key.name === "up" && focus === "buttons") {
      setFocus("list");
      return;
    }

    if (key.name === "n" && focus !== "input") {
      props.onNext();
      return;
    }

    if (key.name === "right") {
      if (focus === "buttons") {
        setFocusedButtonId((current) => adjacentButtonId(buttons, current, 1) ?? current);
      } else if (focus !== "input") {
        props.onNext();
      }
      return;
    }

    if (focus === "buttons" && (key.name === "enter" || key.name === "return" || key.name === "linefeed")) {
      if (focusedButtonId === "back") {
        props.onBack();
      } else {
        props.onNext();
      }
      return;
    }

    if (focus === "list" && focusedRef && (key.name === "enter" || key.name === "return" || key.name === "linefeed" || isSpace(key))) {
      props.onToggleSkill(focusedRef);
      return;
    }

    if (focus === "advise" && props.adviseAvailable && (key.name === "enter" || key.name === "return" || key.name === "linefeed" || isSpace(key))) {
      props.onToggleAdvise();
    }
  });

  const adviseRunning = props.adviseEnabled && props.adviseStatus === "running";
  const spinner = useSpinner(props.status === "loading" || adviseRunning);

  const statusText =
    props.status === "loading"
      ? `${spinner} Searching skills.sh…`
      : props.status === "error"
        ? `✗ Search failed: ${props.error ?? "unknown error"}`
        : props.query.trim().length === 0
          ? "Pack defaults are preselected. Type to search skills.sh."
          : `${props.results.length} result(s) for “${props.query.trim()}”`;

  const adviseStateBadge = props.adviseEnabled
    ? props.adviseStatus === "ready"
      ? `${props.recommendations.length} recommendation(s)`
      : props.adviseStatus === "error"
        ? "failed"
        : "on"
    : "off · press a";

  const adviseBadgeColor = props.adviseEnabled
    ? props.adviseStatus === "error"
      ? palette.warn
      : palette.success
    : palette.faint;

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Skills" subtitle="Select skills to install after the harness is written." />
      <input
        placeholder="Search skills.sh…"
        focused={focus === "input"}
        onInput={(value) => props.onQueryChange(String(value))}
        onSubmit={() => setFocus("list")}
      />
      <text fg={props.status === "error" ? palette.warn : palette.muted}>{statusText}</text>
      {props.adviseAvailable ? (
        <box style={{ flexDirection: "row", gap: 1 }}>
          <text fg={focus === "advise" ? palette.accentText : palette.agent} bg={focus === "advise" ? palette.agent : undefined}>
            {` ★ Agent advise `}
          </text>
          <text fg={palette.muted}>{`· ${props.adviseBackend}`}</text>
          <text fg={adviseBadgeColor}>{`[${adviseStateBadge}]`}</text>
          {adviseRunning ? <text fg={palette.agent}>{`${spinner} researching your context…`}</text> : null}
        </box>
      ) : (
        <text fg={palette.faint}>★ Agent advise unavailable — pass --context or add PRP.md</text>
      )}
      {props.adviseEnabled && props.adviseStatus === "error" ? (
        <text fg={palette.warn}>✗ Agent advise failed: {props.adviseError ?? "unknown error"} — search still works</text>
      ) : null}
      <select
        options={options}
        focused={focus === "list"}
        selectedIndex={Math.max(options.findIndex((option) => option.value === focusedRef), 0)}
        onChange={(_index, option) => option && setFocusedRef(String(option.value))}
        style={{ height: 10 }}
      />
      <text fg={palette.faint}>{`${props.selectedSkills.length} selected · ${options.length} listed${props.recommendations.length > 0 ? ` · ★ ${props.recommendations.length} agent-recommended` : ""}`}</text>
      <ButtonBar
        buttons={buttons}
        focusedId={focus === "buttons" ? focusedButtonId : undefined}
        hint="Tab: cycle focus · Space/Enter: toggle · a: advise · n: next · Esc/←: back"
      />
    </box>
  );
}
