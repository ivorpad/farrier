export type AgentBackend = "claude" | "codex";

export type BackendCommandRunnerInput = {
  cmd: string[];
  cwd: string;
  stdin?: string;
  /** Aborting kills the spawned agent process. */
  signal?: AbortSignal;
  /** Called with each stdout line as it arrives; stdout is still returned in full. */
  onStdoutLine?: (line: string) => void;
};

export type BackendCommandRunnerOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type BackendCommandRunner = (input: BackendCommandRunnerInput) => Promise<BackendCommandRunnerOutput>;

export type DetectBackendDeps = {
  which: (bin: string) => string | null;
};

const defaultDetectDeps: DetectBackendDeps = {
  which: (bin) => Bun.which(bin)
};

export function detectAgentBackend(deps: Partial<DetectBackendDeps> = {}): AgentBackend | undefined {
  const which = deps.which ?? defaultDetectDeps.which;

  if (which("claude")) {
    return "claude";
  }

  if (which("codex")) {
    return "codex";
  }

  return undefined;
}

export type AgentAvailability = Record<AgentBackend, boolean>;

export async function probeAgents(runner: BackendCommandRunner = defaultBackendRunner): Promise<AgentAvailability> {
  const probe = async (bin: AgentBackend): Promise<boolean> => {
    try {
      const output = await runner({ cmd: [bin, "--version"], cwd: process.cwd() });
      return output.exitCode === 0;
    } catch {
      return false;
    }
  };

  const [claude, codex] = await Promise.all([probe("claude"), probe("codex")]);
  return { claude, codex };
}

export type BackendCommandOptions = {
  write?: boolean;
  /**
   * Emit machine-readable per-event stdout (claude stream-json NDJSON, codex
   * --json JSONL) so callers can surface live activity. The final answer is no
   * longer plain text on stdout, so this is for runs whose result is read from
   * the filesystem, not parsed from stdout.
   */
  stream?: boolean;
};

export function backendCommand(
  backend: AgentBackend,
  model: string | undefined,
  prompt: string,
  options: BackendCommandOptions = {}
): { cmd: string[]; stdin?: string } {
  if (backend === "claude") {
    const permissionArgs = options.write
      ? ["--permission-mode", "acceptEdits", "--allowedTools", "Write", "Edit", "Bash"]
      : [];
    // stream-json in -p mode requires --verbose.
    const streamArgs = options.stream ? ["--output-format", "stream-json", "--verbose"] : [];

    return {
      cmd: ["claude", "-p", "--model", model ?? "sonnet", ...permissionArgs, ...streamArgs],
      stdin: prompt
    };
  }

  const sandbox = options.write ? "workspace-write" : "read-only";
  const streamArgs = options.stream ? ["--json"] : [];

  // No default codex model: an explicit --model for a model the account lacks
  // fails silently, while omitting the flag uses the account's default.
  // No approval flag: `codex exec` is non-interactive and rejects `-a`.
  // Catalog off: farrier prompts name any skill they need explicitly
  // ($skill-creator), and codex resolves explicit mentions even without the
  // available-skills catalog. Including the catalog would spend context on the
  // user's whole global skill/plugin set and emit "skills context budget"
  // warnings into the run. Unknown -c keys are ignored by older codex builds.
  return {
    cmd: [
      "codex",
      "exec",
      ...streamArgs,
      ...(model ? ["--model", model] : []),
      "-s",
      sandbox,
      "-c",
      "skills.include_instructions=false",
      prompt
    ],
    stdin: undefined
  };
}

export async function defaultBackendRunner(input: BackendCommandRunnerInput): Promise<BackendCommandRunnerOutput> {
  if (input.signal?.aborted) {
    return { exitCode: 130, stdout: "", stderr: "cancelled before start" };
  }

  const proc = Bun.spawn({
    cmd: input.cmd,
    cwd: input.cwd,
    stdin: input.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe"
  });

  const onAbort = () => {
    proc.kill();
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });

  if (input.stdin !== undefined) {
    const stdin = proc.stdin as unknown as { write(data: string): unknown; end(): unknown } | undefined;
    stdin?.write(input.stdin);
    stdin?.end();
  }

  const readStdout = async (): Promise<string> => {
    if (!proc.stdout) {
      return "";
    }

    if (!input.onStdoutLine) {
      return new Response(proc.stdout).text();
    }

    // Line-buffered incremental read so callers can show live activity.
    const decoder = new TextDecoder();
    let full = "";
    let pending = "";

    for await (const chunk of proc.stdout) {
      const text = decoder.decode(chunk, { stream: true });
      full += text;
      pending += text;

      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);

        if (line.trim() !== "") {
          try {
            input.onStdoutLine(line);
          } catch {
            // Progress display failures must not kill the run.
          }
        }

        newline = pending.indexOf("\n");
      }
    }

    return full + decoder.decode();
  };

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    readStdout(),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("")
  ]);

  input.signal?.removeEventListener("abort", onAbort);

  return { exitCode, stdout, stderr };
}

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
 * Maps one line of streaming backend stdout (claude `--output-format
 * stream-json`, codex `--json`) to a short human-readable activity string, or
 * undefined for lines not worth surfacing (thinking deltas, tool results,
 * usage events, non-JSON noise).
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

export function parseBackendJson(stdout: string): unknown {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error("returned empty stdout");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new Error("did not return JSON");
  }
}

export async function invokeBackend(input: {
  backend: AgentBackend;
  model?: string;
  prompt: string;
  targetDir: string;
  runner: BackendCommandRunner;
  signal?: AbortSignal;
}): Promise<unknown> {
  const command = backendCommand(input.backend, input.model, input.prompt);

  const output = await input.runner({
    cmd: command.cmd,
    cwd: input.targetDir,
    stdin: command.stdin,
    signal: input.signal
  });

  if (output.exitCode !== 0) {
    const stderr = output.stderr.trim();
    throw new Error(`${input.backend} backend exited with code ${output.exitCode}${stderr ? `: ${stderr}` : ""}`);
  }

  try {
    return parseBackendJson(output.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${input.backend} backend ${message}`);
  }
}
