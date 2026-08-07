/**
 * Transcript record extraction: turning one raw Claude JSONL record into the
 * shell commands it ran and the failed or denied results it got back. Shape
 * detection only — what a command MEANS lives in learn-signal-commands.ts, and
 * what repeats across sessions lives in learn-signals.ts.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

// --- Transcript tool_use / tool_result extraction (shared with learn.ts) ---

export type ToolUse = {
  id?: string;
  command: string;
};

export type ToolResult = {
  toolUseId?: string;
  text: string;
  isError: boolean;
  isDenied: boolean;
};

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStrings(item));
  }

  if (isRecord(value)) {
    return Object.values(value).flatMap((item) => flattenStrings(item));
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  return [];
}

export function textFrom(value: unknown): string {
  return flattenStrings(value).join("\n");
}

function booleanField(record: Record<string, unknown>, names: string[]): boolean {
  return names.some((name) => record[name] === true);
}

export function looksDenied(text: string): boolean {
  const lower = text.toLowerCase();

  return (
    (lower.includes("permissiondecision") && lower.includes("deny")) ||
    lower.includes("permission decision") && lower.includes("deny") ||
    lower.includes("permission denied") ||
    lower.includes("denied") ||
    lower.includes("blocked by hook") ||
    lower.includes("hook blocked") ||
    lower.includes("blocked")
  );
}

export function looksErrored(text: string): boolean {
  const lower = text.toLowerCase();

  return (
    lower.includes("exit code") ||
    lower.includes("exited with code") ||
    lower.includes("not found") ||
    lower.includes("permission denied") ||
    lower.includes("failed") ||
    lower.includes("traceback") ||
    lower.includes("error")
  );
}

function dedupeToolUses(uses: ToolUse[]): ToolUse[] {
  const seen = new Set<string>();
  const deduped: ToolUse[] = [];

  for (const use of uses) {
    const key = `${use.id ?? ""}\u0000${use.command}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(use);
  }

  return deduped;
}

export function toolUseFromRecord(record: Record<string, unknown>): ToolUse[] {
  const uses: ToolUse[] = [];

  function addUse(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }

    const name = optionalString(value.name) ?? optionalString(value.tool_name);
    const input = isRecord(value.input) ? value.input : isRecord(value.tool_input) ? value.tool_input : undefined;
    const command = input ? optionalString(input.command) : undefined;

    if (name === "Bash" && command) {
      uses.push({
        id: optionalString(value.id),
        command: normalizeCommand(command)
      });
    }
  }

  addUse(record);

  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];

  for (const item of content) {
    if (isRecord(item) && item.type === "tool_use") {
      addUse(item);
    }
  }

  return dedupeToolUses(uses);
}

/** One observed skill invocation; sessionRef is the scanner's session id. */
export type SkillInvocationEvent = {
  skill: string;
  sessionRef: string;
  date: string | undefined;
};

/**
 * Skill directory names referenced by one shell command. Reading
 * skills/<name>/SKILL.md (or anything under the skill's directory) is the
 * observable invocation signal shared by both backends: Codex loads skills
 * through shell reads, and Claude Bash commands that reach into a skill tree
 * count the same way. Bare roots ("ls .agents/skills") name no skill.
 */
export function skillNamesFromCommand(command: string): string[] {
  const names = new Set<string>();
  const pattern = /(?:\.agents\/|\.claude\/|(?<![\w.-]))skills\/([A-Za-z0-9][\w.-]*)/g;
  for (const match of command.matchAll(pattern)) {
    const name = match[1]!;
    // A trailing "-" is a glob prefix (skills/hig-*/SKILL.md), not a name.
    if (name !== "SKILL.md" && !name.endsWith("-")) names.add(name);
  }
  return Array.from(names);
}

/**
 * Skill names invoked by one Claude transcript record: the Skill tool
 * (input.skill) and slash-command expansions (<command-name>/x</command-name>,
 * which live in isMeta records the steer extraction deliberately skips).
 */
export function skillInvocationsFromRecord(record: Record<string, unknown>): string[] {
  const names = new Set<string>();

  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    if (!isRecord(item) || item.type !== "tool_use" || item.name !== "Skill") continue;
    const input = isRecord(item.input) ? item.input : undefined;
    const skill = input ? optionalString(input.skill) : undefined;
    if (skill) names.add(skill);
  }

  for (const match of textFrom(record).matchAll(/<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/g)) {
    names.add(match[1]!);
  }

  return Array.from(names);
}

/**
 * Human-authored text from one Claude transcript record. Tool results, meta
 * records (command wrappers, caveats), and sidechain (subagent) prompts all
 * arrive as type:"user" but are not the human steering the agent.
 */
export function userTextFromRecord(record: Record<string, unknown>): string | undefined {
  if (record.type !== "user" || record.isMeta === true || record.isSidechain === true) {
    return undefined;
  }

  const message = isRecord(record.message) ? record.message : undefined;
  if (!message) {
    return undefined;
  }

  const content = message.content;
  if (typeof content === "string") {
    return content.trim().length > 0 ? content : undefined;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  if (content.some((item) => isRecord(item) && item.type === "tool_result")) {
    return undefined;
  }

  const texts = content
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "text")
    .map((item) => optionalString(item.text) ?? "")
    .filter((text) => text.trim().length > 0);

  return texts.length > 0 ? texts.join("\n") : undefined;
}

export function toolResultsFromRecord(record: Record<string, unknown>): ToolResult[] {
  const results: ToolResult[] = [];

  function addResult(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }

    const text = textFrom(value);
    const isDenied = looksDenied(text);
    const isError = booleanField(value, ["is_error", "isError", "error"]) || looksErrored(text);

    if (!isDenied && !isError) {
      return;
    }

    results.push({
      toolUseId: optionalString(value.tool_use_id) ?? optionalString(value.toolUseId),
      text,
      isError,
      isDenied
    });
  }

  if (record.type === "tool_result") {
    addResult(record);
  }

  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];

  for (const item of content) {
    if (isRecord(item) && item.type === "tool_result") {
      addResult(item);
    }
  }

  for (const key of ["tool_response", "tool_result", "result", "response"]) {
    addResult(record[key]);
  }

  const fullText = textFrom(record);
  if (looksDenied(fullText) || looksErrored(fullText)) {
    results.push({
      toolUseId: optionalString(record.tool_use_id) ?? optionalString(record.toolUseId),
      text: fullText,
      isError: looksErrored(fullText),
      isDenied: looksDenied(fullText)
    });
  }

  return results;
}
