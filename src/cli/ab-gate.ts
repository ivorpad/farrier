import { resolve } from "node:path";
import { formatAbGateReport, loadAbGateReport } from "../engine/ab-gate";

type AbGateCliOptions = {
  result?: string;
  json: boolean;
  help: boolean;
};

function parseAbGateArgs(args: string[]): AbGateCliOptions {
  const options: AbGateCliOptions = { json: false, help: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--result") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--result requires a value");
      }
      options.result = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--result=")) {
      options.result = arg.slice("--result=".length);
      continue;
    }

    throw new Error(`Unknown ab-gate argument: ${arg}`);
  }

  return options;
}

export async function runAbGate(args: string[], usage: () => string): Promise<number> {
  const options = parseAbGateArgs(args);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  if (!options.result) {
    throw new Error("ab-gate requires --result <result.json> from a paired harness evaluation");
  }

  const report = await loadAbGateReport(resolve(options.result));

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatAbGateReport(report).trimEnd());
  }

  return report.ok ? 0 : 1;
}
