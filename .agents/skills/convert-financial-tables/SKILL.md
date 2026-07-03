---
name: convert-financial-tables
description: Converts PDF financial filings, reports, and statements into LLM-ready Markdown tables with opendataloader-pdf before prompt construction; use when app code needs to send 10-K, 10-Q, or statement tables to an LLM.
---

# Convert Financial Tables

## Core Workflow

Use this skill to convert financial tables from PDF filings and reports into Markdown before the text is passed to an LLM.

1. Accept only PDF financial documents: 10-Ks, 10-Qs, annual reports, interim reports, financial statements, and similar filing/report PDFs.
2. Do not route CSV, XLSX, HTML, image-only files, or generic non-financial PDFs through this skill unless they have first become a PDF filing/report handled by the project convention.
3. Use the `opendataloader-pdf` CLI as the extraction backend. It is the Java-based project convention for PDF table conversion.
4. Let `opendataloader-pdf` handle extraction escalation in this order: Markdown, then cluster, then hybrid Docling for borderless or scanned tables.
5. Return a Markdown string that preserves table structure, period labels, units, notes, page or section markers, and source context when the CLI provides them.
6. Call the conversion immediately before building the LLM prompt, so the prompt receives Markdown tables instead of raw PDF text or bytes.

## TypeScript Integration

Expose the conversion as an async library function in the `ts-base` codebase:

```ts
export async function convertFinancialTablesToMarkdown(
  pdfPath: string,
): Promise<string> {
  // Run opendataloader-pdf with the local project command shape.
}
```

Implementation guidance:

- Use `execFile` or `spawn` with argv arrays rather than shell-interpolated commands.
- Validate that the input path points to a `.pdf` before invoking the CLI.
- Prefer the existing local `opendataloader-pdf` command syntax from project docs or scripts if present.
- Configure the CLI for Markdown output and the project escalation path: markdown -> cluster -> hybrid Docling.
- Reject empty or whitespace-only output as a conversion failure.
- Include CLI stderr and exit code context in thrown errors, without swallowing the original failure.
- Keep the function responsible only for conversion; LLM prompt construction should call it and then insert the returned Markdown into the prompt.

Example call site:

```ts
const tablesMarkdown = await convertFinancialTablesToMarkdown(filingPdfPath);

const prompt = [
  "Analyze these financial tables.",
  "",
  tablesMarkdown,
].join("\n");
```

## Guardrails

- Do not hand-roll PDF table extraction with generic text extraction, OCR, `pdfplumber`, Camelot, Tabula, or ad hoc regex parsing unless the task is explicitly to maintain `opendataloader-pdf` itself.
- Do not pass raw extracted page text to the LLM when a table-aware Markdown conversion can run.
- Do not persist converted Markdown unless the application already has a reason to cache or audit intermediate conversion output.
- Preserve financial labels exactly: statement names, row labels, column headings, currencies, units, footnotes, negative-number notation, and fiscal period text.
