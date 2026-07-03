# Financial Table Quirks — Worked Examples

Detailed, worked-example version of the rules summarized in SKILL.md. Read this when the
source table is messy enough that the quick-reference rules leave you unsure how to handle a
specific cell or layout.

## 1. Multi-row / merged headers

Source (as it visually appears, spanning two header rows):

```
                |        2024         |        2023         |
Line Item       |  Q1   |   Q2         |  Q1   |   Q2         |
Revenue         | 1,000 | 1,200        |  900  | 1,050        |
```

Collapse to one header row that carries both levels of information:

```markdown
| Line Item | 2024 Q1 | 2024 Q2 | 2023 Q1 | 2023 Q2 |
| --- | --- | --- | --- | --- |
| Revenue | 1000 | 1200 | 900 | 1050 |
```

If a header spans three levels (e.g. Region → Year → Quarter), join all levels with a
consistent separator (space or `/`) — pick whichever reads less ambiguously given the actual
labels, and use it uniformly across every column so the reader can parse the pattern once and
apply it everywhere.

## 2. Parenthesized negatives

Source: `Net loss    (2,450)`

Convert to: `Net loss | -2450`

Watch for the case where parentheses are used for something *other* than sign — e.g. a units
annotation like "Revenue (in thousands)" in a header or label cell. Only apply the
negative-number conversion to numeric value cells, not to header/label text that happens to
contain parentheses.

## 3. Currency symbols, thousands separators, and mixed units

Source: `$1,234,567.89`

Convert to: `1234567.89`, and note the currency once (in a column header like "Revenue (USD)"
or in the Notes section) rather than in every cell.

If a table mixes units within a single column (rare, but happens when a document was assembled
from multiple sources — e.g. some rows in USD thousands, others in raw USD), do not silently
normalize the magnitude. Flag it explicitly in Notes: "Rows X and Y appear to be in different
units than the rest of the table — verify against the source before using downstream."

## 4. Footnote markers

Source:
```
Total revenue*        45,200
Adjusted EBITDA†       8,100
...
* Includes discontinued operations through Q2.
† Non-GAAP measure; see reconciliation in Appendix B.
```

Convert to:
```markdown
| Line Item | Value |
| --- | --- |
| Total revenue | 45200 |
| Adjusted EBITDA | 8100 |

**Notes:**
- `*` Total revenue includes discontinued operations through Q2.
- `†` Adjusted EBITDA is a non-GAAP measure; see reconciliation in Appendix B (source document).
```

Keep the marker character as a lookup key in Notes so a reader can trace a specific cell back
to its caveat. If the footnote text itself lives on another page or appendix you don't have
access to, say so ("see Appendix B, not included in this excerpt") rather than omitting the
footnote reference entirely.

## 5. Subtotal / total rows and section hierarchy

Source (indentation-based hierarchy, common in income statements):
```
Revenue
    Product sales          8,000
    Service revenue         2,200
Total revenue                    10,200
Operating expenses
    Salaries                3,100
    Rent                      900
Total operating expenses          4,000
Net income                        6,200
```

Two acceptable conventions — pick one per table and apply it consistently:

**Prefix convention:**
```markdown
| Line Item | Value |
| --- | --- |
| Revenue | — |
| — Product sales | 8000 |
| — Service revenue | 2200 |
| **Total revenue** | **10200** |
| Operating expenses | — |
| — Salaries | 3100 |
| — Rent | 900 |
| **Total operating expenses** | **4000** |
| **Net income** | **6200** |
```

**Section-column convention** (better when there are many line items per section, since it
keeps the Line Item column readable):
```markdown
| Section | Line Item | Value |
| --- | --- | --- |
| Revenue | Product sales | 8000 |
| Revenue | Service revenue | 2200 |
| Revenue | **Total revenue** | **10200** |
| Operating expenses | Salaries | 3100 |
| Operating expenses | Rent | 900 |
| Operating expenses | **Total operating expenses** | **4000** |
| — | **Net income** | **6200** |
```

A section header with no value of its own (like "Revenue" or "Operating expenses" above) should
still get a placeholder (`—`) in the value column rather than a blank cell.

## 6. Multi-page tables

Common failure modes to check for explicitly:

- **Repeated header, different page**: the continuation page shows the header row again
  (sometimes labeled "Balance Sheet (continued)"). Drop the duplicate header when merging —
  the reader only needs it once.
- **No repeated header**: the continuation page just resumes rows with no header at all,
  relying on the reader having just seen the first page. Confirm column order/count still
  matches before appending rows; don't assume it does.
- **Page-boundary subtotal ambiguity**: a page ends with what looks like a total row, and the
  next page continues with more line items before the "real" total. This usually means the
  page-boundary row is a running subtotal, not the table's total — label it accordingly (e.g.
  "Subtotal (page 1)") instead of using "Total", which would be misleading if someone later
  scans the table for the word "Total" to find the bottom-line figure.
- **Column reordering across pages**: rare but happens in reports assembled from different
  source systems. If page 2's columns are in a different order than page 1's, realign them by
  header label, not by position, before merging rows.

## 7. Illegible or uncertain values (scans / images)

If you're transcribing from an image or a poor-quality scan and a digit is genuinely
ambiguous (e.g. a smudge could be a "3" or an "8"):

- Write your best-guess value with a `[?]` suffix: `1,234[?]`.
- Add a Notes line naming the exact cell: "Value for 'Accrued liabilities, 2022' is unclear in
  the source scan; transcribed as 1,234 but could be 1,284 — verify against original."
- Never round or "clean up" an uncertain value to make it look more plausible — the flag is
  more valuable than a confident-looking guess.
