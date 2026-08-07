import { createHash } from "node:crypto";

import { canonicalEvidence } from "../behavior-evidence";

export type NativeHarnessConsumer =
  | "coding-agent"
  | "claude-code"
  | "codex"
  | "agent-tooling"
  | "ci"
  | "repository-verifier";

export type NativeHarnessArtifact = {
  path: string;
  contentDigest: string;
  mode: number;
  consumer: NativeHarnessConsumer;
};

export type NativeHarnessManifest = {
  schemaVersion: 1;
  sourceCommit: string;
  sourceTree: string;
  digest: string;
  artifacts: NativeHarnessArtifact[];
};

export type NativeHarnessOverlayEvidence = {
  sourceTree: string;
  kind: "brief" | "none";
  changedPaths: string[];
  statusSha256: string;
  valid: boolean;
  problems: string[];
};

export type NativeInstructionCompositionEvidence = {
  schemaVersion: 1;
  baselineContentSha256: string;
  briefContentSha256: string;
  finalContentSha256: string;
  baselineBytes: number;
  briefBytes: number;
  finalBytes: number;
};

export const oracleBriefPrefix = "\n\n<!-- farrier:oracle-brief:v1 -->\n";
export const oracleBriefSuffix = "\n<!-- /farrier:oracle-brief -->\n";

const rootVerificationFiles = new Set([
  "package.json",
  "pyproject.toml",
  "Gemfile",
  "Makefile",
  "justfile",
  "Justfile",
  "pytest.ini",
  "tox.ini",
  "ruff.toml",
  ".rubocop.yml",
  ".eslintrc",
  ".eslintrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
]);

async function output(
  command: string[],
  cwd: string,
  binary = false,
  trim = true,
): Promise<string | Uint8Array> {
  const process = Bun.spawn(command, {
    cwd,
    env: {
      PATH: Bun.env.PATH ?? "/usr/bin:/bin",
      HOME: "/var/empty",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buffer, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed (${exitCode}): ${stderr.trim()}`);
  const bytes = new Uint8Array(buffer);
  if (binary) return bytes;
  const decoded = new TextDecoder().decode(bytes);
  return trim ? decoded.trim() : decoded;
}

function route(path: string): NativeHarnessConsumer | undefined {
  const basename = path.split("/").at(-1) ?? path;
  if (basename === "AGENTS.md" || basename === "CLAUDE.md" || basename === "CONTRIBUTING.md") {
    return "coding-agent";
  }
  if (path.startsWith(".claude/")) return "claude-code";
  if (path.startsWith(".codex/")) return "codex";
  if (path.startsWith(".agents/")) return "agent-tooling";
  if (path.startsWith(".github/workflows/")) return "ci";
  if (!path.includes("/") && rootVerificationFiles.has(path)) return "repository-verifier";
  return undefined;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function composeNativeInstructionOverlay(input: {
  baseline: Uint8Array;
  brief: Uint8Array;
}): { bytes: Uint8Array; evidence: NativeInstructionCompositionEvidence } {
  const prefix = new TextEncoder().encode(oracleBriefPrefix);
  const suffix = new TextEncoder().encode(oracleBriefSuffix);
  const bytes = new Uint8Array(input.baseline.length + prefix.length + input.brief.length + suffix.length);
  bytes.set(input.baseline, 0);
  bytes.set(prefix, input.baseline.length);
  bytes.set(input.brief, input.baseline.length + prefix.length);
  bytes.set(suffix, input.baseline.length + prefix.length + input.brief.length);
  return {
    bytes,
    evidence: {
      schemaVersion: 1,
      baselineContentSha256: sha256(input.baseline),
      briefContentSha256: sha256(input.brief),
      finalContentSha256: sha256(bytes),
      baselineBytes: input.baseline.length,
      briefBytes: input.brief.length,
      finalBytes: bytes.length,
    },
  };
}

export function verifyNativeInstructionComposition(input: {
  baseline: Uint8Array;
  brief: Uint8Array;
  final: Uint8Array;
  expectedBriefDigest: string;
}): NativeInstructionCompositionEvidence {
  const composed = composeNativeInstructionOverlay({ baseline: input.baseline, brief: input.brief });
  if (composed.evidence.briefContentSha256 !== input.expectedBriefDigest) {
    throw new Error("Brief bytes do not match the frozen intervention digest.");
  }
  if (!Buffer.from(composed.bytes).equals(Buffer.from(input.final))) {
    throw new Error("Instruction overlay did not preserve the baseline and append the exact frozen brief.");
  }
  return composed.evidence;
}

export async function createNativeHarnessManifest(input: {
  repository: string;
  commit: string;
}): Promise<NativeHarnessManifest> {
  const sourceCommit = String(await output(["git", "rev-parse", `${input.commit}^{commit}`], input.repository));
  const sourceTree = String(await output(["git", "rev-parse", `${input.commit}^{tree}`], input.repository));
  const listing = String(await output([
    "git", "ls-tree", "-r", "-z", "--full-tree", sourceCommit,
  ], input.repository));
  const artifacts: NativeHarnessArtifact[] = [];
  for (const entry of listing.split("\0").filter(Boolean)) {
    const match = entry.match(/^(\d+)\s+blob\s+([0-9a-f]+)\t([\s\S]+)$/);
    if (!match) continue;
    const [, rawMode, objectId, path] = match;
    const consumer = route(path!);
    if (!consumer) continue;
    const bytes = await output(["git", "cat-file", "blob", objectId!], input.repository, true);
    artifacts.push({
      path: path!,
      contentDigest: sha256(bytes as Uint8Array),
      mode: Number.parseInt(rawMode!, 8),
      consumer,
    });
  }
  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  const body = { schemaVersion: 1 as const, sourceCommit, sourceTree, artifacts };
  return { ...body, digest: sha256(canonicalEvidence(body)) };
}

export async function verifyNativeHarnessOverlay(input: {
  workspace: string;
  expectedSourceTree: string;
  kind: "brief" | "none";
  allowedBriefPath?: string;
}): Promise<NativeHarnessOverlayEvidence> {
  const sourceTree = String(await output(["git", "rev-parse", "HEAD^{tree}"], input.workspace));
  const rawStatus = String(await output([
    "git", "status", "--porcelain=v1", "-z", "--untracked-files=all",
  ], input.workspace, false, false));
  const problems: string[] = [];
  if (sourceTree !== input.expectedSourceTree) problems.push("Workspace baseline tree does not match the frozen source tree.");
  const changedPaths: string[] = [];
  const entries = rawStatus.split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const status = entry.slice(0, 2);
    if (status.includes("R") || status.includes("C")) {
      problems.push("Harness overlay must not rename or copy repository files.");
      index += 1;
    }
    changedPaths.push(entry.slice(3));
  }
  changedPaths.sort();
  if (input.kind === "none" && changedPaths.length !== 0) {
    problems.push("A none intervention must leave the native repository unchanged.");
  }
  if (input.kind === "brief"
    && (!input.allowedBriefPath || changedPaths.length !== 1 || changedPaths[0] !== input.allowedBriefPath)) {
    problems.push("A brief intervention must change exactly its one allowed native instruction path.");
  }
  return {
    sourceTree,
    kind: input.kind,
    changedPaths,
    statusSha256: sha256(rawStatus),
    valid: problems.length === 0,
    problems,
  };
}
