import { useState } from "react";
import type { AgentAvailability } from "../engine/backend";
import type { CreateAgent, SkillCreationRequest } from "../engine/create-skill";
import { CreateStep } from "./CreateStep";
import type { SkillEvalPolicy } from "./create-eval";
import { RefineFlow } from "./RefineScreen";

type WizardCreateProps = {
  requests: SkillCreationRequest[];
  availability?: AgentAvailability;
  targetDir: string;
  packId?: string;
  evalPolicy?: SkillEvalPolicy;
  onCycleEvalPolicy?: () => void;
  onAdd: (request: SkillCreationRequest) => void;
  onRemove: (index: number) => void;
  onNext: () => void;
  onBack: () => void;
};

/**
 * The wizard's Create step with queue-time refinement: each queued skill gets
 * its clarifying questions immediately (while the details are fresh), so the
 * harness write later runs unattended on already-pinned briefs.
 */
export function WizardCreate(props: WizardCreateProps) {
  const [refine, setRefine] = useState(true);
  const [flow, setFlow] = useState<{ request: SkillCreationRequest; thenNext: boolean } | null>(null);

  const refineBackend: CreateAgent | undefined = props.availability?.claude
    ? "claude"
    : props.availability?.codex
      ? "codex"
      : undefined;

  if (flow && refineBackend) {
    return (
      <RefineFlow
        request={flow.request}
        backend={refineBackend}
        targetDir={props.targetDir}
        packId={props.packId}
        onDone={(refined) => {
          props.onAdd(refined);
          setFlow(null);

          if (flow.thenNext) {
            props.onNext();
          }
        }}
      />
    );
  }

  const shouldRefine = refine && refineBackend !== undefined;

  return (
    <CreateStep
      requests={props.requests}
      availability={props.availability}
      refine={refine}
      refineBackend={refineBackend}
      onToggleRefine={() => setRefine((current) => !current)}
      evalPolicy={props.evalPolicy}
      onCycleEvalPolicy={props.onCycleEvalPolicy}
      onAddRequest={(request) => (shouldRefine ? setFlow({ request, thenNext: false }) : props.onAdd(request))}
      onRemoveRequest={props.onRemove}
      onSubmit={(pending) => {
        if (pending && shouldRefine) {
          setFlow({ request: pending, thenNext: true });
          return;
        }

        if (pending) {
          props.onAdd(pending);
        }

        props.onNext();
      }}
      onBack={props.onBack}
    />
  );
}
