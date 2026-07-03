import { resolve } from "node:path";
import {
  applyUpdate,
  createUpdateReport,
  formatUpdateApplyResult,
  formatUpdateReport
} from "../engine/update";

type UpdateCliOptions = {
  dir: string;
  yes: boolean;
  json: boolean;
  help: boolean;
};

function parseUpdateArgs(args: string[]): UpdateCliOptions {
  const options: UpdateCliOptions = {
    dir: process.cwd(),
    yes: false,
    json: false,
    help: false
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

    if (arg === "--json") {
      options.json = true;
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

    throw new Error(`Unknown update argument: ${arg}`);
  }

  return options;
}

export async function runUpdate(args: string[], usage: () => string): Promise<number> {
  const options = parseUpdateArgs(args);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const targetDir = resolve(options.dir);

  if (options.yes) {
    const result = await applyUpdate({ targetDir });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ...result.report,
            applied: {
              repairedFiles: result.repairedFiles,
              acknowledgedSecondaryIds: result.acknowledgedSecondaryIds,
              suggestedSkillsNotInstalled: result.suggestedSkillsNotInstalled
            }
          },
          null,
          2
        )
      );
      return 0;
    }

    console.log(formatUpdateApplyResult(result).trimEnd());
    return 0;
  }

  const report = await createUpdateReport({ targetDir });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(formatUpdateReport(report).trimEnd());
  return 0;
}
