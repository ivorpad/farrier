import { useState } from "react";
import type { ApplyHarnessChangePlanResult } from "../engine/create-plan";
import type { CreateAgent, SkillCreationOutcome } from "../engine/create-skill";
import type { InstallSkillResult } from "../engine/skills";
import type { EnforcementAgent } from "../engine/agent-selection";
import { eligiblePerAgentEvals, SkillEvalFlow, type PendingSkillEval, type SkillEvalPolicy } from "./create-eval";
import type { WizardWriteStatus } from "./machine";
import { DoneStep } from "./ReviewStep";

type WizardDoneProps = {
  targetDir: string;
  writeStatus?: WizardWriteStatus;
  applyResult?: ApplyHarnessChangePlanResult;
  installResults: InstallSkillResult[];
  createOutcomes: SkillCreationOutcome[];
  agents: EnforcementAgent[];
  hookCount: number;
  skillCount: number;
  ruleCount: number;
  evalPolicy: SkillEvalPolicy;
  evalBackend?: CreateAgent;
  onExit: (code: number) => void;
};

export function wizardWriteExitCode(writeStatus: WizardWriteStatus | undefined): number {
  return writeStatus?.ok === false ? 1 : 0;
}

/**
 * The wizard's Done screen plus the per-agent eval flow: when the harness run
 * produced a comparable pair and the user's policy isn't "skip", the eval
 * starts immediately; otherwise (or after "keep both") the summary screen
 * offers it as a visible action. All eval screens own their own keys, including ctrl+c.
 */
export function WizardDone(props: WizardDoneProps) {
  const candidate = props.writeStatus?.ok === false ? undefined : eligiblePerAgentEvals(props.createOutcomes)[0];
  const [pendingEval, setPendingEval] = useState<PendingSkillEval | null>(props.evalPolicy !== "skip" ? (candidate ?? null) : null);

  if (pendingEval) {
    return (
      <SkillEvalFlow
        targetDir={props.targetDir}
        candidate={pendingEval}
        backend={props.evalBackend}
        autoApply={props.evalPolicy === "auto"}
        onClose={() => setPendingEval(null)}
        onExit={() => props.onExit(wizardWriteExitCode(props.writeStatus))}
      />
    );
  }

  return (
    <DoneStep
      writeStatus={props.writeStatus}
      applyResult={props.applyResult}
      installResults={props.installResults}
      createOutcomes={props.createOutcomes}
      agents={props.agents}
      hookCount={props.hookCount}
      skillCount={props.skillCount}
      ruleCount={props.ruleCount}
      evalCandidate={candidate}
      onEvaluate={() => {
        if (candidate) {
          setPendingEval(candidate);
        }
      }}
      onExit={() => props.onExit(wizardWriteExitCode(props.writeStatus))}
    />
  );
}
