import { createHash } from "node:crypto";
import type { HarnessAuditCorpus } from "./harness-audit-evidence";
import type {
  HarnessAuditCheck,
  HarnessAuditCitation,
  HarnessAuditLine,
  HarnessAuditRecommendation,
} from "./harness-audit-types";

type JavaScriptManager = "bun" | "npm" | "pnpm" | "yarn";

type PackageRoute = {
  manager: JavaScriptManager;
  lines: HarnessAuditLine[];
  check: HarnessAuditCheck;
  uncertainty?: string;
};

const lockfileByManager: Record<JavaScriptManager, string> = {
  bun: "bun.lock",
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
};

function citation(line: HarnessAuditLine): HarnessAuditCitation {
  return { path: line.path, line: line.line, excerpt: line.text.trim().slice(0, 320) };
}

function uniqueLines(lines: HarnessAuditLine[]): HarnessAuditLine[] {
  return [...new Map(lines.map((line) => [`${line.path}:${line.line}`, line])).values()];
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

function packageLines(corpus: HarnessAuditCorpus): HarnessAuditLine[] {
  return corpus.lines.filter((line) => line.path === "package.json");
}

function scriptLine(
  corpus: HarnessAuditCorpus,
  name: string,
  body: string,
): HarnessAuditLine | undefined {
  return packageLines(corpus).find((line) =>
    line.text.includes(JSON.stringify(name)) && line.text.includes(JSON.stringify(body)));
}

function commandInvokes(body: string, manager: JavaScriptManager): boolean {
  const escaped = manager.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|&&|\\|\\||;)\\s*${escaped}(?:\\s|$)`).test(body);
}

function scriptEntries(root: Record<string, unknown>): Array<[string, string]> {
  const scripts = root.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return [];
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string");
}

function invokedManagers(root: Record<string, unknown>): Set<JavaScriptManager> {
  const managers: JavaScriptManager[] = ["bun", "npm", "pnpm", "yarn"];
  return new Set(managers.filter((manager) =>
    scriptEntries(root).some(([, body]) => commandInvokes(body, manager))));
}

function declaredRoute(
  corpus: HarnessAuditCorpus,
  root: Record<string, unknown>,
): PackageRoute | undefined {
  const check = corpus.checks.find((item) => item.id === "check:package-manager");
  const manager = check?.result.match(/^(bun|npm|pnpm|yarn)(?:@|$)/)?.[1] as JavaScriptManager | undefined;
  if (!check || !manager) return undefined;
  if ([...invokedManagers(root)].some((item) => item !== manager)) return undefined;
  const line = packageLines(corpus).find((item) => /"packageManager"\s*:/.test(item.text)
    && item.text.includes(JSON.stringify(check.result)));
  if (!line) return undefined;
  return { manager, lines: [line], check };
}

function inferredPnpmRoute(corpus: HarnessAuditCorpus, root: Record<string, unknown>): PackageRoute | undefined {
  const pnpm = root.pnpm;
  if (!pnpm || typeof pnpm !== "object" || Array.isArray(pnpm)
    || [...invokedManagers(root)].some((manager) => manager !== "pnpm")) return undefined;
  const invocations = scriptEntries(root)
    .filter(([, body]) => commandInvokes(body, "pnpm"));
  if (invocations.length < 2) return undefined;
  const configLine = packageLines(corpus).find((line) => /^\s*"pnpm"\s*:/.test(line.text));
  const invocationLines = invocations.map(([name, body]) => scriptLine(corpus, name, body));
  if (!configLine || invocationLines.some((line) => !line)) return undefined;
  const lines = uniqueLines([
    configLine,
    ...invocationLines.filter((line): line is HarnessAuditLine => Boolean(line)),
  ]);
  return {
    manager: "pnpm",
    lines,
    check: {
      id: "check:inferred-root-package-route",
      layers: ["toolchain"],
      description: "Inspected root package-manager configuration and explicit package-script routes.",
      result: `pnpm configuration present; ${invocations.length} scripts explicitly invoke pnpm`,
    },
    uncertainty: "package.json does not declare packageManager; pnpm is inferred from its manager-specific configuration and repeated explicit script invocations. A migration or deliberate dual-manager workflow could make deletion wrong.",
  };
}

function rootGuidanceRoute(
  corpus: HarnessAuditCorpus,
  root: Record<string, unknown>,
): PackageRoute | undefined {
  const scripts = new Set(scriptEntries(root).map(([name]) => name));
  const commands: Array<{ manager: JavaScriptManager; line: HarnessAuditLine }> = [];
  for (const line of corpus.lines.filter((item) =>
    item.kind === "guidance" && (item.path === "AGENTS.md" || item.path === "CLAUDE.md"))) {
    if (/\b(?:e\.g\.|for example)\b/i.test(line.text)) continue;
    for (const match of line.text.matchAll(/`(bun|npm|pnpm|yarn)\s+run\s+([A-Za-z0-9][A-Za-z0-9:_-]*)[^`]*`/g)) {
      const before = line.text.slice(Math.max(0, (match.index ?? 0) - 60), match.index);
      if (/\b(?:do not|don't|never|avoid)\b/i.test(before) || !scripts.has(match[2]!)) continue;
      commands.push({ manager: match[1] as JavaScriptManager, line });
    }
  }
  const managers = new Set(commands.map((item) => item.manager));
  if (managers.size !== 1) return undefined;
  const manager = [...managers][0]!;
  if ([...invokedManagers(root)].some((item) => item !== manager)) return undefined;
  const invocations = scriptEntries(root).filter(([, body]) => commandInvokes(body, manager));
  if (!invocations.length) return undefined;
  const invocationLines = invocations.map(([name, body]) => scriptLine(corpus, name, body));
  if (invocationLines.some((line) => !line)) return undefined;
  return {
    manager,
    lines: uniqueLines([
      ...commands.map((item) => item.line),
      ...invocationLines.filter((line): line is HarnessAuditLine => Boolean(line)),
    ]),
    check: {
      id: "check:root-guidance-package-route",
      layers: ["toolchain"],
      description: "Compared exact root guidance commands with explicit package-script routes.",
      result: `root guidance invokes ${manager}; ${invocations.length} scripts explicitly invoke ${manager}`,
    },
    uncertainty: `package.json does not declare packageManager; ${manager} is inferred from exact root guidance and compatible explicit script routes. A migration or deliberate dual-manager workflow could make deletion wrong.`,
  };
}

function packageRoute(corpus: HarnessAuditCorpus): PackageRoute | undefined {
  const root = rootPackage(corpus);
  if (!root) return undefined;
  return typeof root.packageManager === "string"
    ? declaredRoute(corpus, root)
    : rootGuidanceRoute(corpus, root) ?? inferredPnpmRoute(corpus, root);
}

function presentJavaScriptLockfiles(corpus: HarnessAuditCorpus): string[] {
  const result = corpus.checks.find((check) => check.id === "check:lockfiles")?.result;
  if (!result || result === "no known lockfile found") return [];
  const known = new Set(Object.values(lockfileByManager));
  return result.split(", ").filter((path) => known.has(path));
}

function recommendationId(manager: JavaScriptManager, path: string): string {
  const digest = createHash("sha256").update(`${manager}:${path}`, "utf8").digest("hex").slice(0, 10);
  return `toolchain:${digest}`;
}

export function competingLockfileFindings(corpus: HarnessAuditCorpus): HarnessAuditRecommendation[] {
  const route = packageRoute(corpus);
  const lockfiles = presentJavaScriptLockfiles(corpus);
  if (!route || lockfiles.length < 2) return [];
  const intended = lockfileByManager[route.manager];
  if (!lockfiles.includes(intended)) return [];
  const lockfileCheck = corpus.checks.find((check) => check.id === "check:lockfiles");
  const coverage = corpus.checks.find((check) => check.id === "check:audit-coverage");
  const counterchecks = [lockfileCheck, route.check, coverage]
    .filter((check): check is HarnessAuditCheck => Boolean(check))
    .map((check) => ({ description: check.description, result: check.result }));

  return lockfiles.filter((path) => path !== intended).map((path) => ({
    id: recommendationId(route.manager, path),
    layer: "toolchain",
    severity: "high",
    title: "Root package route conflicts with a second JavaScript lockfile",
    defect: `package.json routes root tasks through ${route.manager}, while both ${intended} and ${path} exist at the repository root.`,
    citations: route.lines.map(citation),
    counterchecks,
    proposal: {
      artifact: path,
      change: `Remove ${path} and keep ${intended} as the single JavaScript dependency lockfile for the root package. Review the file deletion before applying it.`,
    },
    risk: `Using ${route.manager} and ${path} together can resolve and update separate dependency states across local, CI, and release installs.`,
    uncertainty: route.uncertainty
      ?? "The audit did not run installs or inspect unselected automation; a migration or deliberate dual-manager workflow could make deletion wrong.",
    source: "deterministic",
  }));
}
