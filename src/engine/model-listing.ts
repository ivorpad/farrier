import { agentProbeTimeoutMs, runAgentProbe } from "./agent-detection";
import { defaultBackendRunner, type AgentBackend, type BackendCommandRunner } from "./backend";
import { createCodexAppServerClient, type CodexAppServerClient, type CodexAppServerFactory } from "./codex-app-server";

/**
 * Model and reasoning-effort suggestions sourced from the installed CLIs,
 * never from a hardcoded catalog. Codex has a real listing: the app-server
 * JSON-RPC method "model/list" (ModelListParams -> {data: Model[],
 * nextCursor}), whose Models also carry supportedReasoningEfforts and
 * defaultReasoningEffort per model. Claude Code has none ("claude models"
 * would run a prompt), so the only local source is `claude --help`: the
 * `--model` option text names the current aliases and a full-name example,
 * and the `--effort` option text enumerates the session effort levels; both
 * self-update with the binary. Every probe degrades to an empty list on
 * failure, timeout, or unparseable output; callers must treat [] as "could
 * not list", not as an error.
 */

export type CliModelSuggestion = {
  id: string;
  displayName?: string;
  /** codex model/list only: effort levels this model accepts, server order. */
  supportedReasoningEfforts?: string[];
  /** codex model/list only: the level used when none is passed. */
  defaultReasoningEffort?: string;
};

export type CliBackendListing = {
  models: CliModelSuggestion[];
  /**
   * Session-wide effort levels. claude: parsed from the `--effort` help
   * block, [] meaning "could not list". codex: absent on purpose; effort
   * levels there are a per-model property of the listed models.
   */
  efforts?: string[];
};

/** The whole spawn+initialize+model/list round trip shares this budget. */
export const codexModelListTimeoutMs = 6000;

// A single-quoted model-shaped token. Requiring the shape inside the quotes
// keeps prose apostrophes (as in "a model's full name") from pairing with a
// later quote and swallowing the token between them.
const quotedModelPattern = /'([A-Za-z][A-Za-z0-9._-]*)'/g;

/**
 * Extracts one option's help block: the option line plus the more-indented
 * continuation lines below it, stopping at the next option or a blank line.
 * Scoping to the block keeps text in other options' descriptions out of the
 * parsed suggestions.
 */
function claudeHelpOptionBlock(helpText: string, option: string): string | undefined {
  const lines = helpText.split("\n");
  const optionPattern = new RegExp(`^(\\s*)(?:-\\w,\\s*)?--${option}\\b`);
  const start = lines.findIndex((line) => optionPattern.test(line));
  if (start < 0) return undefined;
  const indent = lines[start]!.match(/^\s*/)?.[0].length ?? 0;
  const block = [lines[start]!.trim()];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) break;
    const lineIndent = line.match(/^\s*/)?.[0].length ?? 0;
    if (lineIndent <= indent) break;
    block.push(line.trim());
  }
  return block.join(" ");
}

/** Index of the last `pattern` match that starts before `before`, or -1. */
function lastMatchBefore(block: string, pattern: RegExp, before: number): number {
  let last = -1;
  for (const match of block.matchAll(pattern)) {
    if (match.index >= before) break;
    last = match.index;
  }
  return last;
}

/**
 * Parse rules: single-quoted model-shaped tokens inside the `--model` block
 * are the suggestions. The help text introduces them with "alias" and
 * "full name" phrases; each token takes the class of the nearest preceding
 * phrase, aliases are listed first, and the result is deduplicated. This
 * survives alias renames and a reworded or reordered sentence, the two ways
 * the installed binary actually changes this text between versions.
 */
export function parseClaudeModelHelp(helpText: string): CliModelSuggestion[] {
  const block = claudeHelpOptionBlock(helpText, "model");
  if (!block) return [];
  const aliases: string[] = [];
  const fullNames: string[] = [];
  for (const match of block.matchAll(quotedModelPattern)) {
    const aliasAt = lastMatchBefore(block, /alias/gi, match.index);
    const fullNameAt = lastMatchBefore(block, /full\s+name/gi, match.index);
    (fullNameAt > aliasAt ? fullNames : aliases).push(match[1]!);
  }
  return Array.from(new Set([...aliases, ...fullNames])).map((id) => ({ id }));
}

/**
 * Parse rules: the `--effort` block enumerates its levels as a parenthesized
 * comma-separated list ("(low, medium, high, xhigh, max)" in claude 2.1.x).
 * The first parenthesized group whose every comma-separated piece is a bare
 * word is the level list; a leading "or "/"and " on the final piece is
 * tolerated. Prose-bearing groups (the --model block's quoted examples)
 * never qualify, and anything else parses to [] ("could not list").
 */
export function parseClaudeEffortHelp(helpText: string): string[] {
  const block = claudeHelpOptionBlock(helpText, "effort");
  if (!block) return [];
  for (const group of block.matchAll(/\(([^)]+)\)/g)) {
    const tokens = group[1]!.split(",").map((piece) => piece.trim().replace(/^(?:or|and)\s+/i, ""));
    if (tokens.length >= 2 && tokens.every((token) => /^[A-Za-z][A-Za-z0-9._-]*$/.test(token))) {
      return Array.from(new Set(tokens));
    }
  }
  return [];
}

/** `claude --help` only; "claude models" is a prompt and must never run. */
export async function listClaudeCli(
  runner: BackendCommandRunner = defaultBackendRunner,
  timeoutMs: number = agentProbeTimeoutMs
): Promise<CliBackendListing> {
  if (runner === defaultBackendRunner && !Bun.which("claude")) return { models: [], efforts: [] };
  const output = await runAgentProbe("claude", ["claude", "--help"], { runner, timeoutMs });
  if (!output) return { models: [], efforts: [] };
  const helpText = `${output.stdout}\n${output.stderr}`;
  return { models: parseClaudeModelHelp(helpText), efforts: parseClaudeEffortHelp(helpText) };
}

/** Levels from Model.supportedReasoningEfforts: [{reasoningEffort, description}]. */
function codexEffortLevels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const levels: string[] = [];
  for (const entry of value) {
    const level =
      typeof entry === "string"
        ? entry
        : typeof entry === "object" && entry !== null && typeof (entry as { reasoningEffort?: unknown }).reasoningEffort === "string"
          ? (entry as { reasoningEffort: string }).reasoningEffort
          : undefined;
    if (level && !levels.includes(level)) levels.push(level);
  }
  return levels.length > 0 ? levels : undefined;
}

function parseCodexModelList(result: unknown): CliModelSuggestion[] {
  if (typeof result !== "object" || result === null) return [];
  const data = (result as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const suggestions: CliModelSuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const model = entry as {
      id?: unknown;
      displayName?: unknown;
      hidden?: unknown;
      supportedReasoningEfforts?: unknown;
      defaultReasoningEffort?: unknown;
    };
    if (typeof model.id !== "string" || !model.id || model.hidden === true || seen.has(model.id)) continue;
    seen.add(model.id);
    const efforts = codexEffortLevels(model.supportedReasoningEfforts);
    suggestions.push({
      id: model.id,
      ...(typeof model.displayName === "string" && model.displayName ? { displayName: model.displayName } : {}),
      ...(efforts ? { supportedReasoningEfforts: efforts } : {}),
      ...(typeof model.defaultReasoningEffort === "string" && model.defaultReasoningEffort
        ? { defaultReasoningEffort: model.defaultReasoningEffort }
        : {})
    });
  }
  return suggestions;
}

/**
 * First page only: the live server returns the full catalog with
 * nextCursor:null, so following cursors would add moving parts for no
 * observed payoff. If a future codex paginates, later pages are dropped.
 */
export async function listCodexCli(
  factory: CodexAppServerFactory = createCodexAppServerClient,
  timeoutMs: number = codexModelListTimeoutMs
): Promise<CliBackendListing> {
  if (factory === createCodexAppServerClient && !Bun.which("codex")) return { models: [] };
  let client: CodexAppServerClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const attempt = (async () => {
    client = await factory();
    return await client.request("model/list", {});
  })();
  try {
    const outcome = await Promise.race([attempt, timedOut]);
    if (outcome === "timeout") return { models: [] };
    return { models: parseCodexModelList(outcome) };
  } catch {
    return { models: [] };
  } finally {
    clearTimeout(timer);
    void attempt.catch(() => undefined);
    if (client) {
      // Closing also settles a still-pending model/list request.
      void client.close().catch(() => undefined);
    } else {
      // The factory itself is still spawning; close as soon as it settles.
      void attempt.catch(() => undefined).then(() => void client?.close().catch(() => undefined));
    }
  }
}

export type CliListingProbes = Record<AgentBackend, () => Promise<CliBackendListing>>;

const defaultProbes: CliListingProbes = {
  claude: () => listClaudeCli(),
  codex: () => listCodexCli()
};

const processCache = new Map<AgentBackend, Promise<CliBackendListing>>();

/**
 * Per-process memo so re-entering the startup model phase never re-spawns a
 * CLI. The cached value is the settled promise, including an honest empty
 * listing.
 */
export function cliBackendListing(backend: AgentBackend, probes: CliListingProbes = defaultProbes): Promise<CliBackendListing> {
  const cached = processCache.get(backend);
  if (cached) return cached;
  const listing = probes[backend]().catch(
    (): CliBackendListing => (backend === "claude" ? { models: [], efforts: [] } : { models: [] })
  );
  processCache.set(backend, listing);
  return listing;
}

export function resetCliBackendListingCache(): void {
  processCache.clear();
}
