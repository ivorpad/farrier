#!/usr/bin/env python3
"""Rewrite HTML <table> blocks in a markdown file as GFM pipe tables.

Passes text through unchanged wherever no <table> tags are present, so it's safe
to run over markdown that's already pure GFM pipe tables.
"""
import re
import sys
from html.parser import HTMLParser

TABLE_RE = re.compile(r"<table\b.*?</table>", re.IGNORECASE | re.DOTALL)


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self._row = None
        self._cell_parts = None
        self._in_cell = False

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._in_cell = True
            self._cell_parts = []
        elif tag == "br" and self._in_cell:
            self._cell_parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._in_cell:
            text = "".join(self._cell_parts).strip()
            text = re.sub(r"\s+", " ", text)
            text = text.replace("|", "\\|")
            self._row.append(text)
            self._in_cell = False
            self._cell_parts = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._in_cell:
            self._cell_parts.append(data)


def _table_to_gfm(html_table):
    parser = _TableParser()
    parser.feed(html_table)
    rows = [r for r in parser.rows if r]
    if not rows:
        return html_table

    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]

    header, *body = rows
    lines = ["| " + " | ".join(header) + " |"]
    lines.append("| " + " | ".join(["---"] * width) + " |")
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def convert(text):
    return TABLE_RE.sub(lambda m: _table_to_gfm(m.group(0)), text)


def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.md> <output.md>", file=sys.stderr)
        sys.exit(1)

    src, dst = sys.argv[1], sys.argv[2]
    with open(src, "r", encoding="utf-8") as f:
        text = f.read()

    with open(dst, "w", encoding="utf-8") as f:
        f.write(convert(text))


if __name__ == "__main__":
    main()
