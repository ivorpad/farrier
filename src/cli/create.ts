import { resolve } from "node:path";
import { applyHarnessChangePlan, HarnessApplyError, inspectHarnessChangePlan, type HarnessChangePlan, type HarnessFileAction } from "../engine/create-plan";
import { detectPacksWithEvidence, type DetectedPackEvidence } from "../engine/detect";
import { agentsHardRules, createRenderPlan } from "../engine/render";
import { installSkills, type InstallSkillResult } from "../engine/skills";
import type { ResolvedPack } from "../packs/types";
import type { PackCatalog } from "../registry/catalog";
import { parseItemRef } from "../registry/ref";
import { loadConfiguredCatalog } from "./registry";

export type CreateCliOptions = {
  stack?: string;
  detect: boolean;
  dir: string;
  context?: string;
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  json: boolean;
  installSkills: boolean;
  help: boolean;
};

type ResolvedRenderStack = {
  stack: string;
  selection: "detected" | "explicit";
  detected: DetectedPackEvidence[];
};

export function parseCreateArgs(args: string[]): CreateCliOptions {
  const options: CreateCliOptions = {
    dir: process.cwd(),
    yes: false,
    dryRun: false,
    force: false,
    json: false,
    installSkills: true,
    detect: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--no-skills") {
      options.installSkills = false;
      continue;
    }

    if (arg === "--detect") {
      options.detect = true;
      continue;
    }

    if (arg === "--stack") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--stack requires a value");
      }
      options.stack = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--stack=")) {
      options.stack = arg.slice("--stack=".length);
      continue;
    }

    if (arg === "--dir") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--dir requires a value");
      }
      options.dir = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--dir=")) {
      options.dir = arg.slice("--dir=".length);
      continue;
    }

    if (arg === "--context") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--context requires a value");
      }
      options.context = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--context=")) {
      options.context = arg.slice("--context=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.detect && options.stack) {
    throw new Error("--detect and --stack are mutually exclusive");
  }

  if (options.force && !options.yes) {
    throw new Error("--force requires --yes; preview replacements with --dry-run first");
  }

  if (options.dryRun && options.yes) {
    throw new Error("--dry-run and --yes are mutually exclusive");
  }

  return options;
}

function requiredRefsForStack(stack: string | undefined): Map<string, string> {
  const refs = new Map<string, string>();
  if (!stack) {
    return refs;
  }

  const parsed = parseItemRef(stack);
  if (parsed) {
    refs.set(parsed.namespace, parsed.id);
  }

  return refs;
}

function printCatalogWarnings(catalog: PackCatalog): void {
  for (const warning of catalog.warnings) {
    console.error(`farrier: registry warning ${warning.namespace}: ${warning.message}`);
  }
}

function generatorCommand(pack: { generator?: { command: string; args: string[] } }): string | undefined {
  if (!pack.generator) {
    return undefined;
  }

  return [pack.generator.command, ...pack.generator.args].join(" ");
}

async function resolveRenderStack(options: CreateCliOptions, targetDir: string, catalog: PackCatalog): Promise<ResolvedRenderStack> {
  const detected = await detectPacksWithEvidence(targetDir, catalog);

  if (options.detect) {
    if (detected.length === 0) {
      throw new Error(`No stack detected in ${targetDir}. Use --stack generic to render the generic harness.`);
    }

    return {
      stack: detected[0]!.packId,
      selection: "detected",
      detected,
    };
  }

  if (!options.stack) {
    throw new Error(`Missing --stack. Supported stacks: ${catalog.packIds().join(", ")}`);
  }

  return {
    stack: options.stack,
    selection: "explicit",
    detected,
  };
}

function actionMarker(action: HarnessFileAction): string {
  switch (action) {
    case "create":
      return "+";
    case "unchanged":
      return "=";
    case "merge":
      return "~";
    case "update":
      return "M";
    case "replace":
      return "!";
    case "blocked":
      return "x";
  }
}

function generatorSource(pack: ResolvedPack, catalog: PackCatalog): string | undefined {
  return [...pack.packIds].reverse().find((packId) => catalog.getPack(packId)?.generator !== undefined);
}

function creationReport(input: { options: CreateCliOptions; resolved: ResolvedRenderStack; pack: ResolvedPack; plan: HarnessChangePlan; catalog: PackCatalog }): Record<string, unknown> {
  const generator = generatorCommand(input.pack);

  return {
    schemaVersion: 1,
    operation: "create",
    mode: input.options.dryRun ? "preview" : "apply",
    targetDir: input.plan.targetDir,
    stack: {
      selection: input.resolved.selection,
      selected: input.resolved.stack,
      lineage: input.pack.packIds,
      detected: input.resolved.detected,
    },
    harnessBehavior: {
      hardRuleCount: agentsHardRules(input.pack).length,
      hooks: input.pack.hooks,
      skills: input.pack.skills,
      skillAction: input.options.installSkills ? "install" : "record-only",
      commands: input.pack.verbs,
      semanticJudges: "disabled-by-default",
      generator: generator
        ? {
            command: generator,
            source: generatorSource(input.pack, input.catalog) ?? input.pack.id,
            action: "declared-not-run",
          }
        : null,
    },
    files: input.plan.files.map((file) => ({
      path: file.path,
      action: file.action,
      purpose: file.purpose,
      reason: file.reason ?? null,
      requiresForce: file.requiresForce,
    })),
    summary: input.plan.counts,
    applicable: !input.plan.existingHarness && input.plan.blockers.length === 0 && (input.plan.replacements.length === 0 || input.options.force),
    existingHarness: input.plan.existingHarness,
    replacements: input.plan.replacements,
    blockers: input.plan.blockers,
    registryWarnings: input.catalog.warnings,
  };
}

function printDetectedStacks(resolved: ResolvedRenderStack): void {
  if (resolved.detected.length === 0) {
    console.log("Detected project signals: none matched a supported stack");
    return;
  }

  console.log("Detected project stacks:");
  for (const detected of resolved.detected) {
    console.log(`  - ${detected.packId}: ${detected.evidence.join(", ") || "matched pack detector"}`);
  }
}

function printCreationPlan(input: { options: CreateCliOptions; resolved: ResolvedRenderStack; pack: ResolvedPack; plan: HarnessChangePlan; catalog: PackCatalog }): void {
  const counts = input.plan.counts;
  const generator = generatorCommand(input.pack);

  console.log(`Farrier creation plan for ${input.plan.targetDir}`);
  console.log("");
  console.log(`Selected stack: ${input.resolved.stack} (${input.resolved.selection}; lineage ${input.pack.packIds.join(" -> ")})`);
  printDetectedStacks(input.resolved);
  if (input.resolved.selection === "detected" && input.resolved.detected.length > 1) {
    console.log(`Assumption: selected the first, most-specific match; ${input.resolved.detected.length - 1} broader or alternate match(es) are shown above.`);
  } else if (input.resolved.selection === "explicit") {
    console.log("Assumption: the stack was explicitly selected; detected signals did not override it.");
  }

  console.log("");
  console.log("Harness behavior:");
  console.log(`  - ${agentsHardRules(input.pack).length} shared agent rules in AGENTS.md`);
  console.log(`  - ${input.pack.hooks.length} hook(s): ${input.pack.hooks.join(", ") || "none"}`);
  console.log(`  - check: ${input.pack.verbs.check}`);
  console.log(`  - test: ${input.pack.verbs.test}`);
  console.log(`  - format: ${input.pack.verbs.fmt}`);
  if (input.pack.verbs.konsistent) {
    console.log(`  - structure: ${input.pack.verbs.konsistent}`);
  }
  console.log(`  - ${input.pack.skills.length} selected skill(s): ${input.options.installSkills ? "install for Claude Code and Codex after files are written" : "record only (--no-skills)"}`);
  console.log("  - semantic judge hooks are present where selected, but model calls stay disabled by default");
  if (generator) {
    console.log(`  - declared project generator: ${generator} (from ${generatorSource(input.pack, input.catalog) ?? input.pack.id}); harness creation does not run it`);
  }

  console.log("");
  console.log(
    `File actions: ${counts.create} create, ${counts.merge} safe merge, ${counts.update} metadata update, ${counts.unchanged} unchanged, ${counts.replace} replace, ${counts.blocked} blocked`,
  );
  for (const file of input.plan.files) {
    const reason = file.reason ? `; ${file.reason}` : "";
    console.log(`  ${actionMarker(file.action)} ${file.path} — ${file.purpose}${reason}`);
  }

  if (input.plan.existingHarness) {
    console.log("");
    console.log("Blocked: .farrier.json already exists. Use `farrier update --dir <target>`; creation never resets an existing harness.");
  }
  if (input.plan.blockers.length > 0) {
    console.log("");
    console.log("Blocked paths must be resolved before creation:");
    for (const blocker of input.plan.blockers) {
      console.log(`  - ${blocker.path}: ${blocker.reason}`);
    }
  }
  if (input.plan.replacements.length > 0) {
    console.log("");
    console.log("Existing differing files require explicit replacement:");
    for (const path of input.plan.replacements) {
      console.log(`  - ${path}`);
    }
    console.log("Preview first; then use --yes --force to replace them with recoverable backups.");
  }
}

function skillRetryCommand(ref: string): string | undefined {
  const separator = ref.lastIndexOf("@");
  if (separator <= 0 || separator >= ref.length - 1) {
    return undefined;
  }

  return `skills add ${ref.slice(0, separator)} -s ${ref.slice(separator + 1)} -a claude-code codex -y`;
}

function printSkillResults(results: InstallSkillResult[]): void {
  const failed = results.filter((result) => !result.ok);
  console.log(`Skills: installed ${results.length - failed.length} of ${results.length}`);
  for (const result of failed) {
    console.log(`  ! ${result.ref}: ${result.error ?? (result.stderr || "unknown install failure")}`);
    const retry = skillRetryCommand(result.ref);
    if (retry) {
      console.log(`    retry: ${retry}`);
    }
  }
}

function jsonSkillResult(result: InstallSkillResult): Record<string, unknown> {
  return {
    ...result,
    retryCommand: result.ok ? null : (skillRetryCommand(result.ref) ?? null),
  };
}

async function executeCreate(args: string[], usage: () => string): Promise<number> {
  const options = parseCreateArgs(args);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  if (!options.dryRun && !options.yes) {
    throw new Error("Refusing to write without --yes. Use --dry-run to review the creation plan.");
  }

  const targetDir = resolve(options.dir);
  const catalog = await loadConfiguredCatalog({
    targetDir,
    requireRefs: requiredRefsForStack(options.stack),
  });
  if (!options.json) printCatalogWarnings(catalog);
  const resolved = await resolveRenderStack(options, targetDir, catalog);
  const pack = catalog.resolvePack(resolved.stack);
  const renderPlan = await createRenderPlan({
    targetDir,
    pack,
    registryPins: catalog.registryPins(),
  });
  const plan = await inspectHarnessChangePlan(renderPlan, {
    packId: resolved.stack,
    hookCount: pack.hooks.length,
    skillCount: pack.skills.length,
    ruleCount: agentsHardRules(pack).length,
    verbs: pack.verbs,
    konsistentTool: pack.konsistentTool,
  });
  const view = { options, resolved, pack, plan, catalog };
  const report = creationReport(view);

  if (options.dryRun) {
    if (options.json) {
      console.log(JSON.stringify({ ...report, ok: true, written: false }, null, 2));
    } else {
      printCreationPlan(view);
      console.log("");
      console.log("Dry run: nothing was written.");
    }
    return 0;
  }

  if (!options.json) {
    printCreationPlan(view);
    console.log("");
  }

  let applied;
  try {
    applied = await applyHarnessChangePlan(renderPlan, {
      force: options.force,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      const incomplete = error instanceof HarnessApplyError && error.mutationState === "rollback-incomplete";
      console.log(
        JSON.stringify(
          {
            ...report,
            ok: false,
            written: incomplete ? null : false,
            mutationState: error instanceof HarnessApplyError ? error.mutationState : "not-started",
            retainedBackupDir: error instanceof HarnessApplyError ? error.backupDir : null,
            error: message,
          },
          null,
          2,
        ),
      );
      return 1;
    }
    throw error;
  }

  const skillResults = options.installSkills && pack.skills.length > 0 ? await installSkills(pack.skills, targetDir) : [];
  const failedSkills = skillResults.filter((result) => !result.ok);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ...report,
          ok: failedSkills.length === 0,
          written: true,
          applied,
          skills: {
            requested: options.installSkills ? pack.skills : [],
            skipped: !options.installSkills,
            results: skillResults.map(jsonSkillResult),
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Applied ${applied.writtenFiles.length} file change(s); ${applied.unchangedFiles.length} unchanged.`);
    if (applied.backupDir) {
      console.log(`Backups: ${applied.backupDir}`);
    }
    if (!options.installSkills) {
      console.log(`Skills: skipped ${pack.skills.length} selected skill(s) by request.`);
    } else {
      printSkillResults(skillResults);
    }
    console.log(`Next: farrier doctor --dir ${targetDir}`);
  }

  return failedSkills.length === 0 ? 0 : 1;
}

export async function runCreate(args: string[], usage: () => string): Promise<number> {
  try {
    return await executeCreate(args, usage);
  } catch (error) {
    if (!args.includes("--json")) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ schemaVersion: 1, operation: "create", ok: false, written: false, mutationState: "not-started", retainedBackupDir: null, error: message }, null, 2));
    return 1;
  }
}
