---
name: financial-tables-to-markdown
description: "Converts financial tables inside PDF reports and filings (10-Ks, 10-Qs, earnings decks, balance sheets, scanned statements) into clean pipe-delimited markdown using opendataloader-pdf, escalating through borderless-table and OCR-friendly extraction modes as needed. Use this skill any time a PDF with financial tables needs to become markdown text before it is fed into an LLM prompt — whether the user says \"convert this filing to markdown,\" \"extract the tables from this PDF,\" \"get this financial r"
---

# Financial Tables to Markdown

Financial PDFs (10-Ks, 10-Qs, earnings releases, bank statements) routinely contain
tables with no visible ruling lines ("borderless" tables) or that are scanned images.
A naive PDF-to-markdown conversion silently flattens these into run-on prose with no
`|` pipes — the LLM then sees numbers jumbled together with no column alignment, which
is worse than useless for financial data because rows of numbers become ambiguous.

This skill converts a PDF's tables to markdown using `opendataloader-pdf`, and — this
is the important part — **verifies the output actually contains table structure**
before accepting it, escalating to stronger (slower) extraction modes only when the
cheaper mode fails the check. Don't skip the verification step: a conversion that
"succeeds" without errors can still produce prose-flattened tables, and the only way
to catch that is to check the output for markdown table syntax.

## Prerequisites

`opendataloader-pdf` requires Java 11+. Install it once via pipx:

```bash
pipx install opendataloader-pdf
```

If pipx isn't set up on this machine, `uvx opendataloader-pdf` or
`pipx run opendataloader-pdf` work as drop-in replacements for every command below —
just substitute the invocation, the flags are identical.

## The escalation ladder

Try each rung only if the previous one fails verification. Each rung is slower and
more resource-intensive than the last, so don't jump straight to the hybrid model —
most born-digital financial PDFs with ruled tables succeed at rung 1.

**Verification check** (run after every rung): count markdown table rows in the output.

```bash
grep -c '^|' file.md
```

A table-bearing financial page should produce a count "much greater than zero" — as a
rule of thumb, at least a few lines per table on the page. A count of 0 or 1 means the
tables were flattened into prose and you need to escalate.

### Rung 1 — default markdown

```bash
opendataloader-pdf file.pdf -f markdown -o .
grep -c '^|' file.md
```

Fast, and correct for most digitally-generated financial PDFs where tables have visible
borders/rules the parser can detect directly.

### Rung 2 — markdown-with-html + cluster table method

If rung 1's pipe count is ~0, the tables are likely borderless (common in financial
filings and academic-style PDFs where cells are separated by whitespace/alignment only,
not ruling lines). Retry with the clustering table method:

```bash
opendataloader-pdf file.pdf -f markdown-with-html --table-method cluster -o .
grep -c '^|' file.md
```

This fixes the majority of borderless-but-digital tables by clustering text into rows/
columns based on position rather than requiring drawn lines.

### Rung 3 — hybrid docling layout model

If rung 2 still doesn't produce real tables (this usually means the PDF is scanned,
image-based, or has an unusually complex layout), fall back to the hybrid mode that
runs a docling layout model alongside the parser:

```bash
opendataloader-pdf-hybrid --port 5003 --log-level warning &
until curl -s http://localhost:5003/ >/dev/null; do sleep 2; done

opendataloader-pdf file.pdf -f markdown-with-html,json \
  --hybrid docling-fast --hybrid-url http://localhost:5003 -o .

grep -c '^|' file.md
```

Always kill the hybrid server once done with it — it's a local process, not a
long-running service:

```bash
lsof -tiTCP:5003 -sTCP:LISTEN | xargs kill
```

If rung 3 still fails the check, the PDF likely has genuinely unrecoverable table
structure (e.g. heavily degraded scans) — say so explicitly rather than silently
returning flattened prose as if it were a clean conversion.

## Using this programmatically (ts-base projects)

For code that needs to convert a PDF to markdown as a step before an LLM call (rather
than a one-off CLI invocation), use `scripts/convertFinancialTables.ts`. It implements
the exact escalation ladder above as a single async function:

```typescript
import { convertFinancialTablesToMarkdown } from "./convertFinancialTables";

const markdown = await convertFinancialTablesToMarkdown("/path/to/10-K.pdf");
// markdown is ready to embed directly in an LLM prompt
```

The function returns the resulting markdown as a string and throws if all three rungs
fail verification, with an error message naming which rungs were tried and their pipe
counts — don't swallow that into a generic error, the counts are what tell you (or the
calling code's caller) whether it's worth trying an even stronger OCR path manually.

Read `scripts/convertFinancialTables.ts` for the implementation before adapting it —
it's a straightforward wrapper (temp output dir, shell out to the CLI, read the .md
file back, count `^|` lines, escalate) and is meant to be copied into the target
project's codebase rather than executed in place, since it has no dependency on this
skill's directory at runtime.
