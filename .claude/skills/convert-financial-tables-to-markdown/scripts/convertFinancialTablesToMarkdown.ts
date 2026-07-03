import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HYBRID_PORT = 5003;
const HYBRID_URL = `http://localhost:${HYBRID_PORT}`;
const HYBRID_STARTUP_TIMEOUT_MS = 60_000;
const HYBRID_POLL_INTERVAL_MS = 2_000;

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function runCommand(
  command: string,
  args: string[],
  opts: { detached?: boolean } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: opts.detached ?? false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
  });
}

async function commandExists(command: string): Promise<boolean> {
  const result = await runCommand("bash", ["-lc", `command -v ${command}`]).catch(
    () => null,
  );
  return !!result && result.exitCode === 0;
}

/**
 * opendataloader-pdf may be installed globally, or only reachable via uvx/pipx
 * run on machines that don't have it on PATH directly.
 */
async function resolveOpendataloaderInvocation(): Promise<string[]> {
  if (await commandExists("opendataloader-pdf")) {
    return ["opendataloader-pdf"];
  }
  if (await commandExists("uvx")) {
    return ["uvx", "opendataloader-pdf"];
  }
  if (await commandExists("pipx")) {
    return ["pipx", "run", "opendataloader-pdf"];
  }
  throw new Error(
    "opendataloader-pdf not found: install via pipx, or ensure uvx/pipx is on PATH",
  );
}

function countPipeRows(markdown: string): number {
  return markdown.split("\n").filter((line) => line.trimStart().startsWith("|")).length;
}

async function extractPlainMarkdown(pdfPath: string): Promise<string> {
  const [cmd, ...prefixArgs] = await resolveOpendataloaderInvocation();
  const result = await runCommand(cmd, [
    ...prefixArgs,
    pdfPath,
    "-f",
    "markdown",
    "--to-stdout",
  ]);
  return result.stdout;
}

async function extractClusterMarkdown(pdfPath: string): Promise<string> {
  const [cmd, ...prefixArgs] = await resolveOpendataloaderInvocation();
  const result = await runCommand(cmd, [
    ...prefixArgs,
    pdfPath,
    "-f",
    "markdown-with-html",
    "--table-method",
    "cluster",
    "--to-stdout",
  ]);
  return result.stdout;
}

async function waitForHybridServer(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(HYBRID_URL);
      if (response.ok || response.status < 500) return;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, HYBRID_POLL_INTERVAL_MS));
  }
  throw new Error(`opendataloader-pdf-hybrid did not become healthy at ${HYBRID_URL}`);
}

async function extractHybridDoclingMarkdown(pdfPath: string): Promise<string> {
  const server = spawn(
    "opendataloader-pdf-hybrid",
    ["--port", String(HYBRID_PORT), "--log-level", "warning"],
    { detached: true, stdio: "ignore" },
  );
  server.unref();

  const outDir = await mkdtemp(join(tmpdir(), "financial-tables-hybrid-"));
  try {
    await waitForHybridServer(Date.now() + HYBRID_STARTUP_TIMEOUT_MS);

    const [cmd, ...prefixArgs] = await resolveOpendataloaderInvocation();
    await runCommand(cmd, [
      ...prefixArgs,
      pdfPath,
      "-f",
      "markdown-with-html,json",
      "--hybrid",
      "docling-fast",
      "--hybrid-url",
      HYBRID_URL,
      "-o",
      outDir,
    ]);

    const baseName = pdfPath.split("/").pop()!.replace(/\.pdf$/i, "");
    const markdownPath = join(outDir, `${baseName}.md`);
    return await readFile(markdownPath, "utf-8");
  } finally {
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // already exited
      }
    }
    await rm(outDir, { recursive: true, force: true });
  }
}

/**
 * Converts a financial PDF (10-K, 10-Q, statement, etc.) to markdown, escalating
 * through progressively stronger table extraction methods until the tables
 * actually come through as markdown pipe-rows rather than flattened prose.
 *
 * Call this right before building an LLM prompt from the document — it does
 * real subprocess work, and the hybrid-docling fallback spins up a local
 * server, so it's not free to call speculatively.
 */
export async function convertFinancialTablesToMarkdown(pdfPath: string): Promise<string> {
  const plain = await extractPlainMarkdown(pdfPath);
  let best = plain;
  let bestScore = countPipeRows(plain);

  // A well-tabulated financial filing should have several table rows per
  // page; a near-zero count on a multi-page filing means tables were
  // flattened into prose and it's worth paying for a stronger method.
  const looksWeak = (score: number) => score === 0;

  if (looksWeak(bestScore)) {
    const clustered = await extractClusterMarkdown(pdfPath);
    const clusteredScore = countPipeRows(clustered);
    if (clusteredScore > bestScore) {
      best = clustered;
      bestScore = clusteredScore;
    }

    if (looksWeak(bestScore)) {
      const hybrid = await extractHybridDoclingMarkdown(pdfPath);
      const hybridScore = countPipeRows(hybrid);
      if (hybridScore > bestScore) {
        best = hybrid;
        bestScore = hybridScore;
      }
    }
  }

  return best;
}
