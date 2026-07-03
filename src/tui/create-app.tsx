import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { probeAgents, type AgentAvailability } from "../engine/backend";
import {
  createSkills,
  type CreateAgent,
  type SkillCreationOutcome,
  type SkillCreationRequest
} from "../engine/create-skill";
import { detectPacks } from "../engine/detect";
import { evaluatePerAgentSkill, resolvePerAgentSkillWinner, type SkillEvalVerdict, type SkillWinnerResolution } from "../engine/eval-skill";
import { applyRefinements, generateRefineQuestions } from "../engine/refine-skill";
import { createQueuedCollisionHandler, type CollisionPrompt } from "./collision";
import {
  eligiblePerAgentEvals,
  EvalAppliedScreen,
  EvalConfirmScreen,
  EvalErrorScreen,
  EvalProgressScreen,
  EvalVerdictScreen,
  type PendingSkillEval
} from "./create-eval";
import { CreateDoneScreen, CreateProgressScreen, type RequestStatus } from "./create-progress";
import { CreateStep } from "./CreateStep";
import { RefineScreen, RefineWaitScreen, type PendingAnswer, type PendingQuestion } from "./RefineScreen";

type Phase = "form" | "refining" | "questions" | "writing" | "done" | "evaluating" | "evalVerdict" | "evalConfirm" | "evalApplied" | "evalError";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type CreateAppProps = {
  targetDir: string;
  onExit: (code: number, message?: string) => void;
};

function CreateApp(props: CreateAppProps) {
  const [availability, setAvailability] = useState<AgentAvailability | undefined>(undefined);
  const [requests, setRequests] = useState<SkillCreationRequest[]>([]);
  const [outcomes, setOutcomes] = useState<SkillCreationOutcome[]>([]);
  const [statuses, setStatuses] = useState<RequestStatus[]>([]);
  const [phase, setPhase] = useState<Phase>("form");
  const [cancelling, setCancelling] = useState(false);
  const [refine, setRefine] = useState(true);
  const [packId, setPackId] = useState<string | undefined>(undefined);
  const [questionItems, setQuestionItems] = useState<PendingQuestion[]>([]);
  const [collision, setCollision] = useState<CollisionPrompt | null>(null);
  const [pendingEval, setPendingEval] = useState<PendingSkillEval | null>(null);
  const [evalVerdict, setEvalVerdict] = useState<SkillEvalVerdict | null>(null);
  const [evalWinner, setEvalWinner] = useState<CreateAgent | null>(null);
  const [evalResolution, setEvalResolution] = useState<SkillWinnerResolution | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const evalAbortRef = useRef<AbortController | null>(null);
  // Concurrent runs can collide at once; prompts are shown one at a time.
  const collisionChainRef = useRef<Promise<void>>(Promise.resolve());

  const refineBackend: CreateAgent | undefined = availability?.claude ? "claude" : availability?.codex ? "codex" : undefined;
  const evalBackend = refineBackend;

  // exitOnCtrlC is off (it would orphan the spawned agent runs), so ctrl+c is
  // handled here for the phases that don't handle it themselves.
  useKeyboard((key) => {
    if (!(key.ctrl && key.name === "c")) {
      return;
    }

    if (phase === "form" || phase === "refining" || phase === "questions") {
      props.onExit(1, "farrier skill new: cancelled — nothing created.");
    } else if (phase === "evaluating") {
      evalAbortRef.current?.abort();
      setPhase("done");
    } else if (phase === "done") {
      props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0);
    }
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

  // Refine phase: one read-only backend call per request proposes the
  // implementation decisions the description leaves open. Failures never
  // block authoring — they just skip the questions.
  useEffect(() => {
    if (phase !== "refining" || !refineBackend) {
      return;
    }

    let cancelled = false;

    Promise.all(
      requests.map(async (request, requestIndex) => {
        try {
          const questions = await generateRefineQuestions({
            description: request.description,
            backend: refineBackend,
            targetDir: props.targetDir,
            packId
          });
          return questions.map((question): PendingQuestion => ({ requestIndex, description: request.description, question }));
        } catch {
          return [] as PendingQuestion[];
        }
      })
    ).then((perRequest) => {
      if (cancelled) {
        return;
      }

      const items = perRequest.flat();

      if (items.length === 0) {
        setPhase("writing");
      } else {
        setQuestionItems(items);
        setPhase("questions");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [packId, phase, props.targetDir, refineBackend, requests]);

  function applyAnswers(answers: PendingAnswer[]): void {
    setRequests((current) =>
      current.map((request, index) =>
        ({
          ...request,
          description: applyRefinements(
            request.description,
            answers.filter((answer) => answer.requestIndex === index)
          )
        })
      )
    );
    setPhase("writing");
  }

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
    createSkills(requests, props.targetDir, { signal: controller.signal, onCollision }, (event) => {
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
      if (!cancelled) {
        setOutcomes(results);
        setPhase("done");
      }
    });

    return () => {
      cancelled = true;
      // Unmounting mid-run (process exit) must not leave agent runs behind.
      controller.abort();
    };
  }, [phase, props.targetDir, requests]);

  useEffect(() => {
    if (phase !== "evaluating" || !pendingEval) {
      return;
    }

    if (!evalBackend) {
      setEvalError("No backend CLI is available to run the read-only eval.");
      setPhase("evalError");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    evalAbortRef.current = controller;
    setEvalError(null);

    evaluatePerAgentSkill({
      targetDir: props.targetDir,
      skillName: pendingEval.skillName,
      description: pendingEval.description,
      backend: evalBackend,
      signal: controller.signal
    })
      .then((verdict) => {
        if (!cancelled) {
          setEvalVerdict(verdict);
          setPhase("evalVerdict");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setEvalError(errorMessage(error));
          setPhase("evalError");
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [evalBackend, pendingEval, phase, props.targetDir]);

  function startEval(candidate: PendingSkillEval): void {
    setPendingEval(candidate);
    setEvalVerdict(null);
    setEvalWinner(null);
    setEvalResolution(null);
    setEvalError(null);
    setPhase("evaluating");
  }

  async function applyEvalWinner(): Promise<void> {
    if (!pendingEval || !evalWinner) {
      return;
    }

    try {
      const resolution = await resolvePerAgentSkillWinner({
        targetDir: props.targetDir,
        skillName: pendingEval.skillName,
        winner: evalWinner,
        confirmDeleteAndLink: true
      });
      setEvalResolution(resolution);
      setPhase("evalApplied");
    } catch (error) {
      setEvalError(errorMessage(error));
      setPhase("evalError");
    }
  }

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
          onSubmit={(pending) => {
            const all = pending ? [...requests, pending] : requests;

            if (all.length === 0) {
              props.onExit(0, "farrier skill new: nothing to create — exited.");
              return;
            }

            setRequests(all);
            setPhase(refine && refineBackend ? "refining" : "writing");
          }}
          onBack={() =>
            props.onExit(
              1,
              requests.length === 0
                ? "farrier skill new: cancelled — nothing created."
                : `farrier skill new: cancelled — ${requests.length} queued skill(s) discarded, nothing created.`
            )
          }
        />
      );

    case "refining":
      return <RefineWaitScreen backend={refineBackend ?? "backend"} count={requests.length} />;

    case "questions":
      return <RefineScreen items={questionItems} backend={refineBackend ?? "backend"} onDone={applyAnswers} />;

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
              startEval(evalCandidate);
            }
          }}
          onExit={() => props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0)}
        />
      );
    }

    case "evaluating":
      return pendingEval ? (
        <EvalProgressScreen
          skillName={pendingEval.skillName}
          onCancel={() => {
            evalAbortRef.current?.abort();
            setPhase("done");
          }}
        />
      ) : (
        <EvalErrorScreen message="No per-agent skill is selected for eval." onBack={() => setPhase("done")} />
      );

    case "evalVerdict":
      return evalVerdict ? (
        <EvalVerdictScreen
          verdict={evalVerdict}
          onPick={(winner) => {
            setEvalWinner(winner);
            setPhase("evalConfirm");
          }}
          onKeepBoth={() => setPhase("done")}
        />
      ) : (
        <EvalErrorScreen message="Eval finished without a verdict." onBack={() => setPhase("done")} />
      );

    case "evalConfirm":
      return pendingEval && evalWinner ? (
        <EvalConfirmScreen
          skillName={pendingEval.skillName}
          winner={evalWinner}
          onConfirm={() => void applyEvalWinner()}
          onBack={() => setPhase("evalVerdict")}
        />
      ) : (
        <EvalErrorScreen message="No winner is selected." onBack={() => setPhase("done")} />
      );

    case "evalApplied":
      return evalResolution ? (
        <EvalAppliedScreen
          resolution={evalResolution}
          onExit={() => props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0)}
        />
      ) : (
        <EvalErrorScreen message="Winner resolution finished without a report." onBack={() => setPhase("done")} />
      );

    case "evalError":
      return <EvalErrorScreen message={evalError ?? "Unknown eval error."} onBack={() => setPhase("done")} />;
  }
}

export async function runCreateWizard(targetDir: string): Promise<number> {
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;

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

      createRoot(cliRenderer).render(<CreateApp targetDir={targetDir} onExit={finish} />);
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier skill new: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
