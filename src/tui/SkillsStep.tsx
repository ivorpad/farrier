import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { AdviseBackend, SkillRecommendation } from "../engine/advise";
import type { SkillSearchResult } from "../engine/skills";
import type { SkillRef } from "../packs/types";
import { adjacentButtonId, ButtonBar, type ButtonSpec } from "./ButtonBar";
import { DetailPane, formatInstalls, palette, scrollWindow, StepHeader, useSpinner, type PaneLine } from "./chrome";
import type { AdviseStatus, SkillSearchStatus } from "./machine";

type SkillsStepProps = {
  query: string;
  packId: string;
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

// The list scrolls like the Review manifest so a long skills.sh search never
// pushes the pane or keymap off an 80×24 terminal.
const maxVisibleSkills = 6;

const nameColWidth = 24;

type SkillRow = {
  ref: SkillRef;
  name: string;
  selected: boolean;
  installs: number;
  recommended: boolean;
};

function refForResult(result: SkillSearchResult): SkillRef {
  return `${result.source}@${result.skillId}`;
}

function fit(text: string, width: number): string {
  if (text.length <= width) {
    return text.padEnd(width);
  }

  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
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

  const rows = useMemo<SkillRow[]>(() => {
    const rowByRef = new Map<string, SkillRow>();

    for (const result of props.results) {
      const ref = refForResult(result);
      rowByRef.set(ref, {
        ref,
        name: result.name,
        selected: props.selectedSkills.includes(ref),
        installs: result.installs,
        recommended: false
      });
    }

    for (const recommendation of props.recommendations) {
      rowByRef.set(recommendation.ref, {
        ref: recommendation.ref,
        name: recommendation.name,
        selected: props.selectedSkills.includes(recommendation.ref),
        installs: recommendation.installs,
        recommended: true
      });
    }

    for (const ref of props.selectedSkills) {
      if (!rowByRef.has(ref)) {
        // Pack defaults carry only a ref (source@skillId); the skillId is the
        // human-meaningful half, and we have no install count for them.
        rowByRef.set(ref, { ref, name: ref.split("@").pop() ?? ref, selected: true, installs: 0, recommended: false });
      }
    }

    return Array.from(rowByRef.values());
  }, [props.recommendations, props.results, props.selectedSkills]);

  useEffect(() => {
    if (rows.length === 0) {
      setFocusedRef(undefined);
      return;
    }

    if (!focusedRef || !rows.some((row) => row.ref === focusedRef)) {
      setFocusedRef(rows[0].ref);
    }
  }, [focusedRef, rows]);

  const focusedIndex = Math.max(
    rows.findIndex((row) => row.ref === focusedRef),
    0
  );

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

    if (key.name === "up") {
      if (focus === "buttons") {
        setFocus("list");
      } else if (focus === "list") {
        const prev = rows[Math.max(focusedIndex - 1, 0)];
        if (prev) {
          setFocusedRef(prev.ref);
        }
      }
      return;
    }

    if (key.name === "down" && focus === "list") {
      const next = rows[Math.min(focusedIndex + 1, rows.length - 1)];
      if (next) {
        setFocusedRef(next.ref);
      }
      return;
    }

    if (key.name === "n" && focus !== "input") {
      props.onNext();
      return;
    }

    if (key.name === "b" && focus !== "input" && focus !== "buttons") {
      props.onBack();
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

    // Space is the sole toggle; enter always advances (one keymap everywhere).
    if (focus === "list" && focusedRef && isSpace(key)) {
      props.onToggleSkill(focusedRef);
      return;
    }

    if (focus === "advise" && props.adviseAvailable && (key.name === "enter" || key.name === "return" || key.name === "linefeed" || isSpace(key))) {
      props.onToggleAdvise();
      return;
    }

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed") {
      if (focus === "buttons" && focusedButtonId === "back") {
        props.onBack();
      } else {
        props.onNext();
      }
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
          ? "Pack defaults are preselected — receipts below. Type to search skills.sh."
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

  // The detail pane answers the only real question about the focused row: why
  // is it on or off? It mirrors the Hooks "agent sees" pane — one grammar, two
  // domains — and cites real evidence: an agent recommendation's reason, the
  // pack it defaults from, or its skills.sh install count.
  const whyPane = (() => {
    if (!focusedRef) {
      return undefined;
    }

    const checked = props.selectedSkills.includes(focusedRef);
    const recommendation = props.recommendations.find((item) => item.ref === focusedRef);
    const result = props.results.find((item) => refForResult(item) === focusedRef);
    const name = recommendation?.name ?? result?.name ?? focusedRef;
    const title = `why ${checked ? "checked" : "unchecked"} · ${name}`;

    if (recommendation) {
      return {
        title,
        lines: [
          { fg: palette.gold, text: `★ recommended: ${recommendation.reason}` },
          { fg: palette.faint, text: `${formatInstalls(recommendation.installs)} installs · ${recommendation.ref}` }
        ] as PaneLine[]
      };
    }

    if (result) {
      return {
        title,
        lines: [
          { fg: palette.gold, text: `${formatInstalls(result.installs)} installs on skills.sh` },
          { fg: palette.faint, text: "check to pin it in skills-lock.json" }
        ] as PaneLine[]
      };
    }

    return {
      title,
      lines: [
        { fg: palette.faint, text: `pack default for ${props.packId} — uncheck to drop` }
      ] as PaneLine[]
    };
  })();

  const listWindow = scrollWindow(focusedIndex, rows.length, maxVisibleSkills);
  const visibleRows = rows.slice(listWindow.start, listWindow.end);

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Skills" subtitle={`From skills.sh, matched to ${props.packId} · pinned in skills-lock.json`} />
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
      {rows.length === 0 ? (
        <text fg={palette.faint}>No skills to list yet — type above to search skills.sh.</text>
      ) : (
        <box style={{ flexDirection: "column", gap: 0 }}>
          {visibleRows.map((row, offset) => {
            const index = listWindow.start + offset;
            const focused = index === focusedIndex;
            const bg = focused && focus === "list" ? palette.selBg : undefined;
            const cursor = focused ? "▸ " : "  ";

            return (
              <text key={row.ref} bg={bg}>
                <span fg={palette.accent}>{cursor}</span>
                <span fg={row.selected ? palette.success : palette.faint}>{row.selected ? "[x] " : "[ ] "}</span>
                {row.recommended ? <span fg={palette.gold}>{"★ "}</span> : null}
                <span fg={palette.text}>{fit(row.name, nameColWidth)}</span>
                {row.installs > 0 ? (
                  <span>
                    <span fg={palette.gold}>{`  ${formatInstalls(row.installs)}`}</span>
                    <span fg={palette.faint}>{" installs"}</span>
                  </span>
                ) : (
                  <span fg={palette.faint}>{"  pack default"}</span>
                )}
              </text>
            );
          })}
          {rows.length > maxVisibleSkills ? (
            <text fg={palette.faint}>
              {`      showing ${listWindow.start + 1}–${listWindow.end} of ${rows.length} · ↑↓ scrolls`}
            </text>
          ) : null}
        </box>
      )}
      {whyPane ? <DetailPane title={whyPane.title} lines={whyPane.lines} /> : null}
      <text>
        <span fg={palette.gold}>{String(props.selectedSkills.length)}</span>
        <span fg={palette.muted}>{` selected · ${rows.length} listed`}</span>
        {props.recommendations.length > 0 ? (
          <span>
            <span fg={palette.muted}>{" · ★ "}</span>
            <span fg={palette.gold}>{String(props.recommendations.length)}</span>
            <span fg={palette.muted}>{" agent-recommended"}</span>
          </span>
        ) : null}
      </text>
      <ButtonBar
        buttons={buttons}
        focusedId={focus === "buttons" ? focusedButtonId : undefined}
        hint="space toggle · a advise · enter continue · b back"
      />
    </box>
  );
}
