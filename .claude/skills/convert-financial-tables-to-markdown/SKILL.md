---
name: convert-financial-tables-to-markdown
description: Converts financial PDF filings and reports (10-Ks, 10-Qs, balance sheets, income statements) into clean markdown tables using opendataloader-pdf, escalating through cluster and hybrid-docling table extraction as needed — use this whenever a PDF financial document needs to be turned into markdown before it's fed into an LLM prompt, especially when the tables are borderless, scanned, or otherwise fail to extract cleanly on the first pass.
---

# Convert financial tables to markdown

Financial PDFs (10-Ks, 10-Qs, earnings statements, balance sheets) routinely contain
tables that plain PDF-to-text conversion mangles — numbers get flattened into
run-on prose with no column structure, which is useless context for an LLM.
This skill converts such PDFs into markdown, escalating through progressively
stronger extraction methods only when the cheaper method fails to find real
tables, since the stronger methods cost more time (they require running a local
docling server).

## Prerequisite

`opendataloader-pdf` must be available. It's a Java 11+ tool, normally installed
via `pipx`. On machines without a global install, fall back to `uvx opendataloader-pdf`
or `pipx run opendataloader-pdf` (the escalation script tries `opendataloader-pdf`
first and falls back automatically).

## When to use this

Reach for this skill any time a PDF financial filing or report needs to become
markdown for an LLM prompt — not just when the user says "convert this table."
Signs this skill applies:
- The input is a 10-K, 10-Q, annual report, earnings release, or similar filing PDF.
- The document contains numeric tables (balance sheets, income statements, cash flow statements).
- The end goal is passing the extracted content into an LLM prompt.

This skill is scoped to **PDF input only**. It is not for spreadsheets, HTML
tables, or images of tables outside a PDF context — those need different tooling.

## The escalation path

Not every PDF needs the expensive path. Try the cheapest method first and only
escalate if it didn't actually find the tables — verify by counting markdown
pipe-rows (`grep -c '^|'`) after each attempt. A near-zero count on a document
you know has tables means the tables were flattened into prose, and it's time
to escalate.

1. **Plain markdown** — `opendataloader-pdf file.pdf -f markdown --to-stdout`.
   Works for most well-formed tables with visible borders.
2. **Cluster-based markdown** — `opendataloader-pdf file.pdf -f markdown-with-html --table-method cluster --to-stdout`.
   Fixes many borderless tables (common in financial statements where columns
   are aligned by whitespace, not ruled lines) by clustering text positions
   instead of relying on visible grid lines.
3. **Hybrid docling** — for tables that are scanned images, or borderless
   tables complex enough that clustering still misses them. This spins up a
   local docling layout-model server and re-runs extraction against it:
   ```bash
   opendataloader-pdf-hybrid --port 5003 --log-level warning &
   until curl -s http://localhost:5003/ >/dev/null; do sleep 2; done
   opendataloader-pdf file.pdf -f markdown-with-html,json \
     --hybrid docling-fast --hybrid-url http://localhost:5003 -o <outdir>
   # kill the server when done:
   lsof -tiTCP:5003 -sTCP:LISTEN | xargs kill
   ```
   This step is noticeably slower (model startup + inference), so only reach
   for it after steps 1 and 2 have been verified to fail.

## Using it from TypeScript app code

`scripts/convertFinancialTablesToMarkdown.ts` implements this escalation path
as a single async function, so app code doesn't need to shell out by hand:

```ts
import { convertFinancialTablesToMarkdown } from "./scripts/convertFinancialTablesToMarkdown";

const markdown = await convertFinancialTablesToMarkdown("/path/to/10-K.pdf");
// ...build the LLM prompt using `markdown` as context
const prompt = `Analyze the following financial statement:\n\n${markdown}`;
```

Call this right before constructing the LLM prompt, not earlier in the
pipeline — it does real subprocess work (and potentially spins up a local
server for step 3), so only pay that cost for documents that are actually
about to be sent to the model.

The function:
- Runs step 1 (`-f markdown`) and counts pipe-rows in the output.
- If the count looks too low relative to the page count (heuristic: fewer
  than one table row per 3 pages), retries with step 2 (`cluster`).
- If step 2 still looks weak, escalates to step 3 (hybrid docling), managing
  the local server's lifecycle (start, wait for health check, run extraction,
  kill it afterward) internally.
- Returns the best markdown output obtained (highest pipe-row count wins if
  an escalation didn't actually improve things).
- Throws if `opendataloader-pdf` isn't found on `PATH` via any of
  `opendataloader-pdf`, `uvx opendataloader-pdf`, or `pipx run opendataloader-pdf`.

Read `scripts/convertFinancialTablesToMarkdown.ts` directly if you need to
adjust the escalation thresholds or wire it into a different CLI invocation
pattern (e.g. a fixed output directory instead of stdout).
