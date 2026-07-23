import type { AgentBackend } from "./backend";

/**
 * Human-readable one-liners from streaming backend stdout (claude
 * `--output-format stream-json`, codex `--json`), split out of backend.ts so
 * process plumbing and presentation stay separately sized.
 */

function shortPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(-2).join("/");
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

// codex wraps every exec in a login shell; the wrapper is noise.
function stripShellWrapper(command: string): string {
  const match = command.match(/^\/bin\/\w+ -lc '([\s\S]*)'$/);
  return match ? match[1]! : command;
}

function claudeToolActivity(name: string, input: Record<string, unknown>): string {
  if (name === "Bash" && typeof input.command === "string") {
    return `$ ${firstLine(input.command)}`;
  }

  if ((name === "Write" || name === "Edit") && typeof input.file_path === "string") {
    return `${name} ${shortPath(input.file_path)}`;
  }

  if (name === "Read" && typeof input.file_path === "string") {
    return `Read ${shortPath(input.file_path)}`;
  }

  if (name === "Skill" && typeof input.skill === "string") {
    return `Skill ${input.skill}`;
  }

  return name;
}

/**
 * Maps one line of streaming backend stdout to a short human-readable
 * activity string, or undefined for lines not worth surfacing (thinking
 * deltas, tool results, usage events, non-JSON noise).
 */
export function formatBackendStreamActivity(backend: AgentBackend, line: string): string | undefined {
  let event: Record<string, unknown>;

  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  if (backend === "claude") {
    if (event.type !== "assistant") {
      return undefined;
    }

    const message = event.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? (message.content as Record<string, unknown>[]) : [];

    for (const block of content) {
      if (block.type === "tool_use" && typeof block.name === "string") {
        return claudeToolActivity(block.name, (block.input ?? {}) as Record<string, unknown>);
      }

      if (block.type === "text" && typeof block.text === "string" && firstLine(block.text) !== "") {
        return firstLine(block.text);
      }
    }

    return undefined;
  }

  if (event.type !== "item.started" && event.type !== "item.completed") {
    return undefined;
  }

  const item = (event.item ?? {}) as Record<string, unknown>;

  // command_execution appears at both started and completed; show it once.
  if (item.type === "command_execution" && event.type === "item.started" && typeof item.command === "string") {
    return `$ ${firstLine(stripShellWrapper(item.command))}`;
  }

  if (event.type !== "item.completed") {
    return undefined;
  }

  if ((item.type === "agent_message" || item.type === "reasoning") && typeof item.text === "string") {
    const text = firstLine(item.text);
    return text === "" ? undefined : text;
  }

  if (item.type === "file_change" && Array.isArray(item.changes)) {
    const paths = (item.changes as Record<string, unknown>[])
      .map((change) => (typeof change.path === "string" ? shortPath(change.path) : undefined))
      .filter((path): path is string => path !== undefined);
    return paths.length > 0 ? `Edit ${paths.join(", ")}` : undefined;
  }

  if (item.type === "error" && typeof item.message === "string") {
    return firstLine(item.message);
  }

  return undefined;
}
