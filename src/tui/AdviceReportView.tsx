import type { ScrollBoxRenderable } from "@opentui/core";
import type { RefObject } from "react";
import { adviceCreationSupport } from "../engine/advice-apply";
import type { AdviceReport } from "../engine/advice-types";
import {
  adviceDecisionSummary,
  adviceNoRecommendationSummary,
  adviceSupportOutcome,
  backendName,
  formatAdviceTuiReportLines,
  reportLineColor,
} from "./advice-presenter";
import { KeyHints, palette } from "./chrome";
import { binding, bindingsHint, defineBindings } from "./keymap";

const populatedReportBindings = defineBindings(
  binding(["up", "down"], "move", "select recommendation"),
  binding(["left", "right"], "action", "focus report action"),
  binding(["pageup", "pagedown"], "scroll", "scroll report"),
  binding("enter", "activate", "activate report action"),
  binding("r", "retry", "options/rerun"),
  binding(["escape", "b"], "back", "launcher"),
  binding(["q", "ctrl+c"], "quit", "close"),
);

const emptyReportBindings = defineBindings(
  binding(["pageup", "pagedown"], "scroll", "scroll report"),
  binding("r", "retry", "options/rerun"),
  binding(["escape", "b"], "back", "launcher"),
  binding(["q", "ctrl+c"], "quit", "close"),
);

export function adviceReportBindings(report: AdviceReport) {
  return report.recommendations.length ? populatedReportBindings : emptyReportBindings;
}

export function AdviceReportView(props: {
  report: AdviceReport;
  selectedRecommendationIndex: number;
  reportActionIndex: number;
  actionMessage?: string;
  showTechnicalDetails: boolean;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
}) {
  const lines = formatAdviceTuiReportLines(props.report);
  const recommendationFunnel = props.report.sessions.funnel?.recommendation;
  const recovered = recommendationFunnel?.localRecoveries ?? 0;
  const modelCalls = recommendationFunnel?.modelCalls ?? 1;
  const analysis = props.report.analysis;
  const selected = props.report.recommendations[props.selectedRecommendationIndex];
  const support = selected ? adviceCreationSupport(selected) : undefined;
  const decision = selected ? adviceDecisionSummary(props.report, selected) : undefined;
  const creatableCount = props.report.recommendations.filter((recommendation) => {
    const kind = adviceCreationSupport(recommendation).kind;
    return kind === "files" || kind === "skill";
  }).length;
  const bindings = adviceReportBindings(props.report);

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text>
        <span fg={palette.accent}>✦ Advice report</span>
        <span fg={analysis?.status === "partial" ? palette.warn : palette.success}>{` · ${backendName(props.report.backend)} · ${props.report.recommendations.length} validated recommendation(s)${props.showTechnicalDetails ? ` · ${modelCalls} model call(s)${recovered ? ` · ${recovered} recovered locally` : ""}` : ""}`}</span>
      </text>
      {analysis?.status === "partial" ? (
        <text fg={palette.warn}>{`Partial report. Failed categories: ${analysis.categories.filter((item) => item.status === "failed").map((item) => item.category).join(", ")}. Validated recommendations remain reviewable.`}</text>
      ) : null}
      {selected && decision ? (
        <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
          <text bg={palette.selBg}>
            <span fg={palette.accent}>{`▸ ${props.selectedRecommendationIndex + 1}/${props.report.recommendations.length} `}</span>
            <span fg={palette.text}>{decision.benefit}</span>
            <span fg={palette.gold}>{` · ${selected.confidence} confidence`}</span>
            <span fg={support?.kind === "files" || support?.kind === "skill" ? palette.success : palette.warn}>{` · ${adviceSupportOutcome(support?.kind ?? "unsupported")}`}</span>
          </text>
          <text><span fg={palette.gold}>Why: </span><span fg={palette.text}>{decision.why}</span></text>
          <text><span fg={palette.gold}>Value: </span><span fg={palette.success}>{decision.benefit}</span></text>
          <text><span fg={palette.gold}>Evidence: </span><span fg={palette.muted}>{decision.evidence}</span></text>
          <text><span fg={palette.gold}>Creates: </span><span fg={palette.text}>{decision.creates}</span></text>
        </box>
      ) : (
        <text fg={palette.warn}>{adviceNoRecommendationSummary(props.report)}</text>
      )}
      {selected ? (
        <box style={{ flexDirection: "row", flexShrink: 0, gap: 2 }}>
          <text bg={props.reportActionIndex === 0 ? palette.selBg : undefined} fg={palette.text}>{`${props.reportActionIndex === 0 ? "▸ " : "  "}${support?.kind === "inspect" ? "Inspect registry item" : "Create selected"}`}</text>
          <text bg={props.reportActionIndex === 1 ? palette.selBg : undefined} fg={palette.text}>{`${props.reportActionIndex === 1 ? "▸ " : "  "}Create all (${creatableCount})`}</text>
        </box>
      ) : null}
      {props.actionMessage ? <text style={{ flexShrink: 0 }} fg={palette.warn}>{props.actionMessage}</text> : null}
      <text style={{ flexShrink: 0 }} fg={palette.gold}>
        {props.showTechnicalDetails ? `Technical details · ${lines.length} lines · press t to hide` : "Show technical details · press t"}
      </text>
      {props.showTechnicalDetails ? (
        <scrollbox
          ref={props.scrollRef}
          focused={false}
          scrollX={false}
          scrollY
          viewportCulling
          style={{ flexGrow: 1, flexShrink: 1, width: "100%" }}
          contentOptions={{ flexDirection: "column", width: "100%" }}
        >
          {lines.map((line, index) => (
            <text key={`${index}-${line}`} style={{ flexShrink: 0 }} fg={reportLineColor(line)}>{line || " "}</text>
          ))}
        </scrollbox>
      ) : (
        <box style={{ flexGrow: 1 }} />
      )}
      <text style={{ flexShrink: 0 }} fg={palette.muted}>Analysis is read-only. Creation always opens a separate review and confirmation step.</text>
      <box style={{ flexShrink: 0 }}><KeyHints hint={bindingsHint(bindings)} /></box>
    </box>
  );
}
