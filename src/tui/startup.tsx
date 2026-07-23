import { createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useRef, useState } from "react";
import { loadFarrierConfig, type ModelsConfig } from "../config/farrier-config";
import {
  loadStartupChoice,
  saveStartupChoice,
  type StartupAgentChoice,
  type StartupChoice,
  type StartupEffortChoices,
  type StartupModelChoices
} from "../config/startup-choice";
import { detectAgents, type AgentDetection, type AgentDetectionInventory } from "../engine/agent-detection";
import type { AgentBackend } from "../engine/backend";
import { cliBackendListing, type CliBackendListing } from "../engine/model-listing";
import { KeyHints, palette } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";
import { sessionAgentContext, type SessionAgentContext } from "./session-context";
import {
  displayedModel,
  effortOptions,
  emptyPick,
  initialEffortPick,
  initialModelPick,
  modelSuggestions,
  pickedValue,
  type CliListingFetch,
  type OptionPick
} from "./startup-picks";

/**
 * The startup screen: farrier never silently assumes a working agent. It
 * always renders before the launcher, detects what is installed (and whether
 * it is signed in), and waits for an explicit pick: which agent the user
 * works with, then which model and reasoning effort farrier's own LLM work
 * should use this session. A remembered pick is preselected but still needs
 * one Enter.
 */

export type StartupSelection = { agent: StartupAgentChoice; models: StartupModelChoices; efforts: StartupEffortChoices };

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

/** Phase-2 focus order: model line then effort line per backend, Continue last. */
type PickerRow = { backend: AgentBackend; field: "model" | "effort" };

type PickState = Partial<Record<AgentBackend, OptionPick>>;

export function StartupApp(props: {
  detection: AgentDetectionInventory;
  remembered?: StartupChoice;
  models: ModelsConfig;
  /** Injected in tests; the default probes the installed CLIs, cached per process. */
  listCli?: (backend: AgentBackend) => Promise<CliBackendListing>;
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
  const [pickerFocus, setPickerFocus] = useState(0);
  const [modelPicks, setModelPicks] = useState<PickState>({});
  const [effortPicks, setEffortPicks] = useState<PickState>({});
  const [cliListings, setCliListings] = useState<Partial<Record<AgentBackend, CliListingFetch>>>({});
  const cliRequested = useRef(new Set<AgentBackend>());
  const bodyScrollRef = useRef<ScrollBoxRenderable | null>(null);

  const focusedRow = rows[agentIndex] ?? rows[0]!;
  const missingBackends = focusedRow.backends.filter((backend) => !props.detection[backend].installed);

  // Lazy and once per process: fired when phase 2 is entered, remembered in
  // state (and, for the default probes, a module cache) so re-entering the
  // phase never re-probes. The loading state is advisory only; Enter on
  // Continue confirms the config default without waiting.
  const ensureCliListing = (backend: AgentBackend) => {
    if (cliRequested.current.has(backend)) return;
    cliRequested.current.add(backend);
    setCliListings((current) => ({ ...current, [backend]: { status: "loading" } }));
    const listCli = props.listCli ?? cliBackendListing;
    void listCli(backend)
      .then((listing) => setCliListings((current) => ({ ...current, [backend]: { status: "done", listing } })))
      .catch(() => setCliListings((current) => ({ ...current, [backend]: { status: "done", listing: { models: [], efforts: [] } } })));
  };

  const suggestionsFor = (backend: AgentBackend): string[] => {
    const fetched = cliListings[backend];
    return modelSuggestions(
      backend,
      props.models,
      fetched?.status === "done" ? fetched.listing.models.map((entry) => entry.id) : []
    );
  };

  const effortOptionsFor = (backend: AgentBackend) => {
    const pick = modelPicks[backend] ?? emptyPick;
    return effortOptions(
      backend,
      cliListings[backend],
      displayedModel(backend, pick, suggestionsFor(backend), props.models)
    );
  };

  const enterModels = (row: AgentRow) => {
    if (row.backends.length === 0) {
      props.onConfirm({ agent: row.choice, models: {}, efforts: {} });
      return;
    }
    setChosen(row);
    const models: PickState = {};
    const efforts: PickState = {};
    for (const backend of row.backends) {
      models[backend] = initialModelPick(backend, props.models, props.remembered);
      efforts[backend] = initialEffortPick(backend, props.remembered);
      ensureCliListing(backend);
    }
    setModelPicks(models);
    setEffortPicks(efforts);
    // Daily use: focus lands on Continue so a second Enter finishes.
    setPickerFocus(row.backends.length * 2);
    setPhase("models");
  };

  const confirm = () => {
    const models: StartupModelChoices = {};
    const efforts: StartupEffortChoices = {};
    for (const backend of chosen.backends) {
      const model = pickedValue(modelPicks[backend] ?? emptyPick, suggestionsFor(backend));
      if (model) models[backend] = model;
      const effort = pickedValue(effortPicks[backend] ?? emptyPick, effortOptionsFor(backend).levels);
      if (effort) efforts[backend] = effort;
    }
    props.onConfirm({ agent: chosen.choice, models, efforts });
  };

  const updatePick = (row: PickerRow, update: (pick: OptionPick) => OptionPick) => {
    const setPicks = row.field === "model" ? setModelPicks : setEffortPicks;
    setPicks((current) => ({ ...current, [row.backend]: update(current[row.backend] ?? emptyPick) }));
    if (row.field === "model") {
      // The effort options follow the model line; a cycled effort index into
      // the old model's levels must not silently mean a different level.
      setEffortPicks((current) => ({
        ...current,
        [row.backend]: { suggestionIndex: 0, custom: (current[row.backend] ?? emptyPick).custom }
      }));
    }
  };

  const pickerRows: PickerRow[] = chosen.backends.flatMap((backend): PickerRow[] => [
    { backend, field: "model" },
    { backend, field: "effort" }
  ]);

  useKeyboard((key) => {
    if (phase === "agent") {
      const intent = resolveIntent(agentBindings, key);
      if (intent === "quit") props.onCancel();
      else if (intent === "move") setAgentIndex((current) => Math.min(Math.max(current + (key.name === "down" ? 1 : -1), 0), rows.length - 1));
      else if (intent === "choose") enterModels(rows[agentIndex] ?? rows[0]!);
      return;
    }

    const intent = resolveIntent(modelBindings, key);
    const focused = pickerRows[pickerFocus];
    if (intent === "quit") props.onCancel();
    else if (intent === "back") setPhase("agent");
    else if (intent === "focus") {
      const delta = key.name === "up" || key.shift ? -1 : 1;
      const total = pickerRows.length + 1;
      setPickerFocus((current) => (current + delta + total) % total);
    } else if (intent === "suggest" && focused) {
      const options = focused.field === "model" ? suggestionsFor(focused.backend) : effortOptionsFor(focused.backend).levels;
      const optionCount = options.length + 1;
      const delta = key.name === "right" ? 1 : -1;
      updatePick(focused, (pick) => ({
        suggestionIndex: (pick.suggestionIndex + delta + optionCount) % optionCount,
        custom: ""
      }));
    } else if (intent === "accept") {
      if (pickerFocus >= pickerRows.length) confirm();
      else setPickerFocus((current) => current + 1);
    } else if (focused && key.name === "backspace") {
      updatePick(focused, (pick) => ({ ...pick, custom: pick.custom.slice(0, -1) }));
    } else if (focused && isTypedCharacter(key)) {
      const character = key.sequence ?? key.name;
      updatePick(focused, (pick) => ({ suggestionIndex: pick.suggestionIndex, custom: pick.custom + character }));
    }
  });

  const pickerLine = (row: PickerRow, index: number) => {
    const focused = index === pickerFocus;
    const picks = row.field === "model" ? modelPicks : effortPicks;
    const pick = picks[row.backend] ?? emptyPick;
    let option = "config default";
    if (pick.suggestionIndex > 0) {
      if (row.field === "model") {
        option = suggestionsFor(row.backend)[pick.suggestionIndex - 1]!;
      } else {
        const options = effortOptionsFor(row.backend);
        const level = options.levels[pick.suggestionIndex - 1]!;
        option = level === options.modelDefault ? `${level} (model default)` : level;
      }
    }
    return (
      <text key={`${row.backend}-${row.field}`} style={{ flexShrink: 0 }} bg={focused ? palette.selBg : undefined}>
        <span fg={palette.accent}>{focused ? "▸ " : "  "}</span>
        <span fg={palette.text}>{`${agentProductName(row.backend)} ${row.field}:`.padEnd(labelColumn)}</span>
        {pick.custom.length > 0 ? (
          <span fg={palette.text}>{pick.custom}</span>
        ) : (
          <span fg={palette.gold}>{`‹ ${option} ›`}</span>
        )}
        {pick.custom.length > 0 ? <span fg={palette.faint}>{" (typed)"}</span> : null}
      </text>
    );
  };

  const listingNotes = (backend: AgentBackend) => {
    const fetched = cliListings[backend];
    const name = agentProductName(backend);
    if (fetched?.status === "loading") {
      return [
        <text key={`cli-${backend}`} style={{ flexShrink: 0 }} fg={palette.faint}>
          {`Listing models and effort levels from ${name}... Enter still confirms the config defaults.`}
        </text>
      ];
    }
    if (fetched?.status !== "done") return [];
    const notes = [];
    if (fetched.listing.models.length === 0) {
      notes.push(
        <text key={`cli-${backend}`} style={{ flexShrink: 0 }} fg={palette.warn}>
          {`Could not list models from ${name}; type a model name.`}
        </text>
      );
    }
    // Availability of effort levels for the listing as a whole (for codex,
    // the union across listed models), not the currently selected model.
    if (effortOptions(backend, fetched, undefined).levels.length === 0) {
      notes.push(
        <text key={`cli-effort-${backend}`} style={{ flexShrink: 0 }} fg={palette.warn}>
          {`Could not list effort levels from ${name}; type an effort level.`}
        </text>
      );
    }
    return notes;
  };

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
            <text style={{ flexShrink: 0 }} fg={palette.text}>Model and effort for this session · Enter keeps the config defaults</text>
            <box style={{ flexDirection: "column", gap: 0, flexShrink: 0 }}>
              {pickerRows.map((row, index) => pickerLine(row, index))}
              <text style={{ flexShrink: 0 }} bg={pickerFocus >= pickerRows.length ? palette.selBg : undefined}>
                <span fg={palette.accent}>{pickerFocus >= pickerRows.length ? "▸ " : "  "}</span>
                <span fg={palette.text}>Continue</span>
              </text>
            </box>
            <text style={{ flexShrink: 0 }} fg={palette.faint}>Left/Right pick a suggestion · type an exact value · Backspace edits.</text>
            {chosen.backends.flatMap((backend) => listingNotes(backend))}
            <text style={{ flexShrink: 0 }} fg={palette.faint}>
              {chosen.backends.some((backend) => {
                const fetched = cliListings[backend];
                return fetched?.status === "done" && fetched.listing.models.length > 0;
              })
                ? "Suggestions come from your farrier config and what the installed CLI reports."
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
  listCli: (backend: AgentBackend) => Promise<CliBackendListing>;
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
          listCli={dependencies.listCli}
          onConfirm={(picked) => finish(picked)}
          onCancel={() => finish("cancel")}
        />
      );
    });

    if (selection === "cancel") return "cancel";

    try {
      await (dependencies.saveChoice ?? saveStartupChoice)({ agent: selection.agent, models: selection.models, efforts: selection.efforts });
    } catch (error) {
      // The pick still applies to this session; it just is not remembered.
      log(`farrier: could not remember the agent choice: ${error instanceof Error ? error.message : String(error)}`);
    }

    return sessionAgentContext({ choice: selection.agent, models: selection.models, efforts: selection.efforts, detection });
  } catch (error) {
    renderer?.destroy();
    log(`farrier: ${error instanceof Error ? error.message : String(error)}`);
    return "cancel";
  }
}
