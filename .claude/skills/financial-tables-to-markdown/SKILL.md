---
name: financial-tables-to-markdown
description: Converts financial tables (balance sheets, income statements, cash flow statements, and similar tabular financial data) found in PDFs, HTML, images, or spreadsheets into clean, well-structured Markdown tables that preserve headers, row/column alignment, units, and footnotes, so the data is reliably parsed when handed to an LLM for analysis; use this whenever the user shares a financial statement, filing excerpt, earnings report, or similar tabular financial document and wants it summarized, anal
---

# Financial Tables to Markdown

Financial statements are dense, alignment-sensitive, and full of formatting conventions (parenthesized negatives, currency symbols, multi-level headers, footnote markers) that plain-text extraction mangles. An LLM asked to analyze a financial table directly from a PDF dump or OCR text will frequently misalign a number with the wrong row or year. Converting the table to clean Markdown *first* — as a distinct step before analysis — fixes the alignment once, explicitly, so every downstream question about the data starts from a correct structure instead of the LLM re-guessing alignment on every query.

Use this skill whenever a source document contains one or more financial tables (balance sheet, income statement, cash flow statement, statement of stockholders' equity, schedules/notes with tabular figures, budget or forecast tables) and the end goal is to have an LLM read, summarize, compare, or extract data from them.

## Workflow

1. **Identify the source format and extract raw content**
   - **PDF**: Use `opendataloader-pdf` if available (see the user's global tooling notes) — run with `-f markdown` first, but check output for tables that collapsed into run-on prose (a sign of borderless tables). If `grep -c '^|' output.md` comes back near zero for a document you know has tables, retry with `-f markdown-with-html --table-method cluster`, and if that still fails, fall back to the hybrid docling pipeline described in that tool's own docs.
   - **HTML**: Parse `<table>` elements directly (e.g. with a DOM parser or `pandas.read_html`) rather than stripping tags to text — the cell/row structure is already explicit and should not be re-inferred from whitespace.
   - **Images / scanned pages**: Use OCR with table-structure detection (e.g. a hybrid docling/vision pipeline) rather than plain OCR text extraction. Plain OCR text loses column boundaries; you need cell-level bounding boxes to reconstruct rows and columns correctly.
   - **Spreadsheets (xlsx/csv)**: Read with a spreadsheet library (e.g. `openpyxl`, `pandas`) so merged cells and multi-row headers are detected structurally instead of guessed from visual layout.

2. **Detect table boundaries and structure before converting**
   - Locate the table title/caption (e.g. "CONSOLIDATED BALANCE SHEETS") and the reporting period(s) in the header row(s) — these are easy to lose track of once the table is reformatted, so capture them first.
   - Note whether the header is multi-level (e.g. a top row of years/quarters spanning multiple columns, a second row of sub-labels like "Actual" / "Budget"). Multi-level headers do not map cleanly onto Markdown tables (which support only one header row), so decide how to flatten them — see "Multi-level headers" below.
   - Identify the units declaration, usually a line near the top like "(in thousands, except per share data)" or "(in millions)". This applies to the whole table and must be preserved as context, not silently dropped.
   - Identify footnote markers (`*`, `(1)`, `†`) attached to line items or figures, and locate their corresponding footnote text (often below the table or at the end of the document section).

3. **Convert to Markdown**, applying these conventions:
   - One Markdown table per financial statement. If the source has multiple statements (e.g. balance sheet + income statement back to back), split them into separate tables with their own headings — do not merge unrelated statements into one table.
   - Put the units declaration and reporting entity/period as a line of text directly above the table, not inside a cell.
   - Preserve every numeric value as it's printed, including sign convention — see "Numeric formatting" below — rather than normalizing values in ways that lose information the source chose to include.
   - Preserve row order and indentation semantics. Financial statements use indentation to show subtotal hierarchy (e.g. "Total current assets" indented under individual asset lines). Since Markdown tables can't indent cells, encode the hierarchy with leading non-breaking spaces, a prefix like nothing/`  ` two-space indent, or a bold/plain distinction for subtotal vs. detail rows — pick one convention and apply it consistently within a document.
   - Keep row labels in their own leftmost column exactly as written (don't paraphrase or abbreviate line items — "Total stockholders' equity" should not become "Total equity").
   - Attach footnote markers to the exact cell or label they annotate, and reproduce the footnote text below the table (e.g. as a blockquote or small list), rather than leaving the reader to guess what an orphaned asterisk refers to.

4. **Handle multi-level headers**
   Markdown tables only support a single header row, so flatten multi-level headers into one row while keeping the information legible:
   - Combine levels with a separator, e.g. `Q1 2024 (Actual)`, `Q1 2024 (Budget)` rather than just `Actual`, `Budget` — a single-level header must not lose the year/period context from the level above it.
   - If a top-level header spans several columns (e.g. "Fiscal Year 2024" spanning three quarter columns), repeat that label into each of the flattened column headers rather than leaving it only once — the LLM reading the table later sees one header row and cannot infer a spanning label from position alone.

5. **Handle numeric formatting**
   Preserve the source's formatting choices explicitly, since they carry meaning:
   - **Parenthesized negatives**: `(1,234)` is a negative number in financial statements. Keep the parentheses as printed — do not silently convert to `-1234`, since a reader (or LLM) scanning the raw source alongside your Markdown should be able to visually cross-check them. If you also need a normalized form for downstream computation, add it as a separate note rather than replacing the original.
   - **Currency symbols**: Keep `$` on the first value in a column per financial-statement convention (subsequent rows in the same column typically omit it in the source) — reproduce this rather than adding or stripping `$` inconsistently.
   - **Percentages**: Preserve the `%` symbol and decimal precision as printed.
   - **Dashes/em-dashes for zero or N/A**: Statements often use `—` or `-` to mean "zero" or "not applicable" rather than a missing value. Keep this symbol rather than converting it to blank or `0`, since those mean different things (blank often signals missing data to an LLM, whereas `—` is an intentional value).
   - **Thousands separators**: Preserve commas as printed (`1,234,567`).

6. **Handle borderless / visually complex tables**
   Many financial tables (especially in PDFs) have no visible grid lines — columns are implied only by whitespace alignment. Naive text extraction turns each row into a run-on sentence with numbers mashed together. Signs this happened: numbers appear concatenated without clear boundaries, or a row that should have 4-5 numeric columns extracts as a single blob.
   - Re-run extraction with a layout/table-detection method rather than a plain-text method (see step 1's PDF guidance).
   - If automated re-extraction still fails, reconstruct the table manually by looking at the original page image/rendering side by side with the garbled extraction, using column position and known statement structure (e.g. "Assets" sections always list Current Assets before Total Assets) as ground truth.
   - Cross-check reconstructed rows against arithmetic relationships that should hold (e.g. subtotals equal the sum of their component lines, or the balance sheet balances: Assets = Liabilities + Equity) as a sanity check before finalizing — this catches misaligned columns.

7. **Verify before handing off**
   - Confirm every row has the same number of columns as the header.
   - Confirm subtotal/total rows arithmetically match their components where verifiable (flag, don't silently fix, any that don't reconcile — that likely indicates an extraction or alignment error worth surfacing to the user rather than a real discrepancy in the source).
   - Confirm units and period context are stated once, clearly, near the top of each table.

## Output format

Present each statement as its own labeled Markdown table:

```markdown
### Consolidated Balance Sheet
_(in thousands of USD)_ — As of December 31, 2024 and 2023

| Line Item | 2024 | 2023 |
|---|---|---|
| **Current assets** | | |
| &nbsp;&nbsp;Cash and cash equivalents | $12,345 | $10,200 |
| &nbsp;&nbsp;Accounts receivable | 4,560 | 4,100 |
| **Total current assets** | **16,905** | **14,300** |
| Long-term debt | (8,000)* | (7,500)* |
| **Total liabilities** | **20,000** | **18,000** |

> \* Includes current portion of long-term debt; see Note 6.
```

After the table(s), briefly state anything that couldn't be verified cleanly (e.g. "Note: subtotal for 'Total operating expenses' in 2023 does not sum from the listed components — possible OCR misread of one line item; recommend checking against the source") so the user and downstream LLM know where to apply extra scrutiny.
