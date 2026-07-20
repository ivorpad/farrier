import type { HarnessAuditLine } from "./harness-audit-types";

export type PackageScriptPath = { name: string; body: string; path: string };

export function invokedLocalCommandPath(body: string): string | undefined {
  if (/(?:&&|\|\||[;|<>`]|\$\(|[\r\n])/.test(body)) return undefined;
  const direct = body.match(/^\.\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)(?:\s|$)/)?.[1];
  const wrapped = body.match(
    /^(?:bash|sh|zsh|node|bun|deno|python|python3|tsx)\s+((?:\.\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)(?:\s|$)/,
  )?.[1];
  return (direct ?? wrapped)?.replace(/^\.\//, "");
}

export function packageScriptPaths(text: string): PackageScriptPath[] {
  let raw: { scripts?: unknown };
  try {
    raw = JSON.parse(text) as { scripts?: unknown };
  } catch {
    return [];
  }
  if (!raw.scripts || typeof raw.scripts !== "object" || Array.isArray(raw.scripts)) return [];
  return Object.entries(raw.scripts).flatMap(([name, value]) => {
    if (typeof value !== "string") return [];
    const path = invokedLocalCommandPath(value);
    return path ? [{ name, body: value, path }] : [];
  });
}

export function repositoryPathSearchText(line: HarnessAuditLine): string {
  return line.text.replace(
    /\$(?:CLAUDE_PROJECT_DIR|\{CLAUDE_PROJECT_DIR\})\//g,
    (prefix) => " ".repeat(prefix.length),
  );
}

export function insideHomeDirectoryPath(line: HarnessAuditLine, start: number): boolean {
  const before = line.text.slice(0, start);
  if (before.endsWith("~/") || before.endsWith("$HOME/") || before.endsWith("${HOME}/")) return true;
  if (before.endsWith("$") && line.text.startsWith("HOME/", start)) return true;
  if ((before.match(/`/g)?.length ?? 0) % 2 !== 1) return false;
  const fragment = before.slice(before.lastIndexOf("`") + 1);
  return /^(?:~|\$HOME|\$\{HOME\})\//.test(fragment);
}

export function insideGitReference(line: HarnessAuditLine, start: number, end: number): boolean {
  return /^refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/.test(line.text.slice(start, end));
}

function moduleSpecifierAt(line: HarnessAuditLine, start: number, end: number): string | undefined {
  const before = line.text.slice(0, start);
  const quoteIndex = Math.max(before.lastIndexOf('"'), before.lastIndexOf("'"), before.lastIndexOf("`"));
  if (quoteIndex < 0) return undefined;
  const quote = line.text[quoteIndex];
  if (!line.text.slice(end).startsWith(quote)) return undefined;
  const specifier = before.slice(quoteIndex + 1) + line.text.slice(start, end);
  const statement = before.slice(0, quoteIndex);
  return /(?:\b(?:from|import)\s*|\b(?:require|import)\s*\(\s*)$/i.test(statement)
    ? specifier
    : undefined;
}

export function insideBareModuleSpecifier(line: HarnessAuditLine, start: number, end: number): boolean {
  const specifier = moduleSpecifierAt(line, start, end);
  return specifier !== undefined && !/^(?:\.\.?\/|\/)/.test(specifier);
}

export function insideRelativeModuleSpecifier(line: HarnessAuditLine, start: number, end: number): boolean {
  return /^(?:\.\.?\/)/.test(moduleSpecifierAt(line, start, end) ?? "");
}

export function relativeModuleSpecifiers(line: HarnessAuditLine): string[] {
  const specifiers: string[] = [];
  for (const match of line.text.matchAll(/(["'`])(\.\.?\/[^"'`\s]+)\1/g)) {
    const specifier = match[2]!;
    const start = (match.index ?? 0) + 1;
    if (moduleSpecifierAt(line, start, start + specifier.length) === specifier) specifiers.push(specifier);
  }
  return specifiers;
}

export function insideAwsResourceIdentifier(line: HarnessAuditLine, start: number): boolean {
  const before = line.text.slice(0, start);
  const name = "(?:ResourceLabel|ResourceArn|LogGroupName|LogStreamName)";
  return new RegExp(`["']?${name}["']?\\s*:\\s*["']?$`, "i").test(before)
    || /--(?:resource-label|resource-arn|log-group-name|log-stream-name)\s+["']?$/i.test(before);
}

export function illustrativeFencedPathLine(text: string): boolean {
  return /^\s*(?:\/\/|#|--)\s*output\s*:\s*[\[{]/i.test(text)
    || /^\s*(?:`{3,}|~{3,})[^\n]*\b(?:title|filename)=["'][^"']+\/[^"']+["']/i.test(text)
    || /^\s*(?:\/\/|#|--)\s*(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{1,16}(?:\s+(?:-\s+.*|\([^)]*\)))?$/.test(text);
}

export function isProspectiveCreationTarget(line: HarnessAuditLine, start: number): boolean {
  const before = line.text.slice(0, start);
  const valueQuote = line.kind === "toolchain" && /(?:^|\/)package\.json$/.test(line.path)
    ? before.lastIndexOf('"')
    : -1;
  const context = valueQuote >= 0 ? before.slice(valueQuote + 1) : before;
  if (/\b(?:from|using|based on|reference|template)\s*[`"']?\s*$/i.test(context)) return false;
  const directives = Array.from(context.matchAll(
    /\b(create|edit|execute|generate|invoke|load|read|run|scaffold|update|use)\b/gi,
  ));
  const nearest = directives.at(-1)?.[1]?.toLowerCase();
  return nearest === "create" || nearest === "generate" || nearest === "scaffold";
}
