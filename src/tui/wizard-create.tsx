import { useState } from "react";
import type { AgentAvailability } from "../engine/backend";
import { normalizeSkillCreationRequest, type CreateAgent, type SkillCreationRequest } from "../engine/create-skill";
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
  onQuit: () => void;
};

/**
 * The wizard's Create step with queue-time refinement: each queued skill gets
 * its clarifying questions immediately (while the details are fresh), so the
 * harness write later runs unattended on already-pinned briefs.
 */
export function WizardCreate(props: WizardCreateProps) {
  const [refine, setRefine] = useState(true);
  const [flow, setFlow] = useState<{ request: SkillCreationRequest; thenNext: boolean } | null>(null);

  const soleAvailableAuthor: CreateAgent | undefined = props.availability?.claude !== props.availability?.codex
    ? props.availability?.claude ? "claude" : "codex"
    : undefined;

  if (flow) {
    const refineAuthor = normalizeSkillCreationRequest(flow.request).authors[0]!;
    return (
      <RefineFlow
        request={flow.request}
        backend={refineAuthor}
        targetDir={props.targetDir}
        packId={props.packId}
        onDone={(refined) => {
          props.onAdd(refined);
          setFlow(null);

          if (flow.thenNext) {
            props.onNext();
          }
        }}
        onQuit={props.onQuit}
      />
    );
  }

  const shouldRefine = refine;

  return (
    <CreateStep
      requests={props.requests}
      availability={props.availability}
      refine={refine}
      refineBackend={soleAvailableAuthor}
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
      onQuit={props.onQuit}
    />
  );
}
