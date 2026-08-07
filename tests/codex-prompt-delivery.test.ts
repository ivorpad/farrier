import { describe, expect, test } from "bun:test";

import {
  buildCodexPromptDeliveryProof,
  validateCodexPromptDeliveryProof,
} from "../src/engine/evaluations/codex-prompt-delivery";

const digest = "a".repeat(64);
const producer = { adapterId: "codex-prompt-input-audit", version: "1.0.0", binarySha256: digest };
const instruction = new TextEncoder().encode("# Reglas\nUsa corrección exacta.\n");

function promptInput(text = `prefijo ✓\n${new TextDecoder().decode(instruction)}sufijo`): unknown {
  return [{ type: "message", role: "developer", content: [{ type: "input_text", text }] }];
}

describe("Codex prompt delivery proof", () => {
  test("proves one byte-exact model-visible instruction block", () => {
    const proof = buildCodexPromptDeliveryProof({
      promptInput: promptInput(),
      producer,
      instructionPath: "AGENTS.md",
      instructionBytes: instruction,
    });

    expect(validateCodexPromptDeliveryProof({
      proof,
      expectedProducer: producer,
      expectedInstructionPath: "AGENTS.md",
      expectedInstructionBytes: instruction,
    })).toEqual([]);
    expect(proof.instructionByteOffset).toBeGreaterThan("prefijo ✓\n".length);
    expect(proof.instructionOccurrences).toBe(1);
  });

  test("refuses missing or duplicate instruction delivery", () => {
    expect(() => buildCodexPromptDeliveryProof({
      promptInput: promptInput("no instructions"),
      producer,
      instructionPath: "AGENTS.md",
      instructionBytes: instruction,
    })).toThrow("observed 0");
    const repeated = `${new TextDecoder().decode(instruction)}${new TextDecoder().decode(instruction)}`;
    expect(() => buildCodexPromptDeliveryProof({
      promptInput: promptInput(repeated),
      producer,
      instructionPath: "AGENTS.md",
      instructionBytes: instruction,
    })).toThrow("observed 2");
  });

  test("rejects a forged block, adapter, or artifact digest", () => {
    const proof = buildCodexPromptDeliveryProof({
      promptInput: promptInput(),
      producer,
      instructionPath: "AGENTS.md",
      instructionBytes: instruction,
    });
    proof.instructionBlockBase64 = Buffer.from("replacement").toString("base64");
    proof.producer.adapterId = "other-adapter";
    proof.artifactDigest = "b".repeat(64);

    const problems = validateCodexPromptDeliveryProof({
      proof,
      expectedProducer: producer,
      expectedInstructionPath: "AGENTS.md",
      expectedInstructionBytes: instruction,
    });
    expect(problems).toContain("prompt delivery proof is not bound to the frozen adapter and instruction path.");
    expect(problems).toContain("model-visible prompt does not prove one exact instruction inclusion.");
    expect(problems).toContain("prompt delivery artifact digest is invalid.");
  });
});
