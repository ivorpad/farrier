import type { AgentBackend } from "./backend";

export type BackendTokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type BackendEventResult = {
  text: string;
  usage?: BackendTokenUsage;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteToken(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function eventLines(stdout: string): Record<string, unknown>[] {
  return stdout.split("\n").flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as unknown;
      return isRecord(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

function codexResult(events: Record<string, unknown>[]): BackendEventResult | undefined {
  let text: string | undefined;
  let usage: BackendTokenUsage | undefined;
  for (const event of events) {
    if (event.type === "item.completed" && isRecord(event.item)
      && event.item.type === "agent_message" && typeof event.item.text === "string") {
      text = event.item.text;
    }
    if (event.type === "turn.completed" && isRecord(event.usage)) {
      usage = {
        inputTokens: finiteToken(event.usage.input_tokens),
        outputTokens: finiteToken(event.usage.output_tokens),
      };
    }
  }
  return text === undefined ? undefined : { text, ...(usage ? { usage } : {}) };
}

function claudeResult(events: Record<string, unknown>[]): BackendEventResult | undefined {
  const result = [...events].reverse().find((event) => event.type === "result" && typeof event.result === "string");
  if (!result || typeof result.result !== "string") return undefined;
  if (!isRecord(result.usage)) return { text: result.result };
  return {
    text: result.result,
    usage: {
      inputTokens: finiteToken(result.usage.input_tokens)
        + finiteToken(result.usage.cache_creation_input_tokens)
        + finiteToken(result.usage.cache_read_input_tokens),
      outputTokens: finiteToken(result.usage.output_tokens),
    },
  };
}

export function parseBackendEventResult(backend: AgentBackend, stdout: string): BackendEventResult | undefined {
  const events = eventLines(stdout);
  return backend === "codex" ? codexResult(events) : claudeResult(events);
}
