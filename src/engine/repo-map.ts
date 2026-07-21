import { realpath } from "node:fs/promises";
import { extname } from "node:path";

/**
 * Deterministic repository map: layout, test conventions, and git co-change
 * coupling, rendered as a marked AGENTS.md section. Everything here is derived
 * from tracked files and commit history, so the same repository state always
 * produces the same bytes; that is what lets update treat map-only drift in
 * AGENTS.md as safely repairable.
 */

export const repoMapBeginMarker = "<!-- farrier:repo-map:begin -->";
export const repoMapEndMarker = "<!-- farrier:repo-map:end -->";

/** Commits examined for coupling and change-frequency data. */
const commitWindow = 500;
/** Commits touching more files than this are bulk edits; they poison coupling. */
const bulkChangeFileLimit = 20;
const minTrackedFiles = 5;
const maxTopDirectories = 12;
const maxChildDirectories = 6;
const minCoupledChanges = 3;
const maxCoupledPairs = 10;
const maxFrequentFiles = 5;
/** Below this many commits, "frequently changed" is noise, not signal. */
const minCommitsForFrequency = 10;

async function runGit(targetDir: string, args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn({
      cmd: ["git", ...args],
      cwd: targetDir,
      stdout: "pipe",
      stderr: "ignore"
    });
    const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    return exitCode === 0 ? stdout : null;
  } catch {
    return null;
  }
}

type DirectoryStat = {
  files: number;
  extensions: Map<string, number>;
  children: Map<string, number>;
};

function extensionOf(fileName: string): string | null {
  return extname(fileName) || null;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function extensionLabel(stat: DirectoryStat): string {
  const ranked = [...stat.extensions.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const dominant = ranked.filter(([, count]) => count >= stat.files * 0.2).slice(0, 2);
  return dominant.length > 0 ? ` (${dominant.map(([ext]) => ext).join(", ")})` : "";
}

function fileCountLabel(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

function layoutLines(files: readonly string[]): string[] {
  const directories = new Map<string, DirectoryStat>();

  for (const file of files) {
    const segments = file.split("/");
    if (segments.length < 2) {
      continue;
    }

    const top = segments[0];
    let stat = directories.get(top);
    if (!stat) {
      stat = { files: 0, extensions: new Map(), children: new Map() };
      directories.set(top, stat);
    }
    stat.files += 1;
    const extension = extensionOf(segments[segments.length - 1]);
    if (extension) {
      bump(stat.extensions, extension);
    }

    if (segments.length >= 3) {
      bump(stat.children, segments[1]);
    }
  }

  const ranked = [...directories.entries()]
    .sort((a, b) => b[1].files - a[1].files || a[0].localeCompare(b[0]))
    .slice(0, maxTopDirectories);

  const lines: string[] = [];
  for (const [name, stat] of ranked) {
    lines.push(`- \`${name}/\` — ${fileCountLabel(stat.files)}${extensionLabel(stat)}`);

    if (stat.files >= 10) {
      const children = [...stat.children.entries()]
        .filter(([, count]) => count >= 5)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, maxChildDirectories);
      for (const [child, count] of children) {
        lines.push(`  - \`${name}/${child}/\` — ${fileCountLabel(count)}`);
      }
    }
  }

  return lines;
}

type TestPattern = {
  regex: RegExp;
  label: (extension: string) => string;
};

const testPatterns: TestPattern[] = [
  { regex: /\.(test|spec)\.[^./]+$/, label: (ext) => `\`<name>.test${ext}\`` },
  { regex: /(^|\/)test_[^/]+\.py$/, label: () => "`test_<name>.py`" },
  { regex: /_(test|spec)\.[^./]+$/, label: (ext) => `\`<name>_test${ext}\`` }
];

function testLines(files: readonly string[]): string[] {
  const matchCounts = testPatterns.map(() => 0);
  const directories = new Map<string, number>();
  const extensions = new Map<string, number>();
  let total = 0;

  for (const file of files) {
    const index = testPatterns.findIndex((pattern) => pattern.regex.test(file));
    if (index === -1) {
      continue;
    }
    total += 1;
    matchCounts[index] += 1;
    const slash = file.lastIndexOf("/");
    bump(directories, slash === -1 ? "." : file.slice(0, slash));
    const extension = extensionOf(file.slice(slash + 1));
    if (extension) {
      bump(extensions, extension);
    }
  }

  if (total === 0) {
    return [];
  }

  const topDirectories = [...directories.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([dir]) => `\`${dir}/\``);
  const dominantPattern = matchCounts.indexOf(Math.max(...matchCounts));
  const dominantExtension = [...extensions.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )[0][0];
  const naming = testPatterns[dominantPattern].label(dominantExtension);

  return [`- ${total} test files, mostly under ${topDirectories.join(", ")}, named ${naming}.`];
}

type CommitHistory = {
  commits: number;
  fileCounts: Map<string, number>;
  pairCounts: Map<string, number>;
};

function parseCommitHistory(output: string, tracked: ReadonlySet<string>): CommitHistory {
  const history: CommitHistory = { commits: 0, fileCounts: new Map(), pairCounts: new Map() };

  for (const block of output.split("\u0001")) {
    const changed = [...new Set(block.split("\n").map((line) => line.trim()).filter(Boolean))]
      .filter((file) => tracked.has(file))
      .sort();

    if (changed.length === 0 || changed.length > bulkChangeFileLimit) {
      continue;
    }

    history.commits += 1;
    for (const file of changed) {
      bump(history.fileCounts, file);
    }
    for (let i = 0; i < changed.length; i += 1) {
      for (let j = i + 1; j < changed.length; j += 1) {
        bump(history.pairCounts, `${changed[i]}\u0000${changed[j]}`);
      }
    }
  }

  return history;
}

function frequentFileLines(history: CommitHistory): string[] {
  if (history.commits < minCommitsForFrequency) {
    return [];
  }

  // Counts deliberately omit the total commit window: embedding the observed
  // commit count would make every new commit (including the map refresh
  // itself) re-dirty the map. This way it drifts only when a listed fact moves.
  return [...history.fileCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxFrequentFiles)
    .map(([file, count]) => `- \`${file}\` (${count} commits)`);
}

function couplingLines(history: CommitHistory): string[] {
  return [...history.pairCounts.entries()]
    .filter(([, count]) => count >= minCoupledChanges)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxCoupledPairs)
    .map(([pair, count]) => {
      const [left, right] = pair.split("\u0000");
      const [first, second] =
        (history.fileCounts.get(left) ?? 0) >= (history.fileCounts.get(right) ?? 0)
          ? [left, right]
          : [right, left];
      return `- \`${first}\` and \`${second}\` (${count}/${history.fileCounts.get(first) ?? 0})`;
    });
}

/**
 * Render the marked repository-map section for a git repository rooted at
 * targetDir, or null when there is nothing honest to say: git is unavailable,
 * targetDir is not itself a repository root (a parent repository does not
 * count), or fewer than a handful of files are tracked.
 */
export async function generateRepoMapSection(targetDir: string): Promise<string | null> {
  const toplevel = await runGit(targetDir, ["rev-parse", "--show-toplevel"]);
  if (toplevel === null) {
    return null;
  }

  let resolvedTarget: string;
  let resolvedToplevel: string;
  try {
    [resolvedTarget, resolvedToplevel] = await Promise.all([realpath(targetDir), realpath(toplevel.trim())]);
  } catch {
    return null;
  }
  if (resolvedTarget !== resolvedToplevel) {
    return null;
  }

  const [listed, log] = await Promise.all([
    runGit(targetDir, ["ls-files", "-z"]),
    runGit(targetDir, ["log", "--no-merges", "--name-only", "-n", String(commitWindow), "--pretty=format:%x01"])
  ]);
  if (listed === null) {
    return null;
  }
  const files = listed.split("\0").filter(Boolean);
  if (files.length < minTrackedFiles) {
    return null;
  }

  const history = log === null ? null : parseCommitHistory(log, new Set(files));

  const sections: string[] = [
    "## Repository Map",
    "",
    "Generated by farrier from tracked files and git history; `farrier map` or " +
      "`farrier update --yes` refreshes it. Descriptive, not a reading list: use it " +
      "to locate work, not as an instruction to read files a task does not need.",
    ""
  ];

  const layout = layoutLines(files);
  if (layout.length > 0) {
    sections.push("### Layout", "", ...layout, "");
  }

  const tests = testLines(files);
  if (tests.length > 0) {
    sections.push("### Tests", "", ...tests, "");
  }

  if (history) {
    const frequent = frequentFileLines(history);
    if (frequent.length > 0) {
      sections.push("### Frequently changed files (recent history)", "", ...frequent, "");
    }

    const coupling = couplingLines(history);
    if (coupling.length > 0) {
      sections.push(
        "### Change coupling (recent history)",
        "",
        "Files that change together; counts are co-changes/commits touching the first file.",
        "",
        ...coupling,
        ""
      );
    }
  }

  const body = sections.join("\n").trimEnd();
  return `${repoMapBeginMarker}\n${body}\n${repoMapEndMarker}`;
}

/** Content split around the marked map region, or null when no region exists. */
function splitRepoMapRegion(content: string): { before: string; region: string; after: string } | null {
  const begin = content.indexOf(repoMapBeginMarker);
  const end = content.indexOf(repoMapEndMarker);
  if (begin === -1 || end < begin) {
    return null;
  }

  return {
    before: content.slice(0, begin).trimEnd(),
    region: content.slice(begin, end + repoMapEndMarker.length),
    after: content.slice(end + repoMapEndMarker.length).replace(/^\n+/, "")
  };
}

/**
 * Insert or refresh the marked map section in AGENTS.md content, preserving
 * everything outside the markers. A null section leaves the content unchanged
 * (an existing map may be stale, but nothing better can be generated).
 */
export function spliceRepoMapSection(content: string, section: string | null): string {
  if (section === null) {
    return content;
  }

  const split = splitRepoMapRegion(content);
  if (!split) {
    return `${content.trimEnd()}\n\n${section}\n`;
  }

  return `${split.before}\n\n${section}\n${split.after.length > 0 ? `\n${split.after}` : ""}`;
}

/** Remove the marked map section, for comparing AGENTS.md content without it. */
export function stripRepoMapSection(content: string): string {
  const split = splitRepoMapRegion(content);
  if (!split) {
    return content;
  }

  return split.after.length > 0 ? `${split.before}\n\n${split.after}` : `${split.before}\n`;
}

/** The marked map region embedded in content (markers included), if any. */
export function extractRepoMapSection(content: string): string | null {
  return splitRepoMapRegion(content)?.region ?? null;
}
