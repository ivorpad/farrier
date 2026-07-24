import { createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { AdviceCreationPlan } from "../engine/advice-apply";
import type { ApplyHarnessChangePlanResult, HarnessChangePlan } from "../engine/create-plan";
import type { DistillReport, DroppedLesson } from "../engine/distill";
import type { DistillLesson } from "../engine/distill-playbook";
import { AdviceApplyFlow, advicePlanPreviewLines } from "./AdviceApplyFlow";
import { DetailPane, KeyHints, palette, useSpinner, type PaneLine } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";
import { sessionModelSettings, type SessionAgentContext } from "./session-context";

/**
 * The distill surface: turn this project's finished sessions into a portable
 * playbook. Mining and signature hints are local; the LLM lesson
 * classification runs only after the explicit consent screen (redacted
 * excerpts go to the selected backend). Every lesson is reviewed here, the
 * proposal shows its exact files, and applying goes through the shared
 * AdviceApplyFlow with backups.
 */

type Classified = { lessons: DistillLesson[]; dropped: DroppedLesson[] };

type DistillPhase =
  | { kind: "mining" }
  | { kind: "consent"; report: DistillReport }
  | { kind: "classifying"; report: DistillReport }
  | { kind: "lessons"; report: DistillReport; excluded: ReadonlySet<string> }
  | { kind: "error"; message: string };

export function lessonRowLabel(lesson: DistillLesson): string {
  const evidence = `${lesson.steerIndexes.length} steer(s), ${lesson.clusterIndexes.length} cluster(s)`;
  return `${lesson.proposedGate ? "NEW " : ""}${lesson.gateId} — ${evidence}`;
}

export function lessonDetailLines(lesson: DistillLesson, report: DistillReport, included: boolean): PaneLine[] {
  const lines: PaneLine[] = [
    {
      fg: lesson.classification === "portable" ? palette.gold : palette.warn,
      text: lesson.classification === "portable"
        ? included ? "Portable — included in the playbook." : "Portable — excluded by you."
        : "App-specific — stays evidence, never installed."
    },
    ...advicePlanPreviewLines(lesson.rationale, 56).map((text) => ({ fg: palette.muted, text }))
  ];
  for (const index of lesson.steerIndexes.slice(0, 2)) {
    const steer = report.annotated.steers[index];
    if (steer) lines.push({ fg: palette.faint, text: `steer: ${steer.text.replace(/\s+/g, " ").slice(0, 120)}` });
  }
  for (const index of lesson.clusterIndexes.slice(0, 2)) {
    const cluster = report.annotated.failureClusters[index];
    if (cluster) lines.push({ fg: palette.faint, text: `failures: ${cluster.key} ${cluster.count}× / ${cluster.sessionCount} session(s)` });
  }
  if ((lesson.exitChecks?.length ?? 0) > 0) {
    lines.push({ fg: palette.gold, text: `Exit checks: ${lesson.exitChecks!.length} deterministic rule(s) — reviewed in gates/gates.json.` });
  }
  if (lesson.proposedGate) {
    lines.push({ fg: palette.warn, text: "Proposed catalog entry: not in the gate catalog yet; ships marked PROPOSED in gates.md." });
  }
  return lines;
}

export function DistillApp(props: {
  onMine: () => Promise<DistillReport>;
  onClassify: (report: DistillReport) => Promise<Classified>;
  onPlan: (report: DistillReport, lessons: DistillLesson[]) => Promise<{ plan: AdviceCreationPlan; inspection: HarnessChangePlan }>;
  onApply: (plan: AdviceCreationPlan, force: boolean) => Promise<ApplyHarnessChangePlanResult>;
  backendLabel: string;
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<DistillPhase>({ kind: "mining" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [reviewing, setReviewing] = useState<DistillLesson[]>();
  const [applied, setApplied] = useState(false);
  const bodyScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const spinner = useSpinner(phase.kind === "mining" || phase.kind === "classifying");

  useEffect(() => {
    let cancelled = false;
    props.onMine()
      .then((report) => {
        if (!cancelled) setPhase({ kind: "consent", report });
      })
      .catch((error) => {
        if (!cancelled) setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const consentBindings = defineBindings(
    binding("y", "consent", "send & classify"),
    binding("n", "local", "stay local"),
    binding(["escape", "b"], "back", "launcher"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );
  const lessonsBindings = defineBindings(
    binding(["up", "down"], "move", "lessons"),
    binding("space", "toggle", "include/exclude"),
    binding("enter", "activate", "review files"),
    binding(["pageup", "pagedown"], "scroll", "scroll"),
    binding(["escape", "b"], "back", "launcher"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );
  const idleBindings = defineBindings(
    binding(["escape", "b"], "back", "launcher"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );

  const lessons = phase.kind === "lessons" ? phase.report.lessons : [];
  const activeBindings =
    phase.kind === "consent" ? consentBindings : phase.kind === "lessons" && lessons.length > 0 ? lessonsBindings : idleBindings;

  const startClassify = (report: DistillReport) => {
    setPhase({ kind: "classifying", report });
    props.onClassify(report)
      .then((classified) => {
        setPhase({
          kind: "lessons",
          report: {
            ...report,
            lessons: classified.lessons,
            droppedLessons: classified.dropped,
            llmClassified: true
          },
          excluded: new Set()
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setPhase({
          kind: "lessons",
          report: {
            ...report,
            errors: [...report.errors, `LLM classification failed (${message}); showing signature hints instead.`]
          },
          excluded: new Set()
        });
      });
  };

  useKeyboard((key) => {
    if (reviewing) return;
    const intent = resolveIntent(activeBindings, key);
    if (intent === "back" || intent === "quit") {
      props.onExit();
      return;
    }
    if (phase.kind === "consent") {
      if (intent === "consent") startClassify(phase.report);
      else if (intent === "local") setPhase({ kind: "lessons", report: phase.report, excluded: new Set() });
      return;
    }
    if (phase.kind !== "lessons") return;
    if (intent === "scroll") bodyScrollRef.current?.scrollBy(key.name === "pagedown" ? 0.85 : -0.85, "viewport");
    else if (intent === "move") {
      setSelectedIndex((current) => Math.min(Math.max(0, current + (key.name === "down" ? 1 : -1)), lessons.length - 1));
    } else if (intent === "toggle") {
      const lesson = lessons[selectedIndex];
      if (!lesson || lesson.classification !== "portable") return;
      const excluded = new Set(phase.excluded);
      if (excluded.has(lesson.gateId)) excluded.delete(lesson.gateId);
      else excluded.add(lesson.gateId);
      setPhase({ ...phase, excluded });
    } else if (intent === "activate") {
      const included = lessons.filter(
        (lesson) => lesson.classification === "portable" && !phase.excluded.has(lesson.gateId)
      );
      if (included.length > 0) setReviewing(included);
    }
  });

  if (reviewing && phase.kind === "lessons") {
    const report = phase.report;
    const included = reviewing;
    return (
      <AdviceApplyFlow
        recommendation={{ id: `${report.playbookName} (${included.length} lesson(s))` }}
        onPlan={() => props.onPlan(report, included)}
        onApply={async (plan, force) => {
          const result = await props.onApply(plan, force);
          setApplied(true);
          return result;
        }}
        onBack={() => setReviewing(undefined)}
        onCancel={props.onExit}
        onDone={props.onExit}
      />
    );
  }

  const selected = lessons[Math.min(selectedIndex, Math.max(lessons.length - 1, 0))];

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text fg={palette.accent}>✦ Distill playbook</text>
        <text fg={palette.muted}>Turns this project's finished sessions into a portable playbook: gates, evidence, review subagents.</text>
      </box>
      {/* Bounded scroll region with flexShrink:0 children (short-terminal overlap rule). */}
      <scrollbox
        ref={bodyScrollRef}
        focused={false}
        scrollX={false}
        scrollY
        stickyScroll
        stickyStart="top"
        viewportCulling
        style={{ flexGrow: 1, flexShrink: 1, width: "100%" }}
        contentOptions={{ flexDirection: "column", gap: 1, width: "100%" }}
      >
        {phase.kind === "mining" ? (
          <text style={{ flexShrink: 0 }} fg={palette.agent}>{`${spinner}  Reading local sessions… nothing leaves this computer.`}</text>
        ) : null}
        {phase.kind === "classifying" ? (
          <text style={{ flexShrink: 0 }} fg={palette.agent}>{`${spinner}  Classifying lessons with ${props.backendLabel}…`}</text>
        ) : null}
        {phase.kind === "error" ? (
          <text style={{ flexShrink: 0 }} fg={palette.warn}>Distill failed: {phase.message}</text>
        ) : null}
        {phase.kind === "consent" ? (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            <text style={{ flexShrink: 0 }} fg={palette.gold}>
              {`Mined locally: ${phase.report.evidence.steers.length} steer(s) and ${phase.report.evidence.failureClusters.length} failure cluster(s) from ${phase.report.evidence.codexSessionsMatched} session(s).`}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.text}>Classify lessons with {props.backendLabel}?</text>
            <text style={{ flexShrink: 0 }} fg={palette.muted}>
              {"Sends: redacted quotes of your own steering messages and failure counts from this project's sessions."}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.muted}>
              {"Never sent: file contents, secrets matched by the redaction denylist, session ids, other projects."}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.warn}>
              {"Limit: redaction is a deterministic denylist; secrets or personal details typed as ordinary prose are NOT caught."}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.muted}>
              {"The result is a portable artifact you can install into other repositories after review."}
            </text>
            <text style={{ flexShrink: 0 }} fg={palette.text}>{"[y] classify with the backend   [n] stay local (signature hints only)"}</text>
          </box>
        ) : null}
        {phase.kind === "lessons" ? (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            <text style={{ flexShrink: 0 }} fg={palette.faint}>
              {`Lesson source: ${phase.report.llmClassified ? "LLM classification (review-gated)" : "catalog signature hints (local only)"}`}
            </text>
            {phase.report.errors.map((error, index) => (
              <text key={`error-${index}`} style={{ flexShrink: 0 }} fg={palette.warn}>{error}</text>
            ))}
          </box>
        ) : null}
        {phase.kind === "lessons" && lessons.length === 0 ? (
          <text style={{ flexShrink: 0 }} fg={palette.muted}>No lessons matched the gate catalog. Nothing to propose.</text>
        ) : null}
        {phase.kind === "lessons" && lessons.length > 0 ? (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            <text style={{ flexShrink: 0 }} fg={palette.gold}>
              {`${lessons.length} lesson(s) · ${lessons.filter((lesson) => lesson.classification === "portable" && !phase.excluded.has(lesson.gateId)).length} included · enter reviews the exact files`}
            </text>
            {lessons.map((lesson, index) => {
              const focused = index === selectedIndex;
              const includable = lesson.classification === "portable";
              const included = includable && !phase.excluded.has(lesson.gateId);
              const marker = includable ? (included ? "[x]" : "[ ]") : "evi";
              return (
                <text key={lesson.gateId} style={{ flexShrink: 0 }} bg={focused ? palette.selBg : undefined}>
                  <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
                  <span fg={included ? palette.success : palette.faint}>{`${marker} `}</span>
                  <span fg={palette.text}>{lessonRowLabel(lesson)}</span>
                </text>
              );
            })}
          </box>
        ) : null}
        {phase.kind === "lessons" && selected ? (
          <DetailPane
            title={selected.gateId}
            lines={lessonDetailLines(selected, phase.report, selected.classification === "portable" && !phase.excluded.has(selected.gateId))}
          />
        ) : null}
        {applied ? <text style={{ flexShrink: 0 }} fg={palette.success}>Playbook installed in this session.</text> : null}
      </scrollbox>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text fg={palette.muted}>Nothing is sent or written without confirmation; the file review comes before any install.</text>
        <KeyHints hint={bindingsHint(activeBindings)} />
      </box>
    </box>
  );
}

export async function runDistillApp(
  targetDir: string,
  options: { session?: SessionAgentContext } = {}
): Promise<void> {
  const backend = options.session?.backend ?? "claude";
  const { loadFarrierConfig } = await import("../config/farrier-config");
  const models = await loadFarrierConfig({ projectDir: targetDir })
    .then((loaded) => loaded.config.models)
    .catch(() => ({}));
  // The consent screen names exactly what would run: the startup-picked
  // model/effort when set, the config default otherwise.
  const settings = sessionModelSettings({ session: options.session, models, backend, role: "advise" });

  const { buildDistillProposal, classifyDistillLessons, createDistillReport } = await import("../engine/distill");
  const { seedGateCatalog } = await import("../engine/distill-catalog");
  const { defaultBackendRunner } = await import("../engine/backend");
  const { applyHarnessChangePlan, inspectHarnessChangePlan } = await import("../engine/create-plan");
  const { readManifest } = await import("../engine/manifest");

  const agents = await readManifest(targetDir)
    .then((manifest) => manifest.agents)
    .catch(() => ["claude", "codex"] as const);

  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  try {
    renderer = await createCliRenderer();
    const cliRenderer = renderer;
    await new Promise<void>((done) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        cliRenderer.destroy();
        done();
      };
      createRoot(cliRenderer).render(
        <DistillApp
          backendLabel={`${backend} (${settings.model ?? "default model"})`}
          onMine={() => createDistillReport({ targetDir, sendSessionEvidence: false })}
          onClassify={(report) =>
            classifyDistillLessons({
              targetDir,
              annotated: report.annotated,
              catalog: seedGateCatalog,
              backend,
              model: settings.model,
              reasoningEffort: settings.reasoningEffort,
              runner: defaultBackendRunner
            })
          }
          onPlan={async (report, included) => {
            const proposal = await buildDistillProposal(report, { agents: [...agents], lessons: included });
            const plan: AdviceCreationPlan = {
              recommendationId: report.playbookName,
              summary: proposal.summary,
              files: proposal.files
            };
            const inspection = await inspectHarnessChangePlan({ targetDir, files: proposal.files });
            return { plan, inspection };
          }}
          onApply={(plan, force) =>
            applyHarnessChangePlan({ targetDir, files: plan.files }, { force, allowExistingHarness: true })
          }
          onExit={finish}
        />
      );
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier: ${error instanceof Error ? error.message : String(error)}`);
  }
}
