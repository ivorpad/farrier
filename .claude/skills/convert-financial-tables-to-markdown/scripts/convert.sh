#!/usr/bin/env bash
# Convert a financial table spreadsheet (xlsx/xls/csv) into a GFM pipe-table markdown file.
set -euo pipefail

usage() {
  echo "Usage: $(basename "$0") <input.xlsx|input.xls|input.csv> [-o output.md]" >&2
  exit 1
}

INPUT=""
OUTPUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output)
      OUTPUT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      INPUT="$1"
      shift
      ;;
  esac
done

[[ -z "$INPUT" ]] && usage
[[ -f "$INPUT" ]] || { echo "Input file not found: $INPUT" >&2; exit 1; }

command -v soffice >/dev/null 2>&1 || { echo "soffice (LibreOffice) not found on PATH" >&2; exit 1; }
command -v opendataloader-pdf >/dev/null 2>&1 || { echo "opendataloader-pdf not found on PATH" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
base="$(basename "${INPUT%.*}")"
OUTPUT="${OUTPUT:-${base}.md}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

echo "Rendering $INPUT to PDF..." >&2
soffice --headless --convert-to pdf --outdir "$workdir" "$INPUT" >/dev/null 2>&1

pdf_path="$workdir/${base}.pdf"
[[ -f "$pdf_path" ]] || { echo "LibreOffice conversion failed to produce $pdf_path" >&2; exit 1; }

echo "Extracting tables with opendataloader-pdf..." >&2
opendataloader-pdf "$pdf_path" -f markdown --to-stdout > "$workdir/plain.md" 2>/dev/null || true

pipe_count="$(grep -c '^|' "$workdir/plain.md" 2>/dev/null || true)"
pipe_count="${pipe_count:-0}"

if [[ "$pipe_count" -gt 0 ]]; then
  raw_md="$workdir/plain.md"
else
  echo "No pipe tables in plain output (likely borderless); retrying with cluster method..." >&2
  opendataloader-pdf "$pdf_path" -f markdown-with-html --table-method cluster --to-stdout > "$workdir/raw.md" 2>/dev/null
  raw_md="$workdir/raw.md"
fi

python3 "$SCRIPT_DIR/html_table_to_gfm.py" "$raw_md" "$OUTPUT"

echo "Wrote $OUTPUT" >&2
