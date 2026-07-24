import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type IsolationMode = "native-confinement" | "staged-best-effort";

export type IsolationFact = {
  mode: IsolationMode;
  residualRisk: string | null;
};

export type IsolatedExecutionContext = {
  workspace: string;
  environment: Record<string, string>;
  redactValues: readonly string[];
  signal: AbortSignal;
  isolation: IsolationFact;
};

export type IsolatedInput = { source: string; path: string };

/** Fallback timeout when a call site passes no explicit `timeoutMs`. */
export const defaultIsolatedTimeoutMs = 120_000;

/**
 * A single LLM authoring/refinement pass in an isolated workspace. Real codex /
 * claude skill authoring and refinement routinely run several minutes, well
 * past the 120s fallback, so authoring call sites must opt into this budget.
 */
export const isolatedAuthoringTimeoutMs = 600_000;

/**
 * A blind skill evaluation, which runs two judge passes concurrently in one
 * isolated workspace; it needs more headroom than a single authoring pass.
 */
export const isolatedEvalTimeoutMs = 900_000;

/** Stable prefix of the timeout error message; part of the TUI detection contract. */
export const executionTimeoutMessagePrefix = "external execution timed out after";

/** Thrown when {@link withIsolatedExecution} aborts a run because its timeout elapsed. */
export class ExecutionTimeoutError extends Error {
  readonly isExecutionTimeout = true;
  constructor(readonly timeoutMs: number) {
    super(`${executionTimeoutMessagePrefix} ${timeoutMs}ms`);
    this.name = "ExecutionTimeoutError";
  }
}

/**
 * True when a value is (or stringifies to) an isolated-execution timeout.
 * Accepts the thrown Error, its `.message`, or a plain string, because the
 * batch flow keeps only `error.message` on failed items. The message prefix is
 * a stable contract callers may rely on.
 */
export function isExecutionTimeout(value: unknown): boolean {
  if (value instanceof ExecutionTimeoutError) return true;
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  return message.includes(executionTimeoutMessagePrefix);
}

const environmentAllowlist = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "SHELL", "USER", "SSL_CERT_FILE", "SSL_CERT_DIR"] as const;

function scrubbedEnvironment(
  workspace: string,
  passthrough: readonly string[],
  overrides: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: join(workspace, "home"),
    TMPDIR: join(workspace, "tmp"),
  };
  for (const name of [...environmentAllowlist, ...passthrough]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value) environment[name] = value;
  }
  return environment;
}

function passthroughRedactValues(
  names: readonly string[],
  environment: Readonly<Record<string, string | undefined>>
): string[] {
  return Array.from(new Set(names
    .map((name) => environment[name])
    .filter((value): value is string => Boolean(value))));
}

async function copyRegular(source: string, destination: string): Promise<void> {
  const stats = await lstat(source);
  if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) throw new Error(`Isolation input is not a regular file or tree: ${source}`);
  if (stats.isFile()) {
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, await readFile(source));
    return;
  }
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) await copyRegular(join(source, entry.name), join(destination, entry.name));
}

async function targetDigest(root: string, ignoredTopLevel = new Set<string>()): Promise<string> {
  const digest = createHash("sha256");
  const walk = async (path: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!prefix && ignoredTopLevel.has(entry.name)) continue;
      const child = join(path, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stats = await lstat(child, { bigint: true });
      digest.update(`${relative}\0${stats.dev.toString()}\0${stats.ino.toString()}\0${stats.mode.toString()}\0${stats.size.toString()}\0${stats.mtimeNs.toString()}\0${stats.ctimeNs.toString()}\0`);
      if (stats.isSymbolicLink()) digest.update(await readlink(child));
      else if (stats.isDirectory()) await walk(child, relative);
    }
  };
  await walk(root, "");
  return digest.digest("hex");
}

function combinedAbort(parent: AbortSignal | undefined, timeoutMs: number): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new Error("cancelled"));
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new ExecutionTimeoutError(timeoutMs)), timeoutMs);
  timer.unref?.();
  return {
    controller,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

const cancellationCleanupGraceMs = 1_000;
const retainedCancellationWorkspaces = new Set<string>();

async function settlesWithin<T>(execution: Promise<T>, graceMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), graceMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      execution.then(() => true, () => true),
      grace
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function targetUnchanged(targetDir: string, before: string): Promise<boolean> {
  try {
    return await targetDigest(targetDir) === before;
  } catch {
    return false;
  }
}

export async function withIsolatedExecution<T>(input: {
  targetDir: string;
  inputs?: IsolatedInput[];
  nativeConfinement: boolean;
  /** Caller-specific credential/config names copied from the ambient environment. */
  environmentPassthrough?: readonly string[];
  /** Caller-specific explicit config paths; values are never logged. */
  environmentOverrides?: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
  signal?: AbortSignal;
  retainWorkspace?: boolean;
  retainWorkspaceOnError?: boolean;
  readOnlyWorkspace?: boolean;
  /**
   * "reject" (default) fails the run when the target project's fingerprint
   * changed while the external process ran. "tolerate" skips that fence for
   * call sites whose run neither reads from nor stages writes into the target
   * AND whose target is expected to be concurrently edited (export classifies
   * evidence from projects with live agent sessions; their rollouts append
   * mid-run). The workspace fence always stays; the relaxation is recorded in
   * the returned isolation fact.
   */
  concurrentTargetWrites?: "reject" | "tolerate";
  run: (context: IsolatedExecutionContext) => Promise<T>;
}): Promise<{ value: T; isolation: IsolationFact }> {
  const workspace = await mkdtemp(join(tmpdir(), `farrier-exec-${process.pid}-${randomUUID().slice(0, 8)}-`));
  const fenceTarget = (input.concurrentTargetWrites ?? "reject") === "reject";
  const before = fenceTarget ? await targetDigest(input.targetDir) : "";
  const timeout = combinedAbort(input.signal, input.timeoutMs ?? defaultIsolatedTimeoutMs);
  const isolation: IsolationFact = input.nativeConfinement
    ? { mode: "native-confinement", residualRisk: null }
    : {
        mode: "staged-best-effort",
        residualRisk: fenceTarget
          ? "The installed CLI has no supported native write-root confinement; output was staged and the target fingerprint was verified, but the process retained OS-user access."
          : "The installed CLI has no supported native write-root confinement; the target fingerprint was NOT verified because the caller tolerates concurrent target writes (live agent sessions), so the process retained unverified OS-user access to the project.",
      };
  let succeeded = false;
  let deferredCleanup = false;
  try {
    await mkdir(join(workspace, "home"), { recursive: true });
    await mkdir(join(workspace, "tmp"), { recursive: true });
    for (const item of input.inputs ?? []) await copyRegular(item.source, join(workspace, item.path));
    const workspaceBefore = input.readOnlyWorkspace
      ? await targetDigest(workspace, new Set(["home", "tmp"]))
      : undefined;
    const passthrough = input.environmentPassthrough ?? [];
    if (timeout.controller.signal.aborted) {
      throw timeout.controller.signal.reason ?? new Error("external execution cancelled");
    }
    const environment = scrubbedEnvironment(
      workspace,
      passthrough,
      input.environmentOverrides ?? {},
    );
    const execution = Promise.resolve().then(() => input.run({
      workspace,
      environment,
      redactValues: passthroughRedactValues(passthrough, environment),
      signal: timeout.controller.signal,
      isolation
    }));
    const timed = new Promise<never>((_, reject) => {
      const rejectAbort = () => reject(timeout.controller.signal.reason ?? new Error("external execution cancelled"));
      timeout.controller.signal.addEventListener("abort", rejectAbort, { once: true });
      if (timeout.controller.signal.aborted) rejectAbort();
    });
    let value: T;
    try {
      value = await Promise.race([execution, timed]);
    } catch (error) {
      if (timeout.controller.signal.aborted && !(await settlesWithin(execution, cancellationCleanupGraceMs))) {
        deferredCleanup = true;
        retainedCancellationWorkspaces.add(workspace);
        const removeWhenSettled = !input.retainWorkspace || !input.retainWorkspaceOnError;
        const finishDeferredCleanup = async () => {
          try {
            await targetUnchanged(input.targetDir, before);
          } finally {
            retainedCancellationWorkspaces.delete(workspace);
            if (removeWhenSettled) {
              await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
            }
          }
        };
        void execution.then(finishDeferredCleanup, finishDeferredCleanup);
        throw new Error(
          `External execution did not settle within ${cancellationCleanupGraceMs}ms after cancellation; target integrity could not be confirmed and the isolated workspace was retained until process cleanup completes.`
        );
      }
      throw error;
    }
    if (workspaceBefore && await targetDigest(workspace, new Set(["home", "tmp"])) !== workspaceBefore) {
      throw new Error("External process changed read-only staged inputs or produced unexpected output.");
    }
    if (fenceTarget && !(await targetUnchanged(input.targetDir, before))) {
      throw new Error("External process changed the target project or prevented integrity verification; staged output was rejected and the project must be reviewed for unaccepted writes.");
    }
    succeeded = true;
    return { value, isolation };
  } catch (error) {
    if (fenceTarget && !deferredCleanup && !(await targetUnchanged(input.targetDir, before))) {
      // Keep the underlying failure visible: masking it behind the integrity
      // message alone makes a plain backend error undiagnosable, and on a
      // repo with live agent sessions the drift is usually not the real story.
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `External execution failed and changed the target project (or its integrity could not be verified) while it ran; review the project for unaccepted writes. Underlying failure: ${message}`,
        { cause: error }
      );
    }
    throw error;
  } finally {
    timeout.dispose();
    if (!deferredCleanup && (!input.retainWorkspace || (!succeeded && !input.retainWorkspaceOnError))) {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
