import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import type { ResolvedPack, ToolPolicyRule } from "../packs/types";
import type { EnforcementAgent } from "./agent-selection";
import {
  advisorSkillFiles,
  hooksDirectory,
  renderClaudeMd,
  renderClaudeSettingsJson,
  renderCodexHooksJson,
  type RenderedFile
} from "./render";

const legacyHooksDirectory = ".claude/hooks";

/**
 * Migration classification for one existing install. Everything here is
 * report-only; applyUpdate turns it into transactional operations.
 *
 * - pruneFiles: legacy farrier-owned files (or byte-identical generated
 *   content) that the current plan no longer emits. Safe to remove.
 * - pruneTrees: regenerable directory trees (only `__pycache__`).
 * - blockedPaths: legacy paths that need removal but diverged from generated
 *   content; left in place for manual review.
 * - repairUserFiles: user-mutable files whose content is byte-identical to a
 *   reconstructable legacy-generated variant, so rewriting them cannot lose
 *   user edits.
 * - toolPolicyRulesOverride: content for the new rules file when the legacy
 *   file carried extra (learned) rules that must not be lost.
 */
export type StalePathReport = {
  pruneFiles: string[];
  pruneTrees: string[];
  blockedPaths: string[];
  repairUserFiles: string[];
  toolPolicyRulesOverride?: { path: string; content: string; carriedRuleIds: string[] };
  notes: string[];
};

function emptyReport(): StalePathReport {
  return { pruneFiles: [], pruneTrees: [], blockedPaths: [], repairUserFiles: [], notes: [] };
}

async function readTextIfExists(targetDir: string, path: string): Promise<string | undefined> {
  try {
    return await readFile(join(targetDir, path), "utf8");
  } catch {
    return undefined;
  }
}

async function walkFiles(targetDir: string, relativeDir: string): Promise<{ files: string[]; pycacheTrees: string[] }> {
  const files: string[] = [];
  const pycacheTrees: string[] = [];

  const walk = async (relative: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(targetDir, relative), { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const childRelative = posix.join(relative, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "__pycache__") {
          pycacheTrees.push(childRelative);
          continue;
        }
        await walk(childRelative);
        continue;
      }

      if (entry.isFile()) {
        files.push(childRelative);
      }
    }
  };

  await walk(relativeDir);
  return { files, pycacheTrees };
}

function isLegacyOwnedHookFile(path: string): boolean {
  const prefix = `${legacyHooksDirectory}/`;
  if (!path.startsWith(prefix)) {
    return false;
  }

  const relative = path.slice(prefix.length);
  if (relative.startsWith("prompts/") && relative.endsWith(".txt")) {
    return true;
  }
  if (relative.startsWith("@")) {
    return true;
  }
  return !relative.includes("/") && relative.endsWith(".py");
}

type ParsedToolPolicyRules = { version: number; rules: ToolPolicyRule[] };

function parseToolPolicyRules(text: string): ParsedToolPolicyRules | undefined {
  try {
    const parsed = JSON.parse(text) as { version?: unknown; rules?: unknown };
    if (typeof parsed.version !== "number" || !Array.isArray(parsed.rules)) {
      return undefined;
    }
    if (!parsed.rules.every((rule) => rule && typeof rule === "object" && typeof (rule as { id?: unknown }).id === "string")) {
      return undefined;
    }
    return { version: parsed.version, rules: parsed.rules as ToolPolicyRule[] };
  } catch {
    return undefined;
  }
}

async function classifyLegacyHooks(
  targetDir: string,
  planFilesByPath: Map<string, RenderedFile>,
  report: StalePathReport
): Promise<void> {
  const { files, pycacheTrees } = await walkFiles(targetDir, legacyHooksDirectory);
  report.pruneTrees.push(...pycacheTrees);

  for (const path of files) {
    if (isLegacyOwnedHookFile(path)) {
      report.pruneFiles.push(path);
      continue;
    }

    if (path === `${legacyHooksDirectory}/tool-policy-rules.json`) {
      const newPath = `${hooksDirectory}/tool-policy-rules.json`;
      const generated = planFilesByPath.get(newPath);
      const legacyText = await readTextIfExists(targetDir, path);
      const legacyRules = legacyText === undefined ? undefined : parseToolPolicyRules(legacyText);

      if (!generated || !legacyRules) {
        report.blockedPaths.push(path);
        report.notes.push(`${path} could not be merged into ${newPath}; review and remove it manually.`);
        continue;
      }

      const generatedRules = parseToolPolicyRules(generated.content);
      if (!generatedRules) {
        report.blockedPaths.push(path);
        continue;
      }

      const generatedIds = new Set(generatedRules.rules.map((rule) => rule.id));
      const carried = legacyRules.rules.filter((rule) => !generatedIds.has(rule.id));
      if (carried.length > 0) {
        report.toolPolicyRulesOverride = {
          path: newPath,
          content: `${JSON.stringify({ version: generatedRules.version, rules: [...generatedRules.rules, ...carried] }, null, 2)}\n`,
          carriedRuleIds: carried.map((rule) => rule.id)
        };
        report.notes.push(
          `Carried ${carried.length} learned tool-policy rule(s) from ${path} into ${newPath}: ${carried.map((rule) => rule.id).join(", ")}.`
        );
      }
      report.pruneFiles.push(path);
      continue;
    }

    report.blockedPaths.push(path);
  }
}

async function classifyAdvisorTrees(
  targetDir: string,
  planFilesByPath: Map<string, RenderedFile>,
  report: StalePathReport
): Promise<void> {
  const agents: EnforcementAgent[] = ["claude", "codex"];

  for (const agent of agents) {
    for (const file of await advisorSkillFiles(agent)) {
      if (planFilesByPath.has(file.path)) {
        continue;
      }

      const current = await readTextIfExists(targetDir, file.path);
      if (current === undefined) {
        continue;
      }

      if (current === file.content) {
        report.pruneFiles.push(file.path);
      } else {
        report.blockedPaths.push(file.path);
      }
    }
  }
}

/**
 * Reconstruct the pre-v3 generated content of a path-only migration: the only
 * difference between the v2 and v3 renders of these files is the hooks
 * directory embedded in commands.
 */
function legacyVariant(content: string): string {
  return content.replaceAll(hooksDirectory, legacyHooksDirectory);
}

const builtinHookIds = new Set(["secret-shield", "tool-policy", "write-guard", "verb-runner", "quality-judge", "stop-judge"]);

/**
 * Exact reproduction of the v2 renderJustfile output: a single full `check`
 * aggregate (including the hook self-test suite that has since moved to
 * `farrier doctor`) and no fast gate.
 */
function legacyJustfile(pack: ResolvedPack): string {
  const hookCheck = pack.hooks.some((hook) => builtinHookIds.has(hook)) ? ` && uv run --with pytest pytest ${legacyHooksDirectory}` : "";
  const recipes = [
    `check:
  ${pack.verbs.check}${hookCheck}`,
    `test:
  ${pack.verbs.test}`,
    `fmt:
  ${pack.verbs.fmt}`
  ];

  if (pack.verbs.konsistent) {
    const comment = pack.packIds.includes("python-uv")
      ? "  # Temporary local path dependency; upgrade path: git dependency, then PyPI.\n"
      : "";

    recipes.push(`${pack.konsistentTool ?? "konsistent"}:
${comment}  ${pack.verbs.konsistent}`);
  }

  return `${recipes.join("\n\n")}\n`;
}

async function classifyGeneratedSingletons(
  targetDir: string,
  planFilesByPath: Map<string, RenderedFile>,
  pack: ResolvedPack,
  legacyPack: ResolvedPack,
  report: StalePathReport
): Promise<void> {
  // Legacy-generated variants are exactly reconstructable: the v2 render of
  // these files differs from v3 only in the hooks directory embedded in
  // commands and in the hook set (v2 manifests listed disabled judge hooks
  // that migration drops). Byte-matching a reconstructed variant is safe.
  const singletons: Array<{ path: string; generate: (source: ResolvedPack) => string }> = [
    { path: ".claude/settings.json", generate: (source) => renderClaudeSettingsJson(source) },
    { path: ".codex/hooks.json", generate: (source) => renderCodexHooksJson(source) }
  ];

  for (const { path, generate } of singletons) {
    const current = await readTextIfExists(targetDir, path);
    if (current === undefined) {
      continue;
    }

    const generated = planFilesByPath.get(path)?.content ?? generate(pack);
    const stillEmitted = planFilesByPath.has(path);

    if (current === generated) {
      if (!stillEmitted) {
        report.pruneFiles.push(path);
      }
      continue;
    }

    const legacyVariants = new Set([legacyVariant(generated), legacyVariant(generate(legacyPack))]);
    if (legacyVariants.has(current)) {
      if (stillEmitted) {
        report.repairUserFiles.push(path);
      } else {
        report.pruneFiles.push(path);
      }
      continue;
    }

    if (current.includes(`${legacyHooksDirectory}/`)) {
      report.blockedPaths.push(path);
      report.notes.push(`${path} references the legacy ${legacyHooksDirectory}/ path but has local edits; update it manually.`);
    }
  }

  // Rules files generated before probe fixtures existed differ from the new
  // render only by the added probe fields; byte-matching the probe-stripped
  // variant proves there are no learned rules or user edits to preserve.
  const rulesPath = `${hooksDirectory}/tool-policy-rules.json`;
  const generatedRules = planFilesByPath.get(rulesPath);
  if (generatedRules) {
    const current = await readTextIfExists(targetDir, rulesPath);
    if (current !== undefined && current !== generatedRules.content) {
      const parsed = parseToolPolicyRules(generatedRules.content);
      if (parsed) {
        const withoutProbes = `${JSON.stringify(
          { version: parsed.version, rules: parsed.rules.map(({ probe: _probe, ...rest }) => rest) },
          null,
          2
        )}\n`;
        if (current === withoutProbes) {
          report.repairUserFiles.push(rulesPath);
        }
      }
    }
  }

  const justfile = planFilesByPath.get("justfile");
  if (justfile) {
    const current = await readTextIfExists(targetDir, "justfile");
    const legacyVariants = new Set([
      legacyVariant(justfile.content),
      legacyJustfile(pack),
      legacyJustfile(legacyPack),
      // Interim layout: hooks already at .farrier/hooks but still a single
      // full check aggregate including the hook self-tests.
      legacyJustfile(pack).replaceAll(legacyHooksDirectory, hooksDirectory),
      legacyJustfile(legacyPack).replaceAll(legacyHooksDirectory, hooksDirectory)
    ]);
    if (current !== undefined && current !== justfile.content && legacyVariants.has(current)) {
      report.repairUserFiles.push("justfile");
    }
  }

  if (!planFilesByPath.has("CLAUDE.md")) {
    const current = await readTextIfExists(targetDir, "CLAUDE.md");
    if (current !== undefined && current === renderClaudeMd()) {
      report.pruneFiles.push("CLAUDE.md");
    }
  }
}

export async function classifyStalePaths(input: {
  targetDir: string;
  planFiles: readonly RenderedFile[];
  pack: ResolvedPack;
  /** The pack with the pre-migration hook set (e.g. v2 judge hooks), for reconstructing legacy-generated content. */
  legacyPack?: ResolvedPack;
}): Promise<StalePathReport> {
  const report = emptyReport();
  const planFilesByPath = new Map(input.planFiles.map((file) => [file.path, file]));

  await classifyLegacyHooks(input.targetDir, planFilesByPath, report);
  await classifyAdvisorTrees(input.targetDir, planFilesByPath, report);
  await classifyGeneratedSingletons(input.targetDir, planFilesByPath, input.pack, input.legacyPack ?? input.pack, report);

  report.pruneFiles = [...new Set(report.pruneFiles)].sort();
  report.pruneTrees = [...new Set(report.pruneTrees)].sort();
  report.blockedPaths = [...new Set(report.blockedPaths)].sort();
  report.repairUserFiles = [...new Set(report.repairUserFiles)].sort();
  return report;
}
