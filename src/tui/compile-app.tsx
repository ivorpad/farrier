import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { join } from "node:path";
import { useEffect, useState } from "react";
import type { KbCompilePlan, KbCompileTarget } from "../engine/kb-compile";
import type { DroppedTasteGuardPattern, TasteGuardAuthoringRule, TasteGuardRule } from "../engine/kb-taste-authoring";
import type { PreferenceKb } from "../engine/preference-kb";
import { KeyHints, palette, useSpinner } from "./chrome";
import {
  buildPlanState,
  canAuthorPatterns,
  canInstallHook,
  planReducer,
  selectedTargets,
  type CompileNavEvent,
  type CompilePlanState
} from "./compile-machine";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";
import { loadSessionBackendSettings, type SessionAgentContext } from "./session-context";

/**
 * "Compile preferences": route the reviewed preference KB to its runtime
 * primitives. The user reviews the routed targets (per-target or all), applies
 * the deterministic ones, and — behind explicit offers — authors taste-guard
 * patterns for lintable rules or installs the enforcing hook. A thin presenter:
 * compile-machine.ts owns the pure state, the engine owns every write.
 */

export type CompileLoad = { kb: PreferenceKb; plan: KbCompilePlan; hookInstalled: boolean; harnessPresent: boolean };

export type CompileDeps = {
  onLoad: () => Promise<CompileLoad>;
  onApply: (targets: KbCompileTarget[]) => Promise<{ written: string[]; unchanged: string[] }>;
  onInstallHook: () => Promise<{ written: string[] }>;
  /** Present only when an LLM backend is available for pattern authoring. */
  authoring?: {
    backendLabel: string;
    onAuthor: (rules: TasteGuardAuthoringRule[]) => Promise<{ patterns: TasteGuardRule[]; dropped: DroppedTasteGuardPattern[] }>;
    onInstallPatterns: (patterns: TasteGuardRule[]) => Promise<{ written: string[] }>;
  };
};

type CompilePhase =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "plan"; state: CompilePlanState }
  | { kind: "consent"; rules: TasteGuardAuthoringRule[]; back: CompilePlanState }
  | { kind: "authoring"; back: CompilePlanState }
  | { kind: "authored"; patterns: TasteGuardRule[]; dropped: DroppedTasteGuardPattern[]; back: CompilePlanState }
  | { kind: "applying"; message: string }
  | { kind: "applied"; title: string; lines: string[] }
  | { kind: "error"; message: string };

function appliedLines(written: string[], unchanged: string[]): string[] {
  if (written.length === 0) return [`Already up to date — ${unchanged.length} file(s) unchanged.`];
  return [`Wrote ${written.length} file(s):`, ...written.map((path) => `  ✓ ${path}`)];
}

export function CompilePreferencesApp(props: { deps: CompileDeps; onExit: () => void }) {
  const [phase, setPhase] = useState<CompilePhase>({ kind: "loading" });
  const spinner = useSpinner(phase.kind === "loading" || phase.kind === "authoring" || phase.kind === "applying");

  const load = () => {
    setPhase({ kind: "loading" });
    setTimeout(() => {
      void (async () => {
        try {
          const loaded = await props.deps.onLoad();
          if (loaded.kb.rules.length === 0) {
            setPhase({ kind: "empty" });
            return;
          }
          setPhase({ kind: "plan", state: buildPlanState(loaded) });
        } catch (error) {
          setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      })();
    }, 0);
  };

  useEffect(load, []);

  const runApply = (state: CompilePlanState) => {
    const targets = selectedTargets(state);
    if (targets.length === 0) return;
    setPhase({ kind: "applying", message: `Writing ${targets.length} target(s)…` });
    setTimeout(() => {
      void (async () => {
        try {
          const result = await props.deps.onApply(targets);
          setPhase({ kind: "applied", title: "Compiled preferences", lines: appliedLines(result.written, result.unchanged) });
        } catch (error) {
          setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      })();
    }, 0);
  };

  const runInstallHook = () => {
    setPhase({ kind: "applying", message: "Installing the taste-guard hook…" });
    setTimeout(() => {
      void (async () => {
        try {
          const result = await props.deps.onInstallHook();
          setPhase({ kind: "applied", title: "Installed the taste-guard hook", lines: appliedLines(result.written, []) });
        } catch (error) {
          setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      })();
    }, 0);
  };

  const runAuthor = (rules: TasteGuardAuthoringRule[], back: CompilePlanState) => {
    if (!props.deps.authoring) return;
    const authoring = props.deps.authoring;
    setPhase({ kind: "authoring", back });
    setTimeout(() => {
      void (async () => {
        try {
          const { patterns, dropped } = await authoring.onAuthor(rules);
          setPhase({ kind: "authored", patterns, dropped, back });
        } catch (error) {
          setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      })();
    }, 0);
  };

  const runInstallPatterns = (patterns: TasteGuardRule[]) => {
    if (!props.deps.authoring || patterns.length === 0) return;
    const authoring = props.deps.authoring;
    setPhase({ kind: "applying", message: `Installing ${patterns.length} reviewed pattern set(s)…` });
    setTimeout(() => {
      void (async () => {
        try {
          const result = await authoring.onInstallPatterns(patterns);
          setPhase({ kind: "applied", title: "Installed taste-guard patterns", lines: appliedLines(result.written, []) });
        } catch (error) {
          setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      })();
    }, 0);
  };

  const nav = (event: CompileNavEvent) => {
    if (phase.kind !== "plan") return;
    setPhase({ kind: "plan", state: planReducer(phase.state, event) });
  };

  const bindings = activeBindings(phase, props.deps);

  useKeyboard((key) => {
    const intent = resolveIntent(bindings, key);
    if (intent === "quit") {
      props.onExit();
      return;
    }
    if (phase.kind === "plan") {
      if (intent === "move") nav({ type: key.name === "down" ? "down" : "up" });
      else if (intent === "toggle") nav({ type: "toggle" });
      else if (intent === "toggle-all") nav({ type: "toggle-all" });
      else if (intent === "apply") runApply(phase.state);
      else if (intent === "author" && canAuthorPatterns(phase.state)) {
        setPhase({ kind: "consent", rules: phase.state.unpatterned, back: phase.state });
      } else if (intent === "install" && canInstallHook(phase.state)) runInstallHook();
      else if (intent === "back") props.onExit();
      return;
    }
    if (phase.kind === "consent") {
      if (intent === "confirm") runAuthor(phase.rules, phase.back);
      else if (intent === "back") setPhase({ kind: "plan", state: phase.back });
      return;
    }
    if (phase.kind === "authored") {
      if (intent === "confirm") runInstallPatterns(phase.patterns);
      else if (intent === "back") setPhase({ kind: "plan", state: phase.back });
      return;
    }
    if (phase.kind === "applied") {
      if (intent === "confirm") load();
      else if (intent === "back") props.onExit();
      return;
    }
    if (phase.kind === "empty" || phase.kind === "error") {
      if (intent === "back") props.onExit();
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text fg={palette.accent}>✦ Compile preferences</text>
        <text fg={palette.muted}>Route the reviewed preference KB to the runtime primitive each rule's tier calls for.</text>
      </box>
      <scrollbox
        focused={false}
        scrollX={false}
        scrollY
        stickyScroll
        stickyStart={phase.kind === "plan" ? "top" : "bottom"}
        viewportCulling
        style={{ flexGrow: 1, flexShrink: 1, width: "100%" }}
        contentOptions={{ flexDirection: "column", gap: 1, width: "100%" }}
      >
        <PhaseBody phase={phase} spinner={spinner} deps={props.deps} />
      </scrollbox>
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}

function activeBindings(phase: CompilePhase, deps: CompileDeps) {
  if (phase.kind === "loading" || phase.kind === "authoring" || phase.kind === "applying") {
    return defineBindings(binding(["q", "ctrl+c"], "quit", "quit"));
  }
  if (phase.kind === "plan") {
    return defineBindings(
      binding(["up", "down"], "move", "move"),
      binding("space", "toggle", "toggle"),
      binding("a", "toggle-all", "all"),
      binding("enter", "apply", "apply selected"),
      ...(deps.authoring && canAuthorPatterns(phase.state) ? [binding("p", "author", "author patterns")] : []),
      ...(canInstallHook(phase.state) ? [binding("i", "install", "install hook")] : []),
      binding(["escape", "b"], "back", "back"),
      binding(["q", "ctrl+c"], "quit", "quit")
    );
  }
  if (phase.kind === "consent") {
    return defineBindings(
      binding("y", "confirm", "send & author"),
      binding(["escape", "b"], "back", "back"),
      binding(["q", "ctrl+c"], "quit", "quit")
    );
  }
  if (phase.kind === "authored") {
    return defineBindings(
      binding("enter", "confirm", "install patterns"),
      binding(["escape", "b"], "back", "back"),
      binding(["q", "ctrl+c"], "quit", "quit")
    );
  }
  if (phase.kind === "applied") {
    return defineBindings(
      binding("enter", "confirm", "back to plan"),
      binding(["escape", "b"], "back", "done"),
      binding(["q", "ctrl+c"], "quit", "quit")
    );
  }
  return defineBindings(binding(["escape", "b", "q", "ctrl+c"], "back", "back"));
}

function PhaseBody(props: { phase: CompilePhase; spinner: string; deps: CompileDeps }) {
  const { phase, spinner } = props;

  if (phase.kind === "loading") {
    return <text style={{ flexShrink: 0 }} fg={palette.agent}>{`${spinner}  Reading the preference KB and routing rules…`}</text>;
  }
  if (phase.kind === "empty") {
    return (
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text style={{ flexShrink: 0 }} fg={palette.gold}>No reviewed preferences yet.</text>
        <text style={{ flexShrink: 0 }} fg={palette.muted}>Run Improve to mine sessions into reviewed rules; they compile here once .farrier/preferences.json has any.</text>
      </box>
    );
  }
  if (phase.kind === "applying") {
    return <text style={{ flexShrink: 0 }} fg={palette.agent}>{`${spinner}  ${phase.message}`}</text>;
  }
  if (phase.kind === "authoring") {
    return <text style={{ flexShrink: 0 }} fg={palette.agent}>{`${spinner}  Authoring patterns${props.deps.authoring ? ` with ${props.deps.authoring.backendLabel}` : ""}… usually under a minute.`}</text>;
  }
  if (phase.kind === "applied") {
    return (
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text style={{ flexShrink: 0 }} fg={palette.success}>{`✓ ${phase.title}`}</text>
        {phase.lines.map((line, index) => (
          <text key={`applied-${index}`} style={{ flexShrink: 0 }} fg={palette.text}>{line}</text>
        ))}
      </box>
    );
  }
  if (phase.kind === "error") {
    return <text style={{ flexShrink: 0 }} fg={palette.warn}>Compile failed: {phase.message}</text>;
  }
  if (phase.kind === "consent") {
    return <ConsentBody rules={phase.rules} backendLabel={props.deps.authoring?.backendLabel ?? "the model"} />;
  }
  if (phase.kind === "authored") {
    return <AuthoredBody patterns={phase.patterns} dropped={phase.dropped} />;
  }
  return <PlanBody state={phase.state} deps={props.deps} />;
}

function PlanBody(props: { state: CompilePlanState; deps: CompileDeps }) {
  const { state } = props;
  return (
    <box style={{ flexDirection: "column", flexShrink: 0, gap: 1 }}>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text style={{ flexShrink: 0 }} fg={palette.gold}>{`Targets (${state.rows.length}) — space toggles, enter applies the selected:`}</text>
        {state.rows.map((row, index) => {
          const focused = index === state.focus;
          const on = state.selected[index];
          return (
            <box key={`${row.target.kind}-${index}`} style={{ flexDirection: "column", flexShrink: 0 }}>
              <text style={{ flexShrink: 0 }} bg={focused ? palette.selBg : undefined}>
                <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
                <span fg={on ? palette.success : palette.faint}>{on ? "[x] " : "[ ] "}</span>
                <span fg={palette.text}>{row.label}</span>
              </text>
              {focused ? <text style={{ flexShrink: 0 }} fg={palette.faint}>{`    ${row.detail}`}</text> : null}
            </box>
          );
        })}
      </box>
      {state.skipped.length > 0 ? (
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          <text style={{ flexShrink: 0 }} fg={palette.muted}>{`Skipped (${state.skipped.length}):`}</text>
          {state.skipped.map((entry, index) => (
            <text key={`skip-${index}`} style={{ flexShrink: 0 }} fg={palette.faint}>{`  ${entry.ruleId}: ${entry.reason}`}</text>
          ))}
        </box>
      ) : null}
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        {canAuthorPatterns(state) ? (
          <text style={{ flexShrink: 0 }} fg={props.deps.authoring ? palette.gold : palette.faint}>
            {props.deps.authoring
              ? `${state.unpatterned.length} lintable rule(s) have no patterns — press p to author them with review.`
              : `${state.unpatterned.length} lintable rule(s) have no patterns — start a backend to author them.`}
          </text>
        ) : null}
        {canInstallHook(state) ? (
          <text style={{ flexShrink: 0 }} fg={palette.gold}>{"Reviewed patterns exist — press i to install the taste-guard hook."}</text>
        ) : null}
      </box>
    </box>
  );
}

function ConsentBody(props: { rules: TasteGuardAuthoringRule[]; backendLabel: string }) {
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <text style={{ flexShrink: 0 }} fg={palette.text}>{`Author taste-guard patterns for ${props.rules.length} lintable rule(s) with ${props.backendLabel}?`}</text>
      <text style={{ flexShrink: 0 }} fg={palette.text}>{"Sends to the model, only after you say yes:"}</text>
      <text style={{ flexShrink: 0 }} fg={palette.muted}>{"• the reviewed rule sentence for each rule below"}</text>
      <text style={{ flexShrink: 0 }} fg={palette.muted}>{"• the evidence citations recorded with each (e.g. \"steer 3\", \"cluster 1\")"}</text>
      <text style={{ flexShrink: 0 }} fg={palette.muted}>{"Never sent: raw session text, file contents, other projects. Patterns are validated and stay review-gated before anything installs."}</text>
      {props.rules.map((rule, index) => (
        <text key={`consent-${index}`} style={{ flexShrink: 0 }} fg={palette.faint}>{`  ${rule.ruleId}: ${rule.rule}`}</text>
      ))}
    </box>
  );
}

function AuthoredBody(props: { patterns: TasteGuardRule[]; dropped: DroppedTasteGuardPattern[] }) {
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <text style={{ flexShrink: 0 }} fg={palette.gold}>{`Authored ${props.patterns.length} pattern set(s); enter installs them into the taste-guard hook.`}</text>
      {props.patterns.map((pattern, index) => (
        <box key={`pattern-${index}`} style={{ flexDirection: "column", flexShrink: 0 }}>
          <text style={{ flexShrink: 0 }} fg={palette.text}>{`  ${pattern.ruleId} — ${pattern.message}`}</text>
          {pattern.patterns.map((regex, regexIndex) => (
            <text key={`regex-${regexIndex}`} style={{ flexShrink: 0 }} fg={palette.faint}>{`    /${regex}/`}</text>
          ))}
        </box>
      ))}
      {props.dropped.length > 0 ? (
        <text style={{ flexShrink: 0 }} fg={palette.muted}>{`Dropped ${props.dropped.length}: ${props.dropped.map((entry) => entry.reason).join("; ")}`}</text>
      ) : null}
      {props.patterns.length === 0 ? (
        <text style={{ flexShrink: 0 }} fg={palette.warn}>{"Nothing usable was authored; press escape and refine the rule wording, or enforce it declaratively."}</text>
      ) : null}
    </box>
  );
}

export async function runCompilePreferencesApp(
  targetDir: string,
  options: { session?: SessionAgentContext; llmAnalysisAvailable?: boolean }
): Promise<void> {
  let currentKb: PreferenceKb = { version: 1, rules: [] };

  let catalogPromise: Promise<Awaited<ReturnType<typeof loadConfiguredCatalogOnce>>> | undefined;
  const loadConfiguredCatalogOnce = async () => {
    const { loadConfiguredCatalog, registryRefsFromManifest } = await import("../cli/registry");
    const requireRefs = await registryRefsFromManifest(targetDir);
    return loadConfiguredCatalog({ targetDir, requireRefs });
  };
  const loadCatalog = () => (catalogPromise ??= loadConfiguredCatalogOnce());

  const onLoad = async (): Promise<CompileLoad> => {
    const { readFile } = await import("node:fs/promises");
    const { parsePreferenceKb, preferenceKbPath } = await import("../engine/preference-kb");
    const { compileKbPlan } = await import("../engine/kb-compile");
    const kbRaw = await readFile(join(targetDir, preferenceKbPath), "utf8").catch(() => undefined);
    const kb = parsePreferenceKb(kbRaw);
    currentKb = kb;
    const plan = await compileKbPlan({ kb, targetDir });
    const manifestRaw = await readFile(join(targetDir, ".farrier.json"), "utf8").catch(() => undefined);
    let hookInstalled = false;
    if (manifestRaw) {
      try {
        const manifest = JSON.parse(manifestRaw) as { hookIds?: unknown };
        hookInstalled = Array.isArray(manifest.hookIds) && manifest.hookIds.includes("taste-guard");
      } catch {
        hookInstalled = false;
      }
    }
    return { kb, plan, hookInstalled, harnessPresent: manifestRaw !== undefined };
  };

  const deps: CompileDeps = {
    onLoad,
    onApply: async (targets) => {
      const { applyKbCompilePlan } = await import("../engine/kb-compile");
      return applyKbCompilePlan({ targetDir, kb: currentKb, plan: { targets, skipped: [] }, force: true });
    },
    onInstallHook: async () => {
      const { installTasteGuard } = await import("../engine/kb-compile-install");
      return installTasteGuard({ targetDir, catalog: await loadCatalog() });
    }
  };

  if (options.llmAnalysisAvailable) {
    const { backend, settings, backendLabel } = await loadSessionBackendSettings({
      projectDir: targetDir,
      session: options.session,
      role: "advise"
    });
    deps.authoring = {
      backendLabel,
      onAuthor: async (rules) => {
        const { authorTasteGuardPatterns } = await import("../engine/kb-taste-authoring");
        const { defaultBackendRunner } = await import("../engine/backend");
        return authorTasteGuardPatterns({
          targetDir,
          rules,
          backend,
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
          runner: defaultBackendRunner
        });
      },
      onInstallPatterns: async (patterns) => {
        const { installTasteGuard } = await import("../engine/kb-compile-install");
        return installTasteGuard({ targetDir, patterns, catalog: await loadCatalog() });
      }
    };
  }

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
      createRoot(cliRenderer).render(<CompilePreferencesApp deps={deps} onExit={finish} />);
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier: ${error instanceof Error ? error.message : String(error)}`);
  }
}
