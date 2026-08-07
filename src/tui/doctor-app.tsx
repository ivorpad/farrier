import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { useEffect, useState } from "react";
import { loadConfiguredCatalog, registryRefsFromManifest } from "../cli/registry";
import { createDoctorReport, type DoctorProblem, type DoctorReport } from "../engine/doctor";
import {
  applyStackMigrationPlan,
  createStackMigrationPlan,
  type StackMigrationPlan,
  type StackMigrationResult,
} from "../engine/stack-migration";
import { applyUpdate, createUpdateReport, type UpdateApplyResult, type UpdateReport } from "../engine/update";
import type { PackCatalog } from "../registry/catalog";
import { KeyHints, palette, useSpinner } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";
import { cycleAgents } from "./machine";
import { ReviewStep } from "./ReviewStep";

type DoctorPhase =
  | { kind: "loading" }
  | { kind: "no-harness" }
  | { kind: "report"; report: DoctorReport; update: UpdateReport; catalog: PackCatalog }
  | { kind: "updating" }
  | { kind: "updated"; result: UpdateApplyResult }
  | { kind: "migration-loading"; report: DoctorReport; update: UpdateReport; catalog: PackCatalog }
  | { kind: "migration-review"; report: DoctorReport; update: UpdateReport; catalog: PackCatalog; plan: StackMigrationPlan }
  | { kind: "migrating" }
  | { kind: "migrated"; result: StackMigrationResult }
  | { kind: "error"; message: string };

/**
 * A doctor problem's severity text is reused verbatim from the engine; only
 * the path prefix and message are laid out here so the screen stays a thin
 * presenter over the report.
 */
export function doctorProblemLine(problem: DoctorProblem): string {
  const where = problem.path ? `${problem.path}${problem.id ? ` (${problem.id})` : ""} — ` : "";
  return `[${problem.severity}] ${where}${problem.message}`;
}

/**
 * Update can repair a doctor problem only when its remediation points back at
 * `farrier update`; problems that need manual review (outdated user-mutable
 * files, unknown skill provenance) do not, so the offer stays honest.
 */
export function isUpdateRepairable(report: DoctorReport): boolean {
  return report.problems.some((problem) => problem.remediation?.includes("farrier update"));
}

export function updateSummaryLines(result: UpdateApplyResult): string[] {
  const lines: string[] = [];
  const repaired = result.repairedFiles;
  const pruned = result.prunedPaths;

  lines.push(
    repaired.length > 0 ? `Repaired ${repaired.length} file(s):` : "No files needed repair."
  );
  for (const path of repaired) {
    lines.push(`  ✓ ${path}`);
  }
  if (pruned.length > 0) {
    lines.push(`Pruned ${pruned.length} stale legacy path(s):`);
    for (const path of pruned) {
      lines.push(`  ✗ ${path}`);
    }
  }
  if (result.report.outdatedUserFiles.length > 0) {
    lines.push(`Manual review still needed for ${result.report.outdatedUserFiles.length} user-edited file(s).`);
  }
  return lines;
}

export function migrationSummaryLines(result: StackMigrationResult): string[] {
  const lines = [
    `Applied ${result.transaction.written.length} stack migration change(s).`,
    `Manifest now selects ${result.report.currentPackId}.`,
  ];
  if (result.transaction.backupDir) lines.push(`Backup: ${result.transaction.backupDir}`);
  lines.push(result.report.stackDrift.hasDrift ? "Stack drift remains; review the new detection result." : "Detected stack and manifest now agree.");
  return lines;
}

const repairBindings = defineBindings(
  binding("enter", "repair", "run farrier update"),
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);

const migrationBindings = defineBindings(
  binding("enter", "migrate", "review stack migration"),
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);

const idleBindings = defineBindings(
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);

const busyBindings = defineBindings(binding(["q", "ctrl+c"], "quit", "quit"));
const nestedBindings = defineBindings();

export function DoctorApp(props: { targetDir: string; onExit: () => void }) {
  const [phase, setPhase] = useState<DoctorPhase>({ kind: "loading" });
  const spinner = useSpinner(
    phase.kind === "loading" || phase.kind === "updating" || phase.kind === "migration-loading" || phase.kind === "migrating"
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        await stat(join(props.targetDir, ".farrier.json"));
      } catch {
        if (!cancelled) setPhase({ kind: "no-harness" });
        return;
      }

      try {
        const requireRefs = await registryRefsFromManifest(props.targetDir);
        const catalog = await loadConfiguredCatalog({ targetDir: props.targetDir, requireRefs });
        const [report, update] = await Promise.all([
          createDoctorReport({ targetDir: props.targetDir, catalog }),
          createUpdateReport({ targetDir: props.targetDir, catalog }),
        ]);
        if (!cancelled) setPhase({ kind: "report", report, update, catalog });
      } catch (error) {
        if (!cancelled) setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [props.targetDir]);

  const runUpdate = () => {
    setPhase({ kind: "updating" });
    // Defer so the "updating" frame paints before the synchronous-heavy
    // catalog load and mutation transaction begin.
    setTimeout(() => {
      void (async () => {
        try {
          const requireRefs = await registryRefsFromManifest(props.targetDir);
          const catalog = await loadConfiguredCatalog({ targetDir: props.targetDir, requireRefs });
          const result = await applyUpdate({ targetDir: props.targetDir, catalog });
          setPhase({ kind: "updated", result });
        } catch (error) {
          setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      })();
    }, 0);
  };

  const reviewMigration = () => {
    if (phase.kind !== "report") return;
    const source = phase;
    setPhase({ kind: "migration-loading", report: source.report, update: source.update, catalog: source.catalog });
    setTimeout(() => {
      void createStackMigrationPlan({ targetDir: props.targetDir, catalog: source.catalog })
        .then((plan) => setPhase({
          kind: "migration-review",
          report: source.report,
          update: source.update,
          catalog: source.catalog,
          plan,
        }))
        .catch((error) => setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) }));
    }, 0);
  };

  const runMigration = () => {
    if (phase.kind !== "migration-review") return;
    const source = phase;
    setPhase({ kind: "migrating" });
    setTimeout(() => {
      void applyStackMigrationPlan(source.plan, { catalog: source.catalog })
        .then((result) => setPhase({ kind: "migrated", result }))
        .catch((error) => setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) }));
    }, 0);
  };

  const cycleMigrationAgents = () => {
    if (phase.kind !== "migration-review") return;
    const source = phase;
    const agents = cycleAgents(source.plan.agents);
    setPhase({ kind: "migration-loading", report: source.report, update: source.update, catalog: source.catalog });
    setTimeout(() => {
      void createStackMigrationPlan({ targetDir: props.targetDir, catalog: source.catalog, agents })
        .then((plan) => setPhase({
          kind: "migration-review",
          report: source.report,
          update: source.update,
          catalog: source.catalog,
          plan,
        }))
        .catch((error) => setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) }));
    }, 0);
  };

  const repairable = phase.kind === "report" && !phase.report.healthy && isUpdateRepairable(phase.report);
  const migrationAvailable = phase.kind === "report" && phase.update.stackDrift.hasDrift;
  const activeBindings =
    phase.kind === "migration-review"
      ? nestedBindings
      : phase.kind === "loading" || phase.kind === "updating" || phase.kind === "migration-loading" || phase.kind === "migrating"
        ? busyBindings
        : migrationAvailable
          ? migrationBindings
          : repairable
            ? repairBindings
            : idleBindings;

  useKeyboard((key) => {
    const intent = resolveIntent(activeBindings, key);
    if (intent === "quit") props.onExit();
    else if (intent === "back") props.onExit();
    else if (intent === "repair" && repairable) runUpdate();
    else if (intent === "migrate" && migrationAvailable) reviewMigration();
  });

  if (phase.kind === "migration-review") {
    return (
      <ReviewStep
        mode="migrate"
        migrationLabel={`${phase.plan.currentPackId} → ${phase.plan.targetPackId}`}
        agents={phase.plan.agents}
        createRequests={[]}
        files={phase.plan.changes}
        existingHarness
        blockerCount={phase.plan.blockers.length}
        loading={false}
        canConfirm={phase.plan.blockers.length === 0}
        onConfirm={runMigration}
        onCycleAgents={cycleMigrationAgents}
        onBack={() => setPhase({ kind: "report", report: phase.report, update: phase.update, catalog: phase.catalog })}
        onQuit={props.onExit}
      />
    );
  }

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", gap: 0 }}>
        <text fg={palette.accent}>⟳ Doctor & update</text>
        <text fg={palette.muted}>Check harness health, then repair drift left by upgrades.</text>
      </box>

      {phase.kind === "loading" ? (
        <text fg={palette.agent}>{`${spinner}  Checking harness health…`}</text>
      ) : null}

      {phase.kind === "no-harness" ? (
        <text fg={palette.warn}>No harness here yet. Choose Create harness first.</text>
      ) : null}

      {phase.kind === "report" ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          {phase.update.stackDrift.hasDrift ? (
            <text fg={palette.warn}>{`[error] ${phase.update.stackDrift.message}`}</text>
          ) : null}
          {phase.report.healthy && phase.report.problems.length === 0 ? (
            <text fg={palette.success}>✓ Harness healthy</text>
          ) : (
            <>
              <text fg={phase.report.healthy ? palette.gold : palette.warn}>
                {phase.report.healthy
                  ? `Harness healthy, with ${phase.report.problems.length} warning(s):`
                  : `Harness unhealthy — ${phase.report.problems.length} problem(s):`}
              </text>
              {phase.report.problems.map((problem, index) => (
                <text key={`${problem.group}-${index}`} fg={problem.severity === "error" ? palette.warn : palette.gold}>
                  {`  ${doctorProblemLine(problem)}`}
                </text>
              ))}
            </>
          )}
          {phase.update.stackDrift.hasDrift ? (
            <text fg={palette.text}>{"\nReview the complete stack migration before any harness bytes change."}</text>
          ) : repairable ? (
            <text fg={palette.text}>{"\nRun farrier update to repair the drift above."}</text>
          ) : null}
        </box>
      ) : null}

      {phase.kind === "updating" ? (
        <text fg={palette.agent}>{`${spinner}  Running farrier update…`}</text>
      ) : null}

      {phase.kind === "migration-loading" ? (
        <text fg={palette.agent}>{`${spinner}  Building exact ${phase.update.currentPackId} → ${phase.update.stackDrift.suggestedPackId} migration…`}</text>
      ) : null}

      {phase.kind === "migrating" ? (
        <text fg={palette.agent}>{`${spinner}  Applying reviewed stack migration…`}</text>
      ) : null}

      {phase.kind === "updated" ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={palette.success}>✓ Update applied</text>
          {updateSummaryLines(phase.result).map((line, index) => (
            <text key={`summary-${index}`} fg={palette.text}>
              {line}
            </text>
          ))}
        </box>
      ) : null}

      {phase.kind === "migrated" ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={phase.result.report.stackDrift.hasDrift ? palette.warn : palette.success}>✓ Stack migration applied</text>
          {migrationSummaryLines(phase.result).map((line, index) => (
            <text key={`migration-summary-${index}`} fg={palette.text}>{line}</text>
          ))}
        </box>
      ) : null}

      {phase.kind === "error" ? <text fg={palette.warn}>Doctor failed: {phase.message}</text> : null}

      <KeyHints hint={bindingsHint(activeBindings)} />
    </box>
  );
}

export async function runDoctorApp(targetDir: string): Promise<void> {
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
      createRoot(cliRenderer).render(<DoctorApp targetDir={targetDir} onExit={finish} />);
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier: ${error instanceof Error ? error.message : String(error)}`);
  }
}
