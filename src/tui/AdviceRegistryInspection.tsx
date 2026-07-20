import { useKeyboard } from "@opentui/react";
import type { AdviceRecommendation, AdviceReport } from "../engine/advice-types";
import { KeyHints, palette } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";

const inspectionBindings = defineBindings(
  binding(["enter", "escape", "b"], "back", "back to report"),
  binding(["q", "ctrl+c"], "quit", "close"),
);

function nextStep(recommendation: AdviceRecommendation): string {
  if (recommendation.category === "skills") {
    return "Return to the report, then use the Skills search/install flow if you want this exact verified skill.";
  }
  if (recommendation.category === "plugins") {
    return "Plugin installation remains separate because Farrier has not verified a safe marketplace command for this item.";
  }
  return "MCP configuration remains separate until its exact command, environment requirements, and project destination are reviewed.";
}

export function AdviceRegistryInspection(props: {
  report: AdviceReport;
  recommendation: AdviceRecommendation;
  onBack: () => void;
  onClose: () => void;
}) {
  useKeyboard((key) => {
    const intent = resolveIntent(inspectionBindings, key);
    if (intent === "back") props.onBack();
    else if (intent === "quit") props.onClose();
  });

  const recommendation = props.recommendation;
  const registryRef = recommendation.registryRef ?? "missing registry reference";
  const verified = props.report.registry?.verifiedMatches.includes(registryRef) ?? false;
  const evidenceById = new Map(
    [...props.report.profile.evidence, ...props.report.sessions.evidence].map((item) => [item.id, item]),
  );

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.accent}>✦ Registry inspection</text>
      <text><span fg={palette.gold}>Reference: </span><span fg={palette.text}>{registryRef}</span></text>
      <text><span fg={palette.gold}>Category: </span><span fg={palette.text}>{recommendation.category}</span></text>
      <text><span fg={palette.gold}>Provider: </span><span fg={palette.text}>{recommendation.targetVendors.join(", ")}</span></text>
      <text>
        <span fg={palette.gold}>Catalog status: </span>
        <span fg={verified ? palette.success : palette.warn}>{verified ? "verified for this report" : "not present in the report's verified matches"}</span>
      </text>
      <text><span fg={palette.gold}>Why it was suggested: </span><span fg={palette.text}>{recommendation.reason}</span></text>
      <text><span fg={palette.gold}>Expected value: </span><span fg={palette.success}>{recommendation.benefit}</span></text>
      <text><span fg={palette.gold}>Route: </span><span fg={palette.text}>{recommendation.implementationRoute.description}</span></text>
      <box style={{ flexDirection: "column", gap: 0 }}>
        <text fg={palette.gold}>Evidence used</text>
        {recommendation.evidence.map((id) => (
          <text key={id} fg={palette.muted}>{`  ${id}: ${evidenceById.get(id)?.summary ?? "evidence summary unavailable"}`}</text>
        ))}
      </box>
      <text><span fg={palette.gold}>Next step: </span><span fg={palette.muted}>{nextStep(recommendation)}</span></text>
      <text fg={palette.faint}>Inspection is read-only. No package was installed and no project file was changed.</text>
      <KeyHints hint={bindingsHint(inspectionBindings)} />
    </box>
  );
}
