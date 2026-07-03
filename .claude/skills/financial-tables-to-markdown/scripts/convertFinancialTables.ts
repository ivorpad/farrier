/**
 * Converts a PDF's financial tables to markdown for embedding in an LLM prompt.
 *
 * Wraps the `opendataloader-pdf` CLI and escalates through three extraction rungs —
 * default markdown, then markdown-with-html + cluster table method, then the hybrid
 * docling layout model — stopping as soon as one produces real table structure.
 *
 * This file has no dependency on the skill directory at runtime; copy it into the
 * target project (e.g. a ts-base repo) and adjust the import path as needed.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, extname } from "node:path";

const execFileAsync = promisify(execFile);

const HYBRID_PORT = 5003;
const HYBRID_URL = `http://localhost:${HYBRID_PORT}`;
// A page with real tables should produce noticeably more than 0-1 pipe-prefixed
// lines; below this, treat the conversion as flattened prose and escalate.
const MIN_TABLE_ROWS = 2;

interface RungAttempt {
  rung: string;
  tableRowCount: number;
}

export class TableConversionError extends Error {
  constructor(public readonly attempts: RungAttempt[]) {
    super(
      `opendataloader-pdf could not extract table structure from this PDF after ` +
        `trying all rungs: ${attempts
          .map((a) => `${a.rung} (${a.tableRowCount} table rows)`)
          .join(", ")}. The PDF's tables may be too degraded (e.g. a poor scan) ` +
        `for automated extraction.`
    );
  }
}

/** Mirrors `grep -c '^|'` — counts markdown table rows in the output. */
function countTableRows(markdown: string): number {
  return markdown.split("\n").filter((line) => line.startsWith("|")).length;
}

async function runOpenDataLoader(
  pdfPath: string,
  outDir: string,
  extraArgs: string[]
): Promise<void> {
  await execFileAsync("opendataloader-pdf", [pdfPath, "-o", outDir, ...extraArgs], {
    maxBuffer: 1024 * 1024 * 64,
  });
}

async function readOutputMarkdown(pdfPath: string, outDir: string): Promise<string> {
  const stem = basename(pdfPath, extname(pdfPath));
  return readFile(join(outDir, `${stem}.md`), "utf8");
}

async function startHybridServer(): Promise<() => Promise<void>> {
  const { spawn } = await import("node:child_process");
  const proc = spawn(
    "opendataloader-pdf-hybrid",
    ["--port", String(HYBRID_PORT), "--log-level", "warning"],
    { detached: true, stdio: "ignore" }
  );

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HYBRID_URL);
      if (res.ok || res.status < 500) break;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return async () => {
    proc.kill();
  };
}

/**
 * Converts `pdfPath`'s tables to markdown, escalating through extraction rungs
 * until one yields real table structure (or all three have been exhausted).
 */
export async function convertFinancialTablesToMarkdown(pdfPath: string): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), "financial-tables-"));
  const attempts: RungAttempt[] = [];

  try {
    // Rung 1: default markdown — works for most born-digital, ruled tables.
    await runOpenDataLoader(pdfPath, outDir, ["-f", "markdown"]);
    let markdown = await readOutputMarkdown(pdfPath, outDir);
    let rowCount = countTableRows(markdown);
    attempts.push({ rung: "markdown", tableRowCount: rowCount });
    if (rowCount >= MIN_TABLE_ROWS) return markdown;

    // Rung 2: markdown-with-html + cluster table method — handles borderless tables.
    await runOpenDataLoader(pdfPath, outDir, [
      "-f",
      "markdown-with-html",
      "--table-method",
      "cluster",
    ]);
    markdown = await readOutputMarkdown(pdfPath, outDir);
    rowCount = countTableRows(markdown);
    attempts.push({ rung: "markdown-with-html+cluster", tableRowCount: rowCount });
    if (rowCount >= MIN_TABLE_ROWS) return markdown;

    // Rung 3: hybrid docling layout model — handles scanned/complex layouts.
    const stopHybrid = await startHybridServer();
    try {
      await runOpenDataLoader(pdfPath, outDir, [
        "-f",
        "markdown-with-html,json",
        "--hybrid",
        "docling-fast",
        "--hybrid-url",
        HYBRID_URL,
      ]);
      markdown = await readOutputMarkdown(pdfPath, outDir);
      rowCount = countTableRows(markdown);
      attempts.push({ rung: "hybrid-docling", tableRowCount: rowCount });
      if (rowCount >= MIN_TABLE_ROWS) return markdown;
    } finally {
      await stopHybrid();
    }

    throw new TableConversionError(attempts);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
