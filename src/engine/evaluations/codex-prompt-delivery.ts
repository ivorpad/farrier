import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalEvidence } from "../behavior-evidence";
import type { IndependentAuditProducer } from "./prospective-independent-audit";

export type CodexPromptDeliveryProof = {
  schemaVersion: 1;
  producer: IndependentAuditProducer;
  instructionPath: string;
  promptInputSha256: string;
  promptInputBytes: number;
  inputItemCount: number;
  textBlockCount: number;
  instructionBlockIndex: number;
  instructionBlockBase64: string;
  instructionByteOffset: number;
  instructionOccurrences: 1;
  loadedInstructionDigest: string;
  artifactDigest: string;
};

const SHA256 = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function proofBody(proof: Omit<CodexPromptDeliveryProof, "artifactDigest">): object {
  return proof;
}

function textBlocks(promptInput: unknown): string[] {
  if (!Array.isArray(promptInput)) throw new Error("Codex prompt input must be an array.");
  return promptInput.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return [];
      const text = (block as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    });
  });
}

function occurrences(container: string, needle: string): number {
  if (!needle.length) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = container.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

export function buildCodexPromptDeliveryProof(input: {
  promptInput: unknown;
  producer: IndependentAuditProducer;
  instructionPath: string;
  instructionBytes: Uint8Array;
}): CodexPromptDeliveryProof {
  const instruction = new TextDecoder("utf8", { fatal: true }).decode(input.instructionBytes);
  const blocks = textBlocks(input.promptInput);
  const matches = blocks.map((block, index) => ({ block, index, count: occurrences(block, instruction) }))
    .filter((match) => match.count > 0);
  const total = matches.reduce((sum, match) => sum + match.count, 0);
  if (total !== 1 || matches.length !== 1) {
    throw new Error(`model-visible prompt must contain the exact instruction bytes once; observed ${total}.`);
  }
  const match = matches[0]!;
  const characterOffset = match.block.indexOf(instruction);
  const byteOffset = encoder.encode(match.block.slice(0, characterOffset)).byteLength;
  const canonical = canonicalEvidence(input.promptInput);
  const withoutDigest: Omit<CodexPromptDeliveryProof, "artifactDigest"> = {
    schemaVersion: 1,
    producer: { ...input.producer },
    instructionPath: input.instructionPath,
    promptInputSha256: sha256(canonical),
    promptInputBytes: encoder.encode(canonical).byteLength,
    inputItemCount: (input.promptInput as unknown[]).length,
    textBlockCount: blocks.length,
    instructionBlockIndex: match.index,
    instructionBlockBase64: Buffer.from(match.block, "utf8").toString("base64"),
    instructionByteOffset: byteOffset,
    instructionOccurrences: 1,
    loadedInstructionDigest: sha256(input.instructionBytes),
  };
  return { ...withoutDigest, artifactDigest: sha256(canonicalEvidence(proofBody(withoutDigest))) };
}

export async function captureCodexPromptDeliveryProof(input: {
  codexBinary?: string;
  cwd: string;
  prompt: string;
  producer: IndependentAuditProducer;
  instructionPath: string;
  instructionBytes: Uint8Array;
  configOverrides?: readonly string[];
}): Promise<CodexPromptDeliveryProof> {
  const isolatedCodexDirectory = await mkdtemp(join(tmpdir(), "farrier-codex-prompt-input-"));
  try {
    const config = (input.configOverrides ?? []).flatMap((value) => ["-c", value]);
    const process = Bun.spawn([
      input.codexBinary ?? "codex",
      "-C", input.cwd,
      "debug", "prompt-input",
      ...config,
      input.prompt,
    ], {
      env: { ...Bun.env, CODEX_HOME: isolatedCodexDirectory },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode !== 0) throw new Error(`codex debug prompt-input failed (${exitCode}): ${stderr.trim()}`);
    let promptInput: unknown;
    try {
      promptInput = JSON.parse(stdout);
    } catch {
      throw new Error("codex debug prompt-input did not return JSON.");
    }
    return buildCodexPromptDeliveryProof({
      promptInput,
      producer: input.producer,
      instructionPath: input.instructionPath,
      instructionBytes: input.instructionBytes,
    });
  } finally {
    await rm(isolatedCodexDirectory, { recursive: true, force: true });
  }
}

function exactProducer(actual: IndependentAuditProducer, expected: IndependentAuditProducer): boolean {
  return actual.adapterId === expected.adapterId && actual.version === expected.version
    && actual.binarySha256 === expected.binarySha256;
}

export function validateCodexPromptDeliveryProof(input: {
  proof: CodexPromptDeliveryProof;
  expectedProducer: IndependentAuditProducer;
  expectedInstructionPath: string;
  expectedInstructionBytes: Uint8Array;
}): string[] {
  const { proof } = input;
  const problems: string[] = [];
  let block = "";
  try {
    const bytes = Buffer.from(proof.instructionBlockBase64, "base64");
    if (bytes.toString("base64") !== proof.instructionBlockBase64) problems.push("prompt delivery block is not canonical base64.");
    block = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  } catch {
    problems.push("prompt delivery block is not valid UTF-8 base64.");
  }
  const instruction = new TextDecoder("utf8", { fatal: true }).decode(input.expectedInstructionBytes);
  const characterOffset = block.indexOf(instruction);
  const byteOffset = characterOffset < 0 ? -1 : encoder.encode(block.slice(0, characterOffset)).byteLength;
  if (proof.schemaVersion !== 1 || !exactProducer(proof.producer, input.expectedProducer)
    || proof.instructionPath !== input.expectedInstructionPath) problems.push("prompt delivery proof is not bound to the frozen adapter and instruction path.");
  if (!SHA256.test(proof.promptInputSha256) || proof.promptInputBytes < 1
    || proof.inputItemCount < 1 || proof.textBlockCount < 1 || proof.instructionBlockIndex < 0) {
    problems.push("prompt delivery source artifact metadata is invalid.");
  }
  if (proof.instructionOccurrences !== 1 || occurrences(block, instruction) !== 1
    || proof.instructionByteOffset !== byteOffset || proof.loadedInstructionDigest !== sha256(input.expectedInstructionBytes)) {
    problems.push("model-visible prompt does not prove one exact instruction inclusion.");
  }
  const { artifactDigest: _, ...body } = proof;
  if (!SHA256.test(proof.artifactDigest)
    || proof.artifactDigest !== sha256(canonicalEvidence(proofBody(body)))) problems.push("prompt delivery artifact digest is invalid.");
  return problems;
}
