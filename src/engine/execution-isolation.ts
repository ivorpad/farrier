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
  signal: AbortSignal;
  isolation: IsolationFact;
};

export type IsolatedInput = { source: string; path: string };

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
  const timer = setTimeout(() => controller.abort(new Error(`external execution timed out after ${timeoutMs}ms`)), timeoutMs);
  timer.unref?.();
  return {
    controller,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
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
  run: (context: IsolatedExecutionContext) => Promise<T>;
}): Promise<{ value: T; isolation: IsolationFact }> {
  const workspace = await mkdtemp(join(tmpdir(), `farrier-exec-${process.pid}-${randomUUID().slice(0, 8)}-`));
  const before = await targetDigest(input.targetDir);
  const timeout = combinedAbort(input.signal, input.timeoutMs ?? 120_000);
  const isolation: IsolationFact = input.nativeConfinement
    ? { mode: "native-confinement", residualRisk: null }
    : {
        mode: "staged-best-effort",
        residualRisk: "The installed CLI has no supported native write-root confinement; output was staged and the target fingerprint was verified, but the process retained OS-user access.",
      };
  let succeeded = false;
  try {
    await mkdir(join(workspace, "home"), { recursive: true });
    await mkdir(join(workspace, "tmp"), { recursive: true });
    for (const item of input.inputs ?? []) await copyRegular(item.source, join(workspace, item.path));
    const workspaceBefore = input.readOnlyWorkspace
      ? await targetDigest(workspace, new Set(["home", "tmp"]))
      : undefined;
    const execution = input.run({
      workspace,
      environment: scrubbedEnvironment(
        workspace,
        input.environmentPassthrough ?? [],
        input.environmentOverrides ?? {},
      ),
      signal: timeout.controller.signal,
      isolation
    });
    const timed = new Promise<never>((_, reject) => {
      timeout.controller.signal.addEventListener("abort", () => reject(timeout.controller.signal.reason ?? new Error("external execution cancelled")), { once: true });
    });
    const value = await Promise.race([execution, timed]);
    if (workspaceBefore && await targetDigest(workspace, new Set(["home", "tmp"])) !== workspaceBefore) {
      throw new Error("External process changed read-only staged inputs or produced unexpected output.");
    }
    const after = await targetDigest(input.targetDir);
    if (after !== before) throw new Error("External process changed the target project; staged output was rejected and the project must be reviewed for unaccepted writes.");
    succeeded = true;
    return { value, isolation };
  } finally {
    timeout.dispose();
    if (!input.retainWorkspace || (!succeeded && !input.retainWorkspaceOnError)) {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
