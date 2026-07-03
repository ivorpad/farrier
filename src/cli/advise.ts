import { resolve } from "node:path";
import { loadFarrierConfig, resolveModelSettings } from "../config/farrier-config";
import { detectPacks } from "../engine/detect";
import { adviseSkills, detectAgentBackend, resolveContext, type AdviseBackend } from "../engine/advise";

export type AdviseCliOptions = {
  dir: string;
  context?: string;
  backend?: AdviseBackend;
  model?: string;
  json: boolean;
  help: boolean;
};

function adviseUsage(): string {
  return `farrier advise — recommend skills.sh skills from project context

Usage:
  farrier advise --dir <target> [--context <path|text>] [--backend claude|codex] [--model <name>] [--json]

Options:
  --dir <path>          Target directory. Defaults to current working directory.
  --context <path|text> Project context: a file path (tried as-given, then relative to --dir) or literal
                         text. Defaults to detected PRP.md, PRP.txt, or docs/PRP.md inside --dir.
  --backend <name>      Agent backend: claude or codex. Defaults to whichever is found on PATH.
  --model <name>        Backend model override.
  --json                Emit { backend, contextSource, queries, recommendations, notes }.
  --help                Show this help.

Exits 0 on success (including zero recommendations); exits 1 when no context or no backend is available.`;
}

function parseBackend(value: string): AdviseBackend {
  if (value === "claude" || value === "codex") {
    return value;
  }

  throw new Error("--backend must be claude or codex");
}

export function parseAdviseArgs(args: string[]): AdviseCliOptions {
  const options: AdviseCliOptions = {
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

    if (arg === "--backend") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--backend requires a value");
      }
      options.backend = parseBackend(value);
      i += 1;
      continue;
    }

    if (arg.startsWith("--backend=")) {
      options.backend = parseBackend(arg.slice("--backend=".length));
      continue;
    }

    if (arg === "--model") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--model requires a value");
      }
      options.model = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--model=")) {
      options.model = arg.slice("--model=".length);
      continue;
    }

    throw new Error(`Unknown advise argument: ${arg}`);
  }

  return options;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runAdvise(args: string[]): Promise<number> {
  const options = parseAdviseArgs(args);

  if (options.help) {
    console.log(adviseUsage());
    return 0;
  }

  const targetDir = resolve(options.dir);
  const resolvedContext = await resolveContext({ targetDir, context: options.context });

  if (!resolvedContext) {
    console.error(
      "farrier advise: no project context found. Pass --context <path|text> or add PRP.md, PRP.txt, or docs/PRP.md."
    );
    return 1;
  }

  let backend: AdviseBackend | undefined = options.backend;

  if (backend) {
    if (!Bun.which(backend)) {
      console.error(`farrier advise: requested backend '${backend}' was not found on PATH.`);
      return 1;
    }
  } else {
    backend = detectAgentBackend();
  }

  if (!backend) {
    console.error("farrier advise: no agent backend found. Install claude or codex, or pass --backend.");
    return 1;
  }

  const detectedPackIds = await detectPacks(targetDir).catch(() => [] as string[]);
  const packId = detectedPackIds[0] ?? "generic";

  const models = await loadFarrierConfig({ projectDir: targetDir })
    .then((loaded) => loaded.config.models)
    .catch(() => ({}));
  const adviseSettings = resolveModelSettings({ models, backend, role: "advise", explicitModel: options.model });

  try {
    const result = await adviseSkills({
      targetDir,
      packId,
      contextText: resolvedContext.text,
      backend,
      model: adviseSettings.model,
      reasoningEffort: adviseSettings.reasoningEffort
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            backend: result.backend,
            contextSource: resolvedContext.source,
            queries: result.queries,
            recommendations: result.recommendations,
            notes: result.notes
          },
          null,
          2
        )
      );
      return 0;
    }

    console.log(`Backend: ${result.backend}`);
    console.log(`Context: ${resolvedContext.source}`);
    console.log(`Queries: ${result.queries.join(", ") || "none"}`);
    console.log("");

    if (result.recommendations.length === 0) {
      console.log("No skill recommendations.");
    } else {
      console.log("Recommendations:");
      for (const recommendation of result.recommendations) {
        console.log(`  ${recommendation.ref} — ${recommendation.reason} (${recommendation.installs} installs)`);
      }
      console.log("");
      console.log(
        "Install with `npx skills add <source> -s <skillId>`, or re-run the farrier wizard to select and install interactively."
      );
    }

    if (result.notes.length > 0) {
      console.log("");
      console.log("Notes:");
      for (const note of result.notes) {
        console.log(`  - ${note}`);
      }
    }

    return 0;
  } catch (error) {
    console.error(`farrier advise: ${errorMessage(error)}`);
    return 1;
  }
}
