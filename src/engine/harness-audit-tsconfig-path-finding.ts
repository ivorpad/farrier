import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { HarnessAuditCorpus } from "./harness-audit-evidence";
import type {
  HarnessAuditCheck,
  HarnessAuditCitation,
  HarnessAuditLine,
  HarnessAuditRecommendation,
} from "./harness-audit-types";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function citation(line: HarnessAuditLine): HarnessAuditCitation {
  return { path: line.path, line: line.line, excerpt: line.text.trim().slice(0, 320) };
}

function checkForPath(corpus: HarnessAuditCorpus, path: string): HarnessAuditCheck | undefined {
  return corpus.checks.find((check) =>
    check.description === `Checked referenced path ${path}.` && check.result === "missing");
}

function resolvedTarget(baseUrl: string, target: string): string | undefined {
  if (posix.isAbsolute(baseUrl) || posix.isAbsolute(target)) return undefined;
  const resolved = posix.normalize(posix.join(baseUrl, target));
  return resolved !== ".." && !resolved.startsWith("../") ? resolved : undefined;
}

function citedMappingLines(
  corpus: HarnessAuditCorpus,
  alias: string,
  target: string,
): HarnessAuditLine[] {
  const lines = corpus.lines.filter((line) => line.path === "tsconfig.json" && (
    line.text.includes(JSON.stringify(alias)) || line.text.includes(JSON.stringify(target))
  ));
  return [...new Map(lines.map((line) => [`${line.path}:${line.line}`, line])).values()];
}

function recommendationId(alias: string, target: string): string {
  const digest = createHash("sha256").update(`${alias}:${target}`, "utf8").digest("hex").slice(0, 10);
  return `toolchain:${digest}`;
}

export function tsconfigPathAliasFindings(corpus: HarnessAuditCorpus): HarnessAuditRecommendation[] {
  const document = corpus.documents.find((item) => item.path === "tsconfig.json");
  if (!document) return [];
  let root: JsonObject;
  try {
    root = object(JSON.parse(document.text)) ?? {};
  } catch {
    return [];
  }
  const compilerOptions = object(root.compilerOptions);
  const mappings = object(compilerOptions?.paths);
  const baseUrl = typeof compilerOptions?.baseUrl === "string" ? compilerOptions.baseUrl : ".";
  if (!mappings) return [];

  const findings: HarnessAuditRecommendation[] = [];
  for (const [alias, value] of Object.entries(mappings)) {
    if (alias.includes("*") || !Array.isArray(value) || value.length !== 1) continue;
    const target = value[0];
    if (typeof target !== "string" || target.includes("*")) continue;
    const path = resolvedTarget(baseUrl, target);
    if (!path) continue;
    const check = checkForPath(corpus, path);
    const lines = citedMappingLines(corpus, alias, target);
    if (!check || !check.layers.includes("toolchain") || !lines.length) continue;
    findings.push({
      id: recommendationId(alias, target),
      layer: "toolchain",
      severity: "high",
      title: "TypeScript path alias targets a missing file",
      defect: `tsconfig.json maps ${alias} to ${path}, but the contained path check found no such artifact.`,
      citations: lines.map(citation),
      counterchecks: [
        { description: check.description, result: check.result },
        ...corpus.checks.filter((item) => item.id === "check:audit-coverage")
          .map((item) => ({ description: item.description, result: item.result })),
      ],
      proposal: {
        artifact: "tsconfig.json",
        change: `Remove the \`${alias}\` path mapping to \`${target}\` from tsconfig.json. Reintroduce it only after the intended target exists and has been reviewed.`,
      },
      risk: `TypeScript and tools using tsconfig aliases cannot resolve ${alias} while the configuration presents the alias as available.`,
      uncertainty: "The audit proves the sole configured target is absent, but not whether the intended repair is removal, restoration, or a different existing target.",
      source: "deterministic",
    });
  }
  return findings;
}
