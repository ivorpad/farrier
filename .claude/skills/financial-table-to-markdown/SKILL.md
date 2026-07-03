---
name: financial-table-to-markdown
description: Converts financial tables (from PDFs, spreadsheets, images, or scanned statements) into clean, well-structured Markdown tables before handing the data to an LLM for analysis — use this whenever a user shares a balance sheet, income statement, cash flow statement, invoice, pricing schedule, or any other financial table and wants it summarized, extracted, analyzed, or reformatted, especially when the source has merged/multi-row headers, currency symbols, parenthesized negatives, footnote markers,
---

# Financial Table to Markdown

Financial tables are formatted for human eyes, not for language models: numbers hide their
sign in parentheses, headers span two or three visually-merged rows, footnote markers look
like stray characters, and a single logical table is often chopped across page breaks. If you
hand a downstream LLM step a literal transcription of that layout, it has to re-solve the same
parsing puzzle every time — and it will occasionally get the sign of a number wrong, which is
the one mistake you can't afford in a financial table. This skill's job is to do that parsing
once, up front, and emit a Markdown table so unambiguous that a second read is unnecessary.

Use this skill as a pre-processing step: convert first, then pass the resulting Markdown into
whatever analysis, extraction, or summarization the user actually asked for.

## Workflow

1. **Get the raw table into view.** Depending on the source:
   - PDF: extract text/layout (e.g. via existing PDF tooling in this environment). If the table
     is borderless or the extraction collapses columns into run-on prose, fall back to reading
     the page as an image and transcribing the grid visually.
   - Spreadsheet (xlsx/csv): read the sheet directly; merged cells will appear as a value in the
     top-left cell of the merge and blanks elsewhere.
   - Image / scanned document: read it visually, row by row, column by column. Don't guess at
     digits you can't read clearly — flag them (see Uncertain values below) rather than inventing
     a number.
2. **Identify the table's true grain before writing anything down.** What does one row represent
   (a line item, an account, a date period)? What do the columns represent (periods, entities,
   scenarios)? Getting this mental model right first prevents mis-aligning cells later, especially
   in tables with sub-headers or indentation-based hierarchy (e.g. "Operating expenses" as a
   section label followed by indented line items).
3. **Normalize using the rules in the [Conversion Rules](#conversion-rules) section below.**
4. **Stitch multi-page tables** into one continuous table (see below) before normalizing.
5. **Emit the Markdown table**, followed by a short "Notes" section for anything a plain
   transcription would lose: footnote text, currency/units, ambiguous or illegible cells, and
   any judgment calls you made.
6. **Re-check column alignment**: count the pipe-separated cells in every row and confirm each
   row has the same number of columns as the header. A row short one cell almost always means a
   blank/merged cell was silently dropped — go back and add it explicitly rather than letting
   columns drift.

For the full list of quirks and worked examples, see `references/quirks.md`. Read it whenever
the source table has any of: multi-row headers, merged cells, parenthesized negatives, footnote
markers, subtotal/total rows, or page breaks mid-table — i.e. almost always, for real-world
financial documents.

## Conversion Rules (quick reference)

- **Negatives**: convert `(1,234)` → `-1234`. Never leave a parenthesized number as-is — an LLM
  reading it later may treat it as positive. State the convention once in a Notes line (e.g.
  "parentheses in the source denote negative values and have been converted to a leading minus
  sign") so anyone diffing against the original understands the transform.
- **Currency symbols and thousands separators**: strip `$`, `€`, `£`, and thousands commas from
  numeric cells (`$1,234.50` → `1234.50`). Keep the unit/currency as a header annotation or a
  Notes line instead of repeating it in every cell — repetition is what causes inconsistent
  parsing downstream (some cells keep the symbol, some don't).
- **Percentages**: keep the `%` sign; it's part of the value's meaning, not decoration
  (`12.5%` stays `12.5%`).
- **Footnote markers** (`*`, `†`, superscript numbers, lettered refs like `(a)`): strip them from
  the cell value and list what they mean in a Notes section, keyed by the marker, e.g.
  `* Restated to reflect divestiture completed in Q3.` Do not silently drop the footnote text —
  it frequently changes how a number should be interpreted.
- **Multi-row / merged headers**: collapse into a single header row by joining levels with a
  separator, e.g. a top row "Fiscal Year 2024" spanning "Q1 / Q2 / Q3 / Q4" becomes columns
  `FY2024 Q1 | FY2024 Q2 | FY2024 Q3 | FY2024 Q4`. Don't drop the outer label — "Q1" alone is
  ambiguous once the table is out of its original visual context.
- **Row hierarchy / indentation** (e.g. section headers like "Revenue" with indented sub-items
  "Product sales", "Service revenue"): preserve the hierarchy explicitly rather than relying on
  Markdown whitespace, which most renderers collapse. Either prefix indented line items (e.g.
  "— Product sales") or add a `Section` column. Pick one convention and apply it consistently
  through the whole table.
- **Subtotal / total rows**: keep them in the table, but make them unambiguous — bold the label
  (`**Total operating expenses**`) or prefix it (`TOTAL —`) so a downstream reader (human or
  model) doesn't mistake a subtotal for another line item when summing a column.
- **Blank / N/A / not-applicable cells**: use a literal `—` (em dash) or `N/A`, never leave the
  cell empty. An empty Markdown cell is easy to misread as a missing column during parsing.
- **Uncertain / illegible values**: if a scan or image makes a digit genuinely unreadable, write
  your best guess followed by `[?]` (e.g. `1,204[?]`) and call it out in Notes. Never silently
  invent a plausible-looking number — a wrong financial figure that reads as confident is worse
  than one flagged as uncertain.

## Multi-Page Tables

Financial statements routinely break a single logical table across a page boundary, often
repeating the header row on the new page (sometimes with "(continued)" appended) or omitting it
entirely and relying on visual continuity. Before normalizing:

- Confirm the columns on the continuation page actually match the first page's columns and order
  — page breaks are also where column reordering or added columns most often sneak in unnoticed.
- Drop the repeated header row on the continuation page; merge into one table with one header.
- Watch for a total/subtotal row that appears at the bottom of the *first* page — check whether
  it's a running subtotal (keep it, labeled clearly) or an artifact of the page break (in which
  case the real total is the one at the end of the full table, and including both would double
  the total if a downstream step sums the column naively).

## Output Format

Always output:

1. The Markdown table itself.
2. A `**Notes:**` section (omit only if there is truly nothing to note) covering: units/currency,
   the period the numbers cover, footnote text, and any flagged uncertain values.

```markdown
| Line Item | FY2023 | FY2024 |
| --- | --- | --- |
| Revenue | 10,200 | 12,450 |
| Cost of goods sold | -6,100 | -7,300 |
| **Gross profit** | **4,100** | **5,150** |
| Operating expenses* | -1,800 | -2,050 |
| **Net income** | **2,300** | **3,100** |

**Notes:**
- All figures in USD thousands.
- Parenthesized values in the source have been converted to negative numbers.
- `*` Operating expenses include a one-time restructuring charge of 300 in FY2024.
```

This example is a template for structure, not a fixed schema — real tables will have different
column counts, more nesting, or different footnote schemes. Adapt the shape to what the source
table actually contains; the invariants that matter are: one unambiguous header row, explicit
signs, no bare footnote markers, and nothing silently dropped.
