import { resolveModelSettings, type ModelsConfig } from "../config/farrier-config";
import { planAdviceBatch, type AdviceBatchState } from "../engine/advice-batch";
import {
  adviceCreationSupport,
  inspectAdviceCreationPlan,
  planAdviceRecommendation,
  planAdviceSkillRecommendation
} from "../engine/advice-apply";
import type {
  AdviceCategory,
  AdviceRecommendation,
  AdviceReport,
  AdviceSessionLookback
} from "../engine/advice-types";
import { probeAgent, type AgentBackend } from "../engine/backend";
import { ensureCreatorInstalled, type SkillCreationRequest } from "../engine/create-skill";
import { adviseProject, type AdviceProgressEvent, type ProjectAdviceInput } from "../engine/project-advice";
import type { SessionConsent } from "../engine/advice-sessions";
import type { AdviceTuiScope } from "./advise-machine";

function backendName(backend: AgentBackend): "Claude" | "Codex" {
  return backend === "claude" ? "Claude" : "Codex";
}

export function adviceSkillCreationRequest(backend: AgentBackend, recommendation: AdviceRecommendation): SkillCreationRequest {
  return {
    description: `${recommendation.reason}\n\nExpected benefit: ${recommendation.benefit}\n\nImplementation route: ${recommendation.implementationRoute.description}`,
    agents: recommendation.targetVendors,
    mode: backend === "claude" ? "author-claude" : "author-codex",
    nameOverride: recommendation.id.slice(recommendation.id.indexOf(":") + 1)
  };
}

type AdviceWizardActionDependencies = {
  isBackendAvailable: (backend: AgentBackend) => Promise<boolean>;
  advise: (input: ProjectAdviceInput) => Promise<AdviceReport>;
  plan: typeof planAdviceRecommendation;
  planSkill: typeof planAdviceSkillRecommendation;
  inspect: typeof inspectAdviceCreationPlan;
  prepareSkillCreator: typeof ensureCreatorInstalled;
};

export function createAdviceWizardActions(
  input: {
    targetDir: string;
    signal: AbortSignal;
    models?: ModelsConfig;
    loadModels?: () => Promise<ModelsConfig>;
    /** Session-level per-backend model picks from the startup screen; an
     * explicit pick beats every configured role entry for this session. */
    modelOverrides?: { claude?: string; codex?: string };
  },
  dependencies: Partial<AdviceWizardActionDependencies> = {}
) {
  const isBackendAvailable = dependencies.isBackendAvailable ?? ((backend: AgentBackend) => probeAgent(backend));
  const runAdvice = dependencies.advise ?? adviseProject;
  const planRecommendation = dependencies.plan ?? planAdviceRecommendation;
  const planSkillRecommendation = dependencies.planSkill ?? planAdviceSkillRecommendation;
  const inspectPlan = dependencies.inspect ?? inspectAdviceCreationPlan;
  const prepareSkillCreator = dependencies.prepareSkillCreator ?? ensureCreatorInstalled;
  const loadModels = input.loadModels ?? (async () => input.models ?? {});
  const requireBackend = async (backend: AgentBackend): Promise<void> => {
    if (await isBackendAvailable(backend)) return;
    throw new Error(`Selected ${backendName(backend)} reasoning backend is unavailable. Return to options and choose another available backend.`);
  };

  return {
    onRun: async (
      backend: AgentBackend,
      sessionConsent: SessionConsent | undefined,
      lookback: AdviceSessionLookback,
      scope: AdviceTuiScope,
      onProgress: (event: AdviceProgressEvent) => void
    ): Promise<AdviceReport> => {
      await requireBackend(backend);
      const settings = resolveModelSettings({
        models: await loadModels(),
        backend,
        role: "advise",
        explicitModel: input.modelOverrides?.[backend]
      });
      const report = await runAdvice({
        targetDir: input.targetDir,
        backend,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        sessions: sessionConsent ? "auto" : "none",
        sessionConsent,
        lookback,
        targets: [backend],
        only: scope === "all" ? undefined : [scope as AdviceCategory],
        signal: input.signal,
        onProgress
      });
      if (report.backend !== backend) {
        throw new Error(`Selected ${backendName(backend)} reasoning backend returned a report attributed to ${backendName(report.backend)}.`);
      }
      return report;
    },
    onPlan: async (report: AdviceReport, recommendation: AdviceRecommendation) => {
      const support = adviceCreationSupport(recommendation);
      if (support.kind === "inspect") throw new Error(support.description);
      const backend = report.backend;
      await requireBackend(backend);
      const settings = resolveModelSettings({
        models: await loadModels(),
        backend,
        role: "advise",
        explicitModel: input.modelOverrides?.[backend]
      });
      const plan = await planRecommendation({
        report,
        recommendation,
        backend,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        signal: input.signal
      });
      return { plan, inspection: await inspectPlan(input.targetDir, plan) };
    },
    onPlanBatch: async (
      report: AdviceReport,
      previous: AdviceBatchState | undefined,
      signal: AbortSignal,
      onProgress: (state: AdviceBatchState) => void
    ): Promise<AdviceBatchState> => {
      const backend = report.backend;
      await requireBackend(backend);
      const models = await loadModels();
      const explicitModel = input.modelOverrides?.[backend];
      const fileSettings = resolveModelSettings({ models, backend, role: "advise", explicitModel });
      const skillSettings = resolveModelSettings({ models, backend, role: "skillCreation", explicitModel });
      let creatorPreparation: Promise<void> | undefined;
      const prepareCreatorOnce = () => {
        creatorPreparation ??= prepareSkillCreator(backend, input.targetDir).then((result) => {
          if (result && !result.ok) {
            throw new Error(`Could not install the ${backend} creator skill (${result.ref}): ${result.error ?? result.stderr}`);
          }
        });
        return creatorPreparation;
      };
      return planAdviceBatch({
        report,
        previous,
        signal,
        onProgress,
        dependencies: {
          planFiles: (recommendation, taskSignal) => planRecommendation({
            report,
            recommendation,
            backend,
            model: fileSettings.model,
            reasoningEffort: fileSettings.reasoningEffort,
            signal: taskSignal
          }),
          planSkill: async (recommendation, taskSignal) => {
            await prepareCreatorOnce();
            if (taskSignal.aborted) throw new Error("cancelled");
            return planSkillRecommendation({
              report,
              recommendation,
              request: adviceSkillCreationRequest(report.backend, recommendation),
              modelSettings: skillSettings,
              signal: taskSignal,
              creatorReady: true
            });
          },
          inspect: (plan) => inspectPlan(input.targetDir, plan)
        }
      });
    }
  };
}
