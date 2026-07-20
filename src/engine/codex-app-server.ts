export type CodexAppServerRequestOptions = {
  maxResponseBytes?: number;
  signal?: AbortSignal;
};

export type CodexAppServerClient = {
  request: (
    method: string,
    params?: Record<string, unknown>,
    options?: CodexAppServerRequestOptions,
  ) => Promise<unknown>;
  close: () => Promise<void>;
};

export type CodexAppServerFactory = () => Promise<CodexAppServerClient>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  maxResponseBytes: number;
  signal?: AbortSignal;
  abortHandler?: () => void;
};

type RpcMessage = {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
};

const requestTimeoutMs = 20_000;
const defaultResponseBytes = 4_000_000;
const maximumResponseBytes = 8_000_000;

function errorFromRpc(method: string, error: RpcMessage["error"]): Error {
  const code = error?.code === undefined ? "unknown" : String(error.code);
  return new Error(`Codex App Server ${method} failed (${code}): ${error?.message ?? "unknown error"}`);
}

function checkedResponseLimit(value: number | undefined): number {
  const limit = value ?? defaultResponseBytes;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > maximumResponseBytes) {
    throw new Error(`Codex App Server response limit must be between 1 and ${maximumResponseBytes} bytes.`);
  }
  return limit;
}

export const createCodexAppServerClient: CodexAppServerFactory = async () => {
  const proc = Bun.spawn({
    cmd: ["codex", "app-server"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdin = proc.stdin as unknown as { write(data: string): unknown; end(): unknown };
  const pending = new Map<number, PendingRequest>();
  const methodById = new Map<number, string>();
  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  let nextId = 0;
  let buffered = "";
  let closed = false;
  let stderr = "";

  const write = (message: unknown): void => {
    if (closed) throw new Error("Codex App Server client is closed");
    stdin.write(`${JSON.stringify(message)}\n`);
  };

  const clearRequest = (request: PendingRequest): void => {
    clearTimeout(request.timeout);
    if (request.signal && request.abortHandler) {
      request.signal.removeEventListener("abort", request.abortHandler);
    }
  };

  const rejectAll = (error: Error): void => {
    for (const request of pending.values()) {
      clearRequest(request);
      request.reject(error);
    }
    pending.clear();
    methodById.clear();
  };

  const rejectRequest = (id: number, error: Error): void => {
    const request = pending.get(id);
    if (!request) return;
    clearRequest(request);
    pending.delete(id);
    methodById.delete(id);
    request.reject(error);
  };

  const acceptMessage = (message: RpcMessage): void => {
    if (typeof message.id !== "number" || (!Object.hasOwn(message, "result") && !message.error)) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    const method = methodById.get(message.id) ?? "request";
    methodById.delete(message.id);
    clearRequest(request);
    if (message.error) request.reject(errorFromRpc(method, message.error));
    else request.resolve(message.result);
  };

  const pendingLineLimit = (): number => {
    let limit = 0;
    for (const request of pending.values()) limit = Math.max(limit, request.maxResponseBytes);
    return limit || defaultResponseBytes;
  };

  const acceptLine = (line: string): void => {
    if (!line.trim()) return;
    const byteCount = Buffer.byteLength(line);
    const idMatch = line.match(/"id"\s*:\s*(\d+)/);
    const id = idMatch ? Number(idMatch[1]) : undefined;
    if (id !== undefined) {
      const request = pending.get(id);
      if (request && byteCount > request.maxResponseBytes) {
        const method = methodById.get(id) ?? "request";
        rejectRequest(
          id,
          new Error(`Codex App Server ${method} response exceeded ${request.maxResponseBytes} bytes.`),
        );
        return;
      }
    }
    if (byteCount > pendingLineLimit()) {
      rejectAll(new Error("Codex App Server response exceeded the bounded response limit."));
      proc.kill();
      return;
    }
    try {
      acceptMessage(JSON.parse(line) as RpcMessage);
    } catch {
      // Bounded non-JSON diagnostics are ignored; request timeouts still fail safely.
    }
  };

  const stdoutLoop = (async () => {
    if (!proc.stdout) return;
    for await (const chunk of proc.stdout) {
      buffered += stdoutDecoder.decode(chunk, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        acceptLine(line);
        newline = buffered.indexOf("\n");
      }
      if (Buffer.byteLength(buffered) > pendingLineLimit()) {
        buffered = "";
        rejectAll(new Error("Codex App Server response exceeded the bounded response limit."));
        proc.kill();
      }
    }
  })();

  const stderrLoop = (async () => {
    if (!proc.stderr) return;
    for await (const chunk of proc.stderr) {
      if (stderr.length < 4_000) stderr += stderrDecoder.decode(chunk, { stream: true });
    }
  })();

  void proc.exited.then((exitCode) => {
    if (!closed) {
      const detail = stderr.trim() ? `: ${stderr.trim()}` : "";
      rejectAll(new Error(`Codex App Server exited with code ${exitCode}${detail}`));
    }
  });

  const request = (
    method: string,
    params: Record<string, unknown> = {},
    options: CodexAppServerRequestOptions = {},
  ): Promise<unknown> => {
    const maxResponseBytes = checkedResponseLimit(options.maxResponseBytes);
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const request = pending.get(id);
        if (request) clearRequest(request);
        pending.delete(id);
        methodById.delete(id);
        reject(new Error(`Codex App Server ${method} timed out`));
      }, requestTimeoutMs);
      const abortHandler = options.signal
        ? () => rejectRequest(id, new Error(`Codex App Server ${method} was cancelled.`))
        : undefined;
      pending.set(id, {
        resolve,
        reject,
        timeout,
        maxResponseBytes,
        signal: options.signal,
        abortHandler,
      });
      methodById.set(id, method);
      if (abortHandler) options.signal?.addEventListener("abort", abortHandler, { once: true });
      if (options.signal?.aborted) {
        rejectRequest(id, new Error(`Codex App Server ${method} was cancelled.`));
        return;
      }
      try {
        write({ method, id, params });
      } catch (error) {
        const request = pending.get(id);
        if (request) clearRequest(request);
        pending.delete(id);
        methodById.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  await request("initialize", {
    clientInfo: { name: "farrier", title: "Farrier", version: "0.3.0" },
  });
  write({ method: "initialized", params: {} });

  return {
    request,
    close: async () => {
      if (closed) return;
      closed = true;
      rejectAll(new Error("Codex App Server client closed"));
      try {
        stdin.end();
      } catch {
        // The process may already have exited.
      }
      proc.kill();
      await Promise.allSettled([proc.exited, stdoutLoop, stderrLoop]);
    },
  };
};
