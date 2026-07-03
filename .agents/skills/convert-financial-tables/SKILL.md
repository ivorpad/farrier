---
name: convert-financial-tables
description: Convert financial tables from filings, reports, spreadsheets, PDFs, screenshots, or pasted text into faithful Markdown before passing them to an LLM for analysis, extraction, summarization, or QA.
---

# Convert Financial Tables

## Core Rule

Convert every financial table into Markdown before including it in an LLM prompt. Do not pass raw OCR, copied PDF layout text, HTML fragments, spreadsheet dumps, or visually implied rows directly when a Markdown table can preserve the structure.

## Workflow

1. Identify each logical table and its context:
   - Source document, page or sheet, table title, reporting period, currency, units, and footnotes.
   - Whether values are audited, unaudited, restated, pro forma, non-GAAP, trailing twelve months, or estimates.
2. Extract the table structure before interpreting it:
   - Preserve row order, column order, indentation, subtotals, section headers, and blank separator rows when they carry meaning.
   - Combine multi-row column headers into explicit labels such as `Q1 2026 Revenue` or `2026 Actual`.
   - Repeat shared units or period labels inside column names when the source relies on visual grouping.
3. Render one Markdown table per logical table:
   - Use a header row, separator row, and one row per source row.
   - Escape literal pipe characters as `\|`.
   - Keep original numeric notation for negatives, dashes, percentages, basis points, currency symbols, and footnote markers.
   - Use `[blank]` only when the source cell is intentionally empty; use `[illegible]` only when extraction is uncertain.
4. Add compact metadata immediately before the Markdown table:
   - Include source, title, period, units, and relevant notes.
   - State extraction uncertainties before the table, not after the LLM has reasoned over it.
5. Pass the Markdown table to the LLM with task instructions:
   - Ask the LLM to rely only on the supplied Markdown and notes unless external data is explicitly requested.
   - Tell the LLM not to recompute totals unless the user asks for calculation or validation.

## Financial Table Conventions

- Preserve parentheses for negative numbers, e.g. `(123)`, unless explicitly normalizing values for a downstream tool.
- Preserve scale statements such as `in millions`, `except per-share data`, `bps`, or `%`; do not silently convert units.
- Preserve footnote markers such as `Revenue (1)` or `Adjusted EBITDA*` and include footnote text below the table when available.
- Keep section rows such as `Current assets`, `Operating expenses`, or `Cash flows from financing activities` as table rows with blank numeric cells.
- Keep signs and dashes distinct: `-`, `--`, `nm`, `n/a`, and `0` may mean different things in financial reporting.
- If a wide table must be split, split by period or metric group and repeat the row labels, units, title, and source in each segment.

## Prompt Package Format

Use this structure when sending the result onward:

```markdown
Source: <document, page/sheet, URL or file if available>
Table: <title>
Period: <period covered>
Units: <currency and scale>
Notes: <footnotes, extraction caveats, accounting basis>

| <row label> | <column 1> | <column 2> |
| --- | ---: | ---: |
| <source row> | <value> | <value> |
```

Align numeric columns with `---:` when convenient, but prioritize faithful extraction over Markdown styling.

## Quality Check

Before passing the table to an LLM, verify:

- Every row has the same number of Markdown cells.
- Column headers contain enough period, scenario, unit, and currency context to stand alone.
- Totals, subtotals, and key metrics match the source visually or are flagged as uncertain.
- Footnotes, exceptions, and non-GAAP labels are included when they affect interpretation.
- No values were rounded, normalized, inferred, reordered, or omitted without an explicit note.
