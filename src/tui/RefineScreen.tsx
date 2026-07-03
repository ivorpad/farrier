import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import type { AgentBackend } from "../engine/backend";
import type { SkillCreationRequest } from "../engine/create-skill";
import { applyRefinements, generateRefineQuestions, type RefineAnswer, type RefineQuestion } from "../engine/refine-skill";
import { KeyHints, palette, truncateTo, useSpinner } from "./chrome";

export type PendingQuestion = {
  requestIndex: number;
  description: string;
  question: RefineQuestion;
};

export type PendingAnswer = RefineAnswer & { requestIndex: number };

type RefineScreenProps = {
  items: PendingQuestion[];
  backend: string;
  onDone: (answers: PendingAnswer[]) => void;
};

const decideLabel = "Let the creator decide";
const typeLabel = "Type an answer…";

export function RefineWaitScreen(props: { backend: string; count: number }) {
  const spinner = useSpinner(true);

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.accent}>{`${spinner}  Asking ${props.backend} what the brief leaves open for ${props.count} skill(s)…`}</text>
      <text fg={palette.muted}>One quick read-only call — your answers become explicit implementation decisions for the skill-creator.</text>
    </box>
  );
}

/**
 * Self-contained refine flow for a single request: generate questions (wait
 * screen), ask them, hand back the request with the answers folded into its
 * description. Generation failures or zero questions pass the request through
 * untouched — refinement never blocks creation.
 */
export function RefineFlow(props: {
  request: SkillCreationRequest;
  backend: AgentBackend;
  targetDir: string;
  packId?: string;
  onDone: (refined: SkillCreationRequest) => void;
}) {
  const [items, setItems] = useState<PendingQuestion[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    generateRefineQuestions({
      description: props.request.description,
      backend: props.backend,
      targetDir: props.targetDir,
      packId: props.packId
    })
      .then((questions) => {
        if (cancelled) {
          return;
        }

        if (questions.length === 0) {
          props.onDone(props.request);
        } else {
          setItems(questions.map((question) => ({ requestIndex: 0, description: props.request.description, question })));
        }
      })
      .catch(() => {
        if (!cancelled) {
          props.onDone(props.request);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!items) {
    return <RefineWaitScreen backend={props.backend} count={1} />;
  }

  return (
    <RefineScreen
      items={items}
      backend={props.backend}
      onDone={(answers) => props.onDone({ ...props.request, description: applyRefinements(props.request.description, answers) })}
    />
  );
}

/**
 * One question at a time: the backend's concrete options first (its
 * recommendation leads), then an explicit "creator decides" escape hatch and
 * free text. Skipping is always one key — questions must never feel like a
 * form the user is trapped in.
 */
export function RefineScreen(props: RefineScreenProps) {
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState(0);
  const [typing, setTyping] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [answers, setAnswers] = useState<PendingAnswer[]>([]);

  const item = props.items[index];

  if (!item) {
    return null;
  }

  const choices = [...item.question.options, decideLabel, typeLabel];

  function advance(answer: string): void {
    const next: PendingAnswer[] = [
      ...answers,
      { requestIndex: item!.requestIndex, question: item!.question.question, answer }
    ];

    if (index + 1 >= props.items.length) {
      props.onDone(next);
      return;
    }

    setAnswers(next);
    setIndex(index + 1);
    setChoice(0);
    setTyping(false);
    setFreeText("");
  }

  function skipRemaining(): void {
    props.onDone(answers);
  }

  useKeyboard((key) => {
    if (key.name === "escape") {
      skipRemaining();
      return;
    }

    if (typing) {
      if (key.name === "enter" || key.name === "return" || key.name === "linefeed") {
        advance(freeText.trim());
      }
      return;
    }

    if (key.name === "s") {
      advance("");
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

      advance(selected === decideLabel ? "" : selected);
    }
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column", gap: 0 }}>
        <text fg={palette.accent}>{`? Pinning down the brief — question ${index + 1} of ${props.items.length} (via ${props.backend})`}</text>
        <text fg={palette.muted}>{truncateTo(item.description, 76)}</text>
      </box>

      <text fg={palette.text}>{item.question.question}</text>

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

      <KeyHints hint="enter pick · ↑↓ move · s skip question · esc skip the rest" />
    </box>
  );
}
