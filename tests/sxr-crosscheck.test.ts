import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  crosscheckSessionCounts,
  parseSxrListStdoutForTest,
  sxrSessionCrosscheck,
  type FarrierSessionCounts,
} from "../src/engine/sxr-crosscheck";

/**
 * A configurable fake `sxr` on PATH. It reads a per-provider directive from
 * SXR_CLAUDE / SXR_CODEX (chosen by the presence of the --codex flag):
 *   rows:N     print a `#` notice, a `#` header, and N `@`-led rows, exit 0
 *   empty      print sxr's real "no sessions found" line, exit 0
 *   emptyexit1 print nothing, exit 1 (the documented empty result)
 *   usage      print to stderr, exit 2 (usage error)
 *   garbage    print unexpected content, exit 0 (drift on sxr's side)
 *   hang:S     exec sleep S (so a kill actually terminates it) — timeout probe
 */
const fakeSxrScript = `#!/bin/sh
spec="$SXR_CLAUDE"
for a in "$@"; do
  if [ "$a" = "--codex" ]; then spec="$SXR_CODEX"; fi
done
case "$spec" in
  hang:*)
    exec sleep "\${spec#hang:}"
    ;;
  rows:*)
    n="\${spec#rows:}"
    echo "# sxr: sessions recorded for a directory, newest first"
    printf '# @\\tid\\tstarted\\ttitle\\n'
    i=1
    while [ "$i" -le "$n" ]; do
      printf '@%s\\tid%s\\t2026-01-01T00:00:00Z\\ttitle %s\\n' "$i" "$i" "$i"
      i=$((i+1))
    done
    exit 0
    ;;
  empty)
    echo "no sessions found for a directory (checked ~/.claude/projects)"
    exit 0
    ;;
  emptyexit1)
    exit 1
    ;;
  usage)
    echo "Usage: sxr [OPTIONS] COMMAND [ARGS]..." 1>&2
    exit 2
    ;;
  garbage)
    echo "kaboom: unexpected output from a drifted sxr"
    exit 0
    ;;
  *)
    echo "no sessions found for a directory"
    exit 0
    ;;
esac
`;

async function withFakeSxr<T>(
  run: (env: { PATH: string }, targetDir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "farrier-sxr-crosscheck-"));
  try {
    const sxrPath = join(dir, "sxr");
    await writeFile(sxrPath, fakeSxrScript, "utf8");
    await chmod(sxrPath, 0o755);
    // The fake sxr comes first so Bun.which resolves it ahead of any real sxr;
    // the inherited PATH still supplies sh/sleep/printf for the script body.
    const env = { PATH: `${dir}:${process.env.PATH ?? ""}` };
    return await run(env, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function noSxrOnPath<T>(run: (env: { PATH: string }) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "farrier-sxr-absent-"));
  try {
    // A PATH that deliberately excludes any real sxr binary.
    return await run({ PATH: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function providerCounts(base: Partial<FarrierSessionCounts>): FarrierSessionCounts {
  return { claude: 0, codex: 0, ...base };
}

describe("parseSxrListStdout", () => {
  test("counts @-led rows, treats the empty sentinel as zero, flags garbage", () => {
    expect(parseSxrListStdoutForTest("# notice\n# @\tid\n@1\tx\n@2\ty\n")).toEqual({ count: 2 });
    expect(parseSxrListStdoutForTest("no sessions found for a directory\n")).toEqual({ count: 0 });
    expect(parseSxrListStdoutForTest("")).toEqual({ count: 0 });
    expect(parseSxrListStdoutForTest("kaboom garbage\n")).toEqual({ unparseable: true });
  });
});

describe("sxr session cross-check", () => {
  test("absent sxr binary skips silently: not run, no notes, no warnings", async () => {
    await noSxrOnPath(async (env) => {
      const outcome = await crosscheckSessionCounts({
        targetDir: "/anywhere",
        farrier: providerCounts({ claude: 5, codex: 3 }),
        env,
      });
      expect(outcome.ran).toBe(false);
      expect(outcome.notes).toEqual([]);
      expect(outcome.warnings).toEqual([]);
    });
  });

  test("matching counts produce a passing note per provider and no warnings", async () => {
    await withFakeSxr(async (env, dir) => {
      const outcome = await crosscheckSessionCounts({
        targetDir: dir,
        farrier: providerCounts({ claude: 3, codex: 2 }),
        env: { PATH: env.PATH, SXR_CLAUDE: "rows:3", SXR_CODEX: "rows:2" } as Record<string, string>,
      });
      expect(outcome.ran).toBe(true);
      expect(outcome.warnings).toEqual([]);
      expect(outcome.comparisons.map((c) => c.status)).toEqual(["match", "match"]);
      expect(outcome.notes.some((n) => /Claude.*agree on 3/.test(n))).toBe(true);
      expect(outcome.notes.some((n) => /Codex.*agree on 2/.test(n))).toBe(true);
    });
  });

  test("an empty directory (exit 0 sentinel) counts as a legitimate zero and matches", async () => {
    await withFakeSxr(async (env, dir) => {
      const outcome = await crosscheckSessionCounts({
        targetDir: dir,
        farrier: providerCounts({ claude: 0, codex: 0 }),
        env: { PATH: env.PATH, SXR_CLAUDE: "empty", SXR_CODEX: "emptyexit1" } as Record<string, string>,
      });
      expect(outcome.warnings).toEqual([]);
      expect(outcome.comparisons.every((c) => c.status === "match")).toBe(true);
      expect(outcome.comparisons.map((c) => c.sxr)).toEqual([0, 0]);
    });
  });

  test("divergent nonzero counts warn and name both counts (codex shows scanned context)", async () => {
    await withFakeSxr(async (env, dir) => {
      const outcome = await crosscheckSessionCounts({
        targetDir: dir,
        farrier: providerCounts({ claude: 3, codex: 2, codexScanned: 40 }),
        env: { PATH: env.PATH, SXR_CLAUDE: "rows:5", SXR_CODEX: "rows:9" } as Record<string, string>,
      });
      const claude = outcome.warnings.find((w) => w.provider === "claude");
      const codex = outcome.warnings.find((w) => w.provider === "codex");
      expect(claude?.message).toContain("farrier 3");
      expect(claude?.message).toContain("sxr 5");
      expect(codex?.message).toContain("farrier 2");
      expect(codex?.message).toContain("sxr 9");
      expect(codex?.message).toContain("2 of 40 scanned");
      expect(outcome.comparisons.map((c) => c.status)).toEqual(["divergent", "divergent"]);
    });
  });

  test("a cap-induced codex undercount is named as the scan cap, not a reader blind spot", async () => {
    await withFakeSxr(async (env, dir) => {
      const outcome = await crosscheckSessionCounts({
        targetDir: dir,
        farrier: providerCounts({ claude: 3, codex: 1, codexScanned: 5000, codexScanCapHit: true }),
        env: { PATH: env.PATH, SXR_CLAUDE: "rows:3", SXR_CODEX: "rows:131" } as Record<string, string>,
      });
      const codex = outcome.warnings.find((w) => w.provider === "codex");
      expect(codex?.message).toContain("1 of 5000 scanned");
      expect(codex?.message).toContain("scan cap");
      expect(codex?.message).toContain("not a reader blind spot");
      expect(codex?.message).not.toContain("BLIND SPOT");
      expect(codex?.remediation).toContain("Raise farrier's codex scan cap");
      expect(outcome.comparisons.find((c) => c.provider === "codex")?.status).toBe("divergent");
      // Claude matched and is untouched.
      expect(outcome.warnings.some((w) => w.provider === "claude")).toBe(false);
    });
  });

  test("a cap-hit codex zero is the scan cap, not the blind-spot alarm", async () => {
    await withFakeSxr(async (env, dir) => {
      const outcome = await crosscheckSessionCounts({
        targetDir: dir,
        farrier: providerCounts({ codex: 0, codexScanned: 5000, codexScanCapHit: true }),
        env: { PATH: env.PATH, SXR_CLAUDE: "emptyexit1", SXR_CODEX: "rows:12" } as Record<string, string>,
      });
      const codex = outcome.warnings.find((w) => w.provider === "codex");
      expect(codex?.message).toContain("scan cap");
      expect(codex?.message).not.toContain("BLIND SPOT");
      expect(outcome.comparisons.find((c) => c.provider === "codex")?.status).toBe("divergent");
    });
  });

  test("the killer case — farrier zero, sxr nonzero — is an unmissable blind-spot warning", async () => {
    await withFakeSxr(async (env, dir) => {
      const outcome = await crosscheckSessionCounts({
        targetDir: dir,
        farrier: providerCounts({ claude: 0, codex: 0 }),
        env: { PATH: env.PATH, SXR_CLAUDE: "rows:4", SXR_CODEX: "rows:7" } as Record<string, string>,
      });
      expect(outcome.comparisons.map((c) => c.status)).toEqual(["blind-spot", "blind-spot"]);
      const claude = outcome.warnings.find((w) => w.provider === "claude");
      const codex = outcome.warnings.find((w) => w.provider === "codex");
      expect(claude?.message).toContain("BLIND SPOT");
      expect(claude?.message).toContain("0 Claude");
      expect(claude?.message).toContain("found 4");
      expect(codex?.message).toContain("BLIND SPOT");
      expect(codex?.message).toContain("found 7");
    });
  });

  test("a subprocess usage error (exit 2) fails open to a note, never a warning", async () => {
    await withFakeSxr(async (env, dir) => {
      const outcome = await crosscheckSessionCounts({
        targetDir: dir,
        farrier: providerCounts({ claude: 5, codex: 2 }),
        env: { PATH: env.PATH, SXR_CLAUDE: "usage", SXR_CODEX: "rows:2" } as Record<string, string>,
      });
      const claude = outcome.comparisons.find((c) => c.provider === "claude");
      expect(claude?.status).toBe("unavailable");
      expect(claude?.sxr).toBeNull();
      expect(outcome.warnings.some((w) => w.provider === "claude")).toBe(false);
      expect(outcome.notes.some((n) => /Claude.*skipped.*usage error/.test(n))).toBe(true);
      // The healthy codex side still compares.
      expect(outcome.comparisons.find((c) => c.provider === "codex")?.status).toBe("match");
    });
  });

  test("unparseable success output fails open to a note, not a false zero", async () => {
    await withFakeSxr(async (env, dir) => {
      const outcome = await crosscheckSessionCounts({
        targetDir: dir,
        farrier: providerCounts({ claude: 5, codex: 5 }),
        env: { PATH: env.PATH, SXR_CLAUDE: "garbage", SXR_CODEX: "garbage" } as Record<string, string>,
      });
      expect(outcome.warnings).toEqual([]);
      expect(outcome.comparisons.every((c) => c.status === "unavailable")).toBe(true);
      expect(outcome.notes.every((n) => /skipped/.test(n))).toBe(true);
    });
  });

  test("a hanging sxr is killed at the timeout and fails open to a note", async () => {
    await withFakeSxr(async (env, dir) => {
      const outcome = await crosscheckSessionCounts({
        targetDir: dir,
        farrier: providerCounts({ claude: 1, codex: 1 }),
        env: { PATH: env.PATH, SXR_CLAUDE: "hang:30", SXR_CODEX: "rows:1" } as Record<string, string>,
        timeoutMs: 250,
      });
      const claude = outcome.comparisons.find((c) => c.provider === "claude");
      expect(claude?.status).toBe("unavailable");
      expect(outcome.warnings).toEqual([]);
      expect(outcome.notes.some((n) => /Claude.*did not respond within 250ms/.test(n))).toBe(true);
    }, );
  }, 10_000);
});

describe("sxrSessionCrosscheck doctor adapter", () => {
  test("absent sxr yields no problems and no notes (silent)", async () => {
    await noSxrOnPath(async (env) => {
      const result = await sxrSessionCrosscheck({
        targetDir: "/anywhere",
        env,
        farrierCounts: providerCounts({ claude: 3, codex: 3 }),
      });
      expect(result.problems).toEqual([]);
      expect(result.notes).toEqual([]);
    });
  });

  test("a blind spot maps to a sessions-group warning problem (never an error)", async () => {
    await withFakeSxr(async (env, dir) => {
      const result = await sxrSessionCrosscheck({
        targetDir: dir,
        env: { PATH: env.PATH, SXR_CLAUDE: "rows:6", SXR_CODEX: "rows:2" } as Record<string, string>,
        farrierCounts: providerCounts({ claude: 0, codex: 2 }),
      });
      expect(result.problems).toHaveLength(1);
      const problem = result.problems[0]!;
      expect(problem.group).toBe("sessions");
      expect(problem.severity).toBe("warning");
      expect(problem.id).toBe("sxr-crosscheck:claude");
      expect(problem.message).toContain("BLIND SPOT");
      // The matching codex side is a note, not a problem.
      expect(result.notes.some((n) => /Codex.*agree on 2/.test(n))).toBe(true);
    });
  });
});
