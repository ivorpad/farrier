/**
 * Command classification for failure-signal mining: which failed commands are
 * the normal work loop, which are a harness gap, and what key a signal groups
 * under. Nothing here reads a transcript or counts anything.
 */

/**
 * History rewrites are the recovery from an oversized commit; one is evidence
 * enough. Only invocation position counts — `command -v git-filter-repo` is a
 * tool probe, not a rewrite.
 */
export const historyRewritePattern = /(?:^|[;&|(]\s*)(?:git\s+filter-(?:repo|branch)\b|git-filter-repo\b|bfg\s|git\s+lfs\s+migrate\b)/i;
export const sizeRejectionPattern = /exceeds git(?:hub|lab)?'?s? file size limit|remote:\s*error:\s*file .{0,200}? (?:is|exceeds) \d|larger than .{0,40}(?:recommended )?maximum file size|\bGH001\b/i;
export const gitCommandPattern = /(^|[;&|(]\s*)(?:git|gh|hub)\b/;
export const pushCommandPattern = /(^|[;&|]\s*)git\b[^;&|]*\bpush\b/;
export const pushRejectionPattern = /!\s*\[(?:remote )?rejected\]|failed to push some refs|\[remote rejected\]/i;

const lsofKillPattern = /lsof\s+(?:-\S+\s+)*-t?i(?::|\s*:?\s*)(?:tcp:|udp:)?(\d{2,5})[^|]*\|\s*(?:xargs\s+)?kill\b/i;
export const shellWordPattern = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;

/**
 * Heads of read-only exploration / plumbing commands. Their failures are the
 * normal work loop (a grep with no matches exits 1), never a harness gap.
 */
const explorationHeads = new Set([
  "grep", "rg", "sed", "awk", "cat", "ls", "find", "head", "tail", "wc", "echo", "printf",
  "mkdir", "cd", "pushd", "popd", "pgrep", "ps", "lsof", "kill", "pkill", "killall",
  "which", "type", "stat", "file", "tree", "du", "df", "env", "printenv", "sleep",
  "true", "false", "test", "touch", "cp", "mv", "rm", "ln", "chmod", "curl", "wget",
  "git", "python", "python3", "node", "open", "date", "diff", "xargs", "tee", "jq"
]);

/** Verification verbs: failing checks/tests are iteration, not rediscovery. */
const verificationTokens = new Set([
  "pytest", "vitest", "jest", "tsc", "eslint", "ruff", "prettier",
  "rspec", "mocha", "playwright", "cypress"
]);
const verificationTokenPattern = /^(?:test|tests|check|lint|typecheck|build|fmt|format|spec)(?:[:.][\w:.-]*)?$/i;

function unquote(token: string): string {
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1);
  }
  return token;
}

export function killTargets(command: string): string[] {
  const targets: string[] = [];
  // The lsof|xargs kill idiom spans a pipe; match it on the whole command.
  const lsof = command.match(lsofKillPattern);
  if (lsof?.[1]) targets.push(`port:${lsof[1]}`);

  for (const segment of command.split(/\|\||&&|;|\|/)) {
    const tokens = segment.match(shellWordPattern) ?? [];
    const head = tokens.findIndex((token) => token === "pkill" || token === "killall");
    if (head < 0) continue;
    // First non-flag argument is the name/pattern (with -f it is the
    // full-command-line pattern; either way it is what to audit for).
    const argument = tokens.slice(head + 1).find((token) => !token.startsWith("-"));
    if (!argument) continue;
    const target = unquote(argument);
    if (target.length >= 3 && !/^\d+$/.test(target)) targets.push(target);
  }
  return targets;
}

/**
 * Shell segments of one command line, split on newlines, `;`, `&&`, `||`, and
 * pipes. Quoting is tracked: a `bun -e 'import x; run()'` one-liner is one
 * segment, not a command called `import`.
 */
function commandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: string | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    const doubled = command[index + 1] === char;
    if (char === "\n" || char === ";" || char === "|" || (char === "&" && doubled)) {
      if (doubled) index += 1;
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);

  return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

function meaningfulTokens(segment: string): string[] {
  return (segment.match(shellWordPattern) ?? []).filter((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
}

function headName(tokens: string[]): string | undefined {
  const headToken = tokens[0];
  if (!headToken) return undefined;
  return (headToken.split("/").pop() ?? headToken).toLowerCase();
}

/** Directory and shell-option preludes carry no signal of their own. */
const preludeHeads = new Set(["cd", "set", "export", "unset", "source", ".", "pushd", "popd"]);
/** Loop and conditional headers; the command lives in the body segment. */
const controlFlowHeads = new Set(["for", "while", "until", "if", "case", "select"]);
/** Block keywords that merely precede the real command in their segment. */
const blockKeywords = new Set(["do", "then", "else", "elif", "done", "fi", "esac", "{", "}"]);
/**
 * Runners that say nothing on their own: `bun` or `docker` failing is not a
 * finding, `bun run x` or `docker compose up` is. Anything else may key alone.
 */
const genericRunnerHeads = new Set([
  "bun", "npm", "pnpm", "yarn", "npx", "uv", "uvx", "deno", "cargo", "go", "docker",
  "bundle", "poetry", "pdm", "rye", "task", "rake", "just",
  "bash", "sh", "zsh", "dash", "ruby", "perl", "swift"
]);

function isVerificationToken(token: string): boolean {
  return verificationTokens.has(token.toLowerCase()) || verificationTokenPattern.test(token);
}

/**
 * Wrappers hide the command that actually failed: `bash -lc "rg ..."` is a
 * search, not a bash failure, and would otherwise defeat every filter below.
 */
// Searched, not anchored: the wrapper can be anything, including a
// project-local one (`rtk proxy sh -c '<cmd>'`).
const shellInvocationPattern = /(?:^|\s)(?:ba|z|da)?sh\s+-[a-z]*c\s+(['"])([\s\S]*?)\1/;
const leadingWrapperPattern = /^(?:(?:sudo|nohup|command|time|stdbuf\s+-\S+|timeout\s+\S+)\s+)+/;

function unwrapShell(command: string, depth = 0): string {
  if (depth > 2) return command;
  const inner = command.trim().match(shellInvocationPattern)?.[2];
  if (inner && inner.trim().length > 0) return unwrapShell(inner, depth + 1);
  const stripped = command.replace(leadingWrapperPattern, "");
  return stripped === command ? command : unwrapShell(stripped, depth + 1);
}

/**
 * Tokens allowed into a signal key: subcommands and verbs, never paths,
 * filenames, versions, or identifiers like a simulator UUID.
 */
const keyTokenPattern = /^[A-Za-z][A-Za-z0-9_-]*$/;
const maxKeyTokens = 3;
const maxKeyTokenChars = 32;
/** Exploration hides behind wrappers (`rtk proxy grep ...`), not just at head position. */
const commandPositionDepth = 3;

/**
 * The repeated-failure key for one failed command, or undefined when the
 * command is the normal work loop (exploration reads, verification runs).
 *
 * The key is the command's leading verbs, not the command text: agents re-run
 * the same operation with a different path, port, or UUID every time, and an
 * exact-command key scatters those into singletons that never reach the
 * two-session threshold. Length and composition do not disqualify a command —
 * codex records shell work as chained scripts with absolute paths, so a length
 * cap silently excluded that whole backend — but every segment of a chain must
 * pass the semantic filters, so `set -o pipefail; xcodebuild ... test` stays a
 * verification run and `cd repo && pnpm package` keys on `pnpm package`.
 */
export function failureSignalKey(command: string): string | undefined {
  let principal: string[] | undefined;

  for (const segment of commandSegments(unwrapShell(command))) {
    let tokens = meaningfulTokens(segment);
    while (tokens[0] && blockKeywords.has(tokens[0].toLowerCase())) tokens = tokens.slice(1);
    const head = headName(tokens);
    if (!head || preludeHeads.has(head) || controlFlowHeads.has(head)) continue;
    if (tokens.slice(0, commandPositionDepth).some((token) => explorationHeads.has(headName([token])!))) {
      return undefined;
    }
    if (tokens.some(isVerificationToken)) return undefined;
    principal ??= tokens;
  }

  if (!principal || principal.length < 2) return undefined;

  const parts = [headName(principal)!];
  for (const token of principal.slice(1)) {
    if (parts.length >= maxKeyTokens) break;
    if (token.startsWith("-")) continue;
    if (token.length > maxKeyTokenChars || !keyTokenPattern.test(token)) break;
    parts.push(token);
  }

  if (parts.length < 2 && genericRunnerHeads.has(parts[0]!)) return undefined;
  return parts.join(" ");
}

/**
 * Coarse cluster key for work-loop failures: the first one or two meaningful
 * tokens (head basename + subcommand/flag). A day of 239 xcodebuild variants
 * clusters to a handful of keys instead of 239 exact commands.
 */
export function workLoopClusterKey(command: string): string | undefined {
  const tokens = command.match(shellWordPattern) ?? [];
  const meaningful = tokens.filter((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  const headToken = meaningful[0];
  if (!headToken) return undefined;
  const head = (headToken.split("/").pop() ?? headToken).toLowerCase();
  const second = meaningful[1];
  return second && second.length <= 40 ? `${head} ${second}` : head;
}

/**
 * The most informative line of a failed tool result, for work-loop failure
 * samples: prefer the first error-looking line (codex exec output opens with
 * a "Command: ..." wrapper line that says nothing), else the first non-empty
 * line.
 */
export function firstUsefulLine(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.find((line) => /\b(?:error|failed|failure|denied|traceback|exception|fatal)\b/i.test(line)) ?? lines[0];
}
