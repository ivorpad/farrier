import { isAbsolute, relative } from "node:path";
import { redactSessionText } from "./advice-patterns";

/**
 * Deterministic, local capture helpers shared by both session miners.
 *
 * Two signals ride alongside the steer extraction, both counted without an
 * LLM and without leaving the machine:
 *   - the assistant action a steer immediately followed (steer context), so a
 *     correction can be read against what provoked it, and
 *   - per-session activity classification (edits vs commands, and the
 *     directories touched), so a session with real work and no steers can be
 *     recognised as compliance evidence.
 *
 * Everything here is agnostic: no project, provider, or domain string is
 * hardcoded. The Claude side reads tool_use records; both sides classify raw
 * shell commands the same way (apply_patch is an edit, anything else a
 * command), which is also how Codex records edits.
 */

const maxContextChars = 160;

/** Editing tools across the agents farrier observes; matched by tool name. */
const editToolNames = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Create", "str_replace_editor"]);
/** Input fields that name the primary target of a tool_use, in priority order. */
const summaryTargetFields = ["file_path", "notebook_path", "path", "pattern", "url", "query", "skill", "description"];
const pathTargetFields = ["file_path", "notebook_path", "path"];

const shellWordPattern = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;

/** One classified tool action: what kind it was and which directories it touched. */
export type ToolActivity = { kind: "edit" | "command"; dirs: string[] };

/** A classified action attributed to one session; the miners emit these. */
export type SessionActivityEvent = { sessionRef: string; kind: "edit" | "command"; dirs: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function unquote(token: string): string {
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1);
  }
  return token;
}

function firstStringField(input: Record<string, unknown>, fields: readonly string[]): string | undefined {
  for (const field of fields) {
    const value = optionalString(input[field]);
    if (value) return value;
  }
  return undefined;
}

/** The directory of a path token: "src/foo.ts" → "src", "foo.ts" → ".", "/a/b" → "/a". */
export function dirOf(path: string): string {
  const clean = unquote(path).replace(/\/+$/, "");
  const slash = clean.lastIndexOf("/");
  if (slash < 0) return ".";
  if (slash === 0) return "/";
  return clean.slice(0, slash);
}

/** Directories named by path-like tokens (containing a slash) in a shell command. */
export function commandDirs(command: string): string[] {
  const dirs = new Set<string>();
  for (const raw of command.match(shellWordPattern) ?? []) {
    const token = unquote(raw);
    if (token.startsWith("-") || !token.includes("/")) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) continue; // urls, git/ssh remotes
    dirs.add(dirOf(token));
  }
  return Array.from(dirs);
}

/**
 * The files an apply_patch invocation touches, or undefined when the command
 * is not an apply_patch. An empty array means "apply_patch, files unparsed"
 * (still an edit). This is how Codex records file edits.
 */
export function applyPatchFiles(command: string): string[] | undefined {
  if (!/\bapply_patch\b/.test(command) && !/\*\*\*\s*Begin Patch/i.test(command)) return undefined;
  const files: string[] = [];
  // Stop at the next whitespace/asterisk: commands reach here whitespace-
  // normalized to one line, so a greedy match would swallow later markers.
  for (const match of command.matchAll(/\*\*\*\s*(?:Add|Update|Delete) File:\s*([^\s*]+)/g)) {
    const file = match[1]!.trim();
    if (file) files.push(file);
  }
  return files;
}

/** Classifies any raw shell command as an edit (apply_patch) or a command. */
export function classifyCommandActivity(command: string): ToolActivity {
  const patchFiles = applyPatchFiles(command);
  if (patchFiles) {
    return { kind: "edit", dirs: Array.from(new Set(patchFiles.map(dirOf))) };
  }
  return { kind: "command", dirs: commandDirs(command) };
}

/**
 * A one-line summary of a tool_use: the command for shell tools, otherwise
 * "ToolName target" (e.g. "Edit src/foo.ts"), or the bare tool name. Raw and
 * unbounded; steerContextSummary redacts and bounds it before it is stored.
 */
export function summarizeToolUse(name: string, input: Record<string, unknown> | undefined): string {
  const command = input ? optionalString(input.command) : undefined;
  if (command) return command;
  const target = input ? firstStringField(input, summaryTargetFields) : undefined;
  return target ? `${name} ${target}` : name;
}

function contentItems(record: Record<string, unknown>): unknown[] {
  const message = isRecord(record.message) ? record.message : undefined;
  if (Array.isArray(message?.content)) return message.content;
  if (Array.isArray(record.content)) return record.content;
  return [];
}

/**
 * The tool actions in one Claude transcript record: the last tool_use as a
 * one-line summary (for pairing with a following steer) and every edit/command
 * action classified (for per-session activity). Read-only tools (Read, Grep,
 * …) still update the summary but contribute no activity count.
 */
export function claudeToolActionsFromRecord(record: Record<string, unknown>): {
  summary?: string;
  activities: ToolActivity[];
} {
  let summary: string | undefined;
  const activities: ToolActivity[] = [];
  for (const item of contentItems(record)) {
    if (!isRecord(item) || item.type !== "tool_use") continue;
    const name = optionalString(item.name) ?? optionalString(item.tool_name);
    if (!name) continue;
    const input = isRecord(item.input) ? item.input : isRecord(item.tool_input) ? item.tool_input : undefined;
    summary = summarizeToolUse(name, input);
    if (name === "Bash") {
      const command = input ? optionalString(input.command) : undefined;
      if (command) activities.push(classifyCommandActivity(command));
    } else if (editToolNames.has(name)) {
      const path = input ? firstStringField(input, pathTargetFields) : undefined;
      activities.push({ kind: "edit", dirs: path ? [dirOf(path)] : [] });
    }
  }
  return { ...(summary ? { summary } : {}), activities };
}

/**
 * Scopes a touched directory to the project before it can reach the consent-
 * gated prompt, honouring "Never sent: … other projects": a path inside
 * projectDir becomes project-relative; an absolute or home (~) path outside
 * projectDir is dropped entirely; a plain relative path is kept. projectDir is
 * expected already resolved. redactSessionText runs over the survivor as a
 * last-line defense. Returns undefined for anything dropped.
 */
export function scopeDir(dir: string, projectDir: string): string | undefined {
  const trimmed = dir.trim();
  if (trimmed.length === 0) return undefined;
  let scoped: string;
  if (trimmed.startsWith("~")) {
    return undefined; // home-relative: cannot confirm it is inside the project
  } else if (isAbsolute(trimmed)) {
    if (trimmed === projectDir) scoped = ".";
    else if (trimmed.startsWith(`${projectDir}/`)) scoped = relative(projectDir, trimmed) || ".";
    else return undefined; // absolute path outside the project → drop
  } else {
    scoped = trimmed; // plain relative path → keep
  }
  const redacted = redactSessionText(scoped).trim();
  return redacted.length > 0 ? redacted : undefined;
}

/**
 * Redacts and single-lines a raw action summary into a bounded steer context
 * (≤ 160 chars). Runs the same redaction as steer text; returns undefined when
 * nothing survives.
 */
export function steerContextSummary(raw: string): string | undefined {
  const clean = redactSessionText(raw).replace(/\s+/g, " ").trim();
  if (clean.length === 0) return undefined;
  return clean.length > maxContextChars ? `${clean.slice(0, maxContextChars - 1)}…` : clean;
}
