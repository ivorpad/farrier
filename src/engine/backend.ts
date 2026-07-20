import { homedir } from "node:os";
import { join } from "node:path";
import type { ReasoningEffort } from "../config/farrier-config";
import { backendProviderBudgetArgs } from "./backend-provider-budget";
import { parseBackendEventResult, type BackendTokenUsage } from "./backend-json-events";
import {
  boundedBackendDiagnostic,
  captureBackendStream,
  createProcessGroupTerminator,
  emptyBackendCapture,
  resolveBackendOutputLimits,
  type BackendOutputLimits,
  type BackendStreamCapture
} from "./backend-process";
export type { BackendOutputLimits, BackendStreamCapture } from "./backend-process";
export type AgentBackend = "claude" | "codex";
const backendSafeEnvironmentNames = [
  "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "SHELL", "USER",
  "SSL_CERT_FILE", "SSL_CERT_DIR"
] as const;

const backendEnvironmentNames: Record<AgentBackend, readonly string[]> = {
  codex: ["OPENAI_API_KEY", "CODEX_HOME"],
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]
};

/** Explicit authentication/config passthrough for an isolated backend process. */
export function backendEnvironmentPassthrough(backend: AgentBackend): readonly string[] {
  return backendEnvironmentNames[backend];
}

/** Preserve standard login config while honoring explicit backend config paths. */
export function backendEnvironmentOverrides(
  backend: AgentBackend,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  home = homedir()
): Readonly<Record<string, string>> {
  if (backend === "codex") {
    return { CODEX_HOME: environment.CODEX_HOME ?? join(home, ".codex") };
  }
  // On macOS, Claude subscription credentials live in Keychain. Synthesizing
  // CLAUDE_CONFIG_DIR changes Claude's credential/account lookup even when the
  // path is ~/.claude, so retain the normal HOME unless the user set the
  // config directory themselves.
  return environment.CLAUDE_CONFIG_DIR
    ? { CLAUDE_CONFIG_DIR: environment.CLAUDE_CONFIG_DIR }
    : { HOME: home };
}

function directBackendEnvironment(backend: AgentBackend): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of [...backendSafeEnvironmentNames, ...backendEnvironmentNames[backend]]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return { ...environment, ...backendEnvironmentOverrides(backend) };
}

export type BackendCommandRunnerInput = {
  cmd: string[];
  cwd: string;
  stdin?: string;
  /** Aborting kills the spawned agent process. */
  signal?: AbortSignal;
  /** Called with each bounded, scrubbed stdout line as it arrives. */
  onStdoutLine?: (line: string) => void;
  /** Explicit scrubbed environment for isolated external execution. */
  env?: Record<string, string>;
  outputLimits?: BackendOutputLimits;
  /** Exact sensitive values removed before pattern-based redaction. */
  redactValues?: readonly string[];
};

export type BackendCommandRunnerOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
  capture?: {
    stdout: BackendStreamCapture;
    stderr: BackendStreamCapture;
  };
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

export async function probeAgent(backend: AgentBackend, runner: BackendCommandRunner = defaultBackendRunner): Promise<boolean> {
  try {
    const output = await runner({
      cmd: [backend, "--version"],
      cwd: process.cwd(),
      env: directBackendEnvironment(backend),
      redactValues: backendRedactValues(backend)
    });
    return output.exitCode === 0;
  } catch {
    return false;
  }
}

export async function probeAgents(runner: BackendCommandRunner = defaultBackendRunner): Promise<AgentAvailability> {
  const [claude, codex] = await Promise.all([probeAgent("claude", runner), probeAgent("codex", runner)]);
  return { claude, codex };
}

export type BackendCommandOptions = {
  write?: boolean;
  /** Avoid recording an internal helper run as a project session. */
  ephemeral?: boolean;
  /**
   * Emit machine-readable per-event stdout (claude stream-json NDJSON, codex
   * --json JSONL) so callers can surface live activity. The final answer is no
   * longer plain text on stdout, so this is for runs whose result is read from
   * the filesystem, not parsed from stdout.
   */
  stream?: boolean;
  /** codex-only reasoning effort; ignored by the claude branch. */
  reasoningEffort?: ReasoningEffort;
  /** Claude print-mode spend ceiling applied to this single backend process. */
  maxBudgetUsd?: number;
};

export function backendCommand(
  backend: AgentBackend,
  model: string | undefined,
  prompt: string,
  options: BackendCommandOptions = {}
): { cmd: string[]; stdin?: string } {
  const budgetArgs = backendProviderBudgetArgs(backend, options.maxBudgetUsd);
  if (backend === "claude") {
    const permissionArgs = options.write
      ? ["--permission-mode", "acceptEdits", "--allowedTools", "Write", "Edit", "Bash"]
      : [];
    // stream-json in -p mode requires --verbose.
    const streamArgs = options.stream ? ["--output-format", "stream-json", "--verbose"] : [];
    const ephemeralArgs = options.ephemeral ? ["--no-session-persistence"] : [];
    return {
      cmd: [
        "claude", "-p", "--model", model ?? "sonnet",
        ...ephemeralArgs, ...budgetArgs, ...permissionArgs, ...streamArgs,
      ],
      stdin: prompt
    };
  }

  const sandbox = options.write ? "workspace-write" : "read-only";
  const streamArgs = options.stream ? ["--json"] : [];
  const effortArgs = options.reasoningEffort ? ["-c", `model_reasoning_effort=${options.reasoningEffort}`] : [];
  const ephemeralArgs = options.ephemeral ? ["--ephemeral"] : [];
  const repositoryArgs = options.write ? [] : ["--skip-git-repo-check"];

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
      ...ephemeralArgs,
      ...repositoryArgs,
      ...streamArgs,
      ...(model ? ["--model", model] : []),
      "-s",
      sandbox,
      "-c",
      "skills.include_instructions=false",
      ...effortArgs,
      prompt
    ],
    stdin: undefined
  };
}

export async function defaultBackendRunner(input: BackendCommandRunnerInput): Promise<BackendCommandRunnerOutput> {
  const limits = resolveBackendOutputLimits(input.outputLimits);
  const redactValues = input.redactValues ?? [];
  if (input.signal?.aborted) {
    const empty = emptyBackendCapture();
    return {
      exitCode: 130,
      stdout: "",
      stderr: "cancelled before start",
      capture: { stdout: empty, stderr: { ...empty } }
    };
  }

  const proc = Bun.spawn({
    cmd: input.cmd,
    cwd: input.cwd,
    stdin: input.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // Agent CLIs may spawn shells and helpers. A dedicated process group lets
    // cancellation terminate the complete run instead of only its root PID.
    detached: true,
    env: input.env
  });

  const terminator = createProcessGroupTerminator(proc.pid, () => proc.kill());
  const onAbort = () => terminator.terminate();
  input.signal?.addEventListener("abort", onAbort, { once: true });
  if (input.signal?.aborted) onAbort();

  if (input.stdin !== undefined) {
    const stdin = proc.stdin as unknown as { write(data: string): unknown; end(): unknown } | undefined;
    stdin?.write(input.stdin);
    stdin?.end();
  }

  const exited = proc.exited.finally(terminator.rootExited);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      exited,
      captureBackendStream({
        stream: proc.stdout,
        retainBytes: limits.stdoutBytes,
        retain: "head",
        lineBytes: limits.lineBytes,
        onLine: input.onStdoutLine,
        redactValues
      }),
      captureBackendStream({
        stream: proc.stderr,
        retainBytes: limits.stderrBytes,
        retain: "tail",
        lineBytes: limits.lineBytes,
        redactValues
      })
    ]);

    if (input.signal?.aborted) await terminator.wait();
    return {
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      capture: { stdout: stdout.capture, stderr: stderr.capture }
    };
  } finally {
    terminator.dispose();
    input.signal?.removeEventListener("abort", onAbort);
  }
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

export function backendRedactValues(
  backend: AgentBackend,
  environment: Readonly<Record<string, string | undefined>> = process.env
): string[] {
  return Array.from(new Set(backendEnvironmentNames[backend]
    .map((name) => environment[name])
    .filter((value): value is string => Boolean(value))));
}

function captureSummary(capture: BackendStreamCapture | undefined): string {
  if (!capture) return "";
  return `received ${capture.byteCount} bytes; sha256 ${capture.sha256}${capture.truncated ? "; truncated" : ""}`;
}

export function backendFailureMessage(input: {
  backend: AgentBackend;
  exitCode: number;
  output: BackendCommandRunnerOutput;
  redactValues?: readonly string[];
  outputLimits?: BackendOutputLimits;
}): string {
  const limits = resolveBackendOutputLimits(input.outputLimits);
  const values = Array.from(new Set([...backendRedactValues(input.backend), ...(input.redactValues ?? [])]));
  const stderr = boundedBackendDiagnostic(input.output.stderr, values, limits.diagnosticTailBytes);
  const stdout = stderr
    ? ""
    : boundedBackendDiagnostic(input.output.stdout, values, limits.diagnosticTailBytes);
  const detail = stderr || (stdout ? `stdout: ${stdout}` : "");
  const capture = stderr ? input.output.capture?.stderr : input.output.capture?.stdout;
  const summary = captureSummary(capture);
  const diagnostic = [detail, summary ? `[${summary}]` : ""].filter(Boolean).join(" ");
  return `${input.backend} backend exited with code ${input.exitCode}${diagnostic ? `: ${diagnostic}` : ""}`;
}

export async function invokeBackend(input: {
  backend: AgentBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  prompt: string;
  targetDir: string;
  runner: BackendCommandRunner;
  signal?: AbortSignal;
  ephemeral?: boolean;
  env?: Record<string, string>;
  outputLimits?: BackendOutputLimits;
  redactValues?: readonly string[];
  captureUsage?: boolean;
  onUsage?: (usage: BackendTokenUsage) => void;
  maxBudgetUsd?: number;
}): Promise<unknown> {
  const command = backendCommand(input.backend, input.model, input.prompt, {
    reasoningEffort: input.reasoningEffort,
    ephemeral: input.ephemeral,
    stream: input.captureUsage,
    maxBudgetUsd: input.maxBudgetUsd,
  });
  const outputLimits = resolveBackendOutputLimits(input.outputLimits);
  const environment = input.env ?? directBackendEnvironment(input.backend);
  const redactValues = Array.from(new Set([
    ...backendRedactValues(input.backend, environment),
    ...(input.redactValues ?? [])
  ]));

  const output = await input.runner({
    cmd: command.cmd,
    cwd: input.targetDir,
    stdin: command.stdin,
    signal: input.signal,
    env: environment,
    outputLimits,
    redactValues
  });

  if (output.exitCode !== 0) {
    throw new Error(backendFailureMessage({
      backend: input.backend,
      exitCode: output.exitCode,
      output,
      redactValues,
      outputLimits
    }));
  }

  if (output.capture?.stdout.truncated) {
    throw new Error(
      `${input.backend} backend stdout exceeded ${outputLimits.stdoutBytes} bytes (${captureSummary(output.capture.stdout)})`
    );
  }

  try {
    if (input.captureUsage) {
      const eventResult = parseBackendEventResult(input.backend, output.stdout);
      if (eventResult) {
        if (eventResult.usage) input.onUsage?.(eventResult.usage);
        return parseBackendJson(eventResult.text);
      }
    }
    return parseBackendJson(output.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${input.backend} backend ${message}`);
  }
}
