import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { probeAgents, type AgentAvailability } from "../engine/backend";
import {
  createSkills,
  type CreateAgent,
  type SkillCreationOutcome,
  type SkillCreationPhase,
  type SkillCreationRequest
} from "../engine/create-skill";
import { detectPacks } from "../engine/detect";
import { evaluatePerAgentSkill, resolvePerAgentSkillWinner, type SkillEvalVerdict, type SkillWinnerResolution } from "../engine/eval-skill";
import { applyRefinements, generateRefineQuestions } from "../engine/refine-skill";
import { palette, truncateTo, useSpinner } from "./chrome";
import { CollisionPromptView, createQueuedCollisionHandler, type CollisionPrompt } from "./collision";
import {
  eligiblePerAgentEvals,
  EvalAppliedScreen,
  EvalConfirmScreen,
  EvalErrorScreen,
  EvalProgressScreen,
  EvalVerdictScreen,
  type PendingSkillEval
} from "./create-eval";
import { CreateStep } from "./CreateStep";
import { RefineScreen, RefineWaitScreen, type PendingAnswer, type PendingQuestion } from "./RefineScreen";

type Phase = "form" | "refining" | "questions" | "writing" | "done" | "evaluating" | "evalVerdict" | "evalConfirm" | "evalApplied" | "evalError";

type RequestStatus =
  | { kind: "pending" }
  | { kind: "running"; phase: SkillCreationPhase; agent?: CreateAgent }
  | { kind: "done"; outcome: SkillCreationOutcome };

function statusText(status: RequestStatus, request: SkillCreationRequest): { fg: string; text: string } {
  if (status.kind === "pending") {
    return { fg: palette.faint, text: "queued" };
  }

  if (status.kind === "done") {
    const outcome = status.outcome;
    return outcome.error
      ? { fg: palette.warn, text: `✗ ${truncateTo(outcome.error, 40)}` }
      : { fg: palette.success, text: `✓ ${outcome.name}${outcome.installed ? " (installed)" : ""}` };
  }

  // Per-agent legs run in parallel, so name them together rather than
  // flip-flopping between whichever leg emitted the latest event.
  const agent =
    request.mode === "per-agent" && request.agents.length > 1
      ? ` via ${request.agents.join(" + ")} (parallel)`
      : status.agent
        ? ` via ${status.agent}`
        : "";
  const phases: Record<SkillCreationPhase, string> = {
    creator: "pinning skill-creator",
    authoring: `authoring${agent}`,
    validating: "validating",
    installing: "installing"
  };
  return { fg: palette.gold, text: phases[status.phase] };
}

function CreateProgressScreen(props: {
  requests: SkillCreationRequest[];
  statuses: RequestStatus[];
  cancelling: boolean;
  collision: CollisionPrompt | null;
  onCancel: () => void;
}) {
  const spinner = useSpinner(true);
  const running = props.statuses.some((status) => status.kind !== "done");

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      props.onCancel();
      return;
    }

    if (props.collision) {
      if (key.name === "r") {
        props.collision.resolve("replace");
      } else if (key.name === "k" || key.name === "escape") {
        props.collision.resolve("keep");
      }
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={props.cancelling ? palette.warn : palette.accent}>
        {props.cancelling
          ? `${spinner}  Cancelling — killing the agent runs…`
          : running
            ? `${spinner}  Forging ${props.requests.length} skill(s) — up to 3 agent runs in parallel…`
            : "  ⚒  Finishing up…"}
      </text>
      <box style={{ flexDirection: "column", gap: 0 }}>
        {props.requests.map((request, index) => {
          const status = statusText(props.statuses[index] ?? { kind: "pending" }, request);
          const plan = `${request.agents.join("+")} · ${request.mode}`;

          return (
            <text key={`${request.description}-${index}`}>
              <span fg={palette.text}>{`  ${truncateTo(request.description, 30).padEnd(32)}`}</span>
              <span fg={status.fg}>{status.text.padEnd(30)}</span>
              <span fg={palette.faint}>{plan}</span>
            </text>
          );
        })}
      </box>
      {props.collision ? <CollisionPromptView collision={props.collision} /> : null}
      <text fg={palette.muted}>Each skill is a full agent run — expect minutes. ctrl+c cancels and kills the agent runs.</text>
    </box>
  );
}

type CreateAppProps = {
  targetDir: string;
  onExit: (code: number, message?: string) => void;
};

function CreateDoneScreen(props: { outcomes: SkillCreationOutcome[]; evalCandidate?: PendingSkillEval; onEvaluate: () => void; onExit: () => void }) {
  useKeyboard((key) => {
    if (key.name === "e" && props.evalCandidate) {
      props.onEvaluate();
      return;
    }

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed" || key.name === "escape" || key.name === "q") {
      props.onExit();
    }
  });

  const failed = props.outcomes.filter((outcome) => outcome.error).length;

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={failed === 0 ? palette.accent : palette.warn}>
        {failed === 0 ? "  ⚒  Skills forged." : `  ✗  ${failed} of ${props.outcomes.length} skill(s) failed.`}
      </text>
      <box style={{ flexDirection: "column", gap: 0 }}>
        {props.outcomes.map((outcome, index) => (
          <box key={`${outcome.name ?? index}`} style={{ flexDirection: "column", gap: 0 }}>
            <text>
              <span fg={outcome.error ? palette.warn : palette.success}>{outcome.error ? "✗ " : "✓ "}</span>
              <span fg={palette.text}>
                {outcome.error ? outcome.error : `${outcome.name}${outcome.installed ? " (installed)" : ""}`}
              </span>
            </text>
            {outcome.files.map((file) => (
              <text key={file} fg={palette.muted}>{`    ${file}`}</text>
            ))}
            {outcome.notes.map((note) => (
              <text key={note} fg={palette.faint}>{`    - ${note}`}</text>
            ))}
          </box>
        ))}
      </box>
      {props.evalCandidate ? (
        <text fg={palette.gold}>
          {"e "}
          <span fg={palette.muted}>{`evaluate ${props.evalCandidate.skillName} copies · enter close`}</span>
        </text>
      ) : (
        <text fg={palette.gold}>
          {"enter "}
          <span fg={palette.muted}>close</span>
        </text>
      )}
    </box>
  );
}

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
        current.map((status, index) =>
          index === event.index
            ? event.phase === "done"
              ? { kind: "done", outcome: event.outcome }
              : { kind: "running", phase: event.phase, agent: event.agent }
            : status
        )
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

    case "done":
      return (
        <CreateDoneScreen
          outcomes={outcomes}
          onExit={() => props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0)}
        />
      );
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
