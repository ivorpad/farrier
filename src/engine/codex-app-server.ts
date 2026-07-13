export type CodexAppServerClient = {
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

export type CodexAppServerFactory = () => Promise<CodexAppServerClient>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type RpcMessage = {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
};

const requestTimeoutMs = 20_000;

function errorFromRpc(method: string, error: RpcMessage["error"]): Error {
  const code = error?.code === undefined ? "unknown" : String(error.code);
  return new Error(`Codex App Server ${method} failed (${code}): ${error?.message ?? "unknown error"}`);
}

export const createCodexAppServerClient: CodexAppServerFactory = async () => {
  const proc = Bun.spawn({
    cmd: ["codex", "app-server"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
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

  const rejectAll = (error: Error): void => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
    methodById.clear();
  };

  const acceptMessage = (message: RpcMessage): void => {
    if (typeof message.id !== "number" || (!Object.hasOwn(message, "result") && !message.error)) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    const method = methodById.get(message.id) ?? "request";
    methodById.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(errorFromRpc(method, message.error));
    else request.resolve(message.result);
  };

  const stdoutLoop = (async () => {
    if (!proc.stdout) return;
    for await (const chunk of proc.stdout) {
      buffered += stdoutDecoder.decode(chunk, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.trim()) {
          try {
            acceptMessage(JSON.parse(line) as RpcMessage);
          } catch {
            // Non-JSON diagnostics are ignored; request timeouts still fail safely.
          }
        }
        newline = buffered.indexOf("\n");
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

  const request = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        methodById.delete(id);
        reject(new Error(`Codex App Server ${method} timed out`));
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timeout });
      methodById.set(id, method);
      try {
        write({ method, id, params });
      } catch (error) {
        clearTimeout(timeout);
        pending.delete(id);
        methodById.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  await request("initialize", {
    clientInfo: { name: "farrier", title: "Farrier", version: "0.2.0" }
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
    }
  };
};
