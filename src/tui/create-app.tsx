import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { loadFarrierConfig, resolveModelSettings, type ModelsConfig } from "../config/farrier-config";
import { probeAgents, type AgentAvailability } from "../engine/backend";
import {
  createSkills,
  type CreateAgent,
  type SkillCreationOutcome,
  type SkillCreationRequest
} from "../engine/create-skill";
import { detectPacks } from "../engine/detect";
import { createQueuedCollisionHandler, type CollisionPrompt } from "./collision";
import { eligiblePerAgentEvals, nextEvalPolicy, SkillEvalFlow, type PendingSkillEval, type SkillEvalPolicy } from "./create-eval";
import { CreateDoneScreen, CreateProgressScreen, type RequestStatus } from "./create-progress";
import { CreateStep } from "./CreateStep";
import { RefineFlow } from "./RefineScreen";
import { idleExitBindings, resolveIntent } from "./keymap";

type Phase = "form" | "questions" | "writing" | "done" | "eval";

type CreateAppProps = {
  targetDir: string;
  models: ModelsConfig;
  initialRequests?: SkillCreationRequest[];
  onExit: (code: number, message?: string) => void;
};

function CreateApp(props: CreateAppProps) {
  const [availability, setAvailability] = useState<AgentAvailability | undefined>(undefined);
  const [requests, setRequests] = useState<SkillCreationRequest[]>(props.initialRequests ?? []);
  const [outcomes, setOutcomes] = useState<SkillCreationOutcome[]>([]);
  const [statuses, setStatuses] = useState<RequestStatus[]>([]);
  const [phase, setPhase] = useState<Phase>("form");
  const [cancelling, setCancelling] = useState(false);
  const [refine, setRefine] = useState(true);
  const [packId, setPackId] = useState<string | undefined>(undefined);
  // Requests grill sequentially — each question adapts to the prior answers, so
  // one request's interview must finish before the next begins.
  const [grillIndex, setGrillIndex] = useState(0);
  const [collision, setCollision] = useState<CollisionPrompt | null>(null);
  const [pendingEval, setPendingEval] = useState<PendingSkillEval | null>(null);
  const [evalPolicy, setEvalPolicy] = useState<SkillEvalPolicy>("ask");
  const abortRef = useRef<AbortController | null>(null);
  // Concurrent runs can collide at once; prompts are shown one at a time.
  const collisionChainRef = useRef<Promise<void>>(Promise.resolve());

  const refineBackend: CreateAgent | undefined = availability?.claude ? "claude" : availability?.codex ? "codex" : undefined;
  const evalBackend = refineBackend;

  // exitOnCtrlC is off (it would orphan the spawned agent runs), so ctrl+c is
  // handled here for the phases that don't handle it themselves.
  useKeyboard((key) => {
    if (resolveIntent(idleExitBindings, key) !== "quit") {
      return;
    }

    if (phase === "form" || phase === "questions") {
      props.onExit(1, "farrier skill new: cancelled — nothing created.");
    } else if (phase === "done") {
      props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0);
    }
    // "eval" is handled inside SkillEvalFlow (its progress screen cancels on ctrl+c).
  });

  useEffect(() => {
    let cancelled = false;

    probeAgents()
      .then((probed) => {
        if (!cancelled) {
          setAvailability(probed);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailability({ claude: false, codex: false });
        }
      });

    detectPacks(props.targetDir)
      .then((packs) => {
        if (!cancelled) {
          setPackId(packs[0]);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [props.targetDir]);

  useEffect(() => {
    if (phase !== "writing") {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    setStatuses(requests.map(() => ({ kind: "pending" })));

    const onCollision = createQueuedCollisionHandler({ signal: controller.signal, chainRef: collisionChainRef, setCollision });

    // Concurrent authoring (each run has its own staging root); lock-touching
    // installs are serialized inside createSkills.
    const modelSettings = {
      claude: resolveModelSettings({ models: props.models, backend: "claude", role: "skillCreation" }),
      codex: resolveModelSettings({ models: props.models, backend: "codex", role: "skillCreation" })
    };

    createSkills(requests, props.targetDir, { signal: controller.signal, onCollision, modelSettings }, (event) => {
      if (cancelled) {
        return;
      }

      setStatuses((current) =>
        current.map((status, index) => {
          if (index !== event.index) {
            return status;
          }

          if (event.phase === "done") {
            return { kind: "done", outcome: event.outcome };
          }

          // Per-agent runs stream concurrently into one row; keep the latest
          // activity line from each agent.
          const activities = status.kind === "running" ? { ...status.activities } : {};

          if (event.agent && event.activity) {
            activities[event.agent] = event.activity;
          }

          return { kind: "running", phase: event.phase, agent: event.agent, activities };
        })
      );
    }).then((results) => {
      if (cancelled) {
        return;
      }

      setOutcomes(results);

      // Per-agent pairs go straight to the eval unless the user chose skip on
      // the form. evalPolicy is frozen once the form is submitted, so reading
      // it from the closure here is safe.
      const candidate = evalPolicy === "skip" ? undefined : eligiblePerAgentEvals(results)[0];

      if (candidate) {
        setPendingEval(candidate);
        setPhase("eval");
      } else {
        setPhase("done");
      }
    });

    return () => {
      cancelled = true;
      // Unmounting mid-run (process exit) must not leave agent runs behind.
      controller.abort();
    };
  }, [phase, props.targetDir, requests]);

  switch (phase) {
    case "form":
      return (
        <CreateStep
          requests={requests}
          availability={availability}
          standalone
          onAddRequest={(request) => setRequests((current) => [...current, request])}
          onRemoveRequest={(index) => setRequests((current) => current.filter((_, i) => i !== index))}
          refine={refine}
          refineBackend={refineBackend}
          onToggleRefine={() => setRefine((current) => !current)}
          evalPolicy={evalPolicy}
          onCycleEvalPolicy={() => setEvalPolicy(nextEvalPolicy)}
          onSubmit={(pending) => {
            const all = pending ? [...requests, pending] : requests;

            if (all.length === 0) {
              props.onExit(0, "farrier skill new: nothing to create — exited.");
              return;
            }

            setRequests(all);
            setGrillIndex(0);
            setPhase(refine && refineBackend ? "questions" : "writing");
          }}
          onBack={() =>
            props.onExit(
              1,
              requests.length === 0
                ? "farrier skill new: cancelled — nothing created."
                : `farrier skill new: cancelled — ${requests.length} queued skill(s) discarded, nothing created.`
            )
          }
          onQuit={() => props.onExit(1, "farrier skill new: cancelled — nothing created.")}
        />
      );

    case "questions": {
      const request = requests[grillIndex];

      if (!request || !refineBackend) {
        return null;
      }

      const refineSettings = resolveModelSettings({ models: props.models, backend: refineBackend, role: "refine" });

      return (
        <RefineFlow
          key={grillIndex}
          request={request}
          backend={refineBackend}
          targetDir={props.targetDir}
          packId={packId}
          model={refineSettings.model}
          reasoningEffort={refineSettings.reasoningEffort}
          progressLabel={requests.length > 1 ? `skill ${grillIndex + 1} of ${requests.length}` : undefined}
          onDone={(refined) => {
            setRequests((current) => current.map((item, index) => (index === grillIndex ? refined : item)));

            if (grillIndex + 1 >= requests.length) {
              setGrillIndex(0);
              setPhase("writing");
            } else {
              setGrillIndex(grillIndex + 1);
            }
          }}
          onQuit={() => props.onExit(1, "farrier skill new: cancelled — nothing created.")}
        />
      );
    }

    case "writing":
      return (
        <CreateProgressScreen
          requests={requests}
          statuses={statuses}
          cancelling={cancelling}
          collision={collision}
          onCancel={() => {
            setCancelling(true);
            abortRef.current?.abort();
            // A pending replace-prompt would otherwise hold the run open.
            collision?.resolve("keep");
          }}
        />
      );

    case "done": {
      const evalCandidate = eligiblePerAgentEvals(outcomes)[0];
      return (
        <CreateDoneScreen
          outcomes={outcomes}
          evalCandidate={evalCandidate}
          onEvaluate={() => {
            if (evalCandidate) {
              setPendingEval(evalCandidate);
              setPhase("eval");
            }
          }}
          onExit={() => props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0)}
        />
      );
    }

    case "eval":
      return pendingEval ? (
        <SkillEvalFlow
          targetDir={props.targetDir}
          candidate={pendingEval}
          backend={evalBackend}
          autoApply={evalPolicy === "auto"}
          onClose={() => setPhase("done")}
          onExit={() => props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0)}
        />
      ) : (
        <CreateDoneScreen
          outcomes={outcomes}
          onEvaluate={() => undefined}
          onExit={() => props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0)}
        />
      );
  }
}

export async function runCreateWizard(targetDir: string, initialRequests: SkillCreationRequest[] = []): Promise<number> {
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;

  const models = await loadFarrierConfig({ projectDir: targetDir })
    .then((loaded) => loaded.config.models)
    .catch(() => ({}) as ModelsConfig);

  try {
    // The default ctrl+c handler destroys the renderer without resolving
    // anything, orphaning spawned claude/codex runs; CreateApp handles ctrl+c
    // itself and aborts them.
    renderer = await createCliRenderer({ exitOnCtrlC: false });
    const cliRenderer = renderer;

    return await new Promise<number>((resolve) => {
      let settled = false;

      const finish = (code: number, message?: string) => {
        if (settled) {
          return;
        }

        settled = true;
        cliRenderer.destroy();

        if (message) {
          console.error(message);
        }

        resolve(code);
      };

      createRoot(cliRenderer).render(<CreateApp targetDir={targetDir} models={models} initialRequests={initialRequests} onExit={finish} />);
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier skill new: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
