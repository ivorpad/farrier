import { createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useRef, useState } from "react";
import { loadFarrierConfig, type ModelsConfig } from "../config/farrier-config";
import {
  loadStartupChoice,
  saveStartupChoice,
  type StartupAgentChoice,
  type StartupChoice,
  type StartupModelChoices
} from "../config/startup-choice";
import { detectAgents, type AgentDetection, type AgentDetectionInventory } from "../engine/agent-detection";
import type { AgentBackend } from "../engine/backend";
import { cliModelSuggestions, type CliModelSuggestion } from "../engine/model-listing";
import { KeyHints, palette } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";
import { sessionAgentContext, type SessionAgentContext } from "./session-context";

/**
 * The startup screen: farrier never silently assumes a working agent. It
 * always renders before the launcher, detects what is installed (and whether
 * it is signed in), and waits for an explicit pick: which agent the user
 * works with, then which model farrier's own LLM work should use this
 * session. A remembered pick is preselected but still needs one Enter.
 */

export type StartupSelection = { agent: StartupAgentChoice; models: StartupModelChoices };

type AgentRow = { choice: StartupAgentChoice; label: string; backends: AgentBackend[]; detail?: string };

const baseAgentRows: AgentRow[] = [
  { choice: "claude", label: "Claude Code", backends: ["claude"] },
  { choice: "codex", label: "Codex", backends: ["codex"] },
  { choice: "both", label: "Both", backends: ["claude", "codex"], detail: "one harness for both agents; skills install for both" }
];

const noBackendRow: AgentRow = {
  choice: "none",
  label: "Continue without a backend",
  backends: [],
  detail: "Create harness, Learn, and Doctor still work"
};

const labelColumn = Math.max(...[...baseAgentRows, noBackendRow].map((row) => row.label.length)) + 2;

export function agentDetectionLabel(detection: AgentDetection): string {
  if (!detection.installed) return "not installed";
  const version = detection.version ? `v${detection.version}` : "installed";
  const auth =
    detection.auth === "signed-in" ? "signed in" : detection.auth === "not-signed-in" ? "not signed in" : "sign-in unknown";
  return `${version} · ${auth}`;
}

function agentProductName(backend: AgentBackend): string {
  return backend === "claude" ? "Claude Code" : "Codex";
}

/**
 * Model suggestions per backend: the user's configured models first, then
 * whatever the installed CLI reports (codex `model/list`, the claude
 * `--model` help text). No hardcoded catalog: when the CLI reports nothing
 * the row falls back to configured models plus free text. Appending the CLI
 * list keeps earlier indices stable when a probe resolves mid-edit. Index 0
 * of the rendered options is always "config default".
 */
export function modelSuggestions(backend: AgentBackend, models: ModelsConfig, cliModels: readonly string[] = []): string[] {
  const configured = Object.values(models[backend] ?? {})
    .map((entry) => (typeof entry === "string" ? entry : entry.model))
    .filter((model): model is string => Boolean(model));
  return Array.from(new Set([...configured, ...cliModels]));
}

type ModelPick = { suggestionIndex: number; custom: string };

function initialModelPick(backend: AgentBackend, models: ModelsConfig, remembered?: StartupChoice): ModelPick {
  const rememberedModel = remembered?.models[backend];
  if (!rememberedModel) return { suggestionIndex: 0, custom: "" };
  const index = modelSuggestions(backend, models).indexOf(rememberedModel);
  return index >= 0 ? { suggestionIndex: index + 1, custom: "" } : { suggestionIndex: 0, custom: rememberedModel };
}

function pickedModel(pick: ModelPick, suggestions: string[]): string | undefined {
  const custom = pick.custom.trim();
  if (custom.length > 0) return custom;
  return pick.suggestionIndex > 0 ? suggestions[pick.suggestionIndex - 1] : undefined;
}

function isTypedCharacter(key: { name: string; sequence?: string; ctrl?: boolean; meta?: boolean; super?: boolean }): boolean {
  if (key.ctrl || key.meta || key.super) return false;
  if (key.name.length === 1) return true;
  return key.sequence?.length === 1 && key.sequence !== "\t" && key.sequence !== "\r" && key.sequence !== "\n";
}

const agentBindings = defineBindings(
  binding(["up", "down"], "move", "move"),
  binding("enter", "choose", "choose"),
  binding(["escape", "q", "ctrl+c"], "quit", "quit")
);

const modelBindings = defineBindings(
  binding(["up", "down", "tab", "shift+tab"], "focus", "move"),
  binding(["left", "right"], "suggest", "suggestions"),
  binding("enter", "accept", "continue"),
  binding("escape", "back", "back"),
  binding("ctrl+c", "quit", "quit", { hidden: true })
);

type CliModelFetch = { status: "loading" } | { status: "done"; ids: string[] };

export function StartupApp(props: {
  detection: AgentDetectionInventory;
  remembered?: StartupChoice;
  models: ModelsConfig;
  /** Injected in tests; the default probes the installed CLIs, cached per process. */
  listModels?: (backend: AgentBackend) => Promise<CliModelSuggestion[]>;
  onConfirm: (selection: StartupSelection) => void;
  onCancel: () => void;
}) {
  const neitherInstalled = !props.detection.claude.installed && !props.detection.codex.installed;
  const rows = neitherInstalled ? [...baseAgentRows, noBackendRow] : baseAgentRows;
  const rememberedIndex = props.remembered ? rows.findIndex((row) => row.choice === props.remembered!.agent) : -1;

  const [phase, setPhase] = useState<"agent" | "models">("agent");
  // A remembered pick moves the cursor there (one Enter for daily use); a
  // first run starts at the top with nothing marked as chosen.
  const [agentIndex, setAgentIndex] = useState(Math.max(rememberedIndex, 0));
  const [chosen, setChosen] = useState<AgentRow>(rows[0]!);
  const [modelFocus, setModelFocus] = useState(0);
  const [modelPicks, setModelPicks] = useState<Partial<Record<AgentBackend, ModelPick>>>({});
  const [cliModels, setCliModels] = useState<Partial<Record<AgentBackend, CliModelFetch>>>({});
  const cliRequested = useRef(new Set<AgentBackend>());
  const bodyScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const focusedRow = rows[agentIndex] ?? rows[0]!;
  const missingBackends = focusedRow.backends.filter((backend) => !props.detection[backend].installed);

  // Lazy and once per process: fired when phase 2 is entered, remembered in
  // state (and, for the default probes, a module cache) so re-entering the
  // phase never re-probes. The loading state is advisory only; Enter on
  // Continue confirms the config default without waiting.
  const ensureCliModels = (backend: AgentBackend) => {
    if (cliRequested.current.has(backend)) return;
    cliRequested.current.add(backend);
    setCliModels((current) => ({ ...current, [backend]: { status: "loading" } }));
    const listModels = props.listModels ?? cliModelSuggestions;
    void listModels(backend)
      .then((found) => setCliModels((current) => ({ ...current, [backend]: { status: "done", ids: found.map((entry) => entry.id) } })))
      .catch(() => setCliModels((current) => ({ ...current, [backend]: { status: "done", ids: [] } })));
  };

  const suggestionsFor = (backend: AgentBackend): string[] => {
    const fetched = cliModels[backend];
    return modelSuggestions(backend, props.models, fetched?.status === "done" ? fetched.ids : []);
  };

  const enterModels = (row: AgentRow) => {
    if (row.backends.length === 0) {
      props.onConfirm({ agent: row.choice, models: {} });
      return;
    }
    setChosen(row);
    const picks: Partial<Record<AgentBackend, ModelPick>> = {};
    for (const backend of row.backends) {
      picks[backend] = initialModelPick(backend, props.models, props.remembered);
      ensureCliModels(backend);
    }
    setModelPicks(picks);
    // Daily use: focus lands on Continue so a second Enter finishes.
    setModelFocus(row.backends.length);
    setPhase("models");
  };

  const confirm = () => {
    const models: StartupModelChoices = {};
    for (const backend of chosen.backends) {
      const pick = modelPicks[backend];
      const value = pick ? pickedModel(pick, suggestionsFor(backend)) : undefined;
      if (value) models[backend] = value;
    }
    props.onConfirm({ agent: chosen.choice, models });
  };

  const updatePick = (backend: AgentBackend, update: (pick: ModelPick) => ModelPick) => {
    setModelPicks((current) => ({ ...current, [backend]: update(current[backend] ?? { suggestionIndex: 0, custom: "" }) }));
  };

  useKeyboard((key) => {
    if (phase === "agent") {
      const intent = resolveIntent(agentBindings, key);
      if (intent === "quit") props.onCancel();
      else if (intent === "move") setAgentIndex((current) => Math.min(Math.max(current + (key.name === "down" ? 1 : -1), 0), rows.length - 1));
      else if (intent === "choose") enterModels(rows[agentIndex] ?? rows[0]!);
      return;
    }

    const intent = resolveIntent(modelBindings, key);
    const focusedBackend = chosen.backends[modelFocus];
    if (intent === "quit") props.onCancel();
    else if (intent === "back") setPhase("agent");
    else if (intent === "focus") {
      const delta = key.name === "up" || key.shift ? -1 : 1;
      const total = chosen.backends.length + 1;
      setModelFocus((current) => (current + delta + total) % total);
    } else if (intent === "suggest" && focusedBackend) {
      const optionCount = suggestionsFor(focusedBackend).length + 1;
      const delta = key.name === "right" ? 1 : -1;
      updatePick(focusedBackend, (pick) => ({
        suggestionIndex: (pick.suggestionIndex + delta + optionCount) % optionCount,
        custom: ""
      }));
    } else if (intent === "accept") {
      if (modelFocus >= chosen.backends.length) confirm();
      else setModelFocus((current) => current + 1);
    } else if (focusedBackend && key.name === "backspace") {
      updatePick(focusedBackend, (pick) => ({ ...pick, custom: pick.custom.slice(0, -1) }));
    } else if (focusedBackend && isTypedCharacter(key)) {
      const character = key.sequence ?? key.name;
      updatePick(focusedBackend, (pick) => ({ suggestionIndex: pick.suggestionIndex, custom: pick.custom + character }));
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", gap: 0, flexShrink: 0 }}>
        <text fg={palette.accent}>{"🐴 farrier"}</text>
        <text fg={palette.muted}>
          farrier runs your agent's CLI for analysis and skill authoring, and preselects it for the harness. Nothing is chosen for you.
        </text>
      </box>
      {/* Bounded scroll region with flexShrink:0 children: on a short terminal
          opentui otherwise shrinks flex siblings while their text keeps its
          rows, and lines overwrite one another (see advise-app.tsx). */}
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
        {phase === "agent" ? (
          <box style={{ flexDirection: "column", gap: 1, flexShrink: 0 }}>
            <text style={{ flexShrink: 0 }} fg={palette.text}>Which agent do you work with?</text>
            {neitherInstalled ? (
              <text style={{ flexShrink: 0 }} fg={palette.warn}>
                Neither Claude Code nor Codex is installed on this computer. Advise and skill authoring need one of them.
              </text>
            ) : null}
            <box style={{ flexDirection: "column", gap: 0, flexShrink: 0 }}>
              {rows.map((row, index) => {
                const focused = index === agentIndex;
                const rememberedHere = index === rememberedIndex;
                const detail = row.detail ?? row.backends.map((backend) => agentDetectionLabel(props.detection[backend])).join(" / ");
                return (
                  <text key={row.choice} style={{ flexShrink: 0 }} bg={focused ? palette.selBg : undefined}>
                    <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
                    <span fg={rememberedHere ? palette.success : palette.faint}>{rememberedHere ? "◉ " : "○ "}</span>
                    <span fg={palette.text}>{row.label.padEnd(labelColumn)}</span>
                    <span fg={palette.faint}>{detail}</span>
                  </text>
                );
              })}
            </box>
            {missingBackends.length > 0 ? (
              <text style={{ flexShrink: 0 }} fg={palette.warn}>
                {`${missingBackends.map(agentProductName).join(" and ")} is not installed on this computer. farrier can still write its harness files; analysis and skill authoring cannot run it here.`}
              </text>
            ) : null}
            <text style={{ flexShrink: 0 }} fg={palette.faint}>
              {rememberedIndex >= 0
                ? "Remembered from last time. Enter confirms; arrows change it."
                : "No default is assumed; pick explicitly. This is remembered for next time."}
            </text>
          </box>
        ) : (
          <box style={{ flexDirection: "column", gap: 1, flexShrink: 0 }}>
            <text style={{ flexShrink: 0 }} fg={palette.text}>Model for this session · Enter keeps the config default</text>
            <box style={{ flexDirection: "column", gap: 0, flexShrink: 0 }}>
              {chosen.backends.map((backend, index) => {
                const focused = index === modelFocus;
                const pick = modelPicks[backend] ?? { suggestionIndex: 0, custom: "" };
                const suggestions = suggestionsFor(backend);
                const option = pick.suggestionIndex > 0 ? suggestions[pick.suggestionIndex - 1]! : "config default";
                return (
                  <text key={backend} style={{ flexShrink: 0 }} bg={focused ? palette.selBg : undefined}>
                    <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
                    <span fg={palette.text}>{`${agentProductName(backend)} model:`.padEnd(labelColumn)}</span>
                    {pick.custom.length > 0 ? (
                      <span fg={palette.text}>{pick.custom}</span>
                    ) : (
                      <span fg={palette.gold}>{`‹ ${option} ›`}</span>
                    )}
                    {pick.custom.length > 0 ? <span fg={palette.faint}>{" (typed)"}</span> : null}
                  </text>
                );
              })}
              <text style={{ flexShrink: 0 }} bg={modelFocus >= chosen.backends.length ? palette.selBg : undefined}>
                <span fg={palette.accent}>{modelFocus >= chosen.backends.length ? "▸ " : "  "}</span>
                <span fg={palette.text}>Continue</span>
              </text>
            </box>
            <text style={{ flexShrink: 0 }} fg={palette.faint}>Left/Right pick a suggestion · type an exact model name · Backspace edits.</text>
            {chosen.backends.map((backend) => {
              const fetched = cliModels[backend];
              if (fetched?.status === "loading") {
                return (
                  <text key={`cli-${backend}`} style={{ flexShrink: 0 }} fg={palette.faint}>
                    {`Listing models from ${agentProductName(backend)}... Enter still confirms the config default.`}
                  </text>
                );
              }
              if (fetched?.status === "done" && fetched.ids.length === 0) {
                return (
                  <text key={`cli-${backend}`} style={{ flexShrink: 0 }} fg={palette.warn}>
                    {`Could not list models from ${agentProductName(backend)}; type a model name.`}
                  </text>
                );
              }
              return null;
            })}
            <text style={{ flexShrink: 0 }} fg={palette.faint}>
              {chosen.backends.some((backend) => {
                const fetched = cliModels[backend];
                return fetched?.status === "done" && fetched.ids.length > 0;
              })
                ? "Suggestions come from your farrier config and the models the CLI reports."
                : "Suggestions come from your farrier config."}
            </text>
          </box>
        )}
      </scrollbox>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <KeyHints hint={bindingsHint(phase === "agent" ? agentBindings : modelBindings)} />
      </box>
    </box>
  );
}

export type RunStartupDependencies = Partial<{
  detect: () => Promise<AgentDetectionInventory>;
  loadChoice: () => Promise<StartupChoice | undefined>;
  saveChoice: (choice: StartupChoice) => Promise<void>;
  loadModels: () => Promise<ModelsConfig>;
  listModels: (backend: AgentBackend) => Promise<CliModelSuggestion[]>;
  log: (message: string) => void;
}>;

export async function runStartup(targetDir: string, dependencies: RunStartupDependencies = {}): Promise<SessionAgentContext | "cancel"> {
  const log = dependencies.log ?? ((message: string) => console.error(message));
  const detection = await (dependencies.detect ?? detectAgents)();
  const remembered = await (dependencies.loadChoice ?? loadStartupChoice)().catch(() => undefined);
  const loadModels =
    dependencies.loadModels ?? (() => loadFarrierConfig({ projectDir: targetDir }).then((loaded) => loaded.config.models));
  const models = await loadModels().catch(() => ({}) as ModelsConfig);

  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  try {
    renderer = await createCliRenderer();
    const cliRenderer = renderer;
    const selection = await new Promise<StartupSelection | "cancel">((done) => {
      let settled = false;
      const finish = (outcome: StartupSelection | "cancel") => {
        if (settled) return;
        settled = true;
        cliRenderer.destroy();
        done(outcome);
      };
      createRoot(cliRenderer).render(
        <StartupApp
          detection={detection}
          remembered={remembered}
          models={models}
          listModels={dependencies.listModels}
          onConfirm={(picked) => finish(picked)}
          onCancel={() => finish("cancel")}
        />
      );
    });

    if (selection === "cancel") return "cancel";

    try {
      await (dependencies.saveChoice ?? saveStartupChoice)({ agent: selection.agent, models: selection.models });
    } catch (error) {
      // The pick still applies to this session; it just is not remembered.
      log(`farrier: could not remember the agent choice: ${error instanceof Error ? error.message : String(error)}`);
    }

    return sessionAgentContext({ choice: selection.agent, models: selection.models, detection });
  } catch (error) {
    renderer?.destroy();
    log(`farrier: ${error instanceof Error ? error.message : String(error)}`);
    return "cancel";
  }
}
