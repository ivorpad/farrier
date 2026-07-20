import { resolve } from "node:path";
import { createDoctorReport, doctorExitCode, formatDoctorReport } from "../engine/doctor";
import { createRuntimeReport, formatRuntimeReport, runLiveCodexProbe } from "../engine/doctor-runtime";
import { loadConfiguredCatalog, registryRefsFromManifest } from "./registry";

type DoctorCliOptions = {
  dir: string;
  json: boolean;
  staticOnly: boolean;
  live: boolean;
  help: boolean;
};

function parseDoctorArgs(args: string[]): DoctorCliOptions {
  const options: DoctorCliOptions = {
    dir: process.cwd(),
    json: false,
    staticOnly: false,
    live: false,
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

    if (arg === "--static") {
      options.staticOnly = true;
      continue;
    }

    if (arg === "--live") {
      options.live = true;
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

  if (options.staticOnly && options.live) {
    throw new Error("--static and --live are mutually exclusive");
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
  const requireRefs = await registryRefsFromManifest(targetDir);
  const catalog = await loadConfiguredCatalog({ targetDir, requireRefs });
  const report = await createDoctorReport({ targetDir, catalog });

  // Runtime probes need the static shape to be broadly intact (manifest and
  // hook files present); skip them when static health already failed.
  const runStatic = options.staticOnly || !report.healthy;
  const runtime = runStatic ? null : await createRuntimeReport({ targetDir, catalog });
  const live = runtime && options.live ? await runLiveCodexProbe({ targetDir }) : null;

  if (options.json) {
    console.log(JSON.stringify({ ...report, runtime, live }, null, 2));
  } else {
    console.log(formatDoctorReport(report).trimEnd());
    if (runtime) {
      console.log("");
      console.log(formatRuntimeReport(runtime).trimEnd());
    } else if (!options.staticOnly) {
      console.log("");
      console.log("Runtime probes skipped: fix static health problems first, then rerun farrier doctor.");
    }
    if (live) {
      console.log("");
      console.log(`Live Codex probe: ${live.ok ? "ok" : "FAILED"} — ${live.detail}`);
    }
  }

  const runtimeUnhealthy = runtime !== null && !runtime.healthy;
  const liveFailed = live !== null && !live.ok;
  return doctorExitCode(report) || (runtimeUnhealthy || liveFailed ? 1 : 0);
}
