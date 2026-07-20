import { createHash } from "node:crypto";
import { dirname } from "node:path";
import {
  referencedPathForLine,
  type HarnessAuditCorpus,
  type HarnessAuditDocument,
} from "./harness-audit-evidence";
import { competingLockfileFindings } from "./harness-audit-competing-lockfile-finding";
import { generatedOutputBuiltBeforeReference } from "./harness-audit-generated-output";
import { manifestStackFindings } from "./harness-audit-manifest-stack-finding";
import { packagePathForCheck } from "./harness-audit-package-evidence";
import { packageScriptPathAudit } from "./harness-audit-package-script-path-finding";
import { packageScriptManagerFindings } from "./harness-audit-package-script-manager-finding";
import { conditionalSkillFallbackFindings } from "./harness-audit-skill-fallback-finding";
import { skillMutationSafetyFindings } from "./harness-audit-skill-mutation-finding";
import { skillSensitiveDumpFindings } from "./harness-audit-skill-sensitive-dump-finding";
import { skillShapeFindings } from "./harness-audit-skill-shape";
import { tsconfigPathAliasFindings } from "./harness-audit-tsconfig-path-finding";
import type {
  HarnessAuditCheck, HarnessAuditCitation, HarnessAuditLayer, HarnessAuditLine,
  HarnessAuditRecommendation,
} from "./harness-audit-types";

type DocumentedCommand = {
  line: HarnessAuditLine;
  command: string;
  family: "javascript" | "python" | "just" | "make";
  runner: string;
  target?: string;
};

function recommendationId(layer: HarnessAuditLayer, seed: string): string {
  const digest = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 10);
  return `${layer}:${digest}`;
}

function citation(line: HarnessAuditLine): HarnessAuditCitation {
  return { path: line.path, line: line.line, excerpt: line.text.trim().slice(0, 320) };
}

function checkValue(corpus: HarnessAuditCorpus, id: string): HarnessAuditCheck | undefined {
  return corpus.checks.find((item) => item.id === id);
}

function materializeChecks(checks: Array<HarnessAuditCheck | undefined>) {
  return checks.filter((item): item is HarnessAuditCheck => Boolean(item)).map((item) => ({
    description: item.description,
    result: item.result,
  }));
}

function lineFor(documents: HarnessAuditDocument[], path: string, pattern: RegExp): HarnessAuditLine | undefined {
  const document = documents.find((item) => item.path === path);
  if (!document) return undefined;
  const index = document.text.split("\n").findIndex((line) => pattern.test(line));
  if (index < 0) return undefined;
  const text = document.text.split("\n")[index]!.trimEnd();
  return {
    id: `local:${path}:${index + 1}`,
    path,
    line: index + 1,
    text,
    kind: document.kind,
  };
}

function documentedCommands(lines: HarnessAuditLine[]): DocumentedCommand[] {
  const commands: DocumentedCommand[] = [];
  const packageManagerBuiltins = new Set([
    "add", "audit", "cache", "config", "create", "dlx", "exec", "i", "init", "install", "link",
    "deprecate", "dist-tag", "docs", "doctor", "fund", "help", "info", "login", "logout",
    "outdated", "owner", "pack", "ping", "pm", "prefix", "profile", "publish", "remove",
    "repo", "root", "search", "star", "stars", "team", "token", "unlink", "unstar", "update",
    "upgrade", "version", "view", "whoami", "x",
  ]);
  for (const line of lines.filter((item) => item.kind === "guidance" || item.kind === "skill")) {
    if (!/\b(?:check|test|lint|format|verify|validation|install|run)\b/i.test(line.text)) continue;
    if (line.kind === "skill" && externalExecutionContext(lines, line)) continue;
    const snippets = Array.from(line.text.matchAll(/`([^`\n]+)`/g), (match) => match[1]!.trim());
    for (const command of snippets) {
      if (illustrativeCommand(line.text, command)) continue;
      const explicitRun = command.match(/^(npm|bun|pnpm|yarn)\s+run\s+([A-Za-z0-9][A-Za-z0-9:_-]*)(?:\s|$)/);
      const startsRun = /^(?:npm|bun|pnpm|yarn)\s+run(?:\s|$)/.test(command);
      const direct = startsRun
        ? undefined
        : command.match(/^(npm|bun|pnpm|yarn)\s+([A-Za-z0-9][A-Za-z0-9:_-]*)(?:\s|$)/);
      const js = explicitRun ?? direct;
      if (js) {
        if (direct && (packageManagerBuiltins.has(direct[2]!)
          || (direct[1] === "bun" && ["build", "test"].includes(direct[2]!)))) continue;
        commands.push({ line, command, family: "javascript", runner: js[1]!, target: js[2]! });
        continue;
      }
      const just = command.match(/^just\s+([A-Za-z0-9_-]+)(?:\s|$)/);
      if (just) {
        commands.push({ line, command, family: "just", runner: "just", target: just[1]! });
        continue;
      }
      const make = command.match(/^make\s+([A-Za-z0-9_.-]+)(?:\s|$)/);
      if (make) {
        commands.push({ line, command, family: "make", runner: "make", target: make[1]! });
        continue;
      }
      if (/^(?:pip(?:3)?\s+install|python(?:3)?\s|pytest(?:\s|$))/.test(command)) {
        commands.push({ line, command, family: "python", runner: command.split(/\s+/, 1)[0]! });
      }
    }
  }
  return commands;
}

function illustrativeCommand(text: string, command: string): boolean {
  const commandIndex = text.indexOf(`\`${command}\``);
  if (commandIndex < 0) return false;
  const markers = [...text.matchAll(/(?:e\.g\.|for example)/gi)]
    .filter((match) => (match.index ?? -1) < commandIndex);
  const marker = markers.at(-1);
  if (!marker) return false;
  const markerIndex = marker.index!;
  const open = text.lastIndexOf("(", markerIndex);
  if (open > text.lastIndexOf(")", markerIndex)) {
    const close = text.indexOf(")", markerIndex);
    return close < 0 || commandIndex < close;
  }
  const sentenceEnd = text.indexOf(".", markerIndex + marker[0].length);
  return sentenceEnd < 0 || commandIndex < sentenceEnd;
}

function externalExecutionContext(lines: HarnessAuditLine[], line: HarnessAuditLine): boolean {
  const context = lines.filter((item) => item.path === line.path && Math.abs(item.line - line.line) <= 2)
    .map((item) => item.text).join(" ");
  return /\b(?:on|inside|within|through|via)\s+(?:the\s+)?(?:remote(?:\s+\w+)?|guest|container|testbox|sandbox|vm|virtual machine)\b/i.test(context)
    || /\b(?:ssh|mosh)\b|\b(?:docker|podman|kubectl)\s+exec\b|\b(?:testbox|sandbox|guest|vm)\s+(?:run|exec)\b/i.test(context);
}

function targetSet(check: HarnessAuditCheck | undefined): Set<string> {
  if (!check || /^no /.test(check.result)) return new Set();
  return new Set(check.result.split(", ").filter(Boolean));
}

function scopedPackageScriptsCheck(corpus: HarnessAuditCorpus, line: HarnessAuditLine): HarnessAuditCheck | undefined {
  return corpus.checks.map((check) => ({ check, path: packagePathForCheck(check) }))
    .filter((item): item is { check: HarnessAuditCheck; path: string } => Boolean(item.path))
    .filter((item) => {
      const directory = dirname(item.path);
      return directory === "." || line.path.startsWith(`${directory}/`);
    })
    .sort((left, right) => dirname(right.path).length - dirname(left.path).length)[0]?.check;
}

function toolchainFindings(corpus: HarnessAuditCorpus, commands: DocumentedCommand[]): HarnessAuditRecommendation[] {
  const findings: HarnessAuditRecommendation[] = [];
  const rootManagerCheck = checkValue(corpus, "check:package-manager");
  for (const item of commands.filter((command) => command.family === "javascript")) {
    const scriptsCheck = scopedPackageScriptsCheck(corpus, item.line);
    const scopedManagerCheck = scriptsCheck
      ? companionPackageCheck(corpus, scriptsCheck, "check:package-manager")
      : undefined;
    const managerCheck = scopedManagerCheck?.result !== "not declared" ? scopedManagerCheck : rootManagerCheck;
    const declaredManager = managerCheck?.result.match(/^(npm|bun|pnpm|yarn)(?:@|$)/)?.[1];
    if (!declaredManager || item.runner === declaredManager) continue;
    const managerPath = managerCheck === scopedManagerCheck && scriptsCheck
      ? packagePathForCheck(scriptsCheck) ?? "package.json"
      : "package.json";
    const managerLine = lineFor(corpus.documents, managerPath, /"packageManager"\s*:/);
    const replacement = item.command.replace(/^(?:npm|bun|pnpm|yarn)\b/, declaredManager);
    const targetMissing = Boolean(item.target && scriptsCheck && !targetSet(scriptsCheck).has(item.target));
    findings.push({
        id: recommendationId("toolchain", `${item.line.path}:${item.line.line}:${item.command}`),
        layer: "toolchain",
        severity: "high",
        title: "Documented command bypasses the declared package manager",
        defect: `${item.command} uses ${item.runner}, while package.json declares ${declaredManager}.`,
        citations: [citation(item.line), ...(managerLine ? [citation(managerLine)] : [])],
        counterchecks: materializeChecks([managerCheck, scriptsCheck]),
        proposal: {
          artifact: item.line.path,
          change: targetMissing
            ? `Remove the invalid \`${item.command}\` instruction from ${item.line.path}. If the intended task is restored, route it through ${declaredManager}.`
            : `Replace \`${item.command}\` with \`${replacement}\` in ${item.line.path}.`,
        },
        risk: "Agents can install with a different lockfile or run a script under a different runtime than CI.",
        uncertainty: "The audit did not execute either command; a compatibility wrapper outside the selected harness files could exist.",
        source: "deterministic",
    });
  }

  const uvRule = corpus.lines.find((line) => line.kind === "guidance" && /\buse\s+uv\b|\buv\s+for\s+python\b/i.test(line.text));
  if (uvRule) {
    for (const item of commands.filter((command) => command.family === "python" && !itemUsesUv(command.command))) {
      const replacement = uvExecutionReplacement(item.command);
      const routeCheck: HarnessAuditCheck = {
        id: `check:documented-command:${item.line.id}`,
        layers: ["toolchain"],
        description: `Compared documented command ${item.command} with the repository's uv-only route.`,
        result: `${item.command} does not start with uv`,
      };
      findings.push({
        id: recommendationId("toolchain", `${item.line.path}:${item.line.line}:uv:${item.command}`),
        layer: "toolchain",
        severity: "high",
        title: "Python command contradicts the repository's uv route",
        defect: `${item.command} bypasses the uv-only instruction in the same repository harness.`,
        citations: [citation(item.line), citation(uvRule)],
        counterchecks: materializeChecks([routeCheck]),
        proposal: {
          artifact: item.line.path,
          change: replacement
            ? `Replace \`${item.command}\` with \`${replacement}\` in ${item.line.path}.`
            : "Rewrite the dependency command through the repository's intended uv dependency workflow.",
        },
        risk: replacement
          ? "The command can run against an interpreter or environment that differs from the repository's uv route and CI."
          : "A direct pip invocation can mutate dependencies outside the repository's locked uv workflow.",
        uncertainty: replacement
          ? "The audit did not execute the replacement, so the configured uv environment can still fail at runtime."
          : "The evidence does not distinguish a project dependency from a one-off tool, so it cannot choose between uv add and uv run --with.",
        source: "deterministic",
      });
    }
  }
  return findings;
}

function itemUsesUv(command: string): boolean { return /^uv\s/.test(command); }

function uvExecutionReplacement(command: string): string | undefined {
  return /^(?:python(?:3)?\s|pytest(?:\s|$))/.test(command)
    && !/^python(?:3)?\s+-m\s+pip\b/.test(command) ? `uv run ${command}` : undefined;
}

function documentedCommandBody(line: HarnessAuditLine, command: string): string | undefined {
  const token = `\`${command}\``;
  const index = line.text.indexOf(token);
  if (index < 0) return undefined;
  return line.text.slice(index + token.length).match(/^\s*\(([^()\n]+)\)/)?.[1]?.trim();
}

function companionPackageCheck(
  corpus: HarnessAuditCorpus,
  scriptsCheck: HarnessAuditCheck,
  base: string,
): HarnessAuditCheck | undefined {
  const suffix = scriptsCheck.id.slice("check:package-scripts".length);
  return corpus.checks.find((check) => check.id === `${base}${suffix}`);
}

function exactScriptBodyTarget(
  corpus: HarnessAuditCorpus,
  scriptsCheck: HarnessAuditCheck,
  documentedBody: string | undefined,
): string | undefined {
  if (!documentedBody) return undefined;
  const path = packagePathForCheck(scriptsCheck);
  const document = path ? corpus.documents.find((item) => item.path === path) : undefined;
  if (!document) return undefined;
  try {
    const parsed = JSON.parse(document.text) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== "object" || Array.isArray(parsed.scripts)) return undefined;
    const matches = Object.entries(parsed.scripts)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] === documentedBody)
      .map(([name]) => name);
    return matches.length === 1 ? matches[0] : undefined;
  } catch {
    return undefined;
  }
}

function replaceCommandTarget(command: string, current: string, replacement: string): string {
  const index = command.indexOf(current);
  return index < 0 ? command : `${command.slice(0, index)}${replacement}${command.slice(index + current.length)}`;
}

function verificationFindings(corpus: HarnessAuditCorpus, commands: DocumentedCommand[]): HarnessAuditRecommendation[] {
  const justCheck = checkValue(corpus, "check:just-targets");
  const makeCheck = checkValue(corpus, "check:make-targets");
  const just = justCheck ? targetSet(justCheck) : undefined;
  const make = makeCheck ? targetSet(makeCheck) : undefined;
  const findings: HarnessAuditRecommendation[] = [];
  for (const item of commands) {
    if (item.family === "javascript" && item.runner === "yarn") continue;
    const scriptsCheck = scopedPackageScriptsCheck(corpus, item.line);
    const scripts = scriptsCheck ? targetSet(scriptsCheck) : undefined;
    const available = item.family === "javascript" ? scripts : item.family === "just" ? just : item.family === "make" ? make : undefined;
    if (!available || !item.target || available.has(item.target)) continue;
    const countercheck = item.family === "javascript" ? scriptsCheck : item.family === "just" ? justCheck : makeCheck;
    const definitionsCheck = scriptsCheck
      ? companionPackageCheck(corpus, scriptsCheck, "check:package-script-definitions")
      : undefined;
    const documentedBody = documentedCommandBody(item.line, item.command);
    const replacementTarget = scriptsCheck ? exactScriptBodyTarget(corpus, scriptsCheck, documentedBody) : undefined;
    const replacementCommand = replacementTarget
      ? replaceCommandTarget(item.command, item.target, replacementTarget)
      : undefined;
    findings.push({
      id: recommendationId("verification", `${item.line.path}:${item.line.line}:${item.command}`),
      layer: "verification",
      severity: "high",
      title: "Documented verification target does not exist",
      defect: `${item.command} names '${item.target}', but the selected task file does not define it.`,
      citations: [citation(item.line)],
      counterchecks: materializeChecks([countercheck, definitionsCheck, checkValue(corpus, "check:audit-coverage")]),
      proposal: {
        artifact: item.line.path,
        change: replacementCommand && documentedBody
          ? `Replace \`${item.command}\` with \`${replacementCommand}\` in ${item.line.path}; its inspected script body matches \`${documentedBody}\` on the cited line.`
          : `Remove the invalid \`${item.command}\` instruction from ${item.line.path}. Reintroduce it only after the intended task exists and has been reviewed.`,
      },
      risk: "Agents following the harness cannot run the stated completion check and may stop without verification.",
      uncertainty: replacementCommand
        ? "The script bodies were compared as text; the audit did not execute the replacement or inspect external verification policy."
        : "The audit cannot infer the intended target; removing the invalid instruction may expose a missing verification policy until the task is restored.",
      source: "deterministic",
    });
  }
  return findings;
}

function configuredHookCommands(corpus: HarnessAuditCorpus): string[] {
  const commands: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "command" && typeof item === "string") commands.push(item);
      else visit(item);
    }
  };
  for (const document of corpus.documents.filter((item) => /^\.claude\/settings[^/]*\.json$/.test(item.path))) {
    try {
      const parsed = JSON.parse(document.text) as { hooks?: unknown };
      visit(parsed.hooks);
    } catch {
      // Malformed settings cannot prove that an arbitrary path is a configured hook entrypoint.
    }
  }
  return commands;
}

function missingPathFindings(
  corpus: HarnessAuditCorpus,
  packageScriptMissingPaths: ReadonlySet<string>,
): HarnessAuditRecommendation[] {
  const findings: HarnessAuditRecommendation[] = [];
  const grouped = new Map<string, HarnessAuditRecommendation>();
  const hookCommands = configuredHookCommands(corpus);
  for (const check of corpus.checks.filter((item) => item.id.startsWith("check:path:") && item.result === "missing")) {
    const path = check.description.match(/^Checked referenced path (.+)\.$/)?.[1];
    if (!path) continue;
    if (path.split("/").includes("node_modules")) continue;
    for (const line of corpus.lines.filter((item) =>
      item.path !== ".farrier.json" && referencedPathForLine(item).includes(path))) {
      const skillPrefix = `${dirname(line.path)}/`;
      const sourcePath = line.kind === "skill" && path.startsWith(skillPrefix)
        ? path.slice(skillPrefix.length)
        : path;
      const escaped = sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const offeredPackageAlternative = line.kind === "guidance"
        && packageScriptMissingPaths.has(path)
        && (new RegExp(`\\bor\\b[^\\n]{0,80}${escaped}`, "i").test(line.text)
          || new RegExp(`${escaped}[^\\n]{0,80}\\bor\\b`, "i").test(line.text));
      const explicitlyRequired = line.kind === "hook"
        ? hookCommands.some((command) => command.includes(path))
        : offeredPackageAlternative
          || new RegExp(`\\b(?:run|read|execute|invoke|load)\\b[^\\n]{0,40}${escaped}`, "i").test(line.text)
          || new RegExp(`${escaped}[^\\n]{0,40}\\b(?:must|required)\\b`, "i").test(line.text);
      if (!explicitlyRequired) continue;
      if (/(?:\be\.g\.|\bfor example\b)/i.test(line.text)) continue;
      if (generatedOutputBuiltBeforeReference(corpus, line, path)) continue;
      const executedVerificationPath = /\b(?:check|test|verify)\b/i.test(sourcePath)
        && new RegExp(`\\b(?:run|execute|invoke)\\b[^\\n]{0,40}${escaped}`, "i").test(line.text);
      const layer: HarnessAuditLayer = line.kind === "skill"
        ? "skill"
        : line.kind === "hook"
          ? "hook"
          : executedVerificationPath
            ? "verification"
            : "guidance";
      const key = `${layer}:${line.path}:${path}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.citations.push(citation(line));
        continue;
      }
      const finding: HarnessAuditRecommendation = {
        id: recommendationId(layer, `${line.path}:${line.line}:${path}`),
        layer,
        severity: offeredPackageAlternative
          ? "medium"
          : layer === "hook" || layer === "verification" ? "blocking" : "high",
        title: offeredPackageAlternative
          ? "Harness instruction offers a missing operational path"
          : "Harness instruction references a missing artifact",
        defect: offeredPackageAlternative
          ? `${line.path} offers ${path} as an operational option, but the contained path check found no such artifact.`
          : `${line.path} requires ${path}, but the contained path check found no such artifact.`,
        citations: [citation(line)],
        counterchecks: materializeChecks([check, checkValue(corpus, "check:audit-coverage")]),
        proposal: {
          artifact: line.path,
          change: offeredPackageAlternative
            ? `Remove \`${path}\` as an available option from every cited instruction in ${line.path} while retaining verified alternatives. Reintroduce it only after the script exists and has been reviewed.`
            : layer === "hook"
            ? `Remove the stale ${path} command from this hook binding. Re-enable it only after the hook exists and has been reviewed.`
            : `Delete every cited instruction that requires ${path} from ${line.path}. Reintroduce it only after the referenced artifact exists and has been reviewed.`,
        },
        risk: offeredPackageAlternative
          ? `Agents may select ${path} instead of a verified alternative and fail to complete the intended operation.`
          : layer === "hook"
          ? "The configured hook cannot run, so its guard is absent while the configuration appears enabled."
          : "Agents will follow a dead path or skip the affected procedure.",
        uncertainty: "The audit proves the path is absent from the bounded repository snapshot, but not whether deletion or restoration is the intended repair.",
        source: "deterministic",
      };
      grouped.set(key, finding);
      findings.push(finding);
    }
  }
  return findings;
}

function manifestHookFindings(corpus: HarnessAuditCorpus): HarnessAuditRecommendation[] {
  if (corpus.manifestStack?.status === "drift") return [];
  const missing = corpus.checks.filter((check) =>
    check.id.startsWith("check:manifest-hook-") && check.result === "missing");
  if (!missing.length) return [];
  const hookIds = missing.flatMap((check) => {
    const id = check.id.match(/^check:manifest-hook-entry:(.+)$/)?.[1];
    return id ? [id] : [];
  });
  const citations = hookIds
    .map((id) => lineFor(corpus.documents, ".farrier.json", new RegExp(`"${id}"`)))
    .filter((line): line is HarnessAuditLine => Boolean(line))
    .map(citation);
  const fallback = lineFor(corpus.documents, ".farrier.json", /"hookIds"\s*:/);
  const checkedPaths = missing.map((check) =>
    check.description.match(/(?: at | entrypoint )([^ ]+)\.$/)?.[1]).filter(Boolean);
  return [{
    id: recommendationId("hook", `manifest:${checkedPaths.join(",")}`),
    layer: "hook",
    severity: "blocking",
    title: "Manifest-selected safety hooks are not installed",
    defect: `.farrier.json selects active hooks, but ${checkedPaths.join(", ")} ${checkedPaths.length === 1 ? "is" : "are"} absent.`,
    citations: citations.length ? citations : fallback ? [citation(fallback)] : [],
    counterchecks: materializeChecks([
      ...missing,
      checkValue(corpus, "check:manifest-stack"),
      checkValue(corpus, "check:audit-coverage"),
    ]),
    proposal: {
      artifact: checkedPaths.join(", "),
      change: `Run \`farrier update --dir .\` and review restoration of ${checkedPaths.join(", ")}. If the preview contains no unrelated drift, apply it with \`farrier update --dir . --yes\`, then run \`farrier doctor --dir .\`.`,
    },
    risk: "The repository claims safety controls are selected while the provider cannot invoke them, creating false assurance around reads, writes, commands, and completion checks.",
    uncertainty: "The audit proves the selected binding or entrypoints are absent, but cannot decide whether regeneration or retiring the manifest selection is intended.",
    source: "deterministic",
  }];
}

function severityRank(value: HarnessAuditRecommendation["severity"]): number {
  return ["blocking", "high", "medium", "low"].indexOf(value);
}

export function quickHarnessAudit(corpus: HarnessAuditCorpus): HarnessAuditRecommendation[] {
  const commands = documentedCommands(corpus.lines);
  const packageScripts = packageScriptPathAudit(corpus);
  const findings = [
    ...missingPathFindings(corpus, packageScripts.missingPaths),
    ...conditionalSkillFallbackFindings(corpus),
    ...verificationFindings(corpus, commands),
    ...toolchainFindings(corpus, commands),
    ...packageScriptManagerFindings(corpus),
    ...competingLockfileFindings(corpus),
    ...tsconfigPathAliasFindings(corpus),
    ...packageScripts.findings,
    ...skillMutationSafetyFindings(corpus),
    ...skillSensitiveDumpFindings(corpus),
    ...skillShapeFindings(corpus),
    ...manifestStackFindings(corpus),
    ...manifestHookFindings(corpus),
  ];
  const unique = new Map(findings.map((item) => [item.id, item]));
  return [...unique.values()].sort((left, right) =>
    severityRank(left.severity) - severityRank(right.severity)
    || left.layer.localeCompare(right.layer)
    || left.id.localeCompare(right.id));
}

export function sortHarnessRecommendations(items: HarnessAuditRecommendation[]): HarnessAuditRecommendation[] {
  return [...items].sort((left, right) =>
    severityRank(left.severity) - severityRank(right.severity)
    || (left.source === right.source ? 0 : left.source === "deterministic" ? -1 : 1)
    || left.layer.localeCompare(right.layer)
    || left.id.localeCompare(right.id));
}
