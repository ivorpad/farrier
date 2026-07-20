import { createHash } from "node:crypto";
import type {
  HarnessAuditCorpus,
  HarnessAuditDocument,
} from "./harness-audit-evidence";
import type {
  HarnessAuditCheck,
  HarnessAuditCitation,
  HarnessAuditLine,
  HarnessAuditRecommendation,
} from "./harness-audit-types";

function citation(line: HarnessAuditLine): HarnessAuditCitation {
  return { path: line.path, line: line.line, excerpt: line.text.trim().slice(0, 320) };
}

function lineFor(
  documents: HarnessAuditDocument[],
  path: string,
  patterns: RegExp[],
): HarnessAuditLine | undefined {
  const document = documents.find((item) => item.path === path);
  if (!document) return undefined;
  const lines = document.text.split("\n");
  let index = -1;
  for (const pattern of patterns) {
    index = lines.findIndex((line) => pattern.test(line));
    if (index >= 0) break;
  }
  if (index < 0) return undefined;
  return {
    id: `local:${path}:${index + 1}`,
    path,
    line: index + 1,
    text: lines[index]!.trimEnd(),
    kind: document.kind,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function evidenceLine(
  documents: HarnessAuditDocument[],
  evidence: string,
): HarnessAuditLine | undefined {
  const dependency = evidence.match(/^(.+?) (?:dependency|devDependency|gem): (.+)$/);
  if (dependency) {
    return lineFor(documents, dependency[1]!, [new RegExp(escapeRegExp(dependency[2]!))]);
  }
  const patterns = evidence === "package.json"
    ? [/"packageManager"\s*:/, /"(?:dependencies|devDependencies|scripts|name)"\s*:/]
    : evidence === "tsconfig.json"
      ? [/"(?:compilerOptions|extends|include|files)"\s*:/]
      : evidence === "pyproject.toml"
        ? [/^\s*\[project\]/, /^\s*\[tool\./]
        : evidence === "Gemfile"
          ? [/^\s*gem\s+/]
          : evidence === "template.yaml"
            ? [/^\s*(?:Transform|Resources)\s*:/]
            : evidence === "samconfig.toml"
              ? [/^\s*\[[^\]]+\]/]
              : [/\S/];
  return lineFor(documents, evidence, patterns);
}

function materializeChecks(checks: Array<HarnessAuditCheck | undefined>) {
  return checks.filter((item): item is HarnessAuditCheck => Boolean(item)).map((item) => ({
    description: item.description,
    result: item.result,
  }));
}

function recommendationId(seed: string): string {
  const digest = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 10);
  return `toolchain:${digest}`;
}

export function manifestStackFindings(corpus: HarnessAuditCorpus): HarnessAuditRecommendation[] {
  const stack = corpus.manifestStack;
  if (!stack || stack.status !== "drift" || !stack.detectedPackId) return [];
  const hookChecks = corpus.checks.filter((check) =>
    check.id.startsWith("check:manifest-hook-") && check.result === "missing");
  const missingPaths = hookChecks.map((check) =>
    check.description.match(/(?: at | entrypoint )([^ ]+)\.$/)?.[1]).filter(Boolean);
  const manifestLines = stack.manifestPackIds
    .map((packId) => lineFor(corpus.documents, ".farrier.json", [
      new RegExp(`"${escapeRegExp(packId)}"`),
    ]))
    .filter((item): item is HarnessAuditLine => Boolean(item));
  if (!manifestLines.length) {
    const packIdsLine = lineFor(corpus.documents, ".farrier.json", [/"packIds"\s*:/]);
    if (packIdsLine) manifestLines.push(packIdsLine);
  }
  const evidenceLines = stack.evidence
    .map((item) => evidenceLine(corpus.documents, item))
    .filter((item): item is HarnessAuditLine => Boolean(item));
  const citations = [...manifestLines, ...evidenceLines]
    .filter((item): item is HarnessAuditLine => Boolean(item))
    .filter((item, index, all) => all.findIndex((candidate) =>
      candidate.path === item.path && candidate.line === item.line) === index)
    .map(citation);
  const selected = JSON.stringify(stack.manifestPackIds);
  const detected = JSON.stringify(stack.detectedManifestPackIds);
  const blockedRecovery = missingPaths.length
    ? ` ${missingPaths.join(", ")} ${missingPaths.length === 1 ? "is" : "are"} also absent, so recovery from the current manifest would render the wrong stack.`
    : " Regenerating from the current manifest would render the wrong stack.";

  return [{
    id: recommendationId(`${selected}:${detected}`),
    layer: "toolchain",
    severity: "blocking",
    title: missingPaths.length
      ? "Manifest stack drift blocks safe harness recovery"
      : "Manifest pack selection contradicts the detected repository stack",
    defect: `.farrier.json selects ${stack.currentPackId}, but deterministic detection found ${stack.detectedPackId}.${blockedRecovery}`,
    citations,
    counterchecks: materializeChecks([
      corpus.checks.find((check) => check.id === "check:manifest-stack"),
      ...hookChecks,
      corpus.checks.find((check) => check.id === "check:audit-coverage"),
    ]),
    proposal: {
      artifact: ".farrier.json",
      change: `Do not regenerate from the current manifest. The required migration diff is: replace \`packIds: ${selected}\` with \`packIds: ${detected}\`. Apply that diff only through an explicit reviewed migration, inspect the complete render plan, then regenerate the selected bindings and entrypoints.`,
    },
    risk: "Regeneration from the stale manifest can install guidance, commands, and safety controls for the wrong toolchain while appearing to repair the harness.",
    uncertainty: "Detection proves the cited repository signals, but not the maintainers' intended target stack. The audit did not mutate, migrate, or render the repository, and no safe automatic pack-migration command was assumed.",
    source: "deterministic",
  }];
}
