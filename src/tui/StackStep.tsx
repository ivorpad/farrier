import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { PackDetect } from "../packs/types";
import type { PackCatalog, PackListing } from "../registry/catalog";
import { adjacentButtonId, ButtonBar, type ButtonSpec } from "./ButtonBar";
import { palette, StepHeader } from "./chrome";

type StackStepProps = {
  packIds: string[];
  listings: PackListing[];
  catalog: PackCatalog;
  warnings?: string[];
  selectedPackId: string;
  detectedPackId?: string;
  onSelectPack: (packId: string) => void;
  onNext: () => void;
  onCancel: () => void;
};

type Zone = "list" | "buttons";

const buttons: ButtonSpec[] = [
  { id: "cancel", label: "Exit" },
  { id: "next", label: "Continue →" }
];

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
  generic: "language-agnostic starter harness"
};

function summaryFor(packId: string, listings: PackListing[]): string {
  const authored = packSummary[packId];
  if (authored) {
    return authored;
  }

  return listings.find((listing) => listing.id === packId)?.description ?? "available pack";
}

/**
 * The files/signals that PROVED detection — evidence-first: the detected row
 * cites what farrier read, not just an assertion. Pulled from the pack's own
 * detect spec (files + dependency signals), so it is honest and unfabricated.
 */
function detectedEvidence(detect: PackDetect): string[] {
  const evidence: string[] = [];

  for (const file of detect.files ?? []) {
    evidence.push(file);
  }

  for (const file of detect.anyFiles ?? []) {
    evidence.push(file);
  }

  if ((detect.pyprojectDependencies ?? []).length > 0) {
    evidence.push(`pyproject.toml → ${detect.pyprojectDependencies!.join(", ")}`);
  }

  const packageDeps = [
    ...(detect.packageJsonDependencies ?? []),
    ...(detect.packageJsonDevDependencies ?? []),
    ...(detect.packageJsonAnyDependencies ?? [])
  ];
  if (packageDeps.length > 0) {
    evidence.push(`package.json → ${packageDeps.join(", ")}`);
  }

  if ((detect.gemfileGems ?? []).length > 0) {
    evidence.push(`Gemfile → ${detect.gemfileGems!.join(", ")}`);
  }

  for (const child of detect.any ?? []) {
    evidence.push(...detectedEvidence(child));
  }

  return Array.from(new Set(evidence));
}

function evidenceFor(packId: string | undefined, catalog: PackCatalog): string {
  if (!packId) {
    return "";
  }

  try {
    return detectedEvidence(catalog.resolvePack(packId).detect).join(", ");
  } catch {
    return "";
  }
}

export function StackStep(props: StackStepProps) {
  const [zone, setZone] = useState<Zone>("list");
  const [focusedButtonId, setFocusedButtonId] = useState<string>(buttons[0].id);
  const [focusedIndex, setFocusedIndex] = useState<number>(
    Math.max(props.packIds.indexOf(props.selectedPackId), 0)
  );

  const nameWidth = props.packIds.reduce((width, packId) => Math.max(width, packId.length), 0);
  const rowWidth = 58;
  const detectedEvidenceText = evidenceFor(props.detectedPackId, props.catalog);

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
    if (key.name === "escape" || key.name === "q") {
      props.onCancel();
      return;
    }

    if (key.name === "tab") {
      setZone((current) => (current === "list" ? "buttons" : "list"));
      return;
    }

    if (key.name === "down") {
      if (zone === "list") {
        moveFocus(1);
      }
      return;
    }

    if (key.name === "up") {
      if (zone === "buttons") {
        setZone("list");
      } else {
        moveFocus(-1);
      }
      return;
    }

    if (key.name === "left") {
      if (zone === "buttons") {
        if (focusedButtonId === buttons[0].id) {
          setZone("list");
        } else {
          setFocusedButtonId((current) => adjacentButtonId(buttons, current, -1) ?? current);
        }
      }
      return;
    }

    if (key.name === "right") {
      if (zone === "buttons") {
        setFocusedButtonId((current) => adjacentButtonId(buttons, current, 1) ?? current);
      } else {
        props.onNext();
      }
      return;
    }

    if (key.name === "n" && zone === "list") {
      props.onNext();
      return;
    }

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed") {
      if (zone === "buttons") {
        if (focusedButtonId === "cancel") {
          props.onCancel();
        } else {
          props.onNext();
        }
        return;
      }

      props.onNext();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <StepHeader current="Stack" subtitle="Which iron are we working?" />
      {props.warnings && props.warnings.length > 0 ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          {props.warnings.slice(0, 2).map((warning) => (
            <text key={warning} fg={palette.warn}>{warning}</text>
          ))}
        </box>
      ) : null}
      <box style={{ flexDirection: "column", gap: 0 }}>
        {props.packIds.map((packId, index) => {
          const focused = index === focusedIndex && zone === "list";
          const detected = packId === props.detectedPackId;
          const bg = focused ? palette.selBg : undefined;
          const cursor = index === focusedIndex ? "▸ " : "  ";
          const trailing = " ".repeat(Math.max(rowWidth - nameWidth - 3, 0));

          return (
            <text key={packId} bg={bg}>
              <span fg={palette.accent}>{cursor}</span>
              <span fg={palette.text}>{packId.padEnd(nameWidth + 1)}</span>
              {detected ? (
                <span>
                  <span fg={palette.success}>{"detected"}</span>
                  {detectedEvidenceText ? <span fg={palette.faint}>{` · ${detectedEvidenceText}`}</span> : null}
                </span>
              ) : (
                <span fg={palette.muted}>{summaryFor(packId, props.listings)}</span>
              )}
              <span>{trailing}</span>
            </text>
          );
        })}
      </box>
      <text fg={palette.faint}>
        The pack decides everything downstream: which hooks make sense, which skills exist for it, what `just check` runs.
      </text>
      <ButtonBar
        buttons={buttons}
        focusedId={zone === "buttons" ? focusedButtonId : undefined}
        hint="↑↓ move · enter choose · q quit"
      />
    </box>
  );
}
