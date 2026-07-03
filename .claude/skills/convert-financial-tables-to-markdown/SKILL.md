---
name: convert-financial-tables-to-markdown
description: "Converts financial tables from Excel (.xlsx/.xls) or CSV files into clean GFM pipe-table markdown (.md) files, using the opendataloader-pdf CLI's table extraction to reliably handle borderless and complex financial table layouts before the content is passed to an LLM; use this whenever the user has a spreadsheet, workbook, or CSV of financial data (income statements, balance sheets, cap tables, expense reports, etc.) that needs to become markdown for LLM consumption, even if they just say \"turn"
---

# Convert Financial Tables to Markdown

Turn Excel/CSV financial tables into GFM pipe-table markdown that's safe to paste into an LLM
prompt. Raw spreadsheet exports and naive CSV-to-markdown conversions routinely mangle merged
header cells, multi-row financial statement headers, and borderless table layouts common in
financial exports. This skill routes the data through a PDF rendering + table-extraction pass
(the same technique used for borderless PDF tables) instead of a naive cell dump, because that
pass is what correctly reconstructs table structure when column/row boundaries aren't explicit
in the source data.

## Why the PDF-extraction detour

`opendataloader-pdf` has robust table-structure detection (including a `cluster` table method
built for borderless/complex tables) that a direct spreadsheet-to-markdown dump doesn't have.
Rendering the spreadsheet to PDF first and running it through that extractor catches merged
headers and irregular financial-statement layouts more reliably than reading cells directly.
The tradeoff is an extra conversion hop — worth it for messy financial exports; a plain,
simple CSV with one clean header row will also work fine through this path, just with a bit of
overhead.

## Prerequisites

- LibreOffice (`soffice` on PATH) — renders the input spreadsheet to PDF.
- `opendataloader-pdf` CLI (Java 11+) — extracts tables from that PDF. Install via `pipx`, or
  use `uvx opendataloader-pdf` / `pipx run opendataloader-pdf` if not installed globally.
- `python3` (stdlib only, no extra packages required).

## Usage

```bash
scripts/convert.sh <input.xlsx|input.xls|input.csv> [-o output.md]
```

If `-o` is omitted, the output is written next to the input file's basename with a `.md`
extension in the current directory (e.g. `Q4_income_statement.xlsx` → `Q4_income_statement.md`).

The script:
1. Converts the input to a PDF with `soffice --headless --convert-to pdf`.
2. Runs `opendataloader-pdf` on that PDF with plain `-f markdown` first.
3. Checks whether real pipe tables came out (`grep -c '^|'`). If the table was borderless and
   got flattened into prose instead (a known failure mode — no `|` characters), it retries with
   `-f markdown-with-html --table-method cluster`, which handles borderless tables but embeds
   them as raw HTML `<table>` elements instead of GFM pipes.
4. Runs `scripts/html_table_to_gfm.py` over the result, which rewrites any HTML `<table>`
   elements into `| col | col |` GFM pipe-table syntax and passes already-clean markdown through
   unchanged. This guarantees the final `.md` file is pure GFM pipe tables regardless of which
   extraction path was taken.

Inspect the output afterward — skim for a table whose column count looks wrong or whose header
row repeats mid-table, since that usually means the source had merged cells the extractor
mis-split. Re-running with the source PDF fallback described in `references/quirks.md` fixes
most of those cases.

## Files

- `scripts/convert.sh` — the standalone CLI entry point described above.
- `scripts/html_table_to_gfm.py` — stdlib-only HTML-table-to-GFM-pipe-table rewriter, also
  usable standalone: `html_table_to_gfm.py <input.md> <output.md>`.
- `references/quirks.md` — extraction edge cases (borderless tables, scanned/OCR pages, nested
  tables) and how to work around each.
