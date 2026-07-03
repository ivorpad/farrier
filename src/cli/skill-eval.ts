import { resolve } from "node:path";
import { loadFarrierConfig, resolveModelSettings } from "../config/farrier-config";
import { detectAgentBackend, type AgentBackend } from "../engine/backend";
import {
  evaluatePerAgentSkill,
  resolvePerAgentSkillWinner,
  type SkillEvalVerdict,
  type SkillWinnerResolution
} from "../engine/eval-skill";
import type { CreateAgent } from "../engine/create-skill";

export type SkillEvalCliOptions = {
  skillName?: string;
  claudeName?: string;
  codexName?: string;
  dir: string;
  backend?: AgentBackend;
  model?: string;
  description?: string;
  applyWinner?: CreateAgent | "recommended";
  deleteLoserAndLink: boolean;
  json: boolean;
  help: boolean;
};

function usage(): string {
  return `farrier skill eval — compare per-agent skill copies and optionally pick a winner

Usage:
  farrier skill eval <skill-name> [--dir <target>] [--backend claude|codex] [--description <text>] [--json]
  farrier skill eval <skill-name> --apply-winner claude|codex|recommended --delete-loser-and-link [--dir <target>]
  farrier skill eval <skill-name> --claude-name <name> --codex-name <name>   # copies that chose different names

By default this is read-only: the copies are staged at neutral paths and judged blind,
twice with the candidates swapped, using the pinned Anthropic skill-creator eval guidance;
a winner is only recommended when both passes agree. Per-copy reports are written under
.farrier-staging/eval/<name>/. When the copies chose different directory names, pass
--claude-name/--codex-name (each defaults to <skill-name>); picking a winner then links
the loser's root under the winner's name. It deletes and symlinks only when both
--apply-winner and --delete-loser-and-link are present. --apply-winner recommended applies
the verdict's own pick — it keeps the deleted copy in .farrier-staging/trash/ so you can
change your mind, and keeps both copies (exit 0) when the verdict is a tie.`;
}

function parseBackend(value: string): AgentBackend {
  if (value === "claude" || value === "codex") {
    return value;
  }

  throw new Error("--backend must be claude or codex");
}

function parseWinner(value: string): CreateAgent | "recommended" {
  if (value === "claude" || value === "codex" || value === "recommended") {
    return value;
  }

  throw new Error("--apply-winner must be claude, codex, or recommended");
}

export function parseSkillEvalArgs(args: string[]): SkillEvalCliOptions {
  const options: SkillEvalCliOptions = {
    dir: process.cwd(),
    deleteLoserAndLink: false,
    json: false,
    help: false
  };

  const takesValue: Array<{ flag: string; set: (value: string) => void }> = [
    { flag: "--dir", set: (value) => (options.dir = value) },
    { flag: "--backend", set: (value) => (options.backend = parseBackend(value)) },
    { flag: "--model", set: (value) => (options.model = value) },
    { flag: "--description", set: (value) => (options.description = value) },
    { flag: "--apply-winner", set: (value) => (options.applyWinner = parseWinner(value)) },
    { flag: "--claude-name", set: (value) => (options.claudeName = value) },
    { flag: "--codex-name", set: (value) => (options.codexName = value) }
  ];

  const booleans: Record<string, () => void> = {
    "--help": () => (options.help = true),
    "-h": () => (options.help = true),
    "--json": () => (options.json = true),
    "--delete-loser-and-link": () => (options.deleteLoserAndLink = true)
  };

  outer: for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const setBoolean = booleans[arg];

    if (setBoolean) {
      setBoolean();
      continue;
    }

    for (const { flag, set } of takesValue) {
      if (arg === flag) {
        const value = args[i + 1];
        if (!value || value.startsWith("--")) {
          throw new Error(`${flag} requires a value`);
        }
        set(value);
        i += 1;
        continue outer;
      }

      if (arg.startsWith(`${flag}=`)) {
        set(arg.slice(flag.length + 1));
        continue outer;
      }
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown skill eval argument: ${arg}`);
    }

    if (options.skillName !== undefined) {
      throw new Error("skill eval takes a single skill name");
    }

    options.skillName = arg;
  }

  return options;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printVerdict(verdict: SkillEvalVerdict): void {
  console.log(`Recommendation: ${verdict.recommendedWinner}`);
  console.log(verdict.rationale);
  console.log("");
  for (const agent of ["claude", "codex"] as const) {
    const copy = verdict.copies[agent];
    console.log(`${agent} (${copy.score}/10): ${copy.rationale}`);
    console.log(`  path: ${copy.path}`);
    console.log(`  strengths: ${copy.strengths.join("; ") || "none"}`);
    console.log(`  weaknesses: ${copy.weaknesses.join("; ") || "none"}`);
  }
  for (const note of verdict.notes) {
    console.log(`- ${note}`);
  }
  if (verdict.reportPaths) {
    console.log(`Reports: ${verdict.reportPaths.claude} · ${verdict.reportPaths.codex}`);
  }
}

function printResolution(resolution: SkillWinnerResolution): void {
  for (const deleted of resolution.deleted) {
    console.log(`Deleted ${deleted}`);
  }
  for (const link of resolution.links) {
    console.log(`Linked ${link.path} -> ${link.target}`);
  }
  if (resolution.backupPath) {
    console.log(`Deleted copy kept at ${resolution.backupPath}`);
  }
}

export async function runSkillEval(args: string[]): Promise<number> {
  let options: SkillEvalCliOptions;

  try {
    options = parseSkillEvalArgs(args);
  } catch (error) {
    console.error(`farrier skill eval: ${errorMessage(error)}`);
    return 1;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }

  if (!options.skillName || options.skillName.trim().length === 0) {
    console.error("farrier skill eval: a skill name is required. Usage: farrier skill eval <skill-name> [--help]");
    return 1;
  }

  if (options.applyWinner && !options.deleteLoserAndLink) {
    console.error("farrier skill eval: --apply-winner requires --delete-loser-and-link to delete and symlink.");
    return 1;
  }

  try {
    const targetDir = resolve(options.dir);
    const backend = options.backend ?? detectAgentBackend();

    if (!backend) {
      console.error("farrier skill eval: no backend CLI found. Install claude or codex, or pass --backend.");
      return 1;
    }

    const names = {
      claude: options.claudeName ?? options.skillName,
      codex: options.codexName ?? options.skillName
    };

    const models = await loadFarrierConfig({ projectDir: targetDir })
      .then((loaded) => loaded.config.models)
      .catch(() => ({}));
    const evalSettings = resolveModelSettings({ models, backend, role: "eval", explicitModel: options.model });

    const verdict = await evaluatePerAgentSkill({
      targetDir,
      skillName: options.skillName,
      names,
      description: options.description,
      backend,
      model: evalSettings.model,
      reasoningEffort: evalSettings.reasoningEffort
    });

    let resolution: SkillWinnerResolution | undefined;
    let tieKeptBoth = false;

    if (options.applyWinner === "recommended" && verdict.recommendedWinner === "tie") {
      tieKeptBoth = true;
    } else if (options.applyWinner) {
      resolution = await resolvePerAgentSkillWinner({
        targetDir,
        skillName: options.skillName,
        names,
        winner: options.applyWinner === "recommended" ? (verdict.recommendedWinner as CreateAgent) : options.applyWinner,
        confirmDeleteAndLink: options.deleteLoserAndLink,
        // Consent for "recommended" was given before the verdict existed, so
        // the deleted copy is kept recoverable; an explicit pick deletes clean.
        retainBackupInTrash: options.applyWinner === "recommended"
      });
    }

    if (options.json) {
      console.log(JSON.stringify({ verdict, resolution, tieKeptBoth: tieKeptBoth || undefined }, null, 2));
    } else {
      printVerdict(verdict);
      if (tieKeptBoth) {
        console.log("");
        console.log("Verdict is a tie — kept both copies, nothing deleted.");
      }
      if (resolution) {
        console.log("");
        printResolution(resolution);
      }
    }

    return 0;
  } catch (error) {
    console.error(`farrier skill eval: ${errorMessage(error)}`);
    return 1;
  }
}
