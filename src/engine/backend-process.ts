import { createHash } from "node:crypto";
import { redactText } from "./behavior-evidence";

export type BackendOutputLimits = {
  stdoutBytes: number;
  stderrBytes: number;
  diagnosticTailBytes: number;
  lineBytes: number;
};

export type BackendStreamCapture = {
  byteCount: number;
  sha256: string;
  truncated: boolean;
};

export const defaultBackendOutputLimits: BackendOutputLimits = {
  stdoutBytes: 1024 * 1024,
  stderrBytes: 256 * 1024,
  diagnosticTailBytes: 16 * 1024,
  lineBytes: 64 * 1024
};

const encoder = new TextEncoder();

function validateLimit(name: keyof BackendOutputLimits, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`backend output limit ${name} must be a positive safe integer`);
  }
}

export function resolveBackendOutputLimits(limits?: BackendOutputLimits): BackendOutputLimits {
  const resolved = limits ?? defaultBackendOutputLimits;
  for (const [name, value] of Object.entries(resolved) as Array<[keyof BackendOutputLimits, number]>) {
    validateLimit(name, value);
  }
  return { ...resolved };
}

function boundUtf8(
  value: string,
  maxBytes: number,
  retain: "head" | "tail",
): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return { text: value, truncated: false };
  if (retain === "head") {
    let end = maxBytes;
    while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
  }
  let start = bytes.byteLength - maxBytes;
  while (start < bytes.byteLength && (bytes[start]! & 0xc0) === 0x80) start += 1;
  return { text: bytes.subarray(start).toString("utf8"), truncated: true };
}

function progressTruncationNotice(maxBytes: number): string {
  const notice = "[stdout line truncated]";
  if (Buffer.byteLength(notice) <= maxBytes) return notice;
  if (maxBytes >= 5) return "[cut]";
  return ".".repeat(maxBytes);
}

function emitLine(callback: ((line: string) => void) | undefined, line: string): void {
  if (!callback || line.trim() === "") return;
  try {
    callback(line);
  } catch {
    // A progress renderer must not terminate the external process.
  }
}

export async function captureBackendStream(input: {
  stream: ReadableStream<Uint8Array> | null;
  retainBytes: number;
  retain: "head" | "tail";
  lineBytes: number;
  onLine?: (line: string) => void;
  redactValues: readonly string[];
}): Promise<{ text: string; capture: BackendStreamCapture }> {
  const hash = createHash("sha256");
  let byteCount = 0;
  let retained = Buffer.alloc(0);
  let pendingLine = Buffer.alloc(0);
  let discardingLine = false;
  const storageBytes = input.retain === "tail"
    ? input.retainBytes + maxRedactValueBytes(input.redactValues)
    : input.retainBytes;

  if (input.stream) {
    for await (const raw of input.stream as unknown as AsyncIterable<Uint8Array>) {
      const chunk = Buffer.from(raw);
      byteCount += chunk.byteLength;
      hash.update(chunk);

      if (input.retain === "head") {
        const available = input.retainBytes - retained.byteLength;
        if (available > 0) retained = Buffer.concat([retained, chunk.subarray(0, available)]);
      } else {
        retained = Buffer.concat([retained, chunk]);
        if (retained.byteLength > storageBytes) retained = retained.subarray(retained.byteLength - storageBytes);
      }

      if (!input.onLine) continue;
      let offset = 0;
      while (offset < chunk.byteLength) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.byteLength : newline;
        const fragment = chunk.subarray(offset, end);

        if (!discardingLine) {
          if (pendingLine.byteLength + fragment.byteLength > input.lineBytes) {
            pendingLine = Buffer.alloc(0);
            discardingLine = true;
          } else if (fragment.byteLength > 0) {
            pendingLine = Buffer.concat([pendingLine, fragment]);
          }
        }

        if (newline < 0) break;
        if (discardingLine) {
          emitLine(input.onLine, progressTruncationNotice(input.lineBytes));
        } else {
          const redactedLine = redactText(new TextDecoder().decode(pendingLine), input.redactValues);
          const boundedLine = boundUtf8(redactedLine, input.lineBytes, "head");
          emitLine(
            input.onLine,
            boundedLine.truncated ? progressTruncationNotice(input.lineBytes) : boundedLine.text,
          );
        }
        pendingLine = Buffer.alloc(0);
        discardingLine = false;
        offset = newline + 1;
      }
    }
  }

  const rawTruncated = byteCount > input.retainBytes;
  const sha256 = hash.digest("hex");
  const rendered = rawTruncated && input.retain === "head"
    ? `[stdout truncated: received ${byteCount} bytes; sha256 ${sha256}]`
    : redactText(new TextDecoder().decode(retained), input.redactValues);
  const bounded = boundUtf8(rendered, input.retainBytes, input.retain);
  return {
    text: bounded.text,
    capture: {
      byteCount,
      sha256,
      truncated: rawTruncated || bounded.truncated,
    },
  };
}

export function boundedBackendDiagnostic(
  stderr: string,
  redactValues: readonly string[],
  maxBytes: number
): string {
  return boundUtf8(redactText(stderr, redactValues).trim(), maxBytes, "tail").text;
}

export function emptyBackendCapture(): BackendStreamCapture {
  return {
    byteCount: 0,
    sha256: createHash("sha256").digest("hex"),
    truncated: false
  };
}

export function maxRedactValueBytes(values: readonly string[]): number {
  return values.reduce((maximum, value) => Math.max(maximum, encoder.encode(value).byteLength), 0);
}


function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    return code !== "ESRCH";
  }
}

export function createProcessGroupTerminator(pid: number, killRoot: () => void): {
  terminate: () => void;
  rootExited: () => void;
  wait: () => Promise<void>;
  dispose: () => void;
} {
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> | undefined;
  let resolvePending: (() => void) | undefined;

  const finish = () => {
    if (forceTimer) clearTimeout(forceTimer);
    if (pollTimer) clearInterval(pollTimer);
    forceTimer = undefined;
    pollTimer = undefined;
    resolvePending?.();
    resolvePending = undefined;
  };
  const rootExited = () => {
    if (!processGroupExists(pid)) finish();
  };
  const terminate = () => {
    if (pending) return;
    pending = new Promise<void>((resolve) => { resolvePending = resolve; });
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      killRoot();
    }
    pollTimer = setInterval(rootExited, 25);
    pollTimer.unref?.();
    forceTimer = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        finish();
        return;
      }
      forceTimer = setTimeout(finish, 500);
      forceTimer.unref?.();
    }, 500);
    forceTimer.unref?.();
  };

  return {
    terminate,
    rootExited,
    wait: () => pending ?? Promise.resolve(),
    dispose: finish
  };
}
