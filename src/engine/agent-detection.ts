import {
  backendRedactValues,
  defaultBackendRunner,
  directBackendEnvironment,
  type AgentBackend,
  type BackendCommandRunner,
  type BackendCommandRunnerOutput
} from "./backend";

/**
 * Startup detection for the two supported agent CLIs. Everything here is
 * local: a PATH lookup, `<cli> --version`, and the CLI's own auth-status
 * subcommand (`claude auth status`, `codex login status`), each bounded by a
 * short timeout. Both status subcommands read local credential state; the
 * timeout is insurance, not a network budget. Any probe that fails, times
 * out, or prints something unrecognized degrades to "unknown" rather than
 * fabricating a state, and startup never blocks on it.
 */

export type AgentAuthState = "signed-in" | "not-signed-in" | "unknown";

export type AgentDetection = {
  installed: boolean;
  /** Parsed from `<cli> --version`; undefined when the probe failed. */
  version?: string;
  /** Always "unknown" when not installed. */
  auth: AgentAuthState;
};

export type AgentDetectionInventory = Record<AgentBackend, AgentDetection>;

export type AgentDetectionDeps = {
  which: (bin: string) => string | null;
  runner: BackendCommandRunner;
  timeoutMs: number;
};

/** Local subprocesses only; generous enough for a cold CLI start. */
export const agentProbeTimeoutMs = 4000;

const authProbeCommands: Record<AgentBackend, string[]> = {
  claude: ["claude", "auth", "status"],
  codex: ["codex", "login", "status"]
};

const versionPattern = /\d+\.\d+(?:\.[0-9A-Za-z.-]+)?/;

const signedOutPhrases = ["not logged in", "not signed in", "logged out", '"loggedin": false', '"loggedin":false'];

export function parseAgentVersion(stdout: string): string | undefined {
  return stdout.match(versionPattern)?.[0];
}

/**
 * Exit 0 means the CLI itself says the account is usable; a recognizable
 * signed-out phrase beats the exit code (claude prints JSON with a loggedIn
 * field). A nonzero exit without a recognizable phrase (unknown subcommand,
 * usage text, crash) is "unknown" so we never claim "not signed in" on the
 * strength of a probe failure.
 */
export function classifyAuthProbe(output: BackendCommandRunnerOutput | undefined): AgentAuthState {
  if (!output) return "unknown";
  const text = `${output.stdout}\n${output.stderr}`.toLowerCase();
  const saysSignedOut = signedOutPhrases.some((phrase) => text.includes(phrase));
  if (saysSignedOut) return "not-signed-in";
  return output.exitCode === 0 ? "signed-in" : "unknown";
}

/**
 * One bounded local CLI probe: scrubbed environment, abort on timeout, and
 * undefined instead of an error for every failure mode. Shared with the
 * model-listing probes so every startup subprocess obeys the same budget.
 */
export async function runAgentProbe(
  backend: AgentBackend,
  cmd: string[],
  deps: Pick<AgentDetectionDeps, "runner" | "timeoutMs">
): Promise<BackendCommandRunnerOutput | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  // The race resolves undefined on timeout even for runners that ignore the
  // abort signal, so a hung CLI can only cost timeoutMs, never block startup.
  const timedOut = new Promise<undefined>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(undefined), { once: true });
  });

  try {
    return await Promise.race([
      deps.runner({
        cmd,
        cwd: process.cwd(),
        signal: controller.signal,
        env: directBackendEnvironment(backend),
        redactValues: backendRedactValues(backend)
      }),
      timedOut
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function detectAgent(backend: AgentBackend, deps: Partial<AgentDetectionDeps> = {}): Promise<AgentDetection> {
  const which = deps.which ?? ((bin: string) => Bun.which(bin));
  if (!which(backend)) {
    return { installed: false, auth: "unknown" };
  }

  const probeDeps = { runner: deps.runner ?? defaultBackendRunner, timeoutMs: deps.timeoutMs ?? agentProbeTimeoutMs };
  const [versionOutput, authOutput] = await Promise.all([
    runAgentProbe(backend, [backend, "--version"], probeDeps),
    runAgentProbe(backend, authProbeCommands[backend], probeDeps)
  ]);

  const version = versionOutput && versionOutput.exitCode === 0 ? parseAgentVersion(versionOutput.stdout) : undefined;
  return {
    installed: true,
    ...(version !== undefined ? { version } : {}),
    auth: classifyAuthProbe(authOutput)
  };
}

export async function detectAgents(deps: Partial<AgentDetectionDeps> = {}): Promise<AgentDetectionInventory> {
  const [claude, codex] = await Promise.all([detectAgent("claude", deps), detectAgent("codex", deps)]);
  return { claude, codex };
}
