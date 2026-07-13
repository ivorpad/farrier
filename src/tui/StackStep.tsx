import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { DetectedPackEvidence } from "../engine/detect";
import type { PackListing } from "../registry/catalog";
import { ButtonBar } from "./ButtonBar";
import { palette, StepHeader } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";
import { detectedPackPresentations, stackSelectionAssumption } from "./pack-presentation";

type StackStepProps = {
  packIds: string[];
  listings: PackListing[];
  warnings?: string[];
  selectedPackId: string;
  detectedPacks: DetectedPackEvidence[];
  onSelectPack: (packId: string) => void;
  onNext: () => void;
  onCancel: () => void;
};

const stackBindings = defineBindings(
  binding(["up", "down"], "move", "move"),
  binding("enter", "choose", "choose"),
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);

/**
 * Human one-line summaries for each real pack, shown in muted text next to the
 * pack name. Authored copy describing the actual packs — never invented stacks.
 */
const packSummary: Record<string, string> = {
  "python-uv": "uv-managed python · ruff + pytest",
  "python-fastapi": "fastapi services on uv",
  "python-lambda-powertools": "aws lambda powertools on uv",
  "ts-base": "typescript + bun · tsc + bun test",
  "ts-react-vite": "react + vite on bun",
  "ts-nextjs": "next.js on bun",
  "ts-lambda": "typescript aws lambda / cdk",
  rails: "ruby on rails · minitest + rubocop",
  generic: "language-agnostic starter harness",
};

function summaryFor(packId: string, listings: PackListing[]): string {
  const authored = packSummary[packId];
  if (authored) {
    return authored;
  }

  return listings.find((listing) => listing.id === packId)?.description ?? "available pack";
}

export function StackStep(props: StackStepProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(Math.max(props.packIds.indexOf(props.selectedPackId), 0));

  const nameWidth = props.packIds.reduce((width, packId) => Math.max(width, packId.length), 0);
  const detectedByPack = new Map(detectedPackPresentations(props.detectedPacks).map((match) => [match.packId, match]));

  function moveFocus(delta: -1 | 1): void {
    const next = Math.min(Math.max(focusedIndex + delta, 0), props.packIds.length - 1);
    if (next === focusedIndex) {
      return;
    }

    setFocusedIndex(next);
    const packId = props.packIds[next];
    if (packId) {
      props.onSelectPack(packId);
    }
  }

  useKeyboard((key) => {
    const intent = resolveIntent(stackBindings, key);
    if (intent === "back" || intent === "quit") {
      props.onCancel();
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
    if (intent === "choose") props.onNext();
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Stack" subtitle="Which iron are we working?" />
      {props.warnings && props.warnings.length > 0 ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          {props.warnings.slice(0, 2).map((warning) => (
            <text key={warning} fg={palette.warn}>
              {warning}
            </text>
          ))}
        </box>
      ) : null}
      <box style={{ flexDirection: "column", gap: 0 }}>
        {props.packIds.map((packId, index) => {
          const focused = index === focusedIndex;
          const detected = detectedByPack.get(packId);
          const bg = focused ? palette.selBg : undefined;
          const cursor = index === focusedIndex ? "▸ " : "  ";

          return (
            <text key={packId} bg={bg}>
              <span fg={palette.accent}>{cursor}</span>
              <span fg={palette.text}>{packId.padEnd(nameWidth + 1)}</span>
              {detected !== undefined ? (
                <span>
                  <span fg={palette.success}>{detected.label}</span>
                  <span fg={palette.faint}>{` · ${detected.evidence.join(", ")}`}</span>
                </span>
              ) : (
                <span fg={palette.muted}>{summaryFor(packId, props.listings)}</span>
              )}
            </text>
          );
        })}
      </box>
      <text fg={props.selectedPackId === props.detectedPacks[0]?.packId ? palette.faint : palette.gold}>{stackSelectionAssumption(props.selectedPackId, props.detectedPacks)}</text>
      <text fg={palette.faint}>The pack decides everything downstream: which hooks make sense, which skills exist for it, what `just check` runs.</text>
      <ButtonBar hint={bindingsHint(stackBindings)} />
    </box>
  );
}
