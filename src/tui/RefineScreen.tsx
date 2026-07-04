import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { AgentBackend } from "../engine/backend";
import type { ReasoningEffort } from "../config/farrier-config";
import type { SkillCreationRequest } from "../engine/create-skill";
import {
  applyRefinements,
  generateNextGrillQuestion,
  maxGrillQuestions,
  type RefineAnswer,
  type RefineQuestion
} from "../engine/refine-skill";
import { KeyHints, palette, useSpinner } from "./chrome";

const decideLabel = "Let the creator decide";
const typeLabel = "Type an answer…";

type GrillState =
  | { kind: "loading"; questionNumber: number }
  | { kind: "asking"; questionNumber: number; question: RefineQuestion };

/**
 * Self-contained grill for a single request: interview the requester one
 * question at a time (each adapting to the prior answers), then hand back the
 * request with the answers folded into its description. A null step, a thrown
 * step, or Esc all finish gracefully with the answers so far — grilling never
 * blocks creation.
 */
export function RefineFlow(props: {
  request: SkillCreationRequest;
  backend: AgentBackend;
  targetDir: string;
  packId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  progressLabel?: string;
  onDone: (refined: SkillCreationRequest) => void;
}) {
  const [state, setState] = useState<GrillState>({ kind: "loading", questionNumber: 1 });
  const [answers, setAnswers] = useState<RefineAnswer[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const finishedRef = useRef(false);

  function finish(finalAnswers: RefineAnswer[]): void {
    if (finishedRef.current) {
      return;
    }

    finishedRef.current = true;
    abortRef.current?.abort();
    props.onDone({ ...props.request, description: applyRefinements(props.request.description, finalAnswers) });
  }

  // Fetch the next question whenever we enter a loading state. Aborting kills
  // the in-flight backend subprocess (Esc, or unmount on process exit).
  useEffect(() => {
    if (state.kind !== "loading") {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    generateNextGrillQuestion({
      description: props.request.description,
      backend: props.backend,
      targetDir: props.targetDir,
      packId: props.packId,
      priorAnswers: answers,
      questionNumber: state.questionNumber,
      model: props.model,
      reasoningEffort: props.reasoningEffort,
      signal: controller.signal
    })
      .then((question) => {
        if (cancelled) {
          return;
        }

        if (question === null) {
          finish(answers);
        } else {
          setState({ kind: "asking", questionNumber: state.questionNumber, question });
        }
      })
      .catch(() => {
        // A malformed or aborted step stops the interview; proceed with the
        // answers already in hand.
        if (!cancelled) {
          finish(answers);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state, answers]);

  // Aborting an in-flight fetch on unmount must not orphan the subprocess.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Esc at any point — including while a question is loading — ends the grill.
  useKeyboard((key) => {
    if (key.name === "escape") {
      finish(answers);
    }
  });

  function onAnswer(answer: string): void {
    const next: RefineAnswer[] = [
      ...answers,
      { question: state.kind === "asking" ? state.question.question : "", answer }
    ];

    if (state.questionNumber >= maxGrillQuestions) {
      finish(next);
      return;
    }

    setAnswers(next);
    setState({ kind: "loading", questionNumber: state.questionNumber + 1 });
  }

  if (state.kind === "loading") {
    return <GrillWaitScreen backend={props.backend} questionNumber={state.questionNumber} />;
  }

  return (
    <GrillQuestionScreen
      key={state.questionNumber}
      backend={props.backend}
      questionNumber={state.questionNumber}
      question={state.question}
      progressLabel={props.progressLabel}
      onAnswer={onAnswer}
    />
  );
}

export function GrillWaitScreen(props: { backend: string; questionNumber: number }) {
  const spinner = useSpinner(true);

  const message =
    props.questionNumber === 1
      ? `${spinner}  ${props.backend} is sizing up the brief — first question coming…`
      : `${spinner}  ${props.backend} is thinking about your answer… (question ${props.questionNumber} of ≤${maxGrillQuestions})`;

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.accent}>{message}</text>
      <text fg={palette.muted}>esc that's enough — proceed with what you've answered so far.</text>
    </box>
  );
}

/**
 * One question at a time: the backend's concrete options first (its
 * recommendation leads), then an explicit "creator decides" escape hatch and
 * free text. Skipping is always one key — the interview must never feel like a
 * form the user is trapped in.
 */
export function GrillQuestionScreen(props: {
  backend: string;
  questionNumber: number;
  question: RefineQuestion;
  progressLabel?: string;
  onAnswer: (answer: string) => void;
}) {
  const [choice, setChoice] = useState(0);
  const [typing, setTyping] = useState(false);
  const [freeText, setFreeText] = useState("");

  const choices = [...props.question.options, decideLabel, typeLabel];

  useKeyboard((key) => {
    // Esc is owned by RefineFlow (it ends the grill from anywhere).
    if (key.name === "escape") {
      return;
    }

    if (typing) {
      if (key.name === "enter" || key.name === "return" || key.name === "linefeed") {
        props.onAnswer(freeText.trim());
      }
      return;
    }

    if (key.name === "s") {
      props.onAnswer("");
      return;
    }

    if (key.name === "up") {
      setChoice((current) => Math.max(current - 1, 0));
      return;
    }

    if (key.name === "down") {
      setChoice((current) => Math.min(current + 1, choices.length - 1));
      return;
    }

    if (key.name === "enter" || key.name === "return" || key.name === "linefeed") {
      const selected = choices[choice]!;

      if (selected === typeLabel) {
        setTyping(true);
        return;
      }

      props.onAnswer(selected === decideLabel ? "" : selected);
    }
  });

  const header = `? Grilling the brief — question ${props.questionNumber} of ≤${maxGrillQuestions} (via ${props.backend})${
    props.progressLabel ? ` · ${props.progressLabel}` : ""
  }`;

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.accent}>{header}</text>

      <text fg={palette.text}>{props.question.question}</text>

      <box style={{ flexDirection: "column", gap: 0 }}>
        {choices.map((option, optionIndex) => {
          const focused = optionIndex === choice;
          const isMeta = option === decideLabel || option === typeLabel;

          return (
            <text key={option} bg={focused && !typing ? palette.selBg : undefined}>
              <span fg={palette.accent}>{focused && !typing ? "▸ " : "  "}</span>
              <span fg={isMeta ? palette.faint : palette.text}>{option}</span>
              {optionIndex === 0 && !isMeta ? <span fg={palette.gold}>{"  ★ recommended"}</span> : null}
            </text>
          );
        })}
      </box>

      {typing ? (
        <input
          value={freeText}
          focused
          onInput={(value) => setFreeText(String(value))}
          placeholder="Your answer — enter confirms"
        />
      ) : null}

      <KeyHints hint="enter pick · ↑↓ move · s skip question · esc that's enough — proceed" />
    </box>
  );
}
