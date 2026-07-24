import { createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { AdviseResult, SkillRecommendation } from "../engine/advise";
import type { CreateAgent, SkillCreationRequest } from "../engine/create-skill";
import type { InstallSkillResult, SkillSearchResult } from "../engine/skills";
import type { SkillRef } from "../packs/types";
import { DetailPane, formatInstalls, KeyHints, palette, useSpinner, type PaneLine } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent } from "./keymap";
import { agentProductName, sessionModelSettings, type SessionAgentContext } from "./session-context";

/**
 * The Skills surface: find skills for this project before authoring new ones.
 * One text field takes a registry query, an intent sentence, or a PRD (pasted
 * or as a path); enter searches skills.sh deterministically, and the suggest
 * row feeds the same text through the backend as a project brief. Install is
 * explicit per selection; authoring hands off to the create wizard with the
 * text as the brief.
 */

export type SkillsAppOutcome = "back" | "quit" | { kind: "create-skill"; request: SkillCreationRequest };

export type SkillsRow = {
  ref: SkillRef;
  name: string;
  installs: number;
  recommended: boolean;
  reason?: string;
};

export function skillsRowsFor(results: SkillSearchResult[], recommendations: SkillRecommendation[]): SkillsRow[] {
  const byRef = new Map<string, SkillsRow>();
  for (const result of results) {
    const ref: SkillRef = `${result.source}@${result.skillId}`;
    byRef.set(ref, { ref, name: result.name, installs: result.installs, recommended: false });
  }
  for (const recommendation of recommendations) {
    byRef.set(recommendation.ref, {
      ref: recommendation.ref as SkillRef,
      name: recommendation.name,
      installs: recommendation.installs,
      recommended: true,
      reason: recommendation.reason
    });
  }
  return Array.from(byRef.values());
}

type Zone = "input" | "suggest" | "list";

function adjacentZone(current: Zone, suggestAvailable: boolean, delta: -1 | 1): Zone {
  const zones: Zone[] = ["input", ...(suggestAvailable ? (["suggest"] as const) : []), "list"];
  const index = zones.indexOf(current);
  return zones[(index + delta + zones.length) % zones.length] ?? "input";
}

type AsyncStatus = "idle" | "running" | "ready" | "error";

const nameColWidth = 26;

function fit(text: string, width: number): string {
  if (text.length <= width) return text.padEnd(width);
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
}

export function SkillsApp(props: {
  initialQuery?: string;
  onSearch: (query: string, signal: AbortSignal) => Promise<SkillSearchResult[]>;
  /** Undefined when no backend CLI is installed; the suggest row hides. */
  suggest?: { backendLabel: string; run: (text: string, signal: AbortSignal) => Promise<AdviseResult> };
  onInstall: (refs: SkillRef[]) => Promise<InstallSkillResult[]>;
  installTargetsLabel: string;
  /** Undefined when no backend CLI is installed; authoring needs one. */
  onAuthor?: (description: string) => void;
  onExit: (outcome: SkillsAppOutcome) => void;
}) {
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [focus, setFocus] = useState<Zone>("input");
  const [searchStatus, setSearchStatus] = useState<AsyncStatus>("idle");
  const [searchError, setSearchError] = useState<string>();
  const [searchedQuery, setSearchedQuery] = useState<string>();
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [suggestStatus, setSuggestStatus] = useState<AsyncStatus>("idle");
  const [suggestError, setSuggestError] = useState<string>();
  const [suggestQueries, setSuggestQueries] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<SkillRecommendation[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<SkillRef>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [installResults, setInstallResults] = useState<ReadonlyMap<SkillRef, InstallSkillResult>>(new Map());
  const [actionMessage, setActionMessage] = useState<string>();
  const searchAbortRef = useRef<AbortController | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const bodyScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const spinner = useSpinner(searchStatus === "running" || suggestStatus === "running" || installing);

  const rows = skillsRowsFor(results, recommendations);
  const focusedRow = rows[Math.min(focusedIndex, Math.max(rows.length - 1, 0))];

  const runSearch = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setActionMessage(undefined);
    setSearchStatus("running");
    setSearchError(undefined);
    // A pasted PRD is not a registry query; search with its first line so the
    // deterministic search still returns something while suggest reads it all.
    const firstLine = trimmed.split("\n", 1)[0] ?? trimmed;
    const searchTerm = firstLine.length > 80 ? firstLine.slice(0, 80) : firstLine;
    props.onSearch(searchTerm, controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return;
        setResults(found);
        setSearchedQuery(searchTerm);
        setSearchStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSearchStatus("error");
        setSearchError(error instanceof Error ? error.message : String(error));
      });
  };

  const runSuggest = () => {
    const suggest = props.suggest;
    if (!suggest || suggestStatus === "running") return;
    suggestAbortRef.current?.abort();
    const controller = new AbortController();
    suggestAbortRef.current = controller;
    setActionMessage(undefined);
    setSuggestStatus("running");
    setSuggestError(undefined);
    suggest.run(query, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setRecommendations(result.recommendations);
        setSuggestQueries(result.queries);
        setSuggestStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSuggestStatus("error");
        setSuggestError(error instanceof Error ? error.message : String(error));
      });
  };

  const runInstall = () => {
    if (installing) return;
    const refs = selected.size > 0 ? Array.from(selected) : focusedRow ? [focusedRow.ref] : [];
    if (refs.length === 0) {
      setActionMessage("Nothing selected: space selects a skill, then i installs.");
      return;
    }
    setInstalling(true);
    setActionMessage(undefined);
    props.onInstall(refs)
      .then((outcomes) => {
        setInstallResults((current) => {
          const next = new Map(current);
          for (const outcome of outcomes) next.set(outcome.ref, outcome);
          return next;
        });
        const failed = outcomes.filter((outcome) => !outcome.ok);
        setActionMessage(
          failed.length === 0
            ? `Installed ${outcomes.length} skill(s) for ${props.installTargetsLabel}.`
            : `Installed ${outcomes.length - failed.length} skill(s); ${failed.length} failed — details in the pane.`
        );
      })
      .catch((error) => setActionMessage(`Install failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setInstalling(false));
  };

  const runAuthor = () => {
    if (!props.onAuthor) {
      setActionMessage("Authoring needs Claude Code or Codex installed.");
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setActionMessage("Describe the skill first: type what it should do in the text field.");
      return;
    }
    props.onAuthor(trimmed);
  };

  useEffect(() => {
    if (props.initialQuery && props.initialQuery.trim().length > 0) runSearch(props.initialQuery);
    return () => {
      searchAbortRef.current?.abort();
      suggestAbortRef.current?.abort();
    };
    // Mount-only: the initial query comes from the caller (e.g. an Improve
    // skill suggestion) and later searches are explicit.
  }, []);

  const inputBindings = defineBindings(
    binding(["tab", "shift+tab"], "focus", "focus zone"),
    binding("enter", "search", "search"),
    binding("escape", "leaveField", "leave field"),
    binding("ctrl+c", "quit", "quit")
  );
  const mainBindings = defineBindings(
    binding(["tab", "shift+tab"], "focus", "focus zone"),
    binding(["up", "down"], "move", "move"),
    binding("space", "toggle", "select"),
    binding("enter", "activate", "activate"),
    binding("i", "install", "install"),
    ...(props.onAuthor ? [binding("a", "author", "author new skill")] : []),
    binding(["escape", "b"], "back", "back"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );

  useKeyboard((key) => {
    const intent = resolveIntent(focus === "input" ? inputBindings : mainBindings, key, { textInputFocused: focus === "input" });
    if (intent === "quit") {
      props.onExit("quit");
      return;
    }
    if (intent === "leaveField") {
      setFocus("list");
      return;
    }
    if (intent === "focus") {
      setFocus((current) => adjacentZone(current, props.suggest !== undefined, key.shift ? -1 : 1));
      return;
    }
    if (focus === "input") return;
    if (intent === "back") {
      props.onExit("back");
      return;
    }
    if (intent === "move" && focus === "list") {
      setActionMessage(undefined);
      setFocusedIndex((current) => Math.min(Math.max(0, current + (key.name === "down" ? 1 : -1)), Math.max(rows.length - 1, 0)));
      return;
    }
    if ((intent === "toggle" || intent === "activate") && focus === "suggest") {
      runSuggest();
      return;
    }
    if ((intent === "toggle" || intent === "activate") && focus === "list" && focusedRow) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(focusedRow.ref)) next.delete(focusedRow.ref);
        else next.add(focusedRow.ref);
        return next;
      });
      return;
    }
    if (intent === "install") {
      runInstall();
      return;
    }
    if (intent === "author") runAuthor();
  });

  const statusText =
    searchStatus === "running"
      ? `${spinner} Searching skills.sh…`
      : searchStatus === "error"
        ? `✗ Search failed: ${searchError ?? "unknown error"}`
        : searchStatus === "ready"
          ? `${results.length} result(s) for “${searchedQuery ?? ""}”`
          : "Enter searches skills.sh with the text above.";

  const suggestBadge =
    suggestStatus === "ready"
      ? `${recommendations.length} suggestion(s)`
      : suggestStatus === "error"
        ? "failed"
        : suggestStatus === "running"
          ? "running"
          : "off";

  const paneForFocused = (): { title: string; lines: PaneLine[] } | undefined => {
    if (!focusedRow) return undefined;
    const lines: PaneLine[] = [];
    if (focusedRow.recommended && focusedRow.reason) lines.push({ fg: palette.gold, text: `★ suggested: ${focusedRow.reason}` });
    lines.push({ fg: palette.faint, text: `${formatInstalls(focusedRow.installs)} installs · ${focusedRow.ref}` });
    const installed = installResults.get(focusedRow.ref);
    if (installed) {
      lines.push(
        installed.ok
          ? { fg: palette.success, text: "✓ installed in this session" }
          : { fg: palette.warn, text: `✗ install failed: ${installed.error ?? (installed.stderr.trim() ? installed.stderr.trim().slice(0, 120) : "unknown error")}` }
      );
    } else {
      lines.push({ fg: palette.muted, text: "space selects · i installs" });
    }
    return { title: focusedRow.name, lines };
  };
  const pane = paneForFocused();

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text fg={palette.accent}>✦ Skills</text>
        <text fg={palette.muted}>
          Find skills for this project. Type a search, an intent, or paste a PRD (or a path to one).
        </text>
      </box>
      <input
        placeholder="Search skills.sh, or paste a PRD / path…"
        value={props.initialQuery}
        focused={focus === "input"}
        onInput={(value) => setQuery(String(value))}
        onSubmit={() => {
          if (query.trim().length === 0) {
            setFocus("list");
            return;
          }
          runSearch(query);
          setFocus("list");
        }}
        onKeyDown={(key) => {
          if (resolveIntent(inputBindings, key) === "leaveField" && (key.name === "escape" || key.sequence === "\u001b")) {
            key.preventDefault();
            key.stopPropagation();
            setFocus("list");
          }
        }}
      />
      <text style={{ flexShrink: 0 }} fg={searchStatus === "error" ? palette.warn : palette.muted}>{statusText}</text>
      {props.suggest ? (
        <box style={{ flexDirection: "row", gap: 1, flexShrink: 0 }}>
          <text fg={focus === "suggest" ? palette.accentText : palette.agent} bg={focus === "suggest" ? palette.agent : undefined}>
            {` ★ Suggest skills from this text with ${props.suggest.backendLabel} `}
          </text>
          <text fg={palette.faint}>{"· reads it as a project brief · ~20s"}</text>
          <text fg={suggestStatus === "error" ? palette.warn : suggestStatus === "ready" ? palette.success : palette.faint}>
            {`[${suggestBadge}]`}
          </text>
          {suggestStatus === "running" ? <text fg={palette.agent}>{`${spinner} researching…`}</text> : null}
        </box>
      ) : (
        <text style={{ flexShrink: 0 }} fg={palette.faint}>★ Suggestions and authoring need Claude Code or Codex installed; search still works.</text>
      )}
      {suggestStatus === "error" ? (
        <text style={{ flexShrink: 0 }} fg={palette.warn}>{`✗ Suggestions failed: ${suggestError ?? "unknown error"}`}</text>
      ) : null}
      {suggestStatus === "ready" && suggestQueries.length > 0 ? (
        <text style={{ flexShrink: 0 }} fg={palette.faint}>{`searched as: ${suggestQueries.join(" · ")}`}</text>
      ) : null}
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
        {rows.length === 0 ? (
          <text style={{ flexShrink: 0 }} fg={palette.faint}>No skills listed yet — search above{props.suggest ? " or run the suggestion" : ""}.</text>
        ) : (
          <box style={{ flexDirection: "column", flexShrink: 0, gap: 0 }}>
            {rows.map((row, index) => {
              const rowFocused = index === focusedIndex;
              const isSelected = selected.has(row.ref);
              const installed = installResults.get(row.ref);
              return (
                <text key={row.ref} style={{ flexShrink: 0 }} bg={rowFocused && focus === "list" ? palette.selBg : undefined}>
                  <span fg={palette.accent}>{rowFocused ? "▸ " : "  "}</span>
                  <span fg={isSelected ? palette.success : palette.faint}>{isSelected ? "[x] " : "[ ] "}</span>
                  {row.recommended ? <span fg={palette.gold}>{"★ "}</span> : null}
                  <span fg={palette.text}>{fit(row.name, nameColWidth)}</span>
                  <span fg={palette.gold}>{`  ${formatInstalls(row.installs)}`}</span>
                  <span fg={palette.faint}>{" installs"}</span>
                  {installed ? (
                    <span fg={installed.ok ? palette.success : palette.warn}>{installed.ok ? "  ✓ installed" : "  ✗ failed"}</span>
                  ) : null}
                </text>
              );
            })}
          </box>
        )}
        {pane ? <DetailPane title={pane.title} lines={pane.lines} /> : null}
      </scrollbox>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        {actionMessage ? <text fg={palette.gold}>{actionMessage}</text> : null}
        <text fg={palette.muted}>
          {`${selected.size} selected · installs go to ${props.installTargetsLabel}${props.onAuthor ? " · a authors a new skill from the text" : ""}`}
        </text>
        <KeyHints hint={bindingsHint(focus === "input" ? inputBindings : mainBindings)} />
      </box>
    </box>
  );
}

export async function runSkillsApp(
  targetDir: string,
  session?: SessionAgentContext,
  options: { initialQuery?: string } = {}
): Promise<SkillsAppOutcome> {
  const { loadFarrierConfig } = await import("../config/farrier-config");
  const { adviseSkills, resolveContext } = await import("../engine/advise");
  const { installSkills, searchSkills } = await import("../engine/skills");
  const { detectPacks } = await import("../engine/detect");
  const { skillInstallAgentIds } = await import("../engine/skill-paths");

  // sessionAgentContext only ever sets backend to an installed candidate.
  const backend = session?.backend;

  const [models, packId] = await Promise.all([
    loadFarrierConfig({ projectDir: targetDir })
      .then((loaded) => loaded.config.models)
      .catch(() => ({})),
    detectPacks(targetDir)
      .then((packs) => packs[0] ?? "generic")
      .catch(() => "generic")
  ]);
  const settings = backend ? sessionModelSettings({ session, models, backend, role: "advise" }) : undefined;

  const agents: CreateAgent[] = session && session.agents.length > 0 ? [...session.agents] : ["claude", "codex"];
  const installAgents = skillInstallAgentIds(agents, false);
  const installTargetsLabel = agents.map(agentProductName).join(" + ");

  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  try {
    renderer = await createCliRenderer();
    const cliRenderer = renderer;
    return await new Promise<SkillsAppOutcome>((done) => {
      let settled = false;
      const finish = (outcome: SkillsAppOutcome) => {
        if (settled) return;
        settled = true;
        cliRenderer.destroy();
        done(outcome);
      };
      createRoot(cliRenderer).render(
        <SkillsApp
          initialQuery={options.initialQuery}
          onSearch={(query, signal) => searchSkills(query, { signal })}
          suggest={
            backend && settings
              ? {
                  backendLabel: `${backend} (${settings.model ?? "default model"})`,
                  run: async (text, signal) => {
                    const trimmed = text.trim();
                    const resolved = await resolveContext({ targetDir, context: trimmed.length > 0 ? trimmed : undefined });
                    if (!resolved) {
                      throw new Error("Paste a project brief (or a path to a PRD) in the text field first.");
                    }
                    return adviseSkills({
                      targetDir,
                      packId,
                      contextText: resolved.text,
                      backend,
                      model: settings.model,
                      reasoningEffort: settings.reasoningEffort,
                      signal
                    });
                  }
                }
              : undefined
          }
          onInstall={(refs) => installSkills(refs, targetDir, undefined, undefined, installAgents)}
          installTargetsLabel={installTargetsLabel}
          onAuthor={
            backend
              ? (description) =>
                  finish({
                    kind: "create-skill",
                    request: {
                      description,
                      agents,
                      mode: backend === "codex" ? "author-codex" : "author-claude"
                    }
                  })
              : undefined
          }
          onExit={finish}
        />
      );
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier: ${error instanceof Error ? error.message : String(error)}`);
    return "back";
  }
}
