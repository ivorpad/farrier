import { loadFarrierConfig, type ModelsConfig } from "../config/farrier-config";
import { detectAgentBackend, resolveContext, type AdviseBackend, type ResolvedContext } from "../engine/advise";
import { detectPacksWithEvidence, type DetectedPackEvidence } from "../engine/detect";
import { planSkillRegistryQueries } from "../engine/advice-registry";
import type { ProjectProfile } from "../engine/advice-types";
import { profileProject, projectProfileSummary } from "../engine/project-profile";
import { builtinCatalog, loadPackCatalog, type PackCatalog } from "../registry/catalog";

export type WizardBootstrap = {
  catalog: PackCatalog;
  registryWarnings: string[];
  models: ModelsConfig;
  detectedPacks: DetectedPackEvidence[];
  /** Languages the deterministic profile saw; the Stack step names them when no pack matched. */
  profileLanguages: string[];
  skillQueries: string[];
  context?: ResolvedContext;
  adviseBackend?: AdviseBackend;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function contextForProfile(profile: ProjectProfile, supplied?: ResolvedContext): ResolvedContext {
  const profileText = projectProfileSummary(profile);
  if (supplied) {
    return {
      source: supplied.source,
      text: `${supplied.text}\n\nDetected project profile:\n${profileText}`,
    };
  }
  return { source: "deterministic-project-profile", text: profileText };
}

export async function resolveWizardContext(targetDir: string, context?: string): Promise<ResolvedContext> {
  const [supplied, profile] = await Promise.all([
    resolveContext({ targetDir, context }),
    profileProject(targetDir),
  ]);
  return contextForProfile(profile, supplied);
}

export async function loadWizardBootstrap(targetDir: string, context?: string): Promise<WizardBootstrap> {
  let catalog: PackCatalog = builtinCatalog();
  let registryWarnings: string[] = [];
  let models: ModelsConfig = {};

  try {
    const config = await loadFarrierConfig({ projectDir: targetDir });
    models = config.config.models;
    // No stderr progress line here: this runs under the wizard's live renderer
    // (WizardBoot's loading frame), where a raw write would corrupt the screen.
    catalog = await loadPackCatalog({ config: config.config });
    registryWarnings = catalog.warnings.map((warning) => `${warning.namespace}: ${warning.message}`);
  } catch (error) {
    registryWarnings = [`Registry loading failed; showing built-in packs only: ${errorMessage(error)}`];
  }

  const [detectedPacks, profile, suppliedContext] = await Promise.all([
    detectPacksWithEvidence(targetDir, catalog).catch(() => []),
    profileProject(targetDir).catch(() => undefined),
    resolveContext({ targetDir, context }).catch(() => undefined),
  ]);
  const resolvedContext = profile ? contextForProfile(profile, suppliedContext) : suppliedContext;
  const skillQueries = profile
    ? planSkillRegistryQueries(profile).slice(0, 4).map((item) => item.query)
    : [];

  let adviseBackend: AdviseBackend | undefined;
  try { adviseBackend = detectAgentBackend(); } catch { /* advice stays unavailable */ }

  return {
    catalog,
    registryWarnings,
    models,
    detectedPacks,
    profileLanguages: profile?.languages ?? [],
    skillQueries,
    context: resolvedContext,
    adviseBackend
  };
}
