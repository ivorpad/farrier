import { join } from "node:path";
import { builtinCatalog, type PackCatalog } from "../registry/catalog";
import { readIfFile } from "./improve-authoring";
import type { TasteGuardRule } from "./kb-taste-authoring";
import { applyProposalPlan, planPrimitiveProposal } from "./proposal-apply";

/**
 * Install (or reconfigure) the taste-guard hook: add it to the manifest hookIds,
 * set guards.tasteGuard.rules to the reviewed patterns, and re-render the hook
 * files and bindings — all through the shared guard-instance primitive path, so
 * the manifest, the hooks tree, and both agent bindings stay coherent and the
 * write is atomic. This is the review step the compiler defers: patterns only
 * ever reach the enforcing hook after the user confirms them here.
 *
 * Rules are keyed by ruleId: re-authoring an existing rule REPLACES it. The
 * shared guards merge unions arrays by full-JSON equality, which would leave a
 * rule's old patterns beside its new ones, so the merge-by-ruleId result is
 * written over the rendered manifest's guards.tasteGuard.rules before applying.
 *
 * Requires a farrier manifest (planPrimitiveProposal reads it); a repo with no
 * .farrier.json cannot host a hook, so the declarative AGENTS.md words layer is
 * the only enforcement there.
 */
export async function installTasteGuard(input: {
  targetDir: string;
  /** Reviewed patterns to merge in by ruleId; omit (or []) to just install the hook over existing patterns. */
  patterns?: TasteGuardRule[];
  catalog?: PackCatalog;
  force?: boolean;
}): Promise<{ written: string[]; unchanged: string[] }> {
  const catalog = input.catalog ?? builtinCatalog();
  const current = await currentTasteGuardRules(input.targetDir);
  const rules = mergeRulesByRuleId(current, input.patterns ?? []);

  const planned = await planPrimitiveProposal({
    targetDir: input.targetDir,
    proposal: {
      kind: "guard-instance",
      id: "kb-taste-guard",
      title: "Install the taste-guard hook",
      hookId: "taste-guard",
      guardsPatch: { tasteGuard: { rules } },
      message: "Enforces reviewed lintable preferences against the proposed content of Edit/Write.",
      evidence: []
    },
    catalog
  });
  if (planned.kind !== "files") {
    throw new Error("taste-guard install unexpectedly produced no files");
  }

  // Overwrite the rendered manifest's rule list with the merge-by-ruleId result
  // (the guards merge would otherwise keep replaced rules' old entries).
  const files = planned.plan.files.map((file) =>
    file.path === ".farrier.json" ? { ...file, content: withTasteGuardRules(file.content, rules) } : file
  );
  const result = await applyProposalPlan(input.targetDir, { ...planned.plan, files }, input.force ?? true);
  return { written: result.written, unchanged: result.unchanged };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTasteGuardRule(value: unknown): TasteGuardRule | undefined {
  if (!isRecord(value) || typeof value.ruleId !== "string") return undefined;
  if (!Array.isArray(value.patterns) || !value.patterns.every((pattern) => typeof pattern === "string")) return undefined;
  if (typeof value.message !== "string") return undefined;
  return { ruleId: value.ruleId, patterns: value.patterns as string[], message: value.message };
}

/** The well-formed taste-guard rules already recorded in the manifest (empty when absent/malformed). */
async function currentTasteGuardRules(targetDir: string): Promise<TasteGuardRule[]> {
  const raw = await readIfFile(join(targetDir, ".farrier.json"));
  if (raw === undefined) return [];
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return [];
  }
  const guards = isRecord(manifest) ? manifest.guards : undefined;
  const tasteGuard = isRecord(guards) ? guards.tasteGuard : undefined;
  const rules = isRecord(tasteGuard) ? tasteGuard.rules : undefined;
  if (!Array.isArray(rules)) return [];
  return rules.map(asTasteGuardRule).filter((rule): rule is TasteGuardRule => rule !== undefined);
}

/** Merge by ruleId: incoming replaces a collision in place; new rules append. */
export function mergeRulesByRuleId(current: readonly TasteGuardRule[], incoming: readonly TasteGuardRule[]): TasteGuardRule[] {
  const byId = new Map<string, TasteGuardRule>();
  for (const rule of current) byId.set(rule.ruleId, rule);
  for (const rule of incoming) byId.set(rule.ruleId, rule);
  return Array.from(byId.values());
}

/** Set guards.tasteGuard.rules on a rendered manifest, preserving everything else. */
function withTasteGuardRules(manifestContent: string, rules: TasteGuardRule[]): string {
  const parsed = JSON.parse(manifestContent) as Record<string, unknown>;
  const guards = isRecord(parsed.guards) ? parsed.guards : {};
  const tasteGuard = isRecord(guards.tasteGuard) ? guards.tasteGuard : {};
  parsed.guards = { ...guards, tasteGuard: { ...tasteGuard, rules } };
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
