import { resolve } from "node:path";
import type { DoctorProblem } from "./doctor";
import { listClaudeSessions } from "./advice-session-claude";
import { scanCodexSessions } from "./learn-signals-codex";
import { SignalCollector } from "./learn-signals";

/**
 * Optional independent cross-check of farrier's per-directory session discovery
 * against sxr (session x-ray, the user's own CLI). sxr reads the same Claude
 * and Codex session files with its OWN parsers, so two independent readers
 * disagreeing is the cheapest drift detector we have: farrier's session miners
 * have gone silently blind before (the Codex Desktop 0.145 rollout format made
 * the miner extract zero events with no error). The independence is the point,
 * so nothing here reuses farrier's parsers to compute the sxr side.
 *
 * sxr is OPTIONAL forever. Absent binary → the check is skipped in silence.
 * Every failure mode (missing binary, subprocess error, timeout, usage error,
 * unparseable output) fails open to an informational note; it is never a
 * doctor failure and never throws.
 */

export type SessionProvider = "claude" | "codex";

/**
 * Farrier's own per-directory session counts, computed with farrier's parsers.
 * `codex` is codexSessionsMatched (rollout files whose recorded cwd resolved to
 * the project); `codexScanned` is codexSessionsScanned (byte-match superset,
 * capped) and is carried only to explain a divergence in the message.
 */
export type FarrierSessionCounts = {
  claude: number;
  codex: number;
  codexScanned?: number;
  /** True when farrier's codex scan hit its cap: an undercount is the cap, not drift. */
  codexScanCapHit?: boolean;
};

export type SxrExecInput = {
  sxrPath: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  /** Child environment; undefined inherits the parent process environment. */
  env?: Record<string, string | undefined>;
};

export type SxrExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type SxrExec = (input: SxrExecInput) => Promise<SxrExecResult>;

export type ProviderComparisonStatus = "match" | "divergent" | "blind-spot" | "unavailable";

export type ProviderComparison = {
  provider: SessionProvider;
  farrier: number;
  /** null when the sxr side could not be established (fail-open). */
  sxr: number | null;
  status: ProviderComparisonStatus;
};

export type SxrCrosscheckOutcome = {
  /** false only when sxr is not installed (silent skip). */
  ran: boolean;
  comparisons: ProviderComparison[];
  notes: string[];
  warnings: Array<{ provider: SessionProvider; message: string; remediation: string }>;
};

/** ~5s per invocation, per the brief; sxr listing a directory is near-instant. */
const defaultTimeoutMs = 5_000;

/**
 * Count-only codex scan cap for the cross-check, higher than the miner's own
 * bound. sxr counts every session for the cwd, so to compare apples-to-apples
 * farrier must scan deeply enough that its own cap is rarely the reason for a
 * gap — otherwise the cross-check false-alarms on its own truncation (this
 * repo: 527 byte-matching rollouts, of which 131 match; a 200-cap saw 1). This
 * trades a slower doctor run for an honest count; when even this cap is hit,
 * compareProvider names the cap rather than a reader blind spot.
 */
const codexCrosscheckScanCap = 5_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveSxrPath(env?: Record<string, string | undefined>): string | undefined {
  const PATH = env?.PATH ?? process.env.PATH ?? "";
  return Bun.which("sxr", { PATH }) ?? undefined;
}

function mergedChildEnv(overrides?: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...overrides })) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export const defaultSxrExec: SxrExec = async ({ sxrPath, args, cwd, timeoutMs, env }) => {
  const proc = Bun.spawn({
    cmd: [sxrPath, ...args],
    cwd,
    env: mergedChildEnv(env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * sxr `list` emits tab-separated rows on stdout, each session row led by an
 * `@N` handle, above one or two `#` comment lines (a notice and the column
 * header). An empty directory prints a plain `no sessions found for ...` line
 * at exit 0 with no `#` header and no `@` rows. So the session count is the
 * number of `@`-led rows; zero rows with the empty sentinel or a lone header
 * is a legitimate zero, while zero rows with unexpected content is drift on
 * sxr's side and fails open.
 */
function parseSxrListStdout(stdout: string): { count: number } | { unparseable: true } {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const rows = lines.filter((line) => line.startsWith("@"));
  if (rows.length > 0) {
    return { count: rows.length };
  }
  const hasHeader = lines.some((line) => line.startsWith("#"));
  const emptySentinel = lines.some((line) => /^no sessions found\b/i.test(line));
  if (lines.length === 0 || hasHeader || emptySentinel) {
    return { count: 0 };
  }
  return { unparseable: true };
}

/** Test hook for the pure stdout parser; not used in production paths. */
export const parseSxrListStdoutForTest = parseSxrListStdout;

type SxrListResult = { ok: true; count: number } | { ok: false; reason: string };

async function sxrListCount(input: {
  provider: SessionProvider;
  sxrPath: string;
  targetDir: string;
  exec: SxrExec;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
}): Promise<SxrListResult> {
  const args = [
    ...(input.provider === "codex" ? ["--codex"] : []),
    "--path",
    input.targetDir,
    "-n",
    "0",
    "list",
  ];

  let result: SxrExecResult;
  try {
    result = await input.exec({
      sxrPath: input.sxrPath,
      args,
      cwd: input.targetDir,
      timeoutMs: input.timeoutMs,
      ...(input.env ? { env: input.env } : {}),
    });
  } catch (error) {
    return { ok: false, reason: `sxr invocation failed (${errorMessage(error)})` };
  }

  if (result.timedOut) {
    return { ok: false, reason: `sxr did not respond within ${input.timeoutMs}ms` };
  }
  // Exit 2 is a usage or bad-id error; anything other than a clean content (0)
  // or empty-result (1) exit is unexpected. Both fail open.
  if (result.exitCode === 2) {
    return { ok: false, reason: "sxr reported a usage error (exit 2)" };
  }
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return { ok: false, reason: `sxr exited with code ${result.exitCode ?? "null"}` };
  }
  // Exit 1 is the documented empty result: a valid zero.
  if (result.exitCode === 1) {
    return { ok: true, count: 0 };
  }
  // Exit 0: count the `@`-led rows. An empty directory legitimately reports
  // zero here; output that matches none of sxr's documented shapes fails open.
  const parsed = parseSxrListStdout(result.stdout);
  if ("unparseable" in parsed) {
    return { ok: false, reason: "sxr returned success but output did not match the documented list shape" };
  }
  return { ok: true, count: parsed.count };
}

function compareProvider(
  provider: SessionProvider,
  farrier: number,
  sxr: SxrListResult,
  codexScanned: number | undefined,
  capHit: boolean,
): { comparison: ProviderComparison; note?: string; warning?: { provider: SessionProvider; message: string; remediation: string } } {
  const label = provider === "codex" ? "Codex" : "Claude";

  if (!sxr.ok) {
    return {
      comparison: { provider, farrier, sxr: null, status: "unavailable" },
      note: `sxr ${label} session cross-check skipped: ${sxr.reason}.`,
    };
  }

  if (farrier === sxr.count) {
    return {
      comparison: { provider, farrier, sxr: sxr.count, status: "match" },
      note: `sxr ${label} session cross-check: farrier and sxr agree on ${farrier} session(s).`,
    };
  }

  // Cap-induced undercount: farrier stopped at its scan cap, so the gap is
  // the cap, not a reader blind spot. Name it plainly instead of raising the
  // drift alarm — the reader converges with sxr at a high enough cap.
  if (provider === "codex" && capHit && farrier < sxr.count) {
    const scanned = codexScanned ?? farrier;
    return {
      comparison: { provider, farrier, sxr: sxr.count, status: "divergent" },
      warning: {
        provider,
        message:
          `sxr Codex session cross-check diverges: farrier ${farrier} of ${scanned} scanned, sxr ${sxr.count}. ` +
          `This is most likely farrier's scan cap, not a reader blind spot — farrier stopped after ${scanned} ` +
          `byte-matching rollout files in the shared codex directory, so older sessions for this project went uncounted.`,
        remediation:
          `Raise farrier's codex scan cap (or narrow the scope) if a complete count matters; the reader itself ` +
          `converges with 'sxr --codex list' for this directory once the cap is high enough.`,
      },
    };
  }

  // The killer case: farrier's reader is blind to sessions sxr can plainly see.
  if (farrier === 0 && sxr.count > 0) {
    return {
      comparison: { provider, farrier, sxr: sxr.count, status: "blind-spot" },
      warning: {
        provider,
        message:
          `SESSION READER BLIND SPOT: farrier discovered 0 ${label} session(s) for this directory, ` +
          `but sxr independently found ${sxr.count}. Farrier's ${label} session parser is seeing nothing ` +
          `where an independent reader sees ${sxr.count} — the silent parser/format drift class.`,
        remediation:
          `Inspect farrier's ${label} session reader against the on-disk format; ` +
          `compare with 'sxr ${provider === "codex" ? "--codex " : ""}list' for this directory.`,
      },
    };
  }

  const codexContext =
    provider === "codex" && codexScanned !== undefined && codexScanned !== farrier
      ? ` (farrier matched ${farrier} of ${codexScanned} scanned rollout file(s))`
      : "";
  return {
    comparison: { provider, farrier, sxr: sxr.count, status: "divergent" },
    warning: {
      provider,
      message:
        `sxr ${label} session cross-check diverges: farrier ${farrier}${codexContext}, sxr ${sxr.count}. ` +
        `Some divergence is normal (the tools filter sessions differently); a large gap suggests a reader drift.`,
      remediation:
        `Compare farrier's ${label} session discovery with 'sxr ${provider === "codex" ? "--codex " : ""}list' ` +
        `for this directory to confirm whether the gap is benign.`,
    },
  };
}

/**
 * Core comparison. Takes farrier's already-computed counts and an sxr locator,
 * runs sxr independently per provider, and reports matches, divergences, and
 * the blind-spot case. Pure of farrier's session parsers on the sxr side.
 */
export async function crosscheckSessionCounts(input: {
  targetDir: string;
  farrier: FarrierSessionCounts;
  sxrPath?: string;
  env?: Record<string, string | undefined>;
  exec?: SxrExec;
  timeoutMs?: number;
}): Promise<SxrCrosscheckOutcome> {
  const sxrPath = input.sxrPath ?? resolveSxrPath(input.env);
  if (!sxrPath) {
    return { ran: false, comparisons: [], notes: [], warnings: [] };
  }

  const exec = input.exec ?? defaultSxrExec;
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  const targetDir = resolve(input.targetDir);

  const providers: Array<{ provider: SessionProvider; farrier: number }> = [
    { provider: "claude", farrier: input.farrier.claude },
    { provider: "codex", farrier: input.farrier.codex },
  ];

  const notes: string[] = [];
  const warnings: SxrCrosscheckOutcome["warnings"] = [];
  const comparisons: ProviderComparison[] = [];

  for (const { provider, farrier } of providers) {
    const sxr = await sxrListCount({
      provider,
      sxrPath,
      targetDir,
      exec,
      timeoutMs,
      ...(input.env ? { env: input.env } : {}),
    });
    const outcome = compareProvider(provider, farrier, sxr, input.farrier.codexScanned, input.farrier.codexScanCapHit ?? false);
    comparisons.push(outcome.comparison);
    if (outcome.note) notes.push(outcome.note);
    if (outcome.warning) warnings.push(outcome.warning);
  }

  return { ran: true, comparisons, notes, warnings };
}

/**
 * Farrier's own per-directory session counts, each read-only and fail-open:
 * a missing session directory yields zero, never a throw. Claude uses the raw
 * discovered transcript-file count (closest to sxr's one-row-per-file listing);
 * Codex uses the rollout reader that carries the documented drift history.
 */
export async function resolveFarrierSessionCounts(input: {
  targetDir: string;
  claudeTranscriptsDir?: string;
  codexSessionsDir?: string;
}): Promise<FarrierSessionCounts> {
  let claude = 0;
  try {
    const index = await listClaudeSessions({
      targetDir: input.targetDir,
      lookback: "all",
      now: Date.now(),
      ...(input.claudeTranscriptsDir ? { transcriptsDir: input.claudeTranscriptsDir } : {}),
    });
    claude = index.discovered;
  } catch {
    // listClaudeSessions already fails open on missing dirs; guard the rest.
  }

  let codex = 0;
  let codexScanned = 0;
  let codexScanCapHit = false;
  try {
    // Count-only: a higher cap than the miner's so the comparison with sxr is
    // apples-to-apples and does not false-alarm on farrier's own truncation.
    const scan = await scanCodexSessions({
      projectDir: input.targetDir,
      collector: new SignalCollector(),
      maxFiles: codexCrosscheckScanCap,
      ...(input.codexSessionsDir ? { sessionsDir: input.codexSessionsDir } : {}),
    });
    codex = scan.filesMatched;
    codexScanned = scan.filesScanned;
    codexScanCapHit = scan.truncated;
  } catch {
    // Same fail-open contract for the Codex rollout reader.
  }

  return { claude, codex, codexScanned, codexScanCapHit };
}

/**
 * Doctor-facing adapter: resolve sxr first (so the possibly-slow farrier scan
 * only runs when sxr is present), compute farrier's counts, cross-check, and
 * map warnings to `sessions`-group DoctorProblem warnings. Warnings never flip
 * doctor health (only errors do); notes carry matches and fail-open skips.
 */
export async function sxrSessionCrosscheck(input: {
  targetDir: string;
  claudeTranscriptsDir?: string;
  codexSessionsDir?: string;
  sxrPath?: string;
  env?: Record<string, string | undefined>;
  exec?: SxrExec;
  timeoutMs?: number;
  farrierCounts?: FarrierSessionCounts;
}): Promise<{ problems: DoctorProblem[]; notes: string[] }> {
  const sxrPath = input.sxrPath ?? resolveSxrPath(input.env);
  if (!sxrPath) {
    // Optional tooling: absent binary is a silent skip, not even a note.
    return { problems: [], notes: [] };
  }

  let farrier: FarrierSessionCounts;
  try {
    farrier =
      input.farrierCounts ??
      (await resolveFarrierSessionCounts({
        targetDir: input.targetDir,
        ...(input.claudeTranscriptsDir ? { claudeTranscriptsDir: input.claudeTranscriptsDir } : {}),
        ...(input.codexSessionsDir ? { codexSessionsDir: input.codexSessionsDir } : {}),
      }));
  } catch (error) {
    return {
      problems: [],
      notes: [`sxr session cross-check skipped: farrier session discovery failed (${errorMessage(error)}).`],
    };
  }

  let outcome: SxrCrosscheckOutcome;
  try {
    outcome = await crosscheckSessionCounts({
      targetDir: input.targetDir,
      farrier,
      sxrPath,
      ...(input.env ? { env: input.env } : {}),
      ...(input.exec ? { exec: input.exec } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    });
  } catch (error) {
    return { problems: [], notes: [`sxr session cross-check skipped after an unexpected error (${errorMessage(error)}).`] };
  }

  const problems: DoctorProblem[] = outcome.warnings.map((warning) => ({
    group: "sessions",
    severity: "warning",
    id: `sxr-crosscheck:${warning.provider}`,
    message: warning.message,
    remediation: warning.remediation,
  }));

  return { problems, notes: outcome.notes };
}
