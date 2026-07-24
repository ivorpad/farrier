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
  /** Languages the deterministic profile saw; named in the zero-detection line. */
  profileLanguages?: string[];
  onSelectPack: (packId: string) => void;
  onNext: () => void;
  /** esc/b: back to the Agent step. */
  onBack: () => void;
  /** q/ctrl+c: quit farrier. */
  onQuit: () => void;
  /** The active context source (e.g. "file:docs/PRP.md", "text", "deterministic-project-profile"). */
  contextSource?: string;
  /** True while a submitted PRD path/text is being resolved. */
  contextPending?: boolean;
  onContextSubmit?: (value: string) => void;
};

const stackBindings = defineBindings(
  binding(["up", "down"], "move", "move"),
  binding(["tab", "shift+tab"], "focus", "PRD field"),
  binding("enter", "choose", "choose"),
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);
const contextBindings = defineBindings(
  binding(["tab", "shift+tab"], "focus", "back to stacks"),
  binding("enter", "submit", "save"),
  binding("escape", "leaveField", "leave field"),
  binding("ctrl+c", "quit", "quit")
);

/** Human label for the active context source shown under the PRD field. */
export function stackContextLabel(source?: string): string {
  if (!source) return "none yet — suggestions will read the detected project profile";
  if (source === "deterministic-project-profile") return "detected project profile";
  if (source.startsWith("detected:")) return `${source.slice("detected:".length)} (auto-detected) + project profile`;
  if (source.startsWith("file:")) return `${source.slice("file:".length)} + project profile`;
  return "pasted text + project profile";
}

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

/**
 * Plain stack names lead each row; the pack slug is demoted to the muted tail
 * so the emphasized text is the one a user recognizes.
 */
const packDisplayName: Record<string, string> = {
  "python-uv": "Python",
  "python-fastapi": "Python · FastAPI",
  "python-lambda-powertools": "Python · AWS Lambda",
  "ts-base": "TypeScript",
  "ts-react-vite": "React + Vite",
  "ts-nextjs": "Next.js web app",
  "ts-lambda": "TypeScript · AWS Lambda",
  rails: "Ruby on Rails",
  generic: "Any language (neutral starter)",
};

export function displayNameFor(packId: string): string {
  return packDisplayName[packId] ?? packId;
}

function summaryFor(packId: string, listings: PackListing[]): string {
  const authored = packSummary[packId];
  if (authored) {
    return authored;
  }

  return listings.find((listing) => listing.id === packId)?.description ?? "available pack";
}

export function StackStep(props: StackStepProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(Math.max(props.packIds.indexOf(props.selectedPackId), 0));
  const [focus, setFocus] = useState<"list" | "context">("list");
  const [contextDraft, setContextDraft] = useState("");
  const contextAvailable = props.onContextSubmit !== undefined;

  const nameWidth = props.packIds.reduce((width, packId) => Math.max(width, displayNameFor(packId).length), 0);
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

  function submitContext(): void {
    const trimmed = contextDraft.trim();
    if (trimmed.length === 0) return;
    props.onContextSubmit?.(trimmed);
    setFocus("list");
  }

  useKeyboard((key) => {
    const intent = resolveIntent(focus === "context" ? contextBindings : stackBindings, key, {
      textInputFocused: focus === "context",
    });
    if (intent === "quit") {
      props.onQuit();
      return;
    }
    if (intent === "focus" && contextAvailable) {
      setFocus((current) => (current === "list" ? "context" : "list"));
      return;
    }
    if (intent === "leaveField") {
      setFocus("list");
      return;
    }
    if (focus === "context") {
      return;
    }
    if (intent === "back") {
      props.onBack();
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
      // With no detection nothing is preselected; pressing enter on a row is the
      // explicit pick that unblocks advancing (selection otherwise follows focus).
      if (!props.selectedPackId) {
        const packId = props.packIds[focusedIndex];
        if (packId) {
          props.onSelectPack(packId);
        }
      }
      props.onNext();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Stack" subtitle="Which stack does your project use?" />
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
              <span fg={palette.text}>{displayNameFor(packId).padEnd(nameWidth + 1)}</span>
              <span fg={palette.faint}>{`${packId} `}</span>
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
      <text fg={props.selectedPackId === props.detectedPacks[0]?.packId ? palette.faint : palette.gold}>{stackSelectionAssumption(props.selectedPackId, props.detectedPacks, props.profileLanguages ?? [])}</text>
      <text fg={palette.faint}>The pack decides everything downstream: which hooks make sense, which skills exist for it, what `just check` runs.</text>
      {contextAvailable ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={focus === "context" ? palette.gold : palette.muted}>
            Optional: what are you building? Paste a PRD / brief, or a path to one. It powers the skill suggestions later.
          </text>
          <input
            placeholder="e.g. docs/PRD.md, or paste the brief itself — enter saves"
            focused={focus === "context"}
            onInput={(value) => setContextDraft(String(value))}
            onSubmit={submitContext}
            onKeyDown={(key) => {
              if (resolveIntent(contextBindings, key) === "leaveField" && (key.name === "escape" || key.sequence === "\u001b")) {
                key.preventDefault();
                key.stopPropagation();
                setFocus("list");
              }
            }}
          />
          <text fg={palette.faint}>
            {props.contextPending ? "reading the brief…" : `context: ${stackContextLabel(props.contextSource)}`}
          </text>
        </box>
      ) : null}
      <ButtonBar hint={bindingsHint(focus === "context" ? contextBindings : stackBindings)} />
    </box>
  );
}
