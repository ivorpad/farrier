import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { CollisionDecision, CollisionInfo } from "../engine/create-skill";
import { palette } from "./chrome";

export type CollisionPrompt = {
  path: string;
  stagingPath?: string;
  resolve: (decision: CollisionDecision) => void;
};

export type CollisionChain = MutableRefObject<Promise<void>>;

export function createQueuedCollisionHandler(input: {
  signal: AbortSignal;
  chainRef: CollisionChain;
  setCollision: Dispatch<SetStateAction<CollisionPrompt | null>>;
}): (info: CollisionInfo) => Promise<CollisionDecision> {
  return (info) =>
    new Promise((resolve) => {
      input.chainRef.current = input.chainRef.current.then(
        () =>
          new Promise<void>((release) => {
            if (input.signal.aborted) {
              resolve("keep");
              release();
              return;
            }

            input.setCollision({
              path: info.path,
              stagingPath: info.stagingPath,
              resolve: (decision) => {
                input.setCollision(null);
                resolve(decision);
                release();
              }
            });
          })
      );
    });
}

export function CollisionPromptView(props: { collision: CollisionPrompt }) {
  const stagingText = props.collision.stagingPath ? `new copy stays in ${props.collision.stagingPath}` : "new copy stays in staging";

  return (
    <box style={{ flexDirection: "column", gap: 0 }}>
      <text>
        <span fg={palette.warn}>{"! "}</span>
        <span fg={palette.text}>{`${props.collision.path} already exists.`}</span>
      </text>
      <text>
        <span fg={palette.gold}>{"r"}</span>
        <span fg={palette.muted}>{" replace it with the new copy  ·  "}</span>
        <span fg={palette.gold}>{"k"}</span>
        <span fg={palette.muted}>{` keep the existing one (${stagingText})`}</span>
      </text>
    </box>
  );
}
