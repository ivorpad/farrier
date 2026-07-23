import { agentProbeTimeoutMs, runAgentProbe } from "./agent-detection";
import { defaultBackendRunner, type AgentBackend, type BackendCommandRunner } from "./backend";
import { createCodexAppServerClient, type CodexAppServerClient, type CodexAppServerFactory } from "./codex-app-server";

/**
 * Model suggestions sourced from the installed CLIs, never from a hardcoded
 * catalog. Codex has a real listing: the app-server JSON-RPC method
 * "model/list" (ModelListParams -> {data: Model[], nextCursor}). Claude Code
 * has none ("claude models" would run a prompt), so the only local source is
 * the `--model` option text in `claude --help`, which names the current
 * aliases and a full-name example and self-updates with the binary. Every
 * probe degrades to an empty list on failure, timeout, or unparseable
 * output; callers must treat [] as "could not list", not as an error.
 */

export type CliModelSuggestion = { id: string; displayName?: string };

/** The whole spawn+initialize+model/list round trip shares this budget. */
export const codexModelListTimeoutMs = 6000;

// A single-quoted model-shaped token. Requiring the shape inside the quotes
// keeps prose apostrophes (as in "a model's full name") from pairing with a
// later quote and swallowing the token between them.
const quotedModelPattern = /'([A-Za-z][A-Za-z0-9._-]*)'/g;

/**
 * Extracts the `--model` option block: the option line plus the
 * more-indented continuation lines below it, stopping at the next option or
 * a blank line. Scoping to the block keeps quoted words in other options'
 * descriptions out of the suggestions.
 */
function claudeModelHelpBlock(helpText: string): string | undefined {
  const lines = helpText.split("\n");
  const start = lines.findIndex((line) => /^(\s*)(?:-\w,\s*)?--model\b/.test(line));
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
  const block = claudeModelHelpBlock(helpText);
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

/** `claude --help` only; "claude models" is a prompt and must never run. */
export async function listClaudeModels(
  runner: BackendCommandRunner = defaultBackendRunner,
  timeoutMs: number = agentProbeTimeoutMs
): Promise<CliModelSuggestion[]> {
  if (runner === defaultBackendRunner && !Bun.which("claude")) return [];
  const output = await runAgentProbe("claude", ["claude", "--help"], { runner, timeoutMs });
  if (!output) return [];
  return parseClaudeModelHelp(`${output.stdout}\n${output.stderr}`);
}

function parseCodexModelList(result: unknown): CliModelSuggestion[] {
  if (typeof result !== "object" || result === null) return [];
  const data = (result as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const suggestions: CliModelSuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const model = entry as { id?: unknown; displayName?: unknown; hidden?: unknown };
    if (typeof model.id !== "string" || !model.id || model.hidden === true || seen.has(model.id)) continue;
    seen.add(model.id);
    suggestions.push({
      id: model.id,
      ...(typeof model.displayName === "string" && model.displayName ? { displayName: model.displayName } : {})
    });
  }
  return suggestions;
}

/**
 * First page only: the live server returns the full catalog with
 * nextCursor:null, so following cursors would add moving parts for no
 * observed payoff. If a future codex paginates, later pages are dropped.
 */
export async function listCodexModels(
  factory: CodexAppServerFactory = createCodexAppServerClient,
  timeoutMs: number = codexModelListTimeoutMs
): Promise<CliModelSuggestion[]> {
  if (factory === createCodexAppServerClient && !Bun.which("codex")) return [];
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
    if (outcome === "timeout") return [];
    return parseCodexModelList(outcome);
  } catch {
    return [];
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

export type CliModelProbes = Record<AgentBackend, () => Promise<CliModelSuggestion[]>>;

const defaultProbes: CliModelProbes = {
  claude: () => listClaudeModels(),
  codex: () => listCodexModels()
};

const processCache = new Map<AgentBackend, Promise<CliModelSuggestion[]>>();

/**
 * Per-process memo so re-entering the startup model phase never re-spawns a
 * CLI. The cached value is the settled promise, including an honest [].
 */
export function cliModelSuggestions(backend: AgentBackend, probes: CliModelProbes = defaultProbes): Promise<CliModelSuggestion[]> {
  const cached = processCache.get(backend);
  if (cached) return cached;
  const listing = probes[backend]().catch(() => [] as CliModelSuggestion[]);
  processCache.set(backend, listing);
  return listing;
}

export function resetCliModelSuggestionsCache(): void {
  processCache.clear();
}
