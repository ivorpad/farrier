import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { generateRepoMapSection, repoMapBeginMarker, spliceRepoMapSection } from "../engine/repo-map";

type MapCliOptions = {
  dir: string;
  json: boolean;
  help: boolean;
};

function parseMapArgs(args: string[]): MapCliOptions {
  const options: MapCliOptions = { dir: process.cwd(), json: false, help: false };

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

    throw new Error(`Unknown map argument: ${arg}`);
  }

  return options;
}

export async function runMap(args: string[], usage: () => string): Promise<number> {
  const options = parseMapArgs(args);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const targetDir = resolve(options.dir);
  const agentsPath = join(targetDir, "AGENTS.md");

  let existing: string;
  try {
    existing = await readFile(agentsPath, "utf8");
  } catch {
    throw new Error(`no AGENTS.md at ${targetDir}; run farrier create first`);
  }

  const section = await generateRepoMapSection(targetDir);
  if (section === null) {
    throw new Error(
      `no repository map for ${targetDir}: it must be the root of a git repository with at least a handful of tracked files`
    );
  }

  const updated = spliceRepoMapSection(existing, section);
  const hadMap = existing.includes(repoMapBeginMarker);
  const status = updated === existing ? "unchanged" : hadMap ? "refreshed" : "added";

  if (status !== "unchanged") {
    await writeFile(agentsPath, updated, "utf8");
  }

  if (options.json) {
    console.log(JSON.stringify({ targetDir, status }, null, 2));
  } else {
    console.log(`AGENTS.md repository map ${status} in ${targetDir}`);
  }

  return 0;
}
