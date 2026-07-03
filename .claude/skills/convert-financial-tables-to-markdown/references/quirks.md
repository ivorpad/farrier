# Extraction quirks

Edge cases seen when routing spreadsheet-derived financial tables through PDF table extraction,
and how `convert.sh` (or a manual re-run) should handle each.

## Borderless tables get flattened to prose

Financial statements often render without visible cell borders once turned into a PDF. Plain
`-f markdown` output then loses the `|` table syntax entirely and reads as run-on text.
`convert.sh` detects this automatically (`grep -c '^|'` on the plain output) and retries with:

```bash
opendataloader-pdf file.pdf -f markdown-with-html --table-method cluster --to-stdout
```

This recovers table structure but emits it as raw HTML `<table>` markup instead of GFM pipes,
which is why every run — even the plain-markdown path — is passed through
`html_table_to_gfm.py` before being written out.

## Multi-row / merged headers

Financial statements frequently have a two-row header (e.g. a blank top-left cell, then
"Q1 | Q2 | Q3 | Q4" under a merged "FY2025" cell). The cluster table method usually keeps these
as separate `<tr>` rows rather than merging them, which `html_table_to_gfm.py` will render as
two header-shaped rows in the GFM output — the first becomes the GFM header row, the second
becomes a normal data row. If the result reads oddly, manually merge the two header lines in the
output `.md` file; this is a one-time fix per template, not a per-run problem once the source
layout is known.

## Still garbled after the cluster retry

For scanned or heavily irregular financial exports, the cluster method may not be enough. Fall
back to the hybrid layout-model extraction (requires the `opendataloader-pdf-hybrid` docling
server):

```bash
opendataloader-pdf-hybrid --port 5003 --log-level warning &
until curl -s http://localhost:5003/ >/dev/null; do sleep 2; done
opendataloader-pdf file.pdf -f markdown-with-html,json \
  --hybrid docling-fast --hybrid-url http://localhost:5003 -o .
lsof -tiTCP:5003 -sTCP:LISTEN | xargs kill
```

Then run `html_table_to_gfm.py` over the resulting `.md` file as usual.

## Empty or near-empty output

If `soffice --headless --convert-to pdf` silently fails (common on first run if a stale
LibreOffice user-profile lock exists), `convert.sh` exits early because the expected PDF is
missing. Re-running usually clears the lock; if not, delete the LibreOffice lock file under
`~/.config/libreoffice/4/user/.lock` and retry.
