import { createHash } from "node:crypto";
import type { HarnessAuditCorpus } from "./harness-audit-evidence";
import type {
  HarnessAuditCheck,
  HarnessAuditCitation,
  HarnessAuditLine,
  HarnessAuditRecommendation,
} from "./harness-audit-types";

type JavaScriptManager = "bun" | "npm" | "pnpm" | "yarn";

const lockfileByManager: Record<JavaScriptManager, string> = {
  bun: "bun.lock",
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
};

function citation(line: HarnessAuditLine): HarnessAuditCitation {
  return { path: line.path, line: line.line, excerpt: line.text.trim().slice(0, 320) };
}

function rootPolicy(corpus: HarnessAuditCorpus): {
  manager: JavaScriptManager;
  lines: HarnessAuditLine[];
} | undefined {
  const matches: Array<{ manager: JavaScriptManager; line: HarnessAuditLine }> = [];
  for (const line of corpus.lines.filter((item) =>
    item.kind === "guidance" && (item.path === "AGENTS.md" || item.path === "CLAUDE.md"))) {
    const text = line.text.replace(/[*`_]/g, "");
    if (/\b(?:e\.g\.|for example)\b/i.test(text)) continue;
    const match = text.match(/\b(?:always|must)\s+use\s+(bun|npm|pnpm|yarn)\b[^.\n]{0,100}\binstead of\b/i)
      ?? text.match(/\buse\s+only\s+(bun|npm|pnpm|yarn)\b/i);
    if (match) matches.push({ manager: match[1]!.toLowerCase() as JavaScriptManager, line });
  }
  const managers = new Set(matches.map((item) => item.manager));
  if (managers.size !== 1) return undefined;
  return { manager: [...managers][0]!, lines: matches.map((item) => item.line) };
}

function rootPackage(corpus: HarnessAuditCorpus): Record<string, unknown> | undefined {
  const document = corpus.documents.find((item) => item.path === "package.json");
  if (!document) return undefined;
  try {
    const parsed = JSON.parse(document.text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function invokedManagers(body: string): Set<JavaScriptManager> {
  const managers = new Set<JavaScriptManager>();
  for (const match of body.matchAll(/(?:^|&&|\|\||[;(&])\s*(bun|npm|pnpm|yarn)(?=\s|$)/g)) {
    managers.add(match[1] as JavaScriptManager);
  }
  return managers;
}

function scriptLine(
  corpus: HarnessAuditCorpus,
  name: string,
  body: string,
): HarnessAuditLine | undefined {
  return corpus.lines.find((line) => line.path === "package.json"
    && line.text.includes(JSON.stringify(name)) && line.text.includes(JSON.stringify(body)));
}

function recommendationId(manager: JavaScriptManager, tasks: string[]): string {
  const digest = createHash("sha256")
    .update(`${manager}:${tasks.join(",")}`, "utf8").digest("hex").slice(0, 10);
  return `toolchain:${digest}`;
}

export function packageScriptManagerFindings(corpus: HarnessAuditCorpus): HarnessAuditRecommendation[] {
  const policy = rootPolicy(corpus);
  const root = rootPackage(corpus);
  if (!policy || !root) return [];
  const managerCheck = corpus.checks.find((check) => check.id === "check:package-manager");
  if (!managerCheck || (managerCheck.result !== "not declared"
    && !managerCheck.result.startsWith(`${policy.manager}@`))) return [];
  const lockfileCheck = corpus.checks.find((check) => check.id === "check:lockfiles");
  if (!lockfileCheck?.result.split(", ").includes(lockfileByManager[policy.manager])) return [];
  const scripts = root.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return [];
  const conflicts = Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, body]) => ({
      name,
      body,
      managers: [...invokedManagers(body)].filter((manager) => manager !== policy.manager),
      line: scriptLine(corpus, name, body),
    }))
    .filter((item) => item.managers.length && item.line);
  if (!conflicts.length) return [];
  const conflictingManagers = [...new Set(conflicts.flatMap((item) => item.managers))].sort();
  const tasks = conflicts.map((item) => item.name);
  const routeCheck: HarnessAuditCheck = {
    id: "check:root-package-script-manager-route",
    layers: ["toolchain"],
    description: "Compared root package scripts with the exact manager-only guidance route.",
    result: `${policy.manager} required; ${conflictingManagers.join(", ")} invoked by scripts: ${tasks.join(", ")}`,
  };
  const coverage = corpus.checks.find((check) => check.id === "check:audit-coverage");
  const counterchecks = [routeCheck, managerCheck, lockfileCheck, coverage]
    .filter((check): check is HarnessAuditCheck => Boolean(check))
    .map((check) => ({ description: check.description, result: check.result }));
  const lines = [...new Map([
    ...policy.lines,
    ...conflicts.map((item) => item.line!),
  ].map((line) => [`${line.path}:${line.line}`, line])).values()];

  return [{
    id: recommendationId(policy.manager, tasks),
    layer: "toolchain",
    severity: "high",
    title: "Root package scripts bypass the required package manager",
    defect: `Root guidance requires ${policy.manager}, but package tasks ${tasks.join(", ")} invoke ${conflictingManagers.join(", ")}.`,
    citations: lines.map(citation),
    counterchecks,
    proposal: {
      artifact: "package.json",
      change: `Replace the cited ${conflictingManagers.join(" and ")} command invocations in package.json scripts ${tasks.join(", ")} with ${policy.manager}, preserving each command's arguments and order. Review manager-specific operations before applying the edits.`,
    },
    risk: "Package tasks can bypass the repository's stated install and script route, producing different dependency or publish behavior across local and CI runs.",
    uncertainty: "The audit did not execute the rewritten tasks. Manager-specific commands and flags may need a reviewed compatibility adjustment rather than a token-for-token replacement.",
    source: "deterministic",
  }];
}
