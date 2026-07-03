import { useState } from "react";
import type { CreateAgent, SkillCreationOutcome } from "../engine/create-skill";
import type { InstallSkillResult } from "../engine/skills";
import { eligiblePerAgentEvals, SkillEvalFlow, type PendingSkillEval, type SkillEvalPolicy } from "./create-eval";
import { DoneStep } from "./ReviewStep";

type WizardDoneProps = {
  targetDir: string;
  writeStatus?: { ok: boolean; message: string };
  installResults: InstallSkillResult[];
  createOutcomes: SkillCreationOutcome[];
  fileCount: number;
  hookCount: number;
  skillCount: number;
  ruleCount: number;
  evalPolicy: SkillEvalPolicy;
  evalBackend?: CreateAgent;
  onExit: (code: number) => void;
};

/**
 * The wizard's Done screen plus the per-agent eval flow: when the forge
 * produced a comparable pair and the user's policy isn't "skip", the eval
 * starts immediately; otherwise (or after "keep both") the summary screen
 * offers it via `e`. All eval screens own their own keys, including ctrl+c.
 */
export function WizardDone(props: WizardDoneProps) {
  const candidate = eligiblePerAgentEvals(props.createOutcomes)[0];
  const [pendingEval, setPendingEval] = useState<PendingSkillEval | null>(
    props.evalPolicy !== "skip" && props.writeStatus?.ok !== false ? candidate ?? null : null
  );

  if (pendingEval) {
    return (
      <SkillEvalFlow
        targetDir={props.targetDir}
        candidate={pendingEval}
        backend={props.evalBackend}
        autoApply={props.evalPolicy === "auto"}
        onClose={() => setPendingEval(null)}
        onExit={() => props.onExit(0)}
      />
    );
  }

  return (
    <DoneStep
      writeStatus={props.writeStatus}
      installResults={props.installResults}
      createOutcomes={props.createOutcomes}
      fileCount={props.fileCount}
      hookCount={props.hookCount}
      skillCount={props.skillCount}
      ruleCount={props.ruleCount}
      evalCandidate={candidate}
      onEvaluate={() => {
        if (candidate) {
          setPendingEval(candidate);
        }
      }}
      onExit={() => props.onExit(props.writeStatus?.ok === false ? 1 : 0)}
    />
  );
}
