import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadFarrierConfig } from "../config/farrier-config";
import { loadPackCatalog, type PackCatalog } from "../registry/catalog";
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

export async function loadConfiguredCatalog(input: {
  targetDir: string;
  requireRefs?: Map<string, string>;
}): Promise<PackCatalog> {
  const loaded = await loadFarrierConfig({ projectDir: input.targetDir });
  return loadPackCatalog({
    config: loaded.config,
    requireNamespaces: input.requireRefs
  });
}
