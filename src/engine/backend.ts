export type AgentBackend = "claude" | "codex";

export type BackendCommandRunnerInput = {
  cmd: string[];
  cwd: string;
  stdin?: string;
  /** Aborting kills the spawned agent process. */
  signal?: AbortSignal;
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

    return {
      cmd: ["claude", "-p", "--model", model ?? "sonnet", ...permissionArgs],
      stdin: prompt
    };
  }

  const sandbox = options.write ? "workspace-write" : "read-only";

  // No default codex model: an explicit --model for a model the account lacks
  // fails silently, while omitting the flag uses the account's default.
  // No approval flag: `codex exec` is non-interactive and rejects `-a`.
  return {
    cmd: ["codex", "exec", ...(model ? ["--model", model] : []), "-s", sandbox, prompt],
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

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("")
  ]);

  input.signal?.removeEventListener("abort", onAbort);

  return { exitCode, stdout, stderr };
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
}): Promise<unknown> {
  const command = backendCommand(input.backend, input.model, input.prompt);

  const output = await input.runner({
    cmd: command.cmd,
    cwd: input.targetDir,
    stdin: command.stdin
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
