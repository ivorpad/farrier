import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadFarrierConfig } from "../config/farrier-config";
import { loadPackCatalog, type PackCatalog, type RegistryPin } from "../registry/catalog";
import { parseItemRef } from "../registry/ref";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function addRef(refs: Map<string, string>, value: string): void {
  const parsed = parseItemRef(value);
  if (parsed && !refs.has(parsed.namespace)) {
    refs.set(parsed.namespace, parsed.id);
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export async function registryRefsFromManifest(targetDir: string): Promise<Map<string, string>> {
  let text: string;
  try {
    text = await readFile(join(targetDir, ".farrier.json"), "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  const refs = new Map<string, string>();
  const raw = JSON.parse(text) as unknown;
  if (!isRecord(raw)) {
    return refs;
  }

  for (const value of [...stringArray(raw.packIds), ...stringArray(raw.hookIds)]) {
    addRef(refs, value);
  }

  if (isRecord(raw.registry) && isRecord(raw.registry.items)) {
    for (const id of Object.keys(raw.registry.items)) {
      addRef(refs, id);
    }
  }

  return refs;
}

async function registryPinsFromManifest(targetDir: string): Promise<Record<string, RegistryPin>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(targetDir, ".farrier.json"), "utf8"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return {};
    throw error;
  }
  if (!isRecord(raw) || !isRecord(raw.registry) || !isRecord(raw.registry.items)) return {};

  const pins: Record<string, RegistryPin> = {};
  for (const [id, value] of Object.entries(raw.registry.items)) {
    if (
      isRecord(value) &&
      (value.type === "pack" || value.type === "hook" || value.type === "skill") &&
      typeof value.version === "string" &&
      typeof value.sha256 === "string"
    ) {
      pins[id] = {
        type: value.type,
        version: value.version,
        sha256: value.sha256,
        ...(typeof value.sourceIdentity === "string" ? { sourceIdentity: value.sourceIdentity } : {}),
        ...(typeof value.ref === "string" ? { ref: value.ref } : {})
      };
    }
  }
  return pins;
}

export async function loadConfiguredCatalog(input: {
  targetDir: string;
  requireRefs?: Map<string, string>;
}): Promise<PackCatalog> {
  const loaded = await loadFarrierConfig({ projectDir: input.targetDir });
  return loadPackCatalog({
    config: loaded.config,
    registrySources: loaded.registrySources,
    requireNamespaces: input.requireRefs,
    requiredPins: await registryPinsFromManifest(input.targetDir)
  });
}

type RegistryListOptions = {
  dir: string;
  json: boolean;
  help: boolean;
};

function parseRegistryListArgs(args: string[]): RegistryListOptions {
  const options: RegistryListOptions = { dir: process.cwd(), json: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--dir") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--dir requires a value");
      options.dir = value;
      index += 1;
    } else if (arg.startsWith("--dir=")) options.dir = arg.slice("--dir=".length);
    else throw new Error(`Unknown registry list argument: ${arg}`);
  }
  return options;
}

function registryRows(namespaces: string[], catalog: PackCatalog): Array<{ namespace: string; itemCount: number; cached: boolean }> {
  const pins = catalog.registryPins();
  return namespaces.map((namespace) => ({
    namespace,
    itemCount: Object.keys(pins).filter((id) => parseItemRef(id)?.namespace === namespace).length,
    cached: catalog.warnings.some((warning) => warning.namespace === namespace && warning.message.includes("cache"))
  }));
}

export async function runRegistry(args: string[], usageText: () => string): Promise<number> {
  if (args[0] !== "list") {
    console.error("farrier: unknown registry subcommand. Usage: farrier registry list [--help]");
    return 1;
  }
  const options = parseRegistryListArgs(args.slice(1));
  if (options.help) {
    console.log(usageText());
    return 0;
  }
  const targetDir = resolve(options.dir);
  const loaded = await loadFarrierConfig({ projectDir: targetDir });
  const catalog = await loadPackCatalog({ config: loaded.config, registrySources: loaded.registrySources });
  const registries = registryRows(Object.keys(loaded.config.registries), catalog);
  if (options.json) {
    console.log(JSON.stringify({ registries, warnings: catalog.warnings }, null, 2));
    return 0;
  }
  console.log("Registries:");
  if (registries.length === 0) console.log("  none configured");
  else for (const registry of registries) console.log(`  ${registry.namespace}: ${registry.itemCount} items${registry.cached ? " (cached)" : ""}`);
  if (catalog.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of catalog.warnings) console.log(`  - ${warning.namespace}: ${warning.message}`);
  }
  return 0;
}
