import { resolve } from "node:path";
import { createDoctorReport, doctorExitCode, formatDoctorReport } from "../engine/doctor";

type DoctorCliOptions = {
  dir: string;
  json: boolean;
  help: boolean;
};

function parseDoctorArgs(args: string[]): DoctorCliOptions {
  const options: DoctorCliOptions = {
    dir: process.cwd(),
    json: false,
    help: false
  };

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

    throw new Error(`Unknown doctor argument: ${arg}`);
  }

  return options;
}

export async function runDoctor(args: string[], usage: () => string): Promise<number> {
  const options = parseDoctorArgs(args);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const targetDir = resolve(options.dir);
  const report = await createDoctorReport({ targetDir });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorReport(report).trimEnd());
  }

  return doctorExitCode(report);
}
