import { createHash } from "node:crypto";
import { posix } from "node:path";
import { redactText } from "./behavior-evidence";
import { readContainedFile, type ContainedRepository } from "./repository-paths";
import type { HarnessAuditCheck } from "./harness-audit-types";

type PackageDocument = { path: string; text: string };

function checkId(base: string, path: string): string {
  if (path === "package.json") return base;
  const digest = createHash("sha256").update(path, "utf8").digest("hex").slice(0, 16);
  return `${base}:${digest}`;
}

export async function scopedPackageManifestPaths(
  repository: ContainedRepository,
  guidancePaths: string[],
): Promise<string[]> {
  const result = new Set<string>();
  for (const guidancePath of guidancePaths) {
    let directory = posix.dirname(guidancePath);
    while (directory !== ".") {
      const path = `${directory}/package.json`;
      const read = await readContainedFile(repository, path, 192_000);
      if (read.status === "read" || read.status === "oversized") {
        result.add(path);
        break;
      }
      directory = posix.dirname(directory);
    }
  }
  return [...result];
}

export function packageEvidenceChecks(documents: PackageDocument[]): HarnessAuditCheck[] {
  return documents.filter((item) => /(?:^|\/)package\.json$/.test(item.path)).flatMap((document) => {
    const suffix = document.path === "package.json" ? "" : ` for ${document.path}`;
    try {
      const parsed = JSON.parse(document.text) as { packageManager?: unknown; scripts?: unknown };
      const manager = typeof parsed.packageManager === "string" ? parsed.packageManager : "not declared";
      const scriptRecord = parsed.scripts && typeof parsed.scripts === "object" && !Array.isArray(parsed.scripts)
        ? parsed.scripts as Record<string, unknown>
        : {};
      const scripts = Object.keys(scriptRecord).sort();
      const definitions = Object.entries(scriptRecord)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .filter(([name]) => /(?:build|check|ci|coverage|format|lint|secret|test|type|valid|verif)/i.test(name))
        .slice(0, 40)
        .map(([name, value]) => `${name}=${redactText(value).slice(0, 400)}`)
        .join("; ")
        .slice(0, 8_000);
      return [
        {
          id: checkId("check:package-manager", document.path),
          layers: ["verification", "toolchain"] as const,
          description: `Read package.json packageManager${suffix}.`,
          result: manager,
        },
        {
          id: checkId("check:package-scripts", document.path),
          layers: ["guidance", "verification", "toolchain"] as const,
          description: `Listed package.json scripts${suffix}.`,
          result: scripts.length ? scripts.join(", ") : "no scripts declared",
        },
        {
          id: checkId("check:package-script-definitions", document.path),
          layers: ["guidance", "verification", "toolchain"] as const,
          description: `Inspected verification-related package.json script definitions${suffix}.`,
          result: definitions || "no verification-related scripts declared",
        },
      ];
    } catch {
      return [{
        id: checkId("check:package-json-parse", document.path),
        layers: ["verification", "toolchain"] as const,
        description: `Parsed package.json${suffix} before comparing documented commands.`,
        result: "package.json is malformed",
      }];
    }
  });
}

export function packagePathForCheck(check: HarnessAuditCheck): string | undefined {
  if (check.id !== "check:package-scripts" && !check.id.startsWith("check:package-scripts:")) return undefined;
  return check.description.match(/ for (.+\/package\.json)\.$/)?.[1] ?? "package.json";
}
